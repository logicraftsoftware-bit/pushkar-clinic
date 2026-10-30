import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {requirePermission,scopeFor,assertBranch,permissionsFor,writeAudit} from './access.mjs';
import {doctorDay,doctorSlots,fiveMinuteDoctorSlots,availableDoctorSlots,upcomingDoctorSlots} from './doctor-availability.mjs';
import {cents,appointmentTotal,paymentStatus} from './money.mjs';
const router=Router(),uuid=z.string().uuid();
const date=z.string().date(),time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/).transform(value=>value.slice(0,5));
const amount=z.coerce.number().finite().nonnegative().max(99999999.99).multipleOf(0.01);
const appointmentInput=z.object({branch_id:uuid,department_id:uuid,patient_id:uuid,doctor_id:uuid,appointment_date:date,appointment_time:time,
  slot_interval:z.literal(5).optional(),appointment_type:z.string().max(100),visit_type:z.string().max(100),reason:z.string().max(4000).default(''),
  consultation_fee:amount.default(0),payment_status:z.string().optional(),source:z.string().max(100).default('Reception'),notes:z.string().max(10000).default(''),
  symptoms:z.array(z.string().max(200)).max(100).default([]),charges:z.array(z.object({label:z.string().max(200).optional(),name:z.string().max(200).optional(),amount,doctor_fee:z.enum(['registration_fee','maintenance_fee']).optional()}).passthrough()).max(100).default([]),
  doctor_fee_selection:z.object({registration_fee:z.boolean(),maintenance_fee:z.boolean()}).optional(),discount:amount.default(0),payment_mode:z.string().max(100).default(''),paid_amount:amount.default(0)});
