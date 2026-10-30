import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {admissionInput} from './admission-schema.mjs';
import {scopeFor,assertBranch,requirePermission,writeAudit} from './access.mjs';
import {cents} from './money.mjs';
import {bedStayAmount,inpatientTotal} from './inpatient-billing.mjs';
import {configuredPrefix,operationalSettings} from './settings.mjs';
const router=Router(),uuid=z.string().uuid();
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
function admissionTimestamp(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))throw failure('Enter a valid admission date and time.');
  const qualified=/Z$|[+-]\d{2}:\d{2}$/.test(value)?value:value+'+05:30';
  const parsed=new Date(qualified);
  if(!Number.isFinite(parsed.getTime())||day(parsed)!==day(new Date()))throw failure('IPD admission date must be the current hospital date.');
  if(parsed.getTime()>Date.now())throw failure('Admission time cannot be in the future.');
  return parsed;
}
async function consultant(response,departmentId,doctorId,branchId,session){
  if(departmentId&&!await db.collection('departments').findOne({tenant_id:response.locals.account.tenant_id,id:departmentId,branch_id:branchId,is_active:true},{session}))throw failure('Select an active department in the admission branch.');
  if(!doctorId)return;
  if(!departmentId)throw failure('Select the consultant department.');
  const tenant_id=response.locals.account.tenant_id;
  const user=await db.collection('users').findOne({tenant_id,id:doctorId,role:'doctor',is_active:true},{session});
  const staff=await db.collection('staff_members').findOne({tenant_id,user_id:doctorId,staff_type:'Doctor',status:'Active'},{session});
  const assigned=await db.collection('user_branch_access').findOne({tenant_id,user_id:doctorId,branch_id:branchId},{session});
  const department=staff?.professional?.branch_fees?.[branchId]?.department_id||staff?.department_id||user?.department_id;
  if(!user||!staff||(!assigned&&user.branch_id!==branchId)||department!==departmentId)throw failure('Select a consultant assigned to the admission branch and department.');
}
async function takeBed(response,bedId,branchId,session){
  if(!bedId)return null;
  const tenant_id=response.locals.account.tenant_id;
  const bed=await db.collection('beds').findOneAndUpdate({id:bedId,tenant_id,branch_id:branchId,status:'Available'},{$set:{status:'Occupied',updated_at:new Date()}},{session,returnDocument:'before'});
  if(!bed)throw failure('Selected bed is unavailable in this branch.',409);
  return bed;
}
async function stay(admission,bed,startedAt,session){
  if(bed)await db.collection('ipd_bed_stays').insertOne({id:randomUUID(),tenant_id:admission.tenant_id,admission_id:admission.id,branch_id:admission.branch_id,
    bed_id:bed.id,ward_id:bed.ward_id,room_id:bed.room_id,bed_number:bed.bed_number,daily_rate:bed.daily_charge,started_at:startedAt,ended_at:null},{session});
}
async function recalculate(row,session){
  const stays=await db.collection('ipd_bed_stays').find({tenant_id:row.tenant_id,admission_id:row.id},{session}).toArray();
  const totals=inpatientTotal(stays,row.charges??[],row.discount??0);
  const update={bed_daily_charge:totals.bed_amount,total_amount:totals.total_amount,admission_payment_status:cents(row.paid_amount)+cents(row.deposit_amount)>=cents(totals.total_amount)&&totals.total_amount>0?'Paid':'Unpaid',updated_at:new Date()};
  await db.collection('ipd_admissions').updateOne({tenant_id:row.tenant_id,id:row.id},{$set:update},{session});
  return {...row,...update};
}
async function enrich(row){
  const output={...row};delete output._id;
  for(const [collection,key,label,fields] of [['patients','patient_id','patient_name',['first_name','last_name']],['users','consultant_doctor_id','doctor_name',['first_name','last_name']],['departments','department_id','department_name',['name']],['branches','branch_id','branch_name',['name']],['wards','ward_id','ward_name',['name']],['rooms','room_id','room_number',['room_number']],['beds','bed_id','bed_number',['bed_number']]]){
    const record=row[key]?await db.collection(collection).findOne({tenant_id:row.tenant_id,id:row[key]}):null;
    output[label]=record?fields.map(field=>record[field]??'').join(' '):'';
    if(collection==='patients')output.medical_record_number=record?.medical_record_number??'';
  }
  // Hospitals use id as their tenant identity, rather than tenant_id.
  const hospital=await db.collection('hospitals').findOne({id:row.tenant_id});
  output.hospital_name=hospital?.name??'';
  return output;
}
router.get('/ipd',requirePermission('ipd.view'),async(_request,response)=>{
  const rows=await db.collection('ipd_admissions').find(await scopeFor(response,{}),{projection:{_id:0}}).sort({admitted_at:-1}).toArray();
  const result=[];for(const row of rows)result.push(await enrich(row));response.json(result);
});
router.get('/ipd/:id/details',requirePermission('ipd.view'),async(request,response)=>{
  const admissionId=uuid.parse(request.params.id);
  const row=await transaction(async session=>{
    const found=await db.collection('ipd_admissions').findOne(await scopeFor(response,{id:admissionId},session),{session});
    if(!found)throw failure('Admission not found',404);return recalculate(found,session);
  });
  const common={tenant_id:row.tenant_id,admission_id:row.id};
  const stays=await db.collection('ipd_bed_stays').find(common,{projection:{_id:0}}).sort({started_at:1}).toArray();
  response.json({admission:await enrich(row),patient:await db.collection('patients').findOne({tenant_id:row.tenant_id,id:row.patient_id},{projection:{_id:0,normalized_name:0}}),
    transfers:await db.collection('ipd_transfer_history').find(common,{projection:{_id:0}}).sort({created_at:-1}).toArray(),
    invoices:await db.collection('finance_records').find({tenant_id:row.tenant_id,branch_id:row.branch_id,kind:'invoices','data.admission_id':row.id},{projection:{_id:0}}).toArray(),
    bed_stays:stays.map(item=>({...item,...bedStayAmount(item)}))});
});
router.post('/ipd',requirePermission('ipd.create'),async(request,response)=>{
  const input=admissionInput.parse(request.body),admittedAt=admissionTimestamp(input.admitted_at),tenant_id=response.locals.account.tenant_id;
  if(input.expected_discharge)z.string().date().parse(input.expected_discharge);
  if(input.expected_discharge&&input.expected_discharge<day(admittedAt))throw failure('Expected discharge cannot precede admission.');
  const charges=z.array(z.object({amount:z.coerce.number().nonnegative().finite().max(99999999.99).multipleOf(0.01)}).passthrough()).max(100).parse(input.charges);
  for(const field of ['advance','deposit_amount','paid_amount','discount'])cents(input[field]);
  if(cents(input.advance)>0)throw failure('Use the deposit field for advance collections so the receipt is recorded.');
  const admissionId=randomUUID();
  const saved=await transaction(async session=>{
    await db.collection('workflow_locks').updateOne({_id:`${tenant_id}:ipd:${input.patient_id}`},{$inc:{version:1}},{session,upsert:true});
    const patient=await db.collection('patients').findOne({tenant_id,id:input.patient_id,deleted_at:null},{session});
    if(!patient)throw failure('Patient not found',404);
    const branch_id=patient.branch_id;await assertBranch(response,branch_id,session);
    if(await db.collection('ipd_admissions').findOne({tenant_id,patient_id:patient.id,active:true},{session}))throw failure('This patient already has an active IPD admission.',409);
    await consultant(response,input.department_id,input.consultant_doctor_id,branch_id,session);
    const bed=await takeBed(response,input.bed_id,branch_id,session);
    if(!bed&&(input.ward_id||input.room_id)){
      for(const [collection,key] of [['wards','ward_id'],['rooms','room_id']])if(input[key]&&!await db.collection(collection).findOne({tenant_id,id:input[key],branch_id},{session}))throw failure('Selected location is outside the admission branch.');
      if(input.room_id&&input.ward_id&&!await db.collection('rooms').findOne({tenant_id,id:input.room_id,ward_id:input.ward_id},{session}))throw failure('Room does not belong to the selected ward.');
    }
    const initial=cents(bed?.daily_charge??0)+charges.reduce((sum,charge)=>sum+cents(charge.amount),0);
    if(cents(input.discount)>initial||cents(input.paid_amount)>initial-cents(input.discount))throw failure('Discount or payment exceeds admission charges.');
    if(cents(input.paid_amount)+cents(input.deposit_amount)>0){
      if(!(await operationalSettings(tenant_id,session)).payment_methods.includes(input.payment_mode))throw failure('Select a valid payment method.');
    }
    const counter=await db.collection('counters').findOneAndUpdate({_id:`${tenant_id}:ipd`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'});
    const now=new Date(),row={...input,charges,id:admissionId,tenant_id,branch_id,ipd_number:`${await configuredPrefix(tenant_id,'ipd_prefix','IPD',session)}-${String(counter.value).padStart(6,'0')}`,admitted_at:admittedAt,
      ward_id:bed?.ward_id??input.ward_id,room_id:bed?.room_id??input.room_id,bed_id:bed?.id??null,attendant:{name:input.attendant_name,phone:input.attendant_phone,relationship:input.attendant_relationship},
      consultation_fee:0,registration_amount:0,registration_fee_amount:0,registration_addon_amount:0,registration_deposit_amount:0,registration_discount_amount:0,status:'Admitted',active:true,created_at:now,updated_at:now};
    delete row.attendant_name;delete row.attendant_phone;delete row.attendant_relationship;
    await db.collection('ipd_admissions').insertOne({...row},{session});
    await stay(row,bed,admittedAt,session);
    const recalculated=await recalculate(row,session);
    for(const [kind,value] of [['PAYMENT',input.paid_amount],['DEPOSIT',input.deposit_amount]])if(cents(value)>0)await db.collection('finance_records').insertOne({id:randomUUID(),tenant_id,branch_id,patient_id:patient.id,kind:'payments',record_number:`IPD-${kind}-${admissionId}`,
      data:{admission_id:admissionId,ipd_number:row.ipd_number,source:kind==='DEPOSIT'?'IPD Deposit':'IPD Admission',is_deposit:kind==='DEPOSIT',payment_method:input.payment_mode,transaction_reference:input.payment_reference},amount:value,total:value,paid:value,due:0,status:'Paid',created_by:response.locals.account.id,record_date:day(now),created_at:now},{session});
    await writeAudit(response,'ipd_admitted',admissionId,session);
    return recalculated;
  });response.status(201).json(saved);
});
router.put('/ipd/:id/transfer',requirePermission('ipd.update'),async(request,response)=>{
  const admissionId=uuid.parse(request.params.id),optional=z.union([uuid,z.literal(''),z.null()]).optional().transform(value=>value||null);
  const input=z.object({transfer_type:z.string().min(1).max(100),department_id:optional,consultant_doctor_id:optional,ward_id:optional,room_id:optional,bed_id:optional,notes:z.string().max(2000).default('')}).parse(request.body);
  const saved=await transaction(async session=>{
    const filter=await scopeFor(response,{id:admissionId,active:true},session),row=await db.collection('ipd_admissions').findOne(filter,{session});
    if(!row)throw failure('Active admission not found',404);
    if(input.bed_id===row.bed_id&&input.bed_id)throw failure('Select a different available bed.');
    const department=input.department_id??row.department_id,doctor=input.consultant_doctor_id??row.consultant_doctor_id;
    await consultant(response,department,doctor,row.branch_id,session);
    const now=new Date(),bed=input.bed_id?await takeBed(response,input.bed_id,row.branch_id,session):null;
    if(bed){
      if(row.bed_id)await db.collection('beds').updateOne({id:row.bed_id,tenant_id:row.tenant_id,status:'Occupied'},{$set:{status:'Cleaning',updated_at:now}},{session});
      await db.collection('ipd_bed_stays').updateMany({tenant_id:row.tenant_id,admission_id:row.id,ended_at:null},{$set:{ended_at:now}},{session});
      await stay(row,bed,now,session);
    }else if(input.ward_id&&input.ward_id!==row.ward_id||input.room_id&&input.room_id!==row.room_id)throw failure('Select an available bed to change the ward or room.');
    const updated={...row,department_id:department,consultant_doctor_id:doctor,...(bed?{bed_id:bed.id,room_id:bed.room_id,ward_id:bed.ward_id}:{}),updated_at:now};delete updated._id;
    await db.collection('ipd_admissions').replaceOne(filter,updated,{session});
    await db.collection('ipd_transfer_history').insertOne({id:randomUUID(),tenant_id:row.tenant_id,branch_id:row.branch_id,admission_id:row.id,transfer_type:input.transfer_type,from_bed_id:row.bed_id,to_bed_id:updated.bed_id,from_department_id:row.department_id,to_department_id:department,from_doctor_id:row.consultant_doctor_id,to_doctor_id:doctor,notes:input.notes,created_by:response.locals.account.id,created_at:now},{session});
    await writeAudit(response,'ipd_transferred',row.id,session);
    return recalculate(updated,session);
  });response.json(saved);
});
router.put('/ipd/:id/status',requirePermission('ipd.update'),(_request,response)=>response.status(501).json({code:'MONGODB_WORKFLOW_PENDING',error:'IPD discharge and cancellation clearance are not converted yet. Direct status changes are disabled.'}));
export default router;
