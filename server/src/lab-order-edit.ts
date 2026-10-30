import {labDoctorLookupSql} from './clinical-doctors.js';
import {accessibleBranchIds} from './branch-access.js';
import type {Request, Response} from "express";
import {z} from "zod";
import {pool} from "./db.js";
import {laboratoryPrice} from "./lab-branch-pricing.js";
import {labPharmacyBilling} from "./lab-billing.js";
import {labOrderEditable} from "./lab-result-completion.js";

export async function editLabOrder(req: Request & {portalUser?: {tenantId:string;branchId:string;sub:string;role:string;portal?:string}}, res: Response) {
  const body=z.object({test_ids:z.array(z.string().uuid()).min(1),discount:z.number().finite().min(0),updated_at:z.string(),diagnosis:z.string().trim().max(2000).default(""),urgent:z.boolean().default(false),source:z.string().trim().max(100).optional(),referred_by:z.string().uuid().nullable().optional(),referral_partner_id:z.string().uuid().nullable().optional(),collector_id:z.string().uuid().nullable().optional(),refer_pharmacy_id:z.string().uuid().nullable().optional(),pharmacy_discount_percentage:z.number().finite().min(0).max(100).optional()}).parse(req.body);
  const a=req.portalUser!,client=await pool.connect();
  try {
    await client.query("BEGIN");
    const found=await client.query(`SELECT * FROM role_work_items WHERE id=$1 AND tenant_id=$2 AND workspace='laboratory' AND ($3::uuid IS NULL OR branch_id=$3) FOR UPDATE`,[req.params.id,a.tenantId,a.role==="receptionist"?a.branchId:null]);
    const row=found.rows[0];
    if(!row||!labOrderEditable(row))throw new Error("Orders can only be edited before they are sent to sample collection");
    if(new Date(row.updated_at).getTime()!==new Date(body.updated_at).getTime())throw new Error("Order changed. Reopen it before editing");
    const ids=[...new Set(body.test_ids)];
    const masters=await client.query(`SELECT id,name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='test' AND id=ANY($2::uuid[])`,[a.tenantId,ids]);
    if(masters.rows.length!==ids.length)throw new Error("One or more selected tests are unavailable");
    const tests=ids.map(id=>{const master=masters.rows.find(test=>test.id===id)!;const prior=(row.data.tests||[]).find((test:any)=>test.test_id===id);return {...prior,test_id:id,name:master.name,test_type:master.data?.test_type||"Pathology",amount:prior?.amount??laboratoryPrice(master.data,row.branch_id),priority:body.urgent?"Urgent":"Routine"};});
    const invoice=row.data.bill_id?(await client.query(`SELECT * FROM finance_records WHERE id=$1 AND tenant_id=$2 AND kind='invoices' FOR UPDATE`,[row.data.bill_id,a.tenantId])).rows[0]:null;
    if(row.data.bill_id&&!invoice)throw new Error("Order bill is unavailable");
    const tax=Number(invoice?.data?.tax_amount||0);
    if(tax)throw new Error("This bill has tax adjustments and needs billing reconciliation before editing");
    const metadata:Record<string,any>={};
    if(body.source!==undefined)metadata.source=body.source;
    if(body.referred_by!==undefined&&body.referred_by!==(row.data.referred_by_id||null)){
      let name='Self';
      if(body.referred_by){const branches=a.role==='hospital_admin'?null:await accessibleBranchIds(a);const doctor=(await client.query(`SELECT name FROM (${labDoctorLookupSql}) referring WHERE id=$3`,[a.tenantId,branches,body.referred_by])).rows[0];if(!doctor)throw Error('Selected referring doctor is unavailable');name=doctor.name;}
      Object.assign(metadata,{referred_by_id:body.referred_by,referred_by:name});
    }
    if(body.referral_partner_id!==undefined&&body.referral_partner_id!==(row.data.referral_partner_id||null)){
      let name='Self';if(body.referral_partner_id){const partner=(await client.query(`SELECT name FROM referral_partners WHERE id=$1 AND tenant_id=$2 AND status='Active' AND (branch_id=$3 OR branch_id IS NULL OR $3::uuid IS NULL)`,[body.referral_partner_id,a.tenantId,a.branchId||null])).rows[0];if(!partner)throw Error('Selected referral partner is unavailable');name=partner.name;}
      Object.assign(metadata,{referral_partner_id:body.referral_partner_id,executive:name});
    }
    if(body.collector_id!==undefined&&body.collector_id!==(row.data.collector_id||null)){
      let name='';if(body.collector_id){const staff=(await client.query(`SELECT concat_ws(' ',first_name,middle_name,last_name) name FROM staff_members WHERE id=$1 AND tenant_id=$2 AND status='Active' AND (branch_id=$3 OR $3::uuid IS NULL)`,[body.collector_id,a.tenantId,a.branchId||null])).rows[0];if(!staff)throw Error('Selected collection staff is unavailable');name=staff.name;}
      Object.assign(metadata,{collector_id:body.collector_id,collector:name});
    }
    let percentage=Number(row.data.pharmacy_discount_percentage||0);
    if(body.refer_pharmacy_id!==undefined&&body.refer_pharmacy_id!==(row.data.refer_pharmacy_id||null)){
      const pharmacy=body.refer_pharmacy_id?(await client.query(`SELECT id,name,address,discount_percentage FROM hospital_refer_pharmacies WHERE id=$1 AND tenant_id=$2`,[body.refer_pharmacy_id,a.tenantId])).rows[0]:null;
      if(body.refer_pharmacy_id&&!pharmacy)throw Error('Selected refer pharmacy is unavailable');
      Object.assign(metadata,{refer_pharmacy_id:pharmacy?.id||null,refer_pharmacy_name:pharmacy?.name||'Not Applicable',refer_pharmacy_address:pharmacy?.address||''});percentage=Number(pharmacy?.discount_percentage||0);
    }
    if(body.pharmacy_discount_percentage!==undefined)percentage=body.pharmacy_discount_percentage;
    if(!(metadata.refer_pharmacy_id??row.data.refer_pharmacy_id)||metadata.refer_pharmacy_id===null)percentage=0;
    const totals=labPharmacyBilling(tests.map(test=>test.amount),body.discount,Number(invoice?.paid||0),percentage);
    const audit={tests:row.data.tests,discount_amount:row.data.discount_amount||0,diagnosis:row.data.diagnosis||"",source:row.data.source,referred_by_id:row.data.referred_by_id,referred_by:row.data.referred_by,referral_partner_id:row.data.referral_partner_id,executive:row.data.executive,collector_id:row.data.collector_id,collector:row.data.collector,refer_pharmacy_id:row.data.refer_pharmacy_id,refer_pharmacy_name:row.data.refer_pharmacy_name,pharmacy_discount_percentage:row.data.pharmacy_discount_percentage,urgent:row.data.urgent,at:new Date().toISOString(),by:a.sub};
    const discountPatch={discount_amount:totals.discount,manual_discount_amount:totals.manual_discount_amount,pharmacy_discount_percentage:totals.pharmacy_discount_percentage,pharmacy_discount_amount:totals.pharmacy_discount_amount};
    const patch={...metadata,tests,diagnosis:body.diagnosis,urgent:body.urgent,...discountPatch,paid_amount:totals.paid,due_amount:totals.due,order_edit_history:[...(row.data.order_edit_history||[]),audit]};
    if(invoice)await client.query(`UPDATE finance_records SET amount=$1,total=$2,due=$3,status=$4,data=data||$5::jsonb,updated_at=now() WHERE id=$6 AND tenant_id=$7`,[totals.subtotal,totals.total,totals.due,totals.status,JSON.stringify({...metadata,source:invoice.data?.source||"Laboratory",...(metadata.source!==undefined?{investigation_source:metadata.source}:{}),tests,diagnosis:body.diagnosis,urgent:body.urgent,...discountPatch}),invoice.id,a.tenantId]);
    const updated=await client.query(`UPDATE role_work_items SET data=data||$1::jsonb,status=$2,updated_at=now() WHERE id=$3 AND tenant_id=$4 RETURNING *`,[JSON.stringify(patch),invoice?(totals.status==="Unpaid"?"Awaiting Payment":totals.status):row.status,row.id,a.tenantId]);
    await client.query("COMMIT");res.json(updated.rows[0]);
  }catch(error){await client.query("ROLLBACK");res.status(409).json({error:error instanceof Error?error.message:"Unable to edit order"});}finally{client.release();}
}