function failure(message,status=400){return Object.assign(new Error(message),{status});}
async function methods(tenant,session){
  const setting=await db.collection('hospital_settings').findOne({tenant_id:tenant,key:'payment_methods'},{session});
  return Array.isArray(setting?.value)?setting.value:['Cash','UPI','Card','Bank Transfer'];
}
async function doctorFor(response,branch,department,doctorId,session){
  await assertBranch(response,branch,session);
  const tenant=response.locals.account.tenant_id;
  const dept=await db.collection('departments').findOne({id:department,tenant_id:tenant,branch_id:branch,is_active:true},{session});
  const user=await db.collection('users').findOne({id:doctorId,tenant_id:tenant,role:'doctor',is_active:true},{session});
  const staff=await db.collection('staff_members').findOne({user_id:doctorId,tenant_id:tenant,staff_type:'Doctor',status:'Active'},{session});
  const assignment=await db.collection('user_branch_access').findOne({user_id:doctorId,tenant_id:tenant,branch_id:branch},{session});
  const professional=staff?.professional??{},branchFees=professional.branch_fees?.[branch]??{};
  const selectedDepartment=branchFees.department_id||staff?.department_id||user?.department_id;
  if(!dept||!user||!staff||(!assignment&&user.branch_id!==branch)||selectedDepartment!==department)throw failure('Select an active doctor assigned to this branch and department.');
  return {user,staff,department:dept,professional:{...professional,...branchFees}};
}
async function slotsFor(doctor,dayString,interval,exclude,session){
  const professional=doctor.professional,day=doctorDay(professional.appointment_schedule??[],professional.appointment_default_schedule,dayString,professional.appointment_unavailable_dates??[]);
  if(!day)return [];
  const bookings=await db.collection('clinical_appointments').find({tenant_id:doctor.user.tenant_id,doctor_id:doctor.user.id,appointment_date:dayString,...(exclude?{id:{$ne:exclude}}:{}),status:{$nin:['Cancelled','No Show']}},{session}).toArray();
  const maximum=Number(day.max_slots||professional.maximum_appointments||0);
  if(maximum&&bookings.length>=maximum)return [];
  const source=interval===5?fiveMinuteDoctorSlots(day):doctorSlots(day,Number(professional.slot_duration)||20,Number(professional.maximum_appointments)||0);
  const available=interval!==5&&day.slot_mode==='capacity'?availableDoctorSlots(source,bookings):source.filter(slot=>!bookings.some(row=>row.appointment_time.slice(0,5)===slot.time));
  const next=Math.max(0,...bookings.map(row=>Number(row.slot_serial)||0))+1;
  return upcomingDoctorSlots(available.map(slot=>({...slot,serial:interval===5?next:slot.serial})),dayString);
}
async function receipt(response,row,amountCents,key,session){
  if(!amountCents)return;
  const now=new Date(),record_date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  await db.collection('finance_records').insertOne({id:randomUUID(),tenant_id:row.tenant_id,branch_id:row.branch_id,patient_id:row.patient_id,kind:'payments',record_number:key,
    data:{appointment_id:row.id,appointment_number:row.appointment_number,payment_method:row.payment_mode,transaction_reference:row.payment_reference??'',source:'OPD Appointment'},
    amount:amountCents/100,total:amountCents/100,paid:amountCents/100,due:0,status:'Paid',record_date,created_by:response.locals.account.id,created_at:now},{session});
}
router.get('/lookups',async(request,response)=>{
  const granted=await permissionsFor(response.locals.account);
  if(!granted.includes('*')&&!granted.some(code=>['appointment.view','ipd.view','hospital.manage'].includes(code)))throw failure('Clinical access is required.',403);
  const mode=z.enum(['all','none','recent']).default('all').parse(request.query.patients),tenant=response.locals.account.tenant_id;
  const query=await scopeFor(response,{}),read=async name=>db.collection(name).find(query,{projection:{_id:0}}).toArray();
  const branches=await db.collection('branches').find({tenant_id:tenant,is_active:true}).toArray();
  // Branches are filtered separately because their identity is stored in id.
  const allowed=await import('./access.mjs').then(module=>module.allowedBranches(response.locals.account,response.locals.claims.portal));
  const visibleBranches=branches.filter(branch=>allowed===null||allowed.includes(branch.id));
  const patients=mode==='none'?[]:await db.collection('patients').find({tenant_id:tenant,deleted_at:null},{projection:{_id:0,id:1,branch_id:1,first_name:1,last_name:1,medical_record_number:1,phone:1,date_of_birth:1,address:1}}).sort({created_at:-1}).limit(mode==='recent'?25:10000).toArray();
  for(const patient of patients)patient.name=`${patient.first_name} ${patient.last_name}`;
  const staff=await db.collection('staff_members').find({tenant_id:tenant,staff_type:'Doctor',status:'Active',branch_ids:{$in:visibleBranches.map(branch=>branch.id)}}).toArray();
  const doctors=[];
  for(const row of staff){const user=await db.collection('users').findOne({id:row.user_id,tenant_id:tenant,is_active:true});if(user)doctors.push({id:user.id,name:`${user.first_name} ${user.last_name}`,branch_id:user.branch_id,branch_ids:row.branch_ids,department_id:row.department_id,...row.professional});}
  response.json({current_branch_id:response.locals.account.branch_id,patients,branches:visibleBranches.map(({id,name})=>({id,name})),departments:await read('departments'),doctors,wards:await read('wards'),rooms:await read('rooms'),beds:await read('beds'),symptom_types:[],charges:await db.collection('hospital_charge_masters').find({tenant_id:tenant,kind:'charge'},{projection:{_id:0}}).toArray(),payment_methods:await methods(tenant),general_settings:{currency_symbol:'₹',date_format:'dd-mm-yyyy',time_format:'12 Hour'}});
});
router.get('/patient-search',requirePermission('appointment.view'),async(request,response)=>{
  const search=z.string().trim().min(1).max(150).parse(request.query.search??request.query.q),escaped=search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rows=await db.collection('patients').find({tenant_id:response.locals.account.tenant_id,deleted_at:null,$or:['first_name','last_name','medical_record_number','phone'].map(key=>({[key]:{$regex:escaped,$options:'i'}}))},{projection:{_id:0,id:1,first_name:1,last_name:1,medical_record_number:1,phone:1}}).limit(25).toArray();
  response.json(rows.map(row=>({...row,name:`${row.first_name} ${row.last_name}`})));
});
router.get('/appointment-slots',requirePermission('appointment.view'),async(request,response)=>{
  const doctor=await doctorFor(response,uuid.parse(request.query.branch_id),uuid.parse(request.query.department_id),uuid.parse(request.query.doctor_id));
  response.json(await slotsFor(doctor,date.parse(request.query.date),z.coerce.number().refine(value=>value===5).optional().parse(request.query.slot_interval),uuid.optional().parse(request.query.appointment_id)));
});
router.get('/appointments',requirePermission('appointment.view'),async(request,response)=>{
  const extra={};
  for(const field of ['branch_id','doctor_id','patient_id'])if(request.query[field])extra[field]=uuid.parse(request.query[field]);
  if(request.query.from||request.query.to)extra.appointment_date={...(request.query.from?{$gte:date.parse(request.query.from)}:{}),...(request.query.to?{$lte:date.parse(request.query.to)}:{})};
  const filter=await scopeFor(response,extra),paged=request.query.page!==undefined,page=z.coerce.number().int().min(1).max(100000).default(1).parse(request.query.page),pageSize=z.coerce.number().int().min(1).max(100).default(25).parse(request.query.page_size);
  let cursor=db.collection('clinical_appointments').find(filter,{projection:{_id:0}}).sort({appointment_date:-1,appointment_time:1});
  if(paged)cursor=cursor.skip((page-1)*pageSize).limit(pageSize);
  const rows=await cursor.toArray();
  for(const row of rows){
    const patient=await db.collection('patients').findOne({tenant_id:row.tenant_id,id:row.patient_id});
    const doctor=await db.collection('users').findOne({tenant_id:row.tenant_id,id:row.doctor_id});
    const department=await db.collection('departments').findOne({tenant_id:row.tenant_id,id:row.department_id});
    row.patient_name=patient?`${patient.first_name} ${patient.last_name}`:'';row.medical_record_number=patient?.medical_record_number??'';
    row.doctor_name=doctor?`${doctor.first_name} ${doctor.last_name}`:'';row.department_name=department?.name??'';
  }
  response.json(paged?{rows,total:await db.collection('clinical_appointments').countDocuments(filter),page,page_size:pageSize}:rows);
});
router.post('/appointments',requirePermission('appointment.create'),async(request,response)=>{
  const body=appointmentInput.parse(request.body),tenant=response.locals.account.tenant_id,recordId=randomUUID();
  const result=await transaction(async session=>{
    await db.collection('workflow_locks').updateOne({_id:`${tenant}:doctor:${body.doctor_id}:${body.appointment_date}`},{$inc:{version:1}},{session,upsert:true});
    const doctor=await doctorFor(response,body.branch_id,body.department_id,body.doctor_id,session);
    await db.collection('staff_members').updateOne({tenant_id:tenant,id:doctor.staff.id},{$inc:{workflow_version:1}},{session});
    await db.collection('users').updateOne({tenant_id:tenant,id:doctor.user.id},{$inc:{booking_version:1}},{session});
    if(!await db.collection('patients').findOne({tenant_id:tenant,id:body.patient_id,deleted_at:null},{session}))throw failure('Selected patient is unavailable.');
    const slot=(await slotsFor(doctor,body.appointment_date,body.slot_interval,null,session)).find(row=>row.time===body.appointment_time);
    if(!slot)throw failure('This doctor slot is unavailable. Select a future available slot.',409);
    const charges=body.charges.filter(charge=>!charge.doctor_fee);
    if(body.doctor_fee_selection){
      for(const field of ['registration_fee','maintenance_fee'])if(body.doctor_fee_selection[field])charges.push({label:field==='registration_fee'?'Registration Fee':'Maintenance Fee',amount:cents(doctor.professional[field]??100)/100,doctor_fee:field,fee_snapshot_version:2});
    }else charges.push(...body.charges.filter(charge=>charge.doctor_fee));
    const record={...body,charges,id:recordId,tenant_id:tenant,status:'Booked',slot_serial:slot.serial,created_at:new Date(),updated_at:new Date()};
    delete record.doctor_fee_selection;
    const total=appointmentTotal(record),paid=cents(record.paid_amount);
    if(paid>total)throw failure('Payment exceeds the appointment total.');
    if(paid&&!(await methods(tenant,session)).includes(record.payment_mode))throw failure('Select a valid payment method.');
    record.payment_status=paymentStatus(total,paid);
    const counter=await db.collection('counters').findOneAndUpdate({_id:`${tenant}:appointment`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'});
    record.appointment_number=`APT-${String(counter.value).padStart(6,'0')}`;
    const initials=`${doctor.user.first_name} ${doctor.user.last_name}`.split(/\s+/).filter(Boolean).map(part=>part[0]).join('').toUpperCase();
    record.token_number=`${body.appointment_date.split('-').reverse().join('')}/${initials}/${doctor.department.name.replace(/[^a-z0-9]/gi,'').slice(0,5).toUpperCase()}/${String(slot.serial).padStart(3,'0')}`;
    await db.collection('clinical_appointments').insertOne({...record},{session});
    await receipt(response,record,paid,`OPD-BOOKING-${record.id}`,session);
    await writeAudit(response,'appointment_created',record.id,session);
    return record;
  });response.status(201).json(result);
});
router.patch('/appointments/:id/check-in',requirePermission('appointment.update'),async(request,response)=>{
  const input=z.object({payment:z.object({amount,method:z.string().max(100),reference:z.string().max(150).default('')}).optional()}).parse(request.body),recordId=uuid.parse(request.params.id);
  const result=await transaction(async session=>{
    const filter=await scopeFor(response,{id:recordId},session),row=await db.collection('clinical_appointments').findOne(filter,{session});
    if(!row)throw failure('Appointment not found',404);
    if(!['Booked','Confirmed'].includes(row.status))throw failure('This appointment can no longer be checked in.',409);
    let total=appointmentTotal(row),paid=cents(row.paid_amount),collected=0;
    const alreadyPaid=['Paid','Payment not required'].includes(row.payment_status);
    if(alreadyPaid&&input.payment)throw failure('Payment is already recorded.',409);
    if(!alreadyPaid){
      if(!input.payment)throw failure('Enter payment details before checking in.');
      collected=cents(input.payment.amount);
      if(collected&&!(await methods(row.tenant_id,session)).includes(input.payment.method))throw failure('Select a valid payment method.');
      if(total===0&&paid===0&&collected>0&&cents(row.discount)===0){row.consultation_fee=collected/100;total=collected;}
      const due=Math.max(0,total-paid);
      if((due>0&&collected===0)||collected>due)throw failure('Payment must be greater than zero and cannot exceed the outstanding amount.');
      paid+=collected;row.payment_mode=input.payment.method;row.payment_reference=input.payment.reference;
    }
    row.paid_amount=paid/100;row.payment_status=paymentStatus(total,paid);row.status='Checked In';row.updated_at=new Date();
    const {_id,...saved}=row;
    await db.collection('clinical_appointments').replaceOne(filter,saved,{session});
    await receipt(response,saved,collected,`OPD-CHECKIN-${row.id}`,session);
    await writeAudit(response,'appointment_checked_in',row.id,session);
    return saved;
  });response.json({appointment:result,message:'Patient checked in.'});
});
const transitions={Booked:['Confirmed','No Show'],Confirmed:['No Show'],'Checked In':['Waiting','In Consultation','No Show'],Waiting:['In Consultation','No Show'],'In Consultation':['Completed']};
router.patch('/appointments/:id/status',requirePermission('appointment.update'),async(request,response)=>{
  const input=z.object({status:z.enum(['Booked','Confirmed','Checked In','Waiting','In Consultation','Completed','Cancelled','No Show'])}).parse(request.body),recordId=uuid.parse(request.params.id);
  if(input.status==='Cancelled')throw failure('Use an approved cancellation request to retain billing history.',409);
  if(input.status==='Checked In')throw failure('Use the check-in action so payment validation cannot be skipped.',409);
  const result=await transaction(async session=>{
    const filter=await scopeFor(response,{id:recordId},session),row=await db.collection('clinical_appointments').findOne(filter,{session});
    if(!row)throw failure('Appointment not found',404);
    if(!(transitions[row.status]??[]).includes(input.status))throw failure('Invalid appointment status transition.',409);
    const saved=await db.collection('clinical_appointments').findOneAndUpdate(filter,{$set:{status:input.status,updated_at:new Date()}},{session,returnDocument:'after',projection:{_id:0}});
    await writeAudit(response,'appointment_status_changed',row.id,session,{status:input.status});return saved;
  });response.json({appointment:result,message:`Appointment status changed to ${input.status}.`});
});
router.delete('/appointments/:id',requirePermission('appointment.cancel'),(_request,response)=>response.status(409).json({error:'Use Cancellation Requests to retain billing history.'}));
export default router;
