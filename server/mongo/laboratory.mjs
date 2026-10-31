import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,assertBranch,allowedBranches,permissionsFor,requirePermission,writeAudit} from './access.mjs';
import {laboratoryPrice,laboratoryTestAvailable} from './lab-branch-pricing.mjs';
import {labPharmacyBilling} from './lab-billing.mjs';
import {cents,paymentStatus} from './money.mjs';
import {configuredPrefix,operationalSettings} from './settings.mjs';
import {escapeSearch} from './search.mjs';
import {awaitingLabSample,sampleCollectionRow} from './lab-sample-queue.mjs';
const router=Router(),uuid=z.string().uuid(),money=z.coerce.number().finite().nonnegative().max(99999999.99).multipleOf(0.01);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const escape=escapeSearch;
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
router.use(async(request,response,next)=>{
  if(!request.path.startsWith('/lab-')&&!/^\/work-items\/[^/]+\/(?:lab-|sample-action)/.test(request.path))return next();
  const account=response.locals.account;
  if(!['hospital_admin','laboratory','receptionist'].includes(account.role))return response.status(403).json({error:'Laboratory or reception access required.'});
  const granted=await permissionsFor(account),permission=account.role==='receptionist'?(request.method==='GET'?'billing.view':'billing.create'):'lab.order.view';
  if(!granted.includes('*')&&!granted.includes(permission))return response.status(403).json({error:`Permission required: ${permission}`});
  next();
});
async function orderFor(response,orderId,session){
  const order=await db.collection('role_work_items').findOne(await scopeFor(response,{id:orderId,workspace:'laboratory'},session),{session});
  if(!order)throw failure('Laboratory order not found',404);
  return order;
}
async function billFor(order,session){
  const bill=await db.collection('finance_records').findOne({tenant_id:order.tenant_id,id:order.data.bill_id,kind:'invoices'},{session});
  if(!bill)throw failure('Laboratory bill not found',404);return bill;
}
async function postPayment(response,order,bill,amount,method,key,session){
  await db.collection('finance_records').insertOne({id:randomUUID(),tenant_id:order.tenant_id,branch_id:order.branch_id,patient_id:order.patient_id,invoice_id:bill.id,kind:'payments',record_number:`LAB-PAY-${key}`,
    data:{source:'Laboratory',lab_order_id:order.id,payment_mode:method,request_id:key,invoice_total:bill.total,previous_paid:(cents(bill.paid)-cents(amount))/100,paid_to_date:bill.paid,balance_after:bill.due},amount,total:amount,paid:amount,due:0,status:'Paid',record_date:day(),created_by:response.locals.account.id,created_at:new Date()},{session});
}
router.get('/lab-tests',async(request,response)=>{
  const branch=uuid.parse(request.query.center_id??response.locals.account.branch_id);await assertBranch(response,branch);
  const rows=await db.collection('hospital_diagnostic_masters').find({tenant_id:response.locals.account.tenant_id,domain:'pathology',kind:'test'},{projection:{_id:0}}).sort({name:1}).toArray();
  response.json(rows.filter(row=>laboratoryTestAvailable(row.data,branch)).map(row=>({...row,data:{...row.data,amount:laboratoryPrice(row.data,branch)}})));
});
router.get('/lab-patients',async(request,response)=>{
  const query=z.string().trim().max(150).default('').parse(request.query.search);
  if(query.length<2)return response.json([]);
  const rows=await db.collection('patients').find({tenant_id:response.locals.account.tenant_id,deleted_at:null,$or:['first_name','last_name','medical_record_number','phone'].map(field=>({[field]:{$regex:escape(query),$options:'i'}}))},{projection:{_id:0,id:1,medical_record_number:1,first_name:1,last_name:1,phone:1,date_of_birth:1,sex:1,blood_group:1,email:1}}).limit(25).toArray();
  response.json(rows.map(row=>({...row,patient_name:`${row.first_name} ${row.last_name}`})));
});
router.get('/lab-registration-options',async(_request,response)=>{
  const tenant_id=response.locals.account.tenant_id,ids=await allowedBranches(response.locals.account,response.locals.claims.portal);
  const centers=await db.collection('branches').find({tenant_id,is_active:true,...(ids===null?{}:{id:{$in:ids}})},{projection:{_id:0,id:1,name:1}}).toArray();
  const staff=await db.collection('staff_members').find(await scopeFor(response,{status:'Active'}),{projection:{_id:0,id:1,first_name:1,last_name:1}}).toArray();
  response.json({centers,current_center_id:centers.find(row=>row.id===response.locals.account.branch_id)?.id??centers[0]?.id??null,staff:staff.map(row=>({id:row.id,name:`${row.first_name} ${row.last_name}`})),
    partners:await db.collection('referral_partners').find({tenant_id,status:'Active',$or:[{branch_id:response.locals.account.branch_id},{branch_id:null}]},{projection:{_id:0,id:1,name:1}}).toArray(),
    pharmacies:await db.collection('hospital_refer_pharmacies').find({tenant_id},{projection:{_id:0,id:1,name:1,address:1,discount_percentage:1}}).toArray()});
});
const orderInput=z.object({patient_id:uuid,appointment_id:uuid.nullable().optional(),test_ids:z.array(uuid).min(1).max(200),referred_by:uuid.nullable().default(null),referral_partner_id:uuid.nullable().default(null),collector_id:uuid.nullable().default(null),refer_pharmacy_id:uuid.nullable().default(null),center_id:uuid.nullable().default(null),source:z.string().max(100).default('Self'),urgent:z.boolean().default(false),payment_mode:z.string().max(100).default('Cash'),paid:money.default(0),discount:money.default(0)});
router.post('/lab-own-orders',async(request,response)=>{
  const input=orderInput.parse(request.body),tenant_id=response.locals.account.tenant_id,orderId=randomUUID(),invoiceId=randomUUID();
  const result=await transaction(async session=>{
    const branchId=input.center_id??response.locals.account.branch_id;const branch=await assertBranch(response,branchId,session);
    const patient=await db.collection('patients').findOne({tenant_id,id:input.patient_id,deleted_at:null},{session});
    if(!patient)throw failure('Selected patient is unavailable.');
    if(input.appointment_id&&!await db.collection('clinical_appointments').findOne(await scopeFor(response,{id:input.appointment_id,patient_id:input.patient_id,status:{$nin:['Cancelled','No Show']}},session),{session}))throw failure('The selected appointment is unavailable.');
    const ids=[...new Set(input.test_ids)],masters=await db.collection('hospital_diagnostic_masters').find({tenant_id,id:{$in:ids},domain:'pathology',kind:'test'},{session}).toArray();
    if(masters.length!==ids.length)throw failure('One or more selected tests are invalid.');
    const tests=ids.map(test_id=>{const master=masters.find(row=>row.id===test_id);const amount=laboratoryPrice(master.data,branchId);cents(amount);return {test_id,name:master.name,test_type:master.data.test_type??'Pathology',priority:input.urgent?'Urgent':'Routine',instruction:'',amount};});
    let referred='Self',executive='Self',collector='',pharmacy=null;
    if(input.referred_by){const doctor=await db.collection('users').findOne({tenant_id,id:input.referred_by,role:'doctor',is_active:true},{session});if(!doctor)throw failure('Selected referring doctor is unavailable.');referred=`${doctor.first_name} ${doctor.last_name}`;}
    if(input.referral_partner_id){const partner=await db.collection('referral_partners').findOne({tenant_id,id:input.referral_partner_id,status:'Active',$or:[{branch_id:branchId},{branch_id:null}]},{session});if(!partner)throw failure('Selected referral partner is unavailable.');executive=partner.name;}
    if(input.collector_id){const staff=await db.collection('staff_members').findOne({tenant_id,id:input.collector_id,status:'Active',$or:[{branch_id:branchId},{branch_ids:branchId}]},{session});if(!staff)throw failure('Selected collector is unavailable.');collector=`${staff.first_name} ${staff.last_name}`;}
    if(input.refer_pharmacy_id){pharmacy=await db.collection('hospital_refer_pharmacies').findOne({tenant_id,id:input.refer_pharmacy_id},{session});if(!pharmacy)throw failure('Selected referral pharmacy is unavailable.');}
    let totals;try{totals=labPharmacyBilling(tests.map(row=>row.amount),input.discount,input.paid,Number(pharmacy?.discount_percentage??0));}catch(error){throw failure(error.message);}
    if(totals.paid>0&&!(await operationalSettings(tenant_id,session)).payment_methods.includes(input.payment_mode)&&input.payment_mode!=='Insurance')throw failure('Select a valid payment method.');
    const counter=await db.collection('counters').findOneAndUpdate({_id:`${tenant_id}:lab_invoice`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'});
    const number=`${await configuredPrefix(tenant_id,'lab_prefix','LAB',session)}-${day().replaceAll('-','')}-${String(counter.value).padStart(6,'0')}`,now=new Date();
    const data={appointment_id:input.appointment_id??null,patient_type:'OPD',customer_name:`${patient.first_name} ${patient.last_name}`,phone:patient.phone,gender:patient.sex,medical_record_number:patient.medical_record_number,
      tests,diagnosis:'',investigation:'',source:input.source,center:branch.name,center_id:branchId,executive,referral_partner_id:input.referral_partner_id,collector,collector_id:input.collector_id,referred_by:referred,referred_by_id:input.referred_by,
      payment_mode:input.payment_mode,discount_amount:totals.discount,paid_amount:totals.paid,due_amount:totals.due,refer_pharmacy_id:pharmacy?.id??null,refer_pharmacy_name:pharmacy?.name??'Not Applicable',refer_pharmacy_address:pharmacy?.address??'',
      manual_discount_amount:totals.manual_discount_amount,pharmacy_discount_percentage:totals.pharmacy_discount_percentage,pharmacy_discount_amount:totals.pharmacy_discount_amount,bill_id:invoiceId,bill_number:number};
    const row={id:orderId,tenant_id,branch_id:branchId,patient_id:patient.id,created_by:response.locals.account.id,workspace:'laboratory',kind:'pos',title:`Direct Lab · ${data.customer_name}`,status:totals.status==='Unpaid'?'Awaiting Payment':totals.status,priority:input.urgent?'Urgent':'Normal',data,occurred_at:now,created_at:now,updated_at:now};
    const bill={id:invoiceId,tenant_id,kind:'invoices',record_number:number,patient_id:patient.id,branch_id:branchId,data:{...data,lab_order_id:orderId,source:'Laboratory'},amount:totals.subtotal,total:totals.total,paid:totals.paid,due:totals.due,status:totals.status,record_date:day(),created_by:response.locals.account.id,created_at:now,updated_at:now};
    await db.collection('role_work_items').insertOne({...row},{session});await db.collection('finance_records').insertOne({...bill},{session});
    if(totals.paid>0)await postPayment(response,row,bill,totals.paid,input.payment_mode,randomUUID(),session);
    await writeAudit(response,'lab_order_created',orderId,session);
    return {...row,bill:{...bill,tests,patient_name:data.customer_name,medical_record_number:patient.medical_record_number}};
  });response.status(201).json(result);
});
router.get('/lab-orders',async(request,response)=>{
  const stage=z.string().max(100).default('').parse(request.query.stage),extra={workspace:'laboratory'};
  const stages={'Lab Orders':['orders'],'Lab POS':['pos']};
  if(stages[stage])extra.kind={$in:stages[stage]};
  if(stage==='Sample Collection'){
    extra['data.collected_at']=null;extra['data.cancellation_request_id']=null;
    extra.$or=[{kind:{$in:['orders','pos','sample collection']},status:{$in:['Pending','Awaiting Payment','Paid','Partially Paid','Unpaid','Payment not required','Awaiting Sample']},'data.barcodes.0':{$exists:false},'data.processing_status':{$in:[null,'']},'data.result_status':{$in:[null,'','Pending']},'data.tests.0':{$exists:true}},{kind:'sample collection',status:'Barcode Generated'}];
  }
  if(stage==='Results'){extra['data.collected_at']={$type:'string'};extra.status={$nin:['Cancelled','Rejected']};}
  if(stage==='Verification')extra['data.result_status']={$in:['Completed','Partially Completed']};
  if(stage==='Reports'){extra['data.result_status']={$in:['Completed','Partially Completed']};extra['data.doctor_approval']={$type:'object'};}
  const type=z.enum(['','orders','pos','sample collection','results','verification','reports']).default('').parse(request.query.order_type);
  if(type)extra.kind=type;
  if(request.query.from||request.query.to)extra.occurred_at={...(request.query.from?{$gte:new Date(z.string().date().parse(request.query.from)+'T00:00:00+05:30')}:{}),...(request.query.to?{$lte:new Date(z.string().date().parse(request.query.to)+'T23:59:59.999+05:30')}:{})};
  if(request.query.center_id)extra.branch_id=uuid.parse(request.query.center_id);
  const filter=await scopeFor(response,extra),search=z.string().max(150).default('').parse(request.query.search);
  if(search)filter.$and.push({$or:['title','data.customer_name','data.medical_record_number','data.bill_number'].map(field=>({[field]:{$regex:escape(search),$options:'i'}}))});
  const page=z.coerce.number().int().min(1).max(100000).default(1).parse(request.query.page),pageSize=z.coerce.number().int().min(1).max(100).default(25).parse(request.query.page_size);
  const rows=await db.collection('role_work_items').find(filter,{projection:{_id:0,'data.lab_results':0,'data.result_history':0}}).sort({occurred_at:-1}).skip((page-1)*pageSize).limit(pageSize).toArray();
  for(let index=0;index<rows.length;index++){const row=rows[index],bill=row.data.bill_id?await billFor(row):{id:null,record_number:null,total:0,paid:0,due:0,status:'Not billed'};row.bill_id=bill.id;row.bill_number=bill.record_number;row.bill_total=bill.total;row.bill_paid=bill.paid;row.bill_due=bill.due;row.bill_status=bill.status;row.report_available=Boolean(row.data.doctor_approval?.test_ids?.length&&bill.status==='Paid'&&Number(bill.due)===0&&Number(bill.paid)>=Number(bill.total));row.patient_name=row.data.customer_name;row.medical_record_number=row.data.medical_record_number;if(stage==='Sample Collection')rows[index]=sampleCollectionRow(row);}
  const alive={$not:[{$in:['$status',['Cancelled','Rejected']]}]},collected={$ne:[{$ifNull:['$data.collected_at',null]},null]},resultComplete={$in:['$data.result_status',['Completed','Partially Completed']]};
  const metrics={total:true,awaiting:{$and:[alive,{$not:[collected]}]},progress:{$and:[alive,collected,{$not:[resultComplete]}]},ready:{$and:[alive,resultComplete,{$ne:[{$ifNull:['$data.doctor_approval',null]},null]}]},unpaid:{$and:[alive,{$gt:['$data.due_amount',0]}]}};
  const current=day().slice(0,7),parts=day().split('-').map(Number),previous=new Date(Date.UTC(parts[0],parts[1]-2,1)).toISOString().slice(0,7),month={$dateToString:{date:'$occurred_at',format:'%Y-%m',timezone:'Asia/Kolkata'}};
  const aggregate={_id:null},empty={};
  for(const [key,condition] of Object.entries(metrics))for(const [suffix,period] of [['',null],['_current',current],['_previous',previous]]){
    aggregate[key+suffix]={$sum:{$cond:[period?{$and:[condition,{$eq:[month,period]}]}:condition,1,0]}};empty[key+suffix]=0;
  }
  const [summary]=await db.collection('role_work_items').aggregate([{$match:await scopeFor(response,{workspace:'laboratory'})},{$group:aggregate},{$project:{_id:0}}]).toArray();
  response.json({rows,total:await db.collection('role_work_items').countDocuments(filter),summary:summary??empty,page,page_size:pageSize});
});
router.get('/work-items/:id/lab-bill',async(request,response)=>{
  const row=await orderFor(response,uuid.parse(request.params.id)),bill=await billFor(row);delete bill._id;
  const payments=await db.collection('finance_records').find({tenant_id:row.tenant_id,invoice_id:bill.id,kind:'payments'},{projection:{_id:0}}).sort({created_at:1}).toArray();
  response.json({...bill,order_id:row.id,tests:row.data.tests,patient_name:row.data.customer_name,medical_record_number:row.data.medical_record_number,patient_phone:row.data.phone,payments});
});
router.patch('/work-items/:id/lab-bill',async(request,response)=>{
  const body=z.object({payment_mode:z.string().max(100),paid:money.optional(),payment_amount:money.optional(),payment_request_id:uuid.optional(),discount:money}).parse(request.body),orderId=uuid.parse(request.params.id);
  const result=await transaction(async session=>{
    const row=await orderFor(response,orderId,session),bill=await billFor(row,session);
    if(row.status==='Cancelled'||row.data.cancellation_request_id||['Cancelled','Refunded'].includes(bill.status))throw failure('This bill cannot receive payments.',409);
    const incremental=body.payment_amount!==undefined;
    if(incremental&&!body.payment_request_id)throw failure('A payment request ID is required.');
    if(!incremental&&body.paid===undefined)throw failure('Enter a payment amount.');
    if(cents(body.discount)!==cents(bill.data.discount_amount))throw failure('Payment collection cannot change the original discount.');
    const collected=incremental?cents(body.payment_amount):cents(body.paid)-cents(bill.paid),key=body.payment_request_id??randomUUID();
    if(body.payment_request_id){const prior=await db.collection('finance_records').findOne({tenant_id:row.tenant_id,invoice_id:bill.id,kind:'payments','data.request_id':key},{session});if(prior){const matches=incremental?cents(prior.amount)===cents(body.payment_amount):cents(prior.data.paid_to_date)===cents(body.paid);if(!matches||prior.data.payment_mode!==body.payment_mode)throw failure('This payment request was already used with different details.',409);delete bill._id;return bill;}}
    if(collected<0||collected>cents(bill.due))throw failure('Collection cannot reduce paid amounts or exceed the remaining balance.');
    if(collected===0){if(incremental)throw failure('Enter an amount greater than zero.');delete bill._id;return bill;}
    if(!(await operationalSettings(row.tenant_id,session)).payment_methods.includes(body.payment_mode)&&body.payment_mode!=='Insurance')throw failure('Select a valid payment method.');
    const paid=(cents(bill.paid)+collected)/100,due=(cents(bill.total)-cents(paid))/100,status=paymentStatus(cents(bill.total),cents(paid));
    const updated={...bill,paid,due,status,data:{...bill.data,paid_amount:paid,due_amount:due,payment_mode:body.payment_mode},updated_at:new Date()};delete updated._id;
    await db.collection('finance_records').replaceOne({tenant_id:row.tenant_id,id:bill.id},updated,{session});
    await postPayment(response,row,updated,collected/100,body.payment_mode,key,session);
    await db.collection('role_work_items').updateOne({tenant_id:row.tenant_id,id:row.id},{$set:{'data.paid_amount':paid,'data.due_amount':due,'data.payment_mode':body.payment_mode,...(row.kind==='pos'?{status}:{}),updated_at:new Date()}},{session});
    await writeAudit(response,'lab_payment_collected',row.id,session,{amount:collected/100,request_id:key});return updated;
  });response.json(result);
});
router.patch('/work-items/:id/lab-action',requirePermission('lab.order.view'),async(request,response)=>{
  const action=z.object({action:z.enum(['send_sample','send_bill','cancel'])}).parse(request.body).action;
  // Each action validates its own state inside the transaction.
  const saved=await transaction(async session=>{
    const row=await orderFor(response,uuid.parse(request.params.id),session);
    if(action==='cancel'){
      if(row.kind!=='orders'||row.status!=='Pending'||row.data.bill_id)throw failure('Use cancellation approvals for billed or processed orders.',409);
      await db.collection('role_work_items').updateOne({tenant_id:row.tenant_id,id:row.id},{$set:{status:'Cancelled',updated_at:new Date()}},{session});
      await writeAudit(response,'lab_pending_order_cancelled',row.id,session);return {...row,status:'Cancelled',_id:undefined};
    }
    if(action==='send_bill'){
      if(row.data.bill_id){const bill=await billFor(row,session);delete bill._id;return {...row,_id:undefined,bill};}
      if(row.kind!=='orders'||row.status!=='Pending'||row.data.cancellation_request_id)throw failure('Only pending laboratory orders can be billed.',409);
      const permissions=await permissionsFor(response.locals.account,session);
      if(!permissions.includes('*')&&!permissions.includes('billing.create')&&!permissions.includes('lab.order.view'))throw failure('Laboratory billing access required.',403);
      const tests=[];
      for(const item of row.data.tests??[]){
        const master=await db.collection('hospital_diagnostic_masters').findOne({tenant_id:row.tenant_id,id:uuid.parse(item.test_id),domain:'pathology',kind:'test'},{session});
        if(!master||!laboratoryTestAvailable(master.data,row.branch_id))throw failure('A requested test is unavailable in this branch.',409);
        const amount=laboratoryPrice(master.data,row.branch_id);cents(amount);tests.push({...item,name:master.name,amount});
      }
      if(!tests.length)throw failure('Select at least one diagnostic test.');
      const patient=await db.collection('patients').findOne({tenant_id:row.tenant_id,id:row.patient_id,deleted_at:null},{session});if(!patient)throw failure('Patient is unavailable.',409);
      const total=tests.reduce((sum,item)=>sum+cents(item.amount),0)/100,now=new Date(),id=randomUUID();
      const counter=await db.collection('counters').findOneAndUpdate({_id:`${row.tenant_id}:lab_invoice`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'});
      const number=`${await configuredPrefix(row.tenant_id,'lab_prefix','LAB',session)}-${day().replaceAll('-','')}-${String(counter.value).padStart(6,'0')}`;
      const data={...row.data,tests,customer_name:`${patient.first_name} ${patient.last_name}`,medical_record_number:patient.medical_record_number,phone:patient.phone,patient_type:row.data.admission_id?'IPD':'OPD',discount_amount:0,manual_discount_amount:0,paid_amount:0,due_amount:total,payment_mode:'Cash',bill_id:id,bill_number:number,billed_at:now.toISOString()};
      const bill={id,tenant_id:row.tenant_id,branch_id:row.branch_id,patient_id:row.patient_id,kind:'invoices',record_number:number,data:{...data,source:'Laboratory',lab_order_id:row.id},amount:total,total,paid:0,due:total,status:paymentStatus(cents(total),0),record_date:day(),created_by:response.locals.account.id,created_at:now,updated_at:now};
      await db.collection('finance_records').insertOne({...bill},{session});
      await db.collection('role_work_items').updateOne({tenant_id:row.tenant_id,id:row.id},{$set:{kind:'pos',status:total?'Awaiting Payment':'Payment not required',data,updated_at:now}},{session});
      await writeAudit(response,'lab_clinical_order_billed',row.id,session);return {...row,_id:undefined,kind:'pos',status:total?'Awaiting Payment':'Payment not required',data,bill};
    }
    if(row.kind!=='pos'||row.status==='Cancelled'||row.data.cancellation_request_id)throw failure('Only a billed order can be sent for sample collection.',409);
    await billFor(row,session);
    const result=await db.collection('role_work_items').findOneAndUpdate({tenant_id:row.tenant_id,id:row.id},{$set:{kind:'sample collection',status:'Awaiting Sample','data.sample_requested_at':new Date().toISOString(),'data.sample_requested_by':response.locals.account.id,updated_at:new Date()}},{session,returnDocument:'after',projection:{_id:0}});
    await writeAudit(response,'lab_sample_requested',row.id,session);return result;
  });response.json(saved);
});
router.patch('/work-items/:id/sample-action',requirePermission('lab.result.create'),async(request,response)=>{
  const body=z.object({action:z.enum(['generate_barcodes','collected']),collector:z.string().trim().min(2).max(120).optional()}).parse(request.body);
  const saved=await transaction(async session=>{
    const row=await orderFor(response,uuid.parse(request.params.id),session),data={...row.data};let kind,status;
    if(row.status==='Cancelled'||row.data.cancellation_request_id)throw failure('Cancelled orders cannot be collected.',409);
    if(body.action==='generate_barcodes'){
      if(!awaitingLabSample(row)&&!(row.kind==='sample collection'&&row.status==='Barcode Generated'&&data.barcodes?.length&&!data.collected_at))throw failure('Samples must be awaiting collection.',409);
      if(!body.collector)throw failure('Enter the sample collector.');
      if(!data.tests?.length)throw failure('This order has no tests.',409);
      data.barcodes??=data.tests.map((test,index)=>({test_id:test.test_id,test_name:test.name,value:`LAB-${randomUUID()}-${index+1}`}));
      data.collector=body.collector;data.barcode_generated_at??=new Date().toISOString();data.barcode_generated_by=response.locals.account.id;kind='sample collection';status='Barcode Generated';
    }else{
      if(row.kind!=='sample collection'||row.status!=='Barcode Generated'||!Array.isArray(data.barcodes))throw failure('Generate barcodes before marking a sample collected.',409);
      data.collected_at=new Date().toISOString();data.collected_by=response.locals.account.id;kind='results';status='Sample Collected';
    }
    const result=await db.collection('role_work_items').findOneAndUpdate({tenant_id:row.tenant_id,id:row.id},{$set:{kind,status,data,updated_at:new Date()}},{session,returnDocument:'after',projection:{_id:0}});
    await writeAudit(response,body.action==='collected'?'lab_sample_collected':'lab_barcodes_generated',row.id,session);return result;
  });response.json(saved);
});
export default router;
