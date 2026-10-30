import type { Pool } from "pg";
import { ensureLaboratorySchema } from "./laboratory-schema.js";
import type { LabImportPlan } from "./lab-import-plan.js";
import { validateLabImportPlan } from "./validate-lab-import.js";

export async function applyLabImport(db:Pool,plan:LabImportPlan,backupWriter:(backup:unknown)=>Promise<void>) {
  validateLabImportPlan(plan);
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`lab-import:${plan.tenant_id}`]);
    const tenant=await client.query(`SELECT h.name,b.name branch_name FROM hospitals h JOIN branches b ON b.tenant_id=h.id WHERE h.id=$1 AND b.id=$2`,[plan.tenant_id,plan.branch_id]);
    if(!tenant.rows[0])throw new Error("Import hospital/branch does not exist or belongs to another tenant");
    if(plan.summary.branch_mapping){const ids=[...new Set(Object.values(plan.summary.branch_mapping.centers))];const branches=await client.query(`SELECT id FROM branches WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND is_active=true`,[plan.tenant_id,ids]);if(branches.rowCount!==ids.length)throw new Error("Mapped branches must be active and belong to the import hospital");}
    await ensureLaboratorySchema(client);
    // Prevent concurrent laboratory writes while taking the backup and replacing records.
    await client.query("LOCK TABLE role_work_items,hospital_diagnostic_masters,finance_records IN SHARE ROW EXCLUSIVE MODE");
    const old=await client.query(`SELECT * FROM role_work_items WHERE tenant_id=$1 AND workspace='laboratory' AND lower(kind) IN ('orders','pos','sample collection','results','verification','reports')`,[plan.tenant_id]);
    const oldMasters=await client.query(`SELECT * FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology'`,[plan.tenant_id]);
    const invoiceIds=await client.query(`WITH RECURSIVE ids AS (
      SELECT id FROM finance_records WHERE tenant_id=$1 AND (data->>'lab_order_id'=ANY($2::text[]) OR lower(data->>'source')='laboratory')
      UNION SELECT f.id FROM finance_records f JOIN ids i ON f.invoice_id=i.id WHERE f.tenant_id=$1
    ) SELECT f.* FROM finance_records f JOIN ids i ON f.id=i.id`,[plan.tenant_id,old.rows.map(row=>row.id)]);
    const referralTable=await client.query(`SELECT to_regclass('public.referral_commissions') exists`);
    if(referralTable.rows[0].exists){
      const dependencies=await client.query(`SELECT count(*)::int count FROM referral_commissions WHERE tenant_id=$1 AND invoice_id=ANY($2::uuid[])`,[plan.tenant_id,invoiceIds.rows.map(row=>row.id)]);
      if(dependencies.rows[0].count)throw new Error("Existing lab invoices have referral commissions. Reconcile these before replacing financial history.");
    }
    const controls=await client.query(`SELECT * FROM lab_qc_controls WHERE tenant_id=$1`,[plan.tenant_id]);
    const qcRuns=await client.query(`SELECT * FROM lab_qc_runs WHERE tenant_id=$1`,[plan.tenant_id]);
    const backup={tenant:tenant.rows[0],masters:oldMasters.rows,orders:old.rows,finance:invoiceIds.rows,qc_controls:controls.rows,qc_runs:qcRuns.rows,created_at:new Date().toISOString()};
    await backupWriter(backup);
    const run=await client.query(`INSERT INTO lab_import_runs(tenant_id,summary,backup,status) VALUES($1,$2,$3,'Applying') RETURNING id`,[plan.tenant_id,plan.summary,backup]);
    const importId=run.rows[0].id;
    await client.query(`DELETE FROM lab_qc_runs WHERE tenant_id=$1`,[plan.tenant_id]);
    await client.query(`DELETE FROM lab_qc_controls WHERE tenant_id=$1`,[plan.tenant_id]);
    await client.query(`DELETE FROM finance_records WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,[plan.tenant_id,invoiceIds.rows.map(row=>row.id)]);
    await client.query(`DELETE FROM role_work_items WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,[plan.tenant_id,old.rows.map(row=>row.id)]);
    await client.query(`DELETE FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology'`,[plan.tenant_id]);
    for(let offset=0;offset<plan.masters.length;offset+=500)await client.query(`INSERT INTO hospital_diagnostic_masters(id,tenant_id,domain,kind,name,data) SELECT x.id,$1,'pathology',x.kind,x.name,x.data FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,kind text,name text,data jsonb)`,[plan.tenant_id,JSON.stringify(plan.masters.slice(offset,offset+500))]);
    const existing=await client.query(`SELECT id,medical_record_number,address FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL`,[plan.tenant_id]);
    const byUhid=new Map(existing.rows.map(row=>[String(row.medical_record_number).toLowerCase(),row.id]));
    const byLegacy=new Map(existing.rows.filter(row=>row.address?.legacy_lab_patient_id).map(row=>[String(row.address.legacy_lab_patient_id),row.id]));
    const patientIds=new Map<string,string>();
    for(const patient of plan.patients){
      const source=patient.source,uhid=String(source.uhid||`LEGACY-LAB-${patient.legacy_id}`);
      const matched=byUhid.get(uhid.toLowerCase())||byLegacy.get(patient.legacy_id);
      if(matched){patientIds.set(patient.legacy_id,matched);continue;}
      const fullName=String(source.name||"").trim();
      if(!fullName)continue;
      const parts=fullName.split(/\s+/),first=parts.shift()!;
      const dob=/^\d{4}-\d{2}-\d{2}$/.test(source.dob||"")&&source.dob>"1900-01-01"&&source.dob<=new Date().toISOString().slice(0,10)?source.dob:null;
      const sex=({MALE:"male",FEMALE:"female",M:"male",F:"female",OTHER:"other"} as Record<string,string>)[String(source.sex).toUpperCase()]||"unknown";
      const inserted=await client.query(`INSERT INTO patients(id,tenant_id,branch_id,medical_record_number,first_name,last_name,date_of_birth,sex,phone,email,blood_group,address) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(tenant_id,medical_record_number) DO UPDATE SET medical_record_number=patients.medical_record_number RETURNING id`,[patient.id,plan.tenant_id,patient.branch_id||plan.branch_id,uhid,first,parts.join(" "),dob,sex,source.phone||null,source.email||null,source.blood_group||null,{line:source.address||"",legacy_lab_patient_id:patient.legacy_id,legacy_lab_source:source}]);
      patientIds.set(patient.legacy_id,inserted.rows[0].id);byUhid.set(uhid.toLowerCase(),inserted.rows[0].id);
    }
    for(const order of plan.orders){
      if(!order.occurred_at)throw new Error("Order has no valid original timestamp; import aborted");
      const patientId=patientIds.get(order.legacy_patient_id)||byLegacy.get(order.legacy_patient_id)||null;
      order.data.unlinked_patient=!patientId;
      await client.query(`INSERT INTO role_work_items(id,tenant_id,branch_id,patient_id,workspace,kind,title,status,priority,data,occurred_at) VALUES($1,$2,$3,$4,'laboratory',$5,$6,$7,'Normal',$8,$9)`,[order.id,plan.tenant_id,Object.hasOwn(order,"branch_id")?order.branch_id:plan.branch_id,patientId,order.kind,`Imported Lab · ${order.data.customer_name}`,order.status,{...order.data,import_id:importId},order.occurred_at]);
    }
    for(const invoice of plan.invoices)await client.query(`INSERT INTO finance_records(id,tenant_id,kind,record_number,patient_id,branch_id,data,amount,total,paid,due,status,record_date) VALUES($1,$2,'invoices',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[invoice.id,plan.tenant_id,invoice.record_number,patientIds.get(invoice.legacy_patient_id)||byLegacy.get(invoice.legacy_patient_id)||null,Object.hasOwn(invoice,"branch_id")?invoice.branch_id:plan.branch_id,{...invoice.data,import_id:importId},invoice.amount,invoice.total,invoice.paid,invoice.due,invoice.status,invoice.record_date]);
    for(let offset=0;offset<plan.legacy.length;offset+=1000)await client.query(`INSERT INTO lab_legacy_audit(tenant_id,import_id,source_table,source_key,data) SELECT $1,$2,x.table,x.key,x.data FROM jsonb_to_recordset($3::jsonb) AS x("table" text,key text,data jsonb)`,[plan.tenant_id,importId,JSON.stringify(plan.legacy.slice(offset,offset+1000))]);
    const counts=await client.query(`SELECT (SELECT count(*) FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology') masters,(SELECT count(*) FROM role_work_items WHERE tenant_id=$1 AND data->>'import_id'=$2) orders`,[plan.tenant_id,importId]);
    if(Number(counts.rows[0].masters)!==plan.masters.length||Number(counts.rows[0].orders)!==plan.orders.length)throw new Error("Imported record counts failed verification");
    await client.query(`UPDATE lab_import_runs SET status='Completed',summary=summary||$1::jsonb WHERE id=$2`,[JSON.stringify({verified_counts:counts.rows[0],unlinked_orders:plan.orders.filter(order=>order.data.unlinked_patient).length}),importId]);
    await client.query("COMMIT");
    return {import_id:importId,hospital:tenant.rows[0].name,verified:counts.rows[0]};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
