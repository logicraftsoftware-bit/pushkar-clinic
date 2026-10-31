import {Router} from 'express';
import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,assertBranch,requirePermission,writeAudit} from './access.mjs';
import {cents} from './money.mjs';
import {configuredPrefix} from './settings.mjs';
import {hospitalDay} from './finance-ledger.mjs';
const router=Router(),uuid=z.string().uuid(),money=z.coerce.number().finite().nonnegative().max(99999999.99).multipleOf(0.01),percent=z.coerce.number().min(0).max(100).multipleOf(0.01);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
router.use('/pharmacy',(request,response,next)=>requirePermission(request.method==='GET'?'inventory.view':'inventory.manage')(request,response,next));
const billInput=z.object({action:z.enum(['save','generate','reject']),customer_name:z.string().trim().max(200).default('Walk-in Customer'),discount_percent:percent.default(0),items:z.array(z.object({medicine_id:z.union([uuid,z.literal('')]).default(''),name:z.string().trim().min(1).max(200),type:z.string().max(100).default(''),hsn_code:z.string().max(100).default(''),gst_percent:percent.default(0),dose:z.string().max(200).default(''),quantity:z.coerce.number().finite().positive().max(100000).refine(value=>Math.abs(value*1000-Math.round(value*1000))<0.00001),rate:money,instruction:z.string().max(4000).default('')})).min(1).max(200),request_id:uuid.optional(),updated_at:z.string().datetime().optional()});
async function serialize(tenant,session){await db.collection('workflow_locks').updateOne({_id:`${tenant}:pharmacy-billing`},{$inc:{version:1}},{session,upsert:true});}
async function number(tenant,session){const counter=await db.collection('counters').findOneAndUpdate({_id:`${tenant}:pharmacy-bill`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'});return `${await configuredPrefix(tenant,'pharmacy_bill_prefix','PHAB',session)}-${String(counter.value).padStart(6,'0')}`;}
async function medicines(response,session){
  const rows=await db.collection('hospital_pharmacy_masters').find({tenant_id:response.locals.account.tenant_id,kind:'medicine'},{session,projection:{_id:0}}).sort({name:1}).toArray();
  for(const row of rows){const batches=await db.collection('inventory_records').find(await scopeFor(response,{kind:'pharmacy-batch','data.medicine_id':row.id,status:{$ne:'Cancelled'},'data.expiry_date':{$gte:hospitalDay()}},session),{session,projection:{data:1}}).toArray();row.price=Math.max(0,...batches.map(batch=>Number(batch.data.mrp??0)));}
  return rows;
}
router.get('/pharmacy/prescriptions',async(_request,response)=>{
  const rows=await db.collection('role_work_items').find(await scopeFor(response,{workspace:'pharmacy',kind:'prescription'}),{projection:{_id:0}}).sort({occurred_at:-1}).toArray();
  for(const row of rows){const tenant_id=row.tenant_id,patient=await db.collection('patients').findOne({tenant_id,id:row.patient_id}),doctor=await db.collection('users').findOne({tenant_id,id:row.data.doctor_id??row.created_by}),bill=row.data.bill_id?await db.collection('finance_records').findOne({tenant_id,id:row.data.bill_id}):null;Object.assign(row,{patient_name:patient?`${patient.first_name} ${patient.last_name}`.toUpperCase():'',medical_record_number:patient?.medical_record_number??'',doctor_name:doctor?`${doctor.first_name} ${doctor.last_name}`:'',bill_number:bill?.record_number??'',bill_total:bill?.total??0});}
  response.json(rows);
});
router.patch('/pharmacy/prescriptions/:id/cancel',async(request,response)=>{
  const identity=uuid.parse(request.params.id);const result=await transaction(async session=>{const tenant_id=response.locals.account.tenant_id;await serialize(tenant_id,session);const row=await db.collection('role_work_items').findOneAndUpdate(await scopeFor(response,{id:identity,workspace:'pharmacy',kind:'prescription',status:'Pending','data.bill_id':{$exists:false}},session),{$set:{status:'Cancelled','data.cancelled_by':response.locals.account.id,'data.cancelled_at':new Date(),updated_at:new Date()}},{session,returnDocument:'after',projection:{_id:0}});if(!row)throw failure('Only pending, unbilled prescriptions can be cancelled.',409);await writeAudit(response,'pharmacy_prescription_cancelled',identity,session);return row;});response.json(result);
});
router.post('/pharmacy/prescriptions/:id/bill',async(request,response)=>{
  const identity=uuid.parse(request.params.id),result=await transaction(async session=>{
    const tenant_id=response.locals.account.tenant_id;await serialize(tenant_id,session);const row=await db.collection('role_work_items').findOne(await scopeFor(response,{id:identity,workspace:'pharmacy',kind:'prescription'},session),{session});if(!row)throw failure('Prescription not found.',404);
    if(row.data.bill_id){const prior=await db.collection('finance_records').findOne({tenant_id,id:row.data.bill_id,'data.prescription_id':identity},{session,projection:{_id:0}});if(prior)return prior;}
    if(row.status!=='Pending')throw failure('Only pending prescriptions can be converted to a bill.',409);
    const masters=await medicines(response,session),items=(row.data.medicines??[]).map(line=>{const master=masters.find(master=>master.id===line.medicine_id||master.name.toLowerCase()===String(line.name).toLowerCase());return {medicine_id:master?.id??'',name:String(line.name??''),quantity:Number(line.quantity),rate:master?.price??0,gst_percent:Number(master?.data?.tax??0),dose:String(line.dose??''),instruction:String(line.instruction??'')};});
    const parsed=billInput.parse({action:'save',items});
    const total=parsed.items.reduce((sum,line)=>sum+Math.round(cents(line.rate)*line.quantity),0),now=new Date(),bill={id:randomUUID(),tenant_id,kind:'pharmacy-bill',record_number:await number(tenant_id,session),patient_id:row.patient_id,branch_id:row.branch_id,data:{prescription_id:identity,appointment_id:row.data.appointment_id??null,admission_id:row.data.admission_id??null,care_type:row.data.admission_id?'IPD':'OPD',doctor_id:row.data.doctor_id,items:parsed.items.map(line=>({...line,amount:Math.round(cents(line.rate)*line.quantity)/100})),subtotal:total/100,discount:0,discount_percent:0,tax:0},amount:0,total:total/100,paid:0,due:total/100,status:'Draft',record_date:hospitalDay(now),created_by:response.locals.account.id,created_at:now,updated_at:now};
    await db.collection('finance_records').insertOne({...bill},{session});await db.collection('role_work_items').updateOne({tenant_id,id:identity},{$set:{status:'At POS','data.bill_id':bill.id,'data.accepted_at':now,'data.accepted_by':response.locals.account.id,updated_at:now}},{session});await writeAudit(response,'pharmacy_prescription_billed',identity,session,{bill_id:bill.id});return bill;
  });response.status(201).json(result);
});
router.get('/pharmacy/pos',async(_request,response)=>{
  const bills=await db.collection('finance_records').find(await scopeFor(response,{kind:'pharmacy-bill'}),{projection:{_id:0,request_hash:0}}).sort({created_at:-1}).toArray();for(const bill of bills){const patient=bill.patient_id?await db.collection('patients').findOne({tenant_id:bill.tenant_id,id:bill.patient_id}):null;bill.patient_name=patient?`${patient.first_name} ${patient.last_name}`.toUpperCase():bill.data.customer_name??'Walk-in Customer';bill.medical_record_number=patient?.medical_record_number??'';bill.patient_type=bill.data.admission_id?'IPD':'OPD';}response.json({bills,medicines:await medicines(response)});
});
router.get('/pharmacy/pos/print-template',async(_request,response)=>response.json(await db.collection('hospital_print_templates').findOne({tenant_id:response.locals.account.tenant_id,document_type:'pharmacy-bill'},{projection:{_id:0,header_image:1,footer_content:1}})??{header_image:'',footer_content:''}));
for(const editing of [false,true])router[editing?'put':'post'](editing?'/pharmacy/pos/:id':'/pharmacy/pos',async(request,response)=>{
  const body=billInput.parse(request.body),identity=editing?uuid.parse(request.params.id):randomUUID(),tenant_id=response.locals.account.tenant_id,hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const result=await transaction(async session=>{
    await serialize(tenant_id,session);
    if(!editing&&body.request_id){const prior=await db.collection('finance_records').findOne({tenant_id,kind:'pharmacy-bill',request_id:body.request_id},{session,projection:{_id:0}});if(prior){if(prior.request_hash!==hash)throw failure('Request ID already used with different values.',409);delete prior.request_hash;return prior;}}
    const old=editing?await db.collection('finance_records').findOne(await scopeFor(response,{id:identity,kind:'pharmacy-bill'},session),{session}):null;if(editing&&!old)throw failure('Pharmacy bill not found.',404);
    if(old&&old.status!=='Draft')throw failure('Generated or rejected bills are read-only.',409);
    if(old&&(!body.updated_at||new Date(old.updated_at).toISOString()!==body.updated_at))throw failure('Bill changed. Refresh before editing.',409);
    if(!editing&&body.action==='reject')throw failure('Select an existing draft to reject.');
    const branch_id=old?.branch_id??response.locals.account.branch_id;await assertBranch(response,branch_id,session);
    for(const line of body.items)if(line.medicine_id&&!await db.collection('hospital_pharmacy_masters').findOne({tenant_id,id:line.medicine_id,kind:'medicine','data.status':{$ne:'Inactive'}},{session}))throw failure('Select an active medicine in this clinic.');
    let subtotal=0,discount=0,tax=0;const items=body.items.map(line=>{const gross=Math.round(cents(line.rate)*line.quantity),reduction=Math.round(gross*Math.round(body.discount_percent*100)/10000),lineTax=Math.round((gross-reduction)*Math.round(line.gst_percent*100)/10000);subtotal+=gross;discount+=reduction;tax+=lineTax;return {...line,amount:gross/100};});const total=subtotal-discount+tax;cents(total/100);
    const now=new Date(Math.max(Date.now(),old?new Date(old.updated_at).getTime()+1:0)),status=body.action==='generate'?'Bill Generated':body.action==='reject'?'Rejected':'Draft',row={id:identity,tenant_id,kind:'pharmacy-bill',record_number:old?.record_number??await number(tenant_id,session),branch_id,patient_id:old?.patient_id??null,data:{...old?.data,customer_name:body.customer_name,care_type:old?.data?.care_type??'WALK-IN',items,subtotal:subtotal/100,discount:discount/100,discount_percent:body.discount_percent,tax:tax/100},amount:0,total:total/100,paid:old?.paid??0,due:status==='Rejected'?0:total/100,status,record_date:old?.record_date??hospitalDay(now),created_by:old?.created_by??response.locals.account.id,created_at:old?.created_at??now,updated_at:now,...(old?.request_id?{request_id:old.request_id,request_hash:old.request_hash}:body.request_id?{request_id:body.request_id,request_hash:hash}:{})};
    if(old)await db.collection('finance_records').replaceOne({tenant_id,id:identity},row,{session});else await db.collection('finance_records').insertOne({...row},{session});
    if(row.data.prescription_id)await db.collection('role_work_items').updateOne({tenant_id,id:row.data.prescription_id},{$set:{status:status==='Draft'?'At POS':status,updated_at:now}},{session});
    // Bill generation records the invoice. It is not a dispensing or collection event.
    await writeAudit(response,'pharmacy_bill_saved',identity,session,{status,total:row.total});delete row.request_hash;return row;
  });response.status(editing?200:201).json(result);
});
export default router;
