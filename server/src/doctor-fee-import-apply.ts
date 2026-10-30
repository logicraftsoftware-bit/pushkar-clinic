import {createHash,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {consultationFee,departmentKey,doctorName,planDoctorFeeImport,type DoctorFeeSource} from "./doctor-fee-import-plan.js";
type Row=Record<string,any>;

export async function applyDoctorFees(client:PoolClient,tenant:string,branches:Record<"main"|"hatigaon",Row>,sources:DoctorFeeSource[]){
  const hash=createHash("sha256").update("medicity-doctor-fees-v1:"+JSON.stringify(sources)).digest("hex");
  await client.query("BEGIN");
  try{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${tenant}:doctor-fee-import`]);
    await client.query(`CREATE TABLE IF NOT EXISTS doctor_fee_import_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id),source_hash text NOT NULL,backup jsonb NOT NULL,summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,source_hash))`);
    const prior=await client.query("SELECT summary FROM doctor_fee_import_runs WHERE tenant_id=$1 AND source_hash=$2",[tenant,hash]);
    if(prior.rows[0]){await client.query("COMMIT");return {...prior.rows[0].summary,already_applied:true};}
    const found=await client.query(`SELECT s.*,concat_ws(' ',s.first_name,s.middle_name,s.last_name) name,d.name department FROM staff_members s LEFT JOIN departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.staff_type='Doctor' FOR UPDATE OF s`,[tenant]);
    const plan=planDoctorFeeImport(sources,found.rows);
    const departments=(await client.query("SELECT id,branch_id,name,code FROM departments WHERE tenant_id=$1",[tenant])).rows;
    const affected=plan.flatMap(item=>item.existingMatches),userIds=affected.map(row=>row.user_id).filter(Boolean);
    const users=userIds.length?(await client.query("SELECT id,branch_id,department_id,first_name,last_name FROM users WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[tenant,userIds])).rows:[];
    const memberships=userIds.length?(await client.query("SELECT user_id,branch_id FROM user_branch_access WHERE tenant_id=$1 AND user_id=ANY($2::uuid[])",[tenant,userIds])).rows:[];
    const backup={staff:affected,users,memberships,new_staff_ids:[] as string[],new_user_ids:[] as string[],new_department_ids:[] as string[]};
    const summary={updated:0,added:0,departments_added:0,pending_fees:[] as string[],missing_departments:[] as string[],source_rows:sources.length,branch_rows:{hatigaon:0,main:0},doctors:[] as Row[]};
    async function department(branchId:string,name:string){
      if(!name)return null;
      const key=departmentKey(name);
      const existing=departments.find(row=>row.branch_id===branchId&&departmentKey(row.name)===key)||departments.find(row=>!row.branch_id&&departmentKey(row.name)===key);
      if(existing)return existing.id;
      const code=`DOC-${createHash("sha256").update(branchId+key).digest("hex").slice(0,10).toUpperCase()}`;
      const added=(await client.query(`INSERT INTO departments(tenant_id,branch_id,name,code) VALUES($1,$2,$3,$4) RETURNING id,branch_id,name,code`,[tenant,branchId,name.replace(/\\u0026/g,"&"),code])).rows[0];
      departments.push(added);backup.new_department_ids.push(added.id);summary.departments_added++;return added.id;
    }
    for(const item of plan){
      const primary=item.entries.find(entry=>branches[entry.branch].id===item.existing?.branch_id)||item.entries.find(entry=>entry.branch==="main")||item.entries[0]!;
      const branch=branches[primary.branch];
      const name=doctorName(primary.name).split(" ").map(word=>word.length<=2?word:word[0]!.toUpperCase()+word.slice(1).toLowerCase()).join(" ");
      const parts=name.split(" "),last=parts.length>1?parts.pop()!:"";
      const first=`Dr. ${parts.join(" ")}`;
      const matches:Row[]=item.existingMatches.length?item.existingMatches:[{id:randomUUID(),user_id:null,professional:{},branch_id:branch.id}];
      const defaultDepartment=primary.department||item.entries.find(entry=>entry.department)?.department||item.existing?.department||"";
      if(!defaultDepartment)summary.missing_departments.push(primary.name);
      if(item.entries.some(entry=>consultationFee(entry.consultation_fee)===null))summary.pending_fees.push(primary.name);
      const branchFees:Row={};
      for(const entry of item.entries){
        const branchId=branches[entry.branch].id;
        branchFees[branchId]={consultation_fee:consultationFee(entry.consultation_fee),department_id:await department(branchId,entry.department||defaultDepartment),consultation_fee_raw:entry.consultation_fee,registration_fee_raw:entry.registration_fee,maintenance_fee_raw:entry.maintenance_fee,source:entry.source,row:entry.row};
        summary.branch_rows[entry.branch]++;
      }
      for(const existing of matches){
        const professional:Row={...existing.professional,branch_fees:{...existing.professional?.branch_fees,...branchFees},doctor_fee_import:{key:item.key,source_hash:hash,department_pending:!defaultDepartment,fee_pending:item.entries.some(entry=>consultationFee(entry.consultation_fee)===null)}};
        for(const [branchId,fee] of Object.entries(branchFees))if(fee.consultation_fee===null){professional.branch_fees[branchId]={...fee,consultation_fee:existing.professional?.branch_fees?.[branchId]?.consultation_fee??existing.professional?.consultation_fee??0};}
        const primaryFee=consultationFee(primary.consultation_fee);
        if(primaryFee!==null)professional.consultation_fee=primaryFee;
        if(defaultDepartment)professional.specialization=defaultDepartment.replace(/\\u0026/g,"&");
        const departmentId=branchFees[branch.id].department_id||existing.department_id||null;
        let userId=existing.user_id;
        if(!item.existingMatches.length){
          // Required internal account identifiers; no real contact data or credentials are invented.
          userId=randomUUID();
          await client.query(`INSERT INTO users(id,tenant_id,branch_id,department_id,email,password_hash,first_name,last_name,role,is_active,force_password_change) VALUES($1,$2,$3,$4,$5,crypt($6,gen_salt('bf',12)),$7,$8,'doctor',true,true)`,[userId,tenant,branch.id,departmentId,`doctor-${userId}@staff.invalid`,randomUUID()+randomUUID(),first,last]);
          await client.query(`INSERT INTO staff_members(id,tenant_id,user_id,employee_id,first_name,last_name,staff_type,branch_id,department_id,designation,status,employment,account,professional) VALUES($1,$2,$3,$4,$5,$6,'Doctor',$7,$8,'Consultant Doctor','Active',$9,$10,$11)`,[existing.id,tenant,userId,`DOC-IMPORT-${createHash("sha256").update(item.key).digest("hex").slice(0,12).toUpperCase()}`,first,last,branch.id,departmentId,{status:"Active"},{role:"Doctor",account_status:"Active"},professional]);
          backup.new_staff_ids.push(existing.id);backup.new_user_ids.push(userId);summary.added++;
        }else{
          await client.query(`UPDATE staff_members SET first_name=$1,middle_name='',last_name=$2,branch_id=$3,department_id=$4,professional=$5,updated_at=now() WHERE id=$6 AND tenant_id=$7`,[first,last,branch.id,departmentId,professional,existing.id,tenant]);
          if(userId)await client.query(`UPDATE users SET first_name=$1,last_name=$2,branch_id=$3,department_id=$4,updated_at=now() WHERE id=$5 AND tenant_id=$6`,[first,last,branch.id,departmentId,userId,tenant]);
          summary.updated++;
        }
        if(userId)for(const entry of item.entries)await client.query(`INSERT INTO user_branch_access(tenant_id,user_id,branch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[tenant,userId,branches[entry.branch].id]);
      }
      summary.doctors.push({key:item.key,name:primary.name,action:item.action,records:matches.length,branches:item.entries.map(entry=>entry.branch),fees:item.entries.map(entry=>consultationFee(entry.consultation_fee))});
    }
    await client.query(`INSERT INTO doctor_fee_import_runs(tenant_id,source_hash,backup,summary) VALUES($1,$2,$3,$4)`,[tenant,hash,backup,summary]);
    await client.query("COMMIT");return summary;
  }catch(error){await client.query("ROLLBACK");throw error;}
}
