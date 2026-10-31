import {Router} from 'express';
import {z} from 'zod';
import {db,transaction} from './database.mjs';
import {scopeFor,requirePermission,writeAudit} from './access.mjs';
import {labOrderEditable} from './lab-result-completion.mjs';
import {laboratoryPrice,laboratoryTestAvailable} from './lab-branch-pricing.mjs';
import {labPharmacyBilling} from './lab-billing.mjs';
import {cents} from './money.mjs';
const router=Router(),uuid=z.string().uuid(),fail=(message,status=409)=>Object.assign(new Error(message),{status});
router.patch('/work-items/:id/lab-order',(request,response,next)=>requirePermission(response.locals.account.role==='receptionist'?'billing.create':'lab.order.view')(request,response,next),async(request,response)=>{
  const body=z.object({test_ids:z.array(uuid).min(1).max(200),discount:z.number().finite().nonnegative().max(99999999).multipleOf(.01),updated_at:z.string().datetime(),diagnosis:z.string().trim().max(2000).default(''),urgent:z.boolean().default(false),source:z.string().trim().max(100).optional(),referred_by:uuid.nullable().optional(),referral_partner_id:uuid.nullable().optional(),collector_id:uuid.nullable().optional(),refer_pharmacy_id:uuid.nullable().optional(),pharmacy_discount_percentage:z.number().min(0).max(100).optional()}).parse(request.body);
  const saved=await transaction(async session=>{
    const tenant_id=response.locals.account.tenant_id,id=uuid.parse(request.params.id),row=await db.collection('role_work_items').findOne(await scopeFor(response,{id,workspace:'laboratory'},session),{session});
    if(!row)throw fail('Laboratory order not found.',404);
    if(!labOrderEditable(row)||row.data.cancellation_request_id)throw fail('Orders can only be edited before sample collection.');
    if(new Date(row.updated_at).toISOString()!==body.updated_at)throw fail('Order changed. Reopen it before editing.');
    const bill=row.data.bill_id?await db.collection('finance_records').findOne({tenant_id,id:row.data.bill_id,kind:'invoices'},{session}):null;
    if(row.data.bill_id&&!bill||bill&&['Cancelled','Refunded'].includes(bill.status)||Number(bill?.data?.tax_amount??0))throw fail('Bill requires reconciliation before editing.');
    // A referral must be agreed before payment. Changing it afterward could redirect an earned commission.
    for(const field of ['referred_by','referral_partner_id','refer_pharmacy_id']){const previous=row.data[field==='referred_by'?'referred_by_id':field]??null;if(cents(bill?.paid??0)>0&&body[field]!==undefined&&body[field]!==previous)throw fail('Paid invoices retain their referral details.');}
    const tests=[];
    for(const test_id of new Set(body.test_ids)){
      const master=await db.collection('hospital_diagnostic_masters').findOne({tenant_id,id:test_id,domain:'pathology',kind:'test'},{session});if(!master||!laboratoryTestAvailable(master.data,row.branch_id))throw fail('A selected test is unavailable.');
      const old=row.data.tests?.find(test=>test.test_id===test_id),amount=old?.amount??laboratoryPrice(master.data,row.branch_id);cents(amount);tests.push({...old,test_id,name:master.name,test_type:master.data.test_type??'Pathology',amount,priority:body.urgent?'Urgent':'Routine'});
    }
    const metadata={};if(body.source!==undefined)metadata.source=body.source;
    for(const [field,collection,extra,nameKey,defaultName] of [['referred_by','users',{role:'doctor',is_active:true},'referred_by','Self'],['referral_partner_id','referral_partners',{status:'Active'},'executive','Self'],['collector_id','staff_members',{status:'Active'},'collector','']]){
      if(body[field]===undefined)continue;const key=field==='referred_by'?'referred_by_id':field;if(body[field]===(row.data[key]??null))continue;
      let linked=null;if(body[field]){linked=await db.collection(collection).findOne({tenant_id,id:body[field],...extra,...(field==='referral_partner_id'?{$or:[{branch_id:row.branch_id},{branch_id:null}]}:field==='collector_id'?{$or:[{branch_id:row.branch_id},{branch_ids:row.branch_id}]}:{})},{session});if(!linked)throw fail('Selected referral or collector is unavailable.');}
      metadata[key]=body[field];metadata[nameKey]=linked?(linked.name??`${linked.first_name} ${linked.last_name}`):defaultName;
    }
    let percentage=Number(row.data.pharmacy_discount_percentage??0);
    if(body.refer_pharmacy_id!==undefined&&body.refer_pharmacy_id!==(row.data.refer_pharmacy_id??null)){
      const pharmacy=body.refer_pharmacy_id?await db.collection('hospital_refer_pharmacies').findOne({tenant_id,id:body.refer_pharmacy_id},{session}):null;if(body.refer_pharmacy_id&&!pharmacy)throw fail('Selected referral pharmacy is unavailable.');Object.assign(metadata,{refer_pharmacy_id:pharmacy?.id??null,refer_pharmacy_name:pharmacy?.name??'Not Applicable',refer_pharmacy_address:pharmacy?.address??''});percentage=Number(pharmacy?.discount_percentage??0);
    }
    if(body.pharmacy_discount_percentage!==undefined&&body.pharmacy_discount_percentage!==percentage)throw fail('Use the saved or configured pharmacy discount percentage.');
    if(!(Object.hasOwn(metadata,'refer_pharmacy_id')?metadata.refer_pharmacy_id:row.data.refer_pharmacy_id))percentage=0;
    let totals;try{totals=labPharmacyBilling(tests.map(test=>test.amount),body.discount,bill?.paid??0,percentage);}catch(error){throw fail(error.message);}
    const now=new Date(Math.max(Date.now(),new Date(row.updated_at).getTime()+1)),data={...row.data,...metadata,tests,diagnosis:body.diagnosis,urgent:body.urgent,discount_amount:totals.discount,manual_discount_amount:totals.manual_discount_amount,pharmacy_discount_percentage:totals.pharmacy_discount_percentage,pharmacy_discount_amount:totals.pharmacy_discount_amount,paid_amount:totals.paid,due_amount:totals.due,order_edit_history:[...(row.data.order_edit_history??[]),{at:now.toISOString(),by:response.locals.account.id,tests:row.data.tests,discount_amount:row.data.discount_amount??0,diagnosis:row.data.diagnosis??''}]};
    if(bill)await db.collection('finance_records').updateOne({tenant_id,id:bill.id},{$set:{amount:totals.subtotal,total:totals.total,due:totals.due,status:totals.status,data:{...bill.data,...data,source:'Laboratory',investigation_source:data.source},updated_at:now}},{session});
    const result=await db.collection('role_work_items').findOneAndUpdate({tenant_id,id},{$set:{data,status:bill?(totals.status==='Unpaid'?'Awaiting Payment':totals.status):row.status,priority:body.urgent?'Urgent':'Normal',updated_at:now}},{session,returnDocument:'after',projection:{_id:0}});await writeAudit(response,'lab_order_edited',id,session);return result;
  });response.json(saved);
});
export default router;
