import {Router} from 'express';
import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,assertBranch,permissionsFor,writeAudit} from './access.mjs';
import {cents,paymentStatus} from './money.mjs';
import {operationalSettings} from './settings.mjs';
import {syncAdmissionInvoice,financialNumber,hospitalDay} from './finance-ledger.mjs';
const router=Router(),uuid=z.string().uuid(),kind=z.enum(['invoices','payments','expenses','refunds']);
const nullable=z.union([uuid,z.literal(''),z.null()]).optional().transform(value=>value||null);
const money=z.coerce.number().finite().nonnegative().max(99999999.99).multipleOf(0.01);
const input=z.object({branch_id:nullable,patient_id:nullable,invoice_id:nullable,amount:money.default(0),total:money.default(0),paid:money.default(0),record_date:z.union([z.string().date(),z.literal('')]).optional(),data:z.record(z.string(),z.unknown()).default({}),request_id:uuid.optional(),updated_at:z.string().datetime().optional()});
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
async function permission(response,code,session) {
  const granted=await permissionsFor(response.locals.account,session);
  if(!granted.includes('*')&&!granted.includes(code))throw failure(`Permission required: ${code}`,403);
}
function validateData(data) {
  for(const field of ['admission_id','appointment_id','lab_order_id','cancellation_request_id','source','bill_id','request_id'])if(data[field]!==undefined)throw failure('Linked clinical records must be changed through their workflow.');
}
async function patient(tenant,identity,session) {
  if(identity&&!await db.collection('patients').findOne({tenant_id:tenant,id:identity,deleted_at:null},{session}))throw failure('Select a patient in this clinic.');
}
async function paymentMethod(tenant,data,session) {
  const method=z.string().min(1).max(100).parse(data.payment_method??data.payment_mode??'');
  if(!(await operationalSettings(tenant,session)).payment_methods.includes(method))throw failure('Select a configured payment method.');
  return method;
}
router.post('/finance/:kind',async(request,response)=>{
  const resource=kind.parse(request.params.kind),body=input.parse(request.body),tenant_id=response.locals.account.tenant_id;
  const hash=createHash('sha256').update(JSON.stringify({resource,body})).digest('hex');
  const result=await transaction(async session=>{
    await permission(response,resource==='refunds'?'billing.refund':'billing.create',session);
    await db.collection('workflow_locks').updateOne({_id:`${tenant_id}:finance`},{$inc:{version:1}},{session,upsert:true});
    if(body.request_id){
      const prior=await db.collection('finance_records').findOne({tenant_id,request_id:body.request_id},{session,projection:{_id:0}});
      if(prior){if(prior.request_hash!==hash)throw failure('Request ID already used with different values.',409);delete prior.request_hash;return prior;}
    }
    validateData(body.data);
    let invoice=null,admission=null,order=null;
    if(['payments','refunds'].includes(resource)){
      if(!body.invoice_id)throw failure('Select an invoice.');
      invoice=await db.collection('finance_records').findOne(await scopeFor(response,{id:body.invoice_id,kind:'invoices'},session),{session});
      if(!invoice)throw failure('Invoice not found in an authorized branch.',404);
      if(['Cancelled','Refunded'].includes(invoice.status))throw failure('This invoice cannot receive further transactions.',409);
      if(body.patient_id&&body.patient_id!==invoice.patient_id||body.branch_id&&body.branch_id!==invoice.branch_id)throw failure('The payment patient and branch must match the invoice.');
      body.patient_id=invoice.patient_id;body.branch_id=invoice.branch_id;
      if(invoice.data?.admission_id){
        admission=await db.collection('ipd_admissions').findOne(await scopeFor(response,{id:invoice.data.admission_id},session),{session});
        if(!admission)throw failure('Admission not found.',404);
        invoice=await syncAdmissionInvoice(admission,session);
      }
      if(invoice.data?.lab_order_id){
        order=await db.collection('role_work_items').findOne(await scopeFor(response,{id:invoice.data.lab_order_id,workspace:'laboratory'},session),{session});
        if(!order||order.status==='Cancelled'||order.data.cancellation_request_id)throw failure('This laboratory bill cannot receive payments.',409);
      }
      if(resource==='refunds'&&(admission||order||invoice.data?.appointment_id))throw failure('Clinical refunds require an approved cancellation request.',409);
    }
    body.branch_id??=response.locals.account.branch_id;
    await assertBranch(response,body.branch_id,session);await patient(tenant_id,body.patient_id,session);
    let total=resource==='invoices'?cents(body.total):cents(body.amount),paid=resource==='invoices'?cents(body.paid):total;
    if(resource==='invoices'&&!body.patient_id)throw failure('Select a patient.');
    if(resource!=='invoices'&&total===0)throw failure('Enter an amount greater than zero.');
    if(paid>total)throw failure('Paid amount exceeds the invoice total.');
    if(resource==='payments'&&total>cents(invoice.due))throw failure('Payment exceeds the outstanding balance.',409);
    if(resource==='refunds'&&total>cents(invoice.paid))throw failure('Refund exceeds collected payments.',409);
    if(resource==='refunds')body.data.reason=z.string().trim().min(3).max(2000).parse(body.data.reason);
    const method=(resource!=='invoices'||paid>0)?await paymentMethod(tenant_id,body.data,session):'';
    const now=new Date(),row={id:randomUUID(),tenant_id,branch_id:body.branch_id,patient_id:body.patient_id,invoice_id:body.invoice_id,kind:resource,record_number:await financialNumber(tenant_id,resource,session),amount:resource==='invoices'?total/100:body.amount,total:total/100,paid:paid/100,due:resource==='invoices'?(total-paid)/100:0,status:resource==='invoices'?paymentStatus(total,paid):resource==='refunds'?'Refunded':'Paid',record_date:body.record_date||hospitalDay(now),data:{...body.data,source:'Manual Finance',...(method?{payment_method:method}:{}),...(invoice?.data?.admission_id?{admission_id:invoice.data.admission_id}:{}),...(invoice?.data?.lab_order_id?{lab_order_id:invoice.data.lab_order_id}:{}),...(invoice?.data?.appointment_id?{appointment_id:invoice.data.appointment_id}:{})},created_by:response.locals.account.id,created_at:now,updated_at:now,...(body.request_id?{request_id:body.request_id,request_hash:hash}:{})};
    await db.collection('finance_records').insertOne({...row},{session});
    if(resource==='invoices'&&paid>0){
      await db.collection('finance_records').insertOne({...row,id:randomUUID(),request_id:undefined,request_hash:undefined,invoice_id:row.id,kind:'payments',record_number:await financialNumber(tenant_id,'payments',session),amount:paid/100,total:paid/100,paid:paid/100,due:0,status:'Paid',data:{source:'Manual Invoice',payment_method:method}},{session});
    }
    if(invoice){
      const nextPaid=cents(invoice.paid)+(resource==='refunds'?-total:total),due=cents(invoice.total)-nextPaid,status=resource==='refunds'?'Refunded':paymentStatus(cents(invoice.total),nextPaid);
      await db.collection('finance_records').updateOne({tenant_id,id:invoice.id},{$set:{paid:nextPaid/100,due:due/100,status,updated_at:now,...(order?{'data.paid_amount':nextPaid/100,'data.due_amount':due/100,'data.payment_mode':method}:{})}},{session});
      if(admission)await db.collection('ipd_admissions').updateOne({tenant_id,id:admission.id},{$inc:{paid_amount:total/100},$set:{admission_payment_status:status,updated_at:now}},{session});
      if(order)await db.collection('role_work_items').updateOne({tenant_id,id:order.id},{$set:{'data.paid_amount':nextPaid/100,'data.due_amount':due/100,'data.payment_mode':method,...(order.kind==='pos'?{status}:{}),updated_at:now}},{session});
    }
    await writeAudit(response,'finance_posted',row.id,session,{kind:resource,amount:row.amount,invoice_id:row.invoice_id});
    delete row.request_hash;return row;
  });response.status(201).json(result);
});
router.put('/finance/:kind/:id',async(request,response)=>{
  const resource=kind.parse(request.params.kind),recordId=uuid.parse(request.params.id),body=input.parse(request.body);
  if(resource!=='invoices')throw failure('Posted payments, refunds and expenses are immutable. Record a correcting transaction.',409);
  if(!body.updated_at)throw failure('Refresh the invoice before editing.',409);
  const result=await transaction(async session=>{
    await permission(response,'billing.update',session);
    const filter=await scopeFor(response,{id:recordId,kind:resource},session),row=await db.collection('finance_records').findOne(filter,{session});
    if(!row)throw failure('Invoice not found.',404);
    if(row.data?.source!=='Manual Finance')throw failure('Change clinical invoices through their workflow.',409);
    if(new Date(row.updated_at).toISOString()!==body.updated_at)throw failure('Invoice changed. Refresh before editing.',409);
    validateData(body.data);
    if(body.patient_id!==row.patient_id||body.branch_id&&body.branch_id!==row.branch_id)throw failure('The invoice patient and branch cannot be changed.');
    if(cents(body.paid)!==cents(row.paid))throw failure('Use Add Payment or Refund to change collections.',409);
    if(cents(body.total)<cents(row.paid))throw failure('Invoice total cannot be lower than collected payments.');
    const total=cents(body.total),paid=cents(row.paid),now=new Date(Math.max(Date.now(),new Date(row.updated_at).getTime()+1));
    const changes={data:{...body.data,source:'Manual Finance'},amount:total/100,total:total/100,due:(total-paid)/100,status:paymentStatus(total,paid),record_date:body.record_date||row.record_date,updated_at:now};
    await db.collection('finance_records').updateOne(filter,{$set:changes},{session});
    await writeAudit(response,'manual_invoice_updated',recordId,session,{previous_total:row.total,total:changes.total});
    const {_id,request_hash,...safe}=row;return {...safe,...changes};
  });response.json(result);
});
export default router;
