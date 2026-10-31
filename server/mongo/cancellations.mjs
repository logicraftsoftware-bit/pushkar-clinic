import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,requirePermission,permissionsFor,writeAudit} from './access.mjs';
import {cents,appointmentTotal} from './money.mjs';
import {operationalSettings} from './settings.mjs';
import {financialNumber,hospitalDay} from './finance-ledger.mjs';
import {cancellationBlockReason,cancellationBookedTests,refundBalance} from './cancellation-policy.mjs';
import {escapeSearch} from './search.mjs';
const router=Router(),uuid=z.string().uuid(),amount=z.number().finite().nonnegative().max(99999999.99).multipleOf(0.01);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
router.use(requirePermission('billing.view'),(_request,response,next)=>{if(!['receptionist','accountant','hospital_admin'].includes(response.locals.account.role))return response.status(403).json({error:'Reception or accountant access required.'});next();});
async function authorize(response,review,session){
  if(!(review?['accountant','hospital_admin']:['receptionist','hospital_admin']).includes(response.locals.account.role))throw failure(review?'Only an accountant can review requests.':'Only reception can submit requests and process refunds.',403);
  const permissions=await permissionsFor(response.locals.account,session),needed=review?'billing.refund':'billing.update';
  if(!permissions.includes('*')&&!permissions.includes(needed))throw failure(`Permission required: ${needed}`,403);
}
async function serialize(response,session){await db.collection('workflow_locks').updateOne({_id:`${response.locals.account.tenant_id}:cancellations`},{$inc:{version:1}},{session,upsert:true});}
async function billFor(response,type,targetId,session,lock=false){
  const tenant_id=response.locals.account.tenant_id;
  let source,invoice,records;
  if(type==='OPD'){
    source=await db.collection('clinical_appointments').findOne(await scopeFor(response,{id:targetId},session),{session});
    if(!source)throw failure('OPD bill not found.',404);
    invoice=await db.collection('finance_records').findOne({tenant_id,kind:'invoices','data.appointment_id':targetId},{session});records=[source];
  }else{
    invoice=await db.collection('finance_records').findOne(await scopeFor(response,{id:targetId,kind:'invoices'},session),{session});
    records=await db.collection('role_work_items').find(await scopeFor(response,{workspace:'laboratory','data.bill_id':targetId},session),{session}).sort({id:1}).toArray();source=invoice;
    if(!invoice||!records.length)throw failure('Lab bill not found.',404);
    const outside=await db.collection('role_work_items').countDocuments({tenant_id,workspace:'laboratory','data.bill_id':targetId},{session});if(outside!==records.length)throw failure('This invoice includes orders outside your branch access.',403);
  }
  if(lock){for(const row of records)await db.collection(type==='OPD'?'clinical_appointments':'role_work_items').updateOne({tenant_id,id:row.id},{$inc:{cancellation_version:1}},{session});if(invoice)await db.collection('finance_records').updateOne({tenant_id,id:invoice.id},{$inc:{cancellation_version:1}},{session});}
  const patient=await db.collection('patients').findOne({tenant_id,id:source.patient_id},{session});
  return {type,target_id:targetId,branch_id:source.branch_id,patient_id:source.patient_id,patient_name:patient?`${patient.first_name} ${patient.last_name}`.toUpperCase():'',bill_number:invoice?.record_number??source.appointment_number,total:invoice?invoice.total:appointmentTotal(source)/100,paid:invoice?invoice.paid:source.paid_amount??0,invoice_id:invoice?.id??null,invoice_data:invoice?.data??{},booked_tests:type==='Lab'?cancellationBookedTests(invoice,records):[],records,source,block_reason:invoice&&['Cancelled','Refunded'].includes(invoice.status)?'This bill is already cancelled or refunded.':cancellationBlockReason(type,records)};
}
async function requestFor(response,identity,session){const row=await db.collection('cancellation_requests').findOne(await scopeFor(response,{id:identity},session),{session});if(!row)throw failure('Cancellation request not found.',404);return row;}
async function event(response,identity,action,value,note,session,method=null,financeId=null){
  const account=response.locals.account;
  await db.collection('cancellation_events').insertOne({id:randomUUID(),tenant_id:account.tenant_id,request_id:identity,actor_id:account.id,actor_name:`${account.first_name} ${account.last_name}`,actor_role:account.role,action,amount:value,note,method,finance_id:financeId,created_at:new Date()},{session});
  await writeAudit(response,`cancellation_${action.toLowerCase().replaceAll(' ','_')}`,identity,session,{amount:value,finance_id:financeId});
}
router.get('/options',async(_request,response)=>{const settings=await operationalSettings(response.locals.account.tenant_id);response.json({payment_methods:settings.payment_methods,can_review:['accountant','hospital_admin'].includes(response.locals.account.role),can_process:['receptionist','hospital_admin'].includes(response.locals.account.role)});});
router.get('/bill',async(request,response)=>{
  const number=z.string().trim().min(1).max(100).parse(request.query.number),tenant_id=response.locals.account.tenant_id,exact={$regex:`^${escapeSearch(number)}$`,$options:'i'};
  const appointments=await db.collection('clinical_appointments').find(await scopeFor(response,{appointment_number:exact}),{projection:{id:1}}).toArray();
  const invoices=await db.collection('finance_records').find(await scopeFor(response,{kind:'invoices',record_number:exact})).toArray();
  const targets=new Map(appointments.map(row=>[`OPD:${row.id}`,{type:'OPD',id:row.id}]));
  for(const invoice of invoices){const type=invoice.data?.appointment_id?'OPD':'Lab',id=invoice.data?.appointment_id??invoice.id;if(type==='Lab'&&!invoice.data?.lab_order_id)continue;targets.set(`${type}:${id}`,{type,id});}
  const result=[];
  for(const target of targets.values()){
    const bill=await billFor(response,target.type,target.id),pending=await db.collection('cancellation_requests').findOne({tenant_id,bill_type:target.type,target_id:target.id,status:{$ne:'Rejected'}});
    const {records,source,...safe}=bill;result.push({...safe,default_amount:bill.paid,block_reason:pending?`Cancellation request ${pending.request_number} is already ${pending.status}.`:bill.block_reason});
  }
  response.json(result);
});
router.get('/',async(request,response)=>{
  const search=z.string().trim().max(150).default('').parse(request.query.search),stage=z.enum(['requests','refunds']).default('requests').parse(request.query.stage),status=z.enum(['','Pending','Approved','Rejected','Partially Refunded','Completed']).default('').parse(request.query.status),page=z.coerce.number().int().min(1).max(100000).default(1).parse(request.query.page);
  const extra={$and:[...(status?[{status}]:[]),...(stage==='refunds'?[{status:{$in:['Approved','Partially Refunded','Completed']}}]:[]),...(search?[{$or:['bill_number','request_number','patient_name'].map(field=>({[field]:{$regex:escapeSearch(search),$options:'i'}}))}]:[])]};
  if(!extra.$and.length)delete extra.$and;
  const filter=await scopeFor(response,extra),[rows,total,balances]=await Promise.all([db.collection('cancellation_requests').find(filter,{projection:{_id:0}}).sort({created_at:-1,id:-1}).skip((page-1)*20).limit(20).toArray(),db.collection('cancellation_requests').countDocuments(filter),db.collection('cancellation_requests').find({$and:[filter,{status:{$in:['Approved','Partially Refunded']}}]},{projection:{approved_amount:1,refunded_amount:1}}).toArray()]);
  for(const row of rows){const tenant_id=row.tenant_id;const [branch,creator,reviewer]=await Promise.all([db.collection('branches').findOne({tenant_id,id:row.branch_id}),db.collection('users').findOne({tenant_id,id:row.created_by}),row.reviewed_by?db.collection('users').findOne({tenant_id,id:row.reviewed_by}):null]);row.branch_name=branch?.name??'';row.requested_by_name=creator?`${creator.first_name} ${creator.last_name}`:'';row.reviewed_by_name=reviewer?`${reviewer.first_name} ${reviewer.last_name}`:'';}
  response.json({rows,total,pending_refund:balances.reduce((sum,row)=>sum+cents(row.approved_amount)-cents(row.refunded_amount),0)/100,page,page_size:20});
});
router.get('/:id/events',async(request,response)=>{const id=uuid.parse(request.params.id);await requestFor(response,id);const rows=await db.collection('cancellation_events').find({tenant_id:response.locals.account.tenant_id,request_id:id},{projection:{_id:0}}).sort({created_at:1,id:1}).toArray();for(const row of rows)if(row.finance_id)row.record_number=(await db.collection('finance_records').findOne({tenant_id:row.tenant_id,id:row.finance_id}))?.record_number??'';response.json(rows);});
router.post('/',async(request,response)=>{
  const body=z.object({type:z.enum(['OPD','Lab']),target_id:uuid,reason:z.string().trim().min(3).max(1000),amount}).parse(request.body),tenant_id=response.locals.account.tenant_id;
  const result=await transaction(async session=>{
    await authorize(response,false,session);await serialize(response,session);
    const bill=await billFor(response,body.type,body.target_id,session,true);
    if(bill.block_reason)throw failure(bill.block_reason,409);
    if(cents(body.amount)>cents(bill.paid))throw failure('Requested refund exceeds the collected amount.');
    if(await db.collection('cancellation_requests').findOne({tenant_id,bill_type:body.type,target_id:body.target_id,status:{$ne:'Rejected'}},{session}))throw failure('A cancellation request already exists for this bill.',409);
    const now=new Date(),row={id:randomUUID(),tenant_id,branch_id:bill.branch_id,bill_type:body.type,target_id:body.target_id,invoice_id:bill.invoice_id,patient_id:bill.patient_id,request_number:`CAN-${randomUUID().slice(0,8).toUpperCase()}`,bill_number:bill.bill_number,patient_name:bill.patient_name,reason:body.reason,bill_total:bill.total,collected_amount:bill.paid,requested_amount:body.amount,approved_amount:0,refunded_amount:0,booked_tests:bill.booked_tests,status:'Pending',created_by:response.locals.account.id,created_at:now,updated_at:now};
    await db.collection('cancellation_requests').insertOne({...row},{session});await event(response,row.id,'Requested',body.amount,body.reason,session);return row;
  });response.status(201).json(result);
});
router.post('/:id/review',async(request,response)=>{
  const identity=uuid.parse(request.params.id),body=z.object({decision:z.enum(['approve','reject']),amount,note:z.string().trim().min(3).max(1000)}).parse(request.body),tenant_id=response.locals.account.tenant_id;
  const result=await transaction(async session=>{
    await authorize(response,true,session);await serialize(response,session);const row=await requestFor(response,identity,session);
    if(row.status!=='Pending')throw failure('This request has already been reviewed.',409);
    const now=new Date(),changes={reviewed_by:response.locals.account.id,reviewed_at:now,review_note:body.note,updated_at:now};
    if(body.decision==='reject')Object.assign(changes,{status:'Rejected'});
    else{
      const bill=await billFor(response,row.bill_type,row.target_id,session,true);
      if(bill.block_reason)throw failure(bill.block_reason,409);
      if(cents(body.amount)>cents(bill.paid)||cents(body.amount)>cents(row.requested_amount))throw failure('Approved refund cannot exceed the requested or collected amount.');
      const retained=(cents(bill.paid)-cents(body.amount))/100,credit=Math.max(0,cents(bill.total)-cents(retained))/100,credit_number=`CN-${randomUUID().slice(0,8).toUpperCase()}`,financeId=randomUUID();
      const data={source:row.bill_type==='Lab'?'Laboratory Cancellation':'OPD Cancellation',cancellation_request_id:identity,bill_number:row.bill_number,original_total:bill.total,original_paid:bill.paid,approved_refund:body.amount,retained_amount:retained,reason:row.reason,...(row.bill_type==='OPD'?{appointment_id:row.target_id}:{})};
      await db.collection('finance_records').insertOne({id:financeId,tenant_id,branch_id:bill.branch_id,patient_id:bill.patient_id,invoice_id:bill.invoice_id,kind:'credit notes',record_number:credit_number,data,amount:credit,total:credit,paid:0,due:0,status:'Approved',record_date:hospitalDay(now),created_by:response.locals.account.id,created_at:now,updated_at:now},{session});
      if(bill.invoice_id)await db.collection('finance_records').updateOne({tenant_id,id:bill.invoice_id},{$set:{total:retained,due:0,status:'Cancelled',data:{...bill.invoice_data,...data},updated_at:now}},{session});
      if(row.bill_type==='OPD')await db.collection('clinical_appointments').updateOne({tenant_id,id:row.target_id},{$set:{status:'Cancelled',cancellation_reason:row.reason,cancelled_at:now,cancellation_request_id:identity,approved_refund_amount:body.amount,cancellation_retained_amount:retained,payment_status:body.amount>0?'Refund Pending':'Cancelled',updated_at:now}},{session});
      else await db.collection('role_work_items').updateMany({tenant_id,workspace:'laboratory','data.bill_id':bill.invoice_id},{$set:{status:'Cancelled','data.cancellation_request_id':identity,'data.cancelled_by':response.locals.account.id,'data.cancelled_at':now,'data.approved_refund_amount':body.amount,updated_at:now}},{session});
      Object.assign(changes,{approved_amount:body.amount,status:body.amount>0?'Approved':'Completed',credit_number});
      await event(response,identity,'Approved',body.amount,body.note,session,null,financeId);
    }
    await db.collection('cancellation_requests').updateOne({tenant_id,id:identity},{$set:changes},{session});
    if(body.decision==='reject')await event(response,identity,'Rejected',null,body.note,session);
    const {_id,...safe}=row;return {...safe,...changes};
  });response.json(result);
});
router.post('/:id/refund',async(request,response)=>{
  const identity=uuid.parse(request.params.id),body=z.object({amount,method:z.string().trim().min(1).max(100),reference:z.string().trim().max(150).default(''),payment_key:uuid}).parse(request.body),tenant_id=response.locals.account.tenant_id;
  const result=await transaction(async session=>{
    await authorize(response,false,session);await serialize(response,session);const row=await requestFor(response,identity,session);delete row._id;
    const prior=await db.collection('finance_records').findOne({tenant_id,kind:'refunds','data.refund_payment_key':body.payment_key},{session,projection:{_id:0}});
    if(prior){if(prior.data.cancellation_request_id!==identity||cents(prior.amount)!==cents(body.amount)||prior.data.payment_method!==body.method||prior.data.transaction_reference!==body.reference)throw failure('Refund key already used with different values.',409);return {request:row,refund:prior,replayed:true};}
    if(!['Approved','Partially Refunded'].includes(row.status))throw failure('Only approved requests can be refunded.',409);
    if(!(await operationalSettings(tenant_id,session)).payment_methods.includes(body.method))throw failure('Select a valid refund payment method.');
    if(body.method!=='Cash'&&!body.reference)throw failure('Enter the transaction reference.');
    const balance=refundBalance(row.approved_amount,row.refunded_amount,body.amount),bill=await billFor(response,row.bill_type,row.target_id,session,true);
    if(cents(body.amount)>cents(bill.paid))throw failure('Current collected amount is below this refund.',409);
    const linked=row.bill_type==='OPD'?bill.source.cancellation_request_id:bill.source.data.cancellation_request_id;
    if(linked!==identity)throw failure('Bill is not linked to this approved cancellation.',409);
    const now=new Date(),refund={id:randomUUID(),tenant_id,branch_id:bill.branch_id,patient_id:bill.patient_id,invoice_id:bill.invoice_id,kind:'refunds',record_number:await financialNumber(tenant_id,'refunds',session),data:{source:row.bill_type==='Lab'?'Laboratory Refund':'OPD Refund',cancellation_request_id:identity,bill_number:row.bill_number,...(row.bill_type==='OPD'?{appointment_id:row.target_id}:{}),refund_payment_key:body.payment_key,payment_method:body.method,transaction_reference:body.reference,reason:row.reason},amount:body.amount,total:body.amount,paid:body.amount,due:0,status:'Completed',record_date:hospitalDay(now),created_by:response.locals.account.id,created_at:now,updated_at:now};
    await db.collection('finance_records').insertOne({...refund},{session});
    if(bill.invoice_id)await db.collection('finance_records').updateOne({tenant_id,id:bill.invoice_id},{$set:{paid:(cents(bill.paid)-cents(body.amount))/100,due:0,'data.refunded_amount':balance.refunded,'data.refund_status':balance.status,updated_at:now}},{session});
    if(row.bill_type==='OPD')await db.collection('clinical_appointments').updateOne({tenant_id,id:row.target_id},{$set:{paid_amount:(cents(bill.paid)-cents(body.amount))/100,refund_amount:balance.refunded,payment_status:balance.status==='Completed'?'Refunded':'Refund Pending',updated_at:now}},{session});
    else await db.collection('role_work_items').updateMany({tenant_id,workspace:'laboratory','data.bill_id':bill.invoice_id},{$set:{'data.paid_amount':(cents(bill.paid)-cents(body.amount))/100,'data.refunded_amount':balance.refunded,'data.refund_status':balance.status,updated_at:now}},{session});
    const changes={refunded_amount:balance.refunded,status:balance.status,updated_at:now};await db.collection('cancellation_requests').updateOne({tenant_id,id:identity},{$set:changes},{session});
    await event(response,identity,'Refund Paid',body.amount,body.reference,session,body.method,refund.id);return {request:{...row,...changes},refund,replayed:false};
  });response.json(result);
});
export default router;
