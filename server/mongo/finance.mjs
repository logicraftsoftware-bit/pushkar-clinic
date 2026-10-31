import {Router} from 'express';
import {z} from 'zod';
import {db,transaction} from './database.mjs';
import {requirePermission,scopeFor,allowedBranches,permissionsFor} from './access.mjs';
import {inventoryScope} from './inventory.mjs';
import {operationalSettings} from './settings.mjs';
import {syncAdmissionInvoice} from './finance-ledger.mjs';
const router=Router();
async function enrich(row){
  const tenant_id=row.tenant_id;
  const invoice=row.invoice_id?await db.collection('finance_records').findOne({tenant_id,id:row.invoice_id}):null;
  const data={...invoice?.data,...row.data};
  const [patient,branch,hospital,creator,appointment,admission,lab]=await Promise.all([
    (row.patient_id||invoice?.patient_id)?db.collection('patients').findOne({tenant_id,id:row.patient_id||invoice.patient_id}):null,
    db.collection('branches').findOne({tenant_id,id:row.branch_id}),db.collection('hospitals').findOne({id:tenant_id}),
    row.created_by?db.collection('users').findOne({tenant_id,id:row.created_by}):null,
    data.appointment_id?db.collection('clinical_appointments').findOne({tenant_id,id:data.appointment_id}):null,
    data.admission_id?db.collection('ipd_admissions').findOne({tenant_id,id:data.admission_id}):null,
    data.lab_order_id?db.collection('role_work_items').findOne({tenant_id,id:data.lab_order_id,workspace:'laboratory'}):null,
  ]);
  const doctorId=appointment?.doctor_id||admission?.consultant_doctor_id,departmentId=appointment?.department_id||admission?.department_id;
  const doctor=doctorId?await db.collection('users').findOne({tenant_id,id:doctorId}):null,department=departmentId?await db.collection('departments').findOne({tenant_id,id:departmentId}):null;
  Object.assign(row,{patient_name:patient?`${patient.first_name} ${patient.last_name}`.toUpperCase():'',medical_record_number:patient?.medical_record_number??'',patient_phone:patient?.phone??'',patient_date_of_birth:patient?.date_of_birth??null,patient_address:patient?.address??{},branch_name:branch?.name??'',hospital_name:hospital?.name??'',invoice_number:invoice?.record_number??'',created_by_name:creator?`${creator.first_name} ${creator.last_name}`:'',invoice_data:invoice?.data??null,invoice_record_date:invoice?.record_date??null,accounting_invoice_amount:invoice?.amount??null,accounting_invoice_total:invoice?.total??null,
    accounting_department_id:departmentId??null,accounting_department_name:department?.name??data.department_name??'',accounting_doctor_id:doctorId??null,accounting_doctor_name:doctor?`${doctor.first_name} ${doctor.last_name}`:data.doctor_name??'',accounting_encounter:lab?'Laboratory':appointment?'OPD':admission?'IPD':row.kind==='pharmacy-bill'?'Pharmacy':null,appointment_number:appointment?.appointment_number??null,accounting_visit_type:appointment?.visit_type??admission?.admission_type??null,accounting_opd_amount:appointment?.consultation_fee??null,accounting_appointment_charges:appointment?.charges??[],accounting_appointment_discount:appointment?.discount??0,accounting_lab_data:lab?.data??null});
  return row;
}
router.get('/finance/accounting-options',requirePermission('billing.view'),async(_request,response)=>{
  const ids=await allowedBranches(response.locals.account,response.locals.claims.portal),tenant_id=response.locals.account.tenant_id;
  const branches=await db.collection('branches').find({tenant_id,is_active:true,...(ids===null?{}:{id:{$in:ids}})},{projection:{_id:0,id:1,name:1}}).toArray();
  const departments=await db.collection('departments').find(await scopeFor(response,{is_active:true}),{projection:{_id:0,id:1,name:1,branch_id:1}}).toArray();
  const assigned=await db.collection('clinical_appointments').find(await scopeFor(response),{projection:{doctor_id:1,branch_id:1}}).toArray(),doctors=[];
  const seen=new Set();for(const row of assigned){const key=`${row.doctor_id}:${row.branch_id}`;if(seen.has(key))continue;seen.add(key);const user=await db.collection('users').findOne({tenant_id,id:row.doctor_id});if(user)doctors.push({id:user.id,name:`${user.first_name} ${user.last_name}`,branch_id:row.branch_id});}
  response.json({branches,departments,doctors,encounters:['OPD','IPD','Laboratory & Radiology','Pharmacy']});
});
router.get('/finance/lab-invoices/:id',requirePermission('billing.view'),async(request,response)=>{
  const filter=await scopeFor(response,{id:z.string().uuid().parse(request.params.id),kind:'invoices','data.lab_order_id':{$type:'string'},...(response.locals.claims.portal==='receptionist'?{created_by:response.locals.account.id}:{})});
  const row=await db.collection('finance_records').findOne(filter,{projection:{_id:0,request_hash:0}});
  if(!row)return response.status(404).json({error:'Laboratory invoice not found.'});
  const payments=await db.collection('finance_records').find({tenant_id:row.tenant_id,invoice_id:row.id,kind:'payments'},{projection:{_id:0,request_hash:0}}).sort({created_at:1,id:1}).toArray();
  const template=await db.collection('hospital_print_templates').findOne({tenant_id:row.tenant_id,document_type:'pathology'});
  response.json({...await enrich(row),tests:row.data.tests,payments,pathology_header_image:template?.header_image??'',pathology_footer_content:template?.footer_content??''});
});
router.get('/finance/:kind',requirePermission('billing.view'),async(request,response)=>{
  const kind=z.enum(['invoices','payments','expenses','refunds','pharmacy-bill','outstanding','reports','all','reception-accounting']).parse(request.params.kind);
  const date=z.union([z.string().date(),z.literal('')]).default(''),from=date.parse(request.query.from),to=date.parse(request.query.to);
  if(from&&to&&from>to)return response.status(400).json({error:'From Date must be on or before To Date.'});
  if(['invoices','outstanding','reports','all','reception-accounting'].includes(kind))await transaction(async session=>{
    const admissions=await db.collection('ipd_admissions').find(await scopeFor(response,{},session),{session}).toArray();
    for(const admission of admissions)await syncAdmissionInvoice(admission,session);
  });
  if(kind==='invoices'&&request.query.sync_only==='true')return response.json({synced:true});
  const extra={...(kind==='outstanding'?{kind:'invoices',due:{$gt:0}}:['all','reception-accounting','reports'].includes(kind)?{}:{kind}),...(from||to?{record_date:{...(from?{$gte:from}:{}),...(to?{$lte:to}:{})}}:{})};
  if(['all','reception-accounting'].includes(kind)&&response.locals.claims.portal==='receptionist')extra.created_by=response.locals.account.id;
  const rows=await db.collection('finance_records').find(await scopeFor(response,extra),{projection:{_id:0,request_hash:0}}).sort({record_date:-1,created_at:-1}).toArray();
  if(kind==='reports'){
    const totals={invoiced:0,collected:0,outstanding:0,expenses:0,refunds:0};
    for(const row of rows){if(row.kind==='invoices'){totals.invoiced+=Math.round(row.total*100);totals.outstanding+=Math.round(row.due*100);}else if(row.kind==='payments')totals.collected+=Math.round(row.amount*100);else if(row.kind==='expenses')totals.expenses+=Math.round(row.amount*100);else if(row.kind==='refunds')totals.refunds+=Math.round(row.amount*100);}
    return response.json([Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,value/100]))]);
  }
  for(const row of rows){await enrich(row);if(row.kind==='payments'&&row.invoice_id)row.accounting_is_balance_payment=Boolean(await db.collection('finance_records').findOne({tenant_id:row.tenant_id,invoice_id:row.invoice_id,kind:'payments',$or:[{created_at:{$lt:row.created_at}},{created_at:row.created_at,id:{$lt:row.id}}]},{projection:{_id:1}}));}
  response.json(rows);
});
router.get('/lookups',async(request,response)=>{
  const tenant_id=response.locals.account.tenant_id,ids=await allowedBranches(response.locals.account,response.locals.claims.portal),permissions=await permissionsFor(response.locals.account);
  const has=code=>permissions.includes('*')||permissions.includes(code),billing=has('billing.view'),stock=has('inventory.view');
  if(!billing&&!stock)return response.status(403).json({error:'Billing or inventory access required.'});
  const requested=z.string().max(300).default(billing?'branches,patients,invoices':'branches,items,categories,suppliers,users').parse(request.query.keys).split(',').filter(Boolean);
  const result={};
  for(const key of new Set(requested)){
    if(key==='branches')result.branches=await db.collection('branches').find({tenant_id,is_active:true,...(ids===null?{}:{id:{$in:ids}})},{projection:{_id:0,id:1,name:1}}).toArray();
    else if(['patients','invoices'].includes(key)){
      if(!billing)return response.status(403).json({error:'Billing access required for patient and invoice lookups.'});
      if(key==='patients')result.patients=(await db.collection('patients').find(await scopeFor(response,{deleted_at:null}),{projection:{_id:0,id:1,first_name:1,last_name:1,medical_record_number:1}}).toArray()).map(row=>({...row,name:`${row.first_name} ${row.last_name}`}));
      else result.invoices=(await db.collection('finance_records').find(await scopeFor(response,{kind:'invoices'}),{projection:{_id:0,id:1,record_number:1,total:1,due:1}}).toArray()).map(row=>({...row,code:row.record_number}));
    }else if(['items','categories','suppliers'].includes(key)){
      if(!stock)return response.status(403).json({error:'Inventory access required.'});
      result[key]=(await db.collection('inventory_records').find(await inventoryScope(response,{kind:key,status:{$ne:'Inactive'}}),{projection:{_id:0,id:1,record_code:1,data:1,quantity:1,branch_id:1}}).toArray()).map(row=>({id:row.id,code:row.record_code,name:row.data?.name??'',stock:row.quantity,branch_id:row.branch_id}));
    }else if(key==='users')result.users=(await db.collection('users').find(await scopeFor(response,{is_active:true}),{projection:{_id:0,id:1,first_name:1,last_name:1}}).toArray()).map(row=>({id:row.id,name:`${row.first_name} ${row.last_name}`}));
  }
  const runtime=await operationalSettings(tenant_id);
  response.json({...result,payment_methods:runtime.payment_methods,general_settings:runtime.general});
});
export default router;
