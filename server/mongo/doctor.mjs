import {Router} from 'express';
import {beginQueueVisit} from './queue-service.mjs';
import {doctorDay} from './doctor-availability.mjs';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,requirePermission,writeAudit} from './access.mjs';
import {consultationData,allergyConflicts,canonicalClinical} from './consultation-validation.mjs';
import {combinedDiagnosticTests,comparableDiagnosticTests} from './diagnostic-workflow.mjs';
import {laboratoryPrice,laboratoryTestAvailable} from './lab-branch-pricing.mjs';
import {hospitalDay} from './finance-ledger.mjs';
const router=Router(),uuid=z.string().uuid(),failure=(message,status=400)=>Object.assign(new Error(message),{status});
router.use((_request,response,next)=>{if(!['doctor','hospital_admin'].includes(response.locals.account.role))return response.status(403).json({error:'Doctor workspace access required.'});next();});
async function encounterScope(response,admission,extra={},session){return scopeFor(response,{...extra,...(response.locals.account.role==='hospital_admin'?{}:{[admission?'consultant_doctor_id':'doctor_id']:response.locals.account.id})},session);}
async function enrich(row){
  const output={...row};delete output._id;
  const tenant_id=row.tenant_id,patient=await db.collection('patients').findOne({tenant_id,id:row.patient_id});
  Object.assign(output,{patient_name:patient?`${patient.first_name} ${patient.last_name}`.toUpperCase():'',medical_record_number:patient?.medical_record_number??'',phone:patient?.phone??'',sex:patient?.sex??'',date_of_birth:patient?.date_of_birth??null,patient_address:patient?.address??{}});
  for(const [collection,key,label,field] of [['departments','department_id','department_name','name'],['branches','branch_id','branch_name','name'],['wards','ward_id','ward_name','name'],['rooms','room_id','room_number','room_number'],['beds','bed_id','bed_number','bed_number']]){const ref=row[key]?await db.collection(collection).findOne({tenant_id,id:row[key]}):null;output[label]=ref?.[field]??'';}
  const doctorId=row.doctor_id??row.consultant_doctor_id,user=doctorId?await db.collection('users').findOne({tenant_id,id:doctorId}):null,staff=doctorId?await db.collection('staff_members').findOne({tenant_id,user_id:doctorId}):null;
  output.doctor_name=user?`${user.first_name} ${user.last_name}`:'';output.doctor_qualification=staff?.professional?.qualification??'';
  return output;
}
router.get('/overview',requirePermission('appointment.view'),async(_request,response)=>{
  const all=await db.collection('clinical_appointments').find(await encounterScope(response,false)).sort({appointment_date:1,appointment_time:1}).toArray(),today=hospitalDay();
  const appointments=[],completedAppointments=[];for(const row of all){if(row.status==='Completed'){if(completedAppointments.length<200)completedAppointments.push(await enrich(row));}else if(!['Cancelled','No Show'].includes(row.status)&&appointments.length<200)appointments.push(await enrich(row));}
  const ipd=await db.collection('ipd_admissions').find(await encounterScope(response,true,{active:true})).sort({admitted_at:1}).toArray(),ipdAdmissions=[];for(const row of ipd)ipdAdmissions.push(await enrich(row));
  const staff=await db.collection('staff_members').findOne({tenant_id:response.locals.account.tenant_id,user_id:response.locals.account.id});
  const dates=[...new Set([today,...all.map(row=>row.appointment_date)])];
  const professional=staff?.professional??{},slots=[...(professional.appointment_schedule??[])];
  for(const date of dates){if(!slots.some(row=>String(row.appointment_date).slice(0,10)===date)){const day=doctorDay(professional.appointment_schedule??[],professional.default_schedule,date,professional.unavailable_dates??[]);if(day)slots.push(day);}}
  response.json({appointments,completedAppointments:completedAppointments.reverse(),ipdAdmissions,slots:slots.map(row=>({...row,doctor_id:response.locals.account.id,branch_id:response.locals.account.branch_id})),metrics:{today:all.filter(row=>row.appointment_date===today).length,waiting:all.filter(row=>row.appointment_date===today&&['Booked','Confirmed','Checked In','Waiting','Present'].includes(row.status)).length,completed:all.filter(row=>row.appointment_date===today&&row.status==='Completed').length,patients:new Set(all.map(row=>row.patient_id)).size}});
});
router.get('/patients/:id',requirePermission('patient.view'),async(request,response)=>{
  const identity=uuid.parse(request.params.id),tenant_id=response.locals.account.tenant_id;
  if(response.locals.account.role!=='hospital_admin'&&!await db.collection('clinical_appointments').findOne(await encounterScope(response,false,{patient_id:identity}))&&!await db.collection('ipd_admissions').findOne(await encounterScope(response,true,{patient_id:identity,active:true})))throw failure('Patient not found in your clinical assignments.',404);
  const patient=await db.collection('patients').findOne({tenant_id,id:identity,deleted_at:null},{projection:{_id:0}});if(!patient)throw failure('Patient not found.',404);
  const appointments=await db.collection('clinical_appointments').find(await scopeFor(response,{patient_id:identity}),{projection:{_id:0}}).sort({appointment_date:-1}).toArray(),records=await db.collection('doctor_clinical_records').find(await scopeFor(response,{patient_id:identity}),{projection:{_id:0}}).sort({created_at:-1}).toArray();
  response.json({patient,appointments,records});
});
router.get('/print-template/opd-prescription',requirePermission('prescription.view'),async(_request,response)=>response.json(await db.collection('hospital_print_templates').findOne({tenant_id:response.locals.account.tenant_id,document_type:'opd-prescription'},{projection:{_id:0,header_image:1,footer_content:1}})??{header_image:'',footer_content:''}));
router.get('/prescription-masters',requirePermission('prescription.view'),async(_request,response)=>{
  const tenant_id=response.locals.account.tenant_id,branch=response.locals.account.branch_id,grouped={medicine:[],category:[],dosage:[],interval:[],duration:[],pathology_test:[],radiology_test:[]};
  for(const row of await db.collection('hospital_pharmacy_masters').find({tenant_id,kind:{$in:['medicine','category','dosage','interval','duration']}},{projection:{_id:0}}).sort({name:1}).toArray())grouped[row.kind].push(row);
  for(const row of await db.collection('hospital_diagnostic_masters').find({tenant_id,domain:'pathology',kind:'test'},{projection:{_id:0}}).sort({name:1}).toArray())if(laboratoryTestAvailable(row.data??{},branch))grouped[row.data?.test_type==='Radiology'?'radiology_test':'pathology_test'].push({...row,data:{...row.data,amount:laboratoryPrice(row.data??{},branch)}});
  response.json(grouped);
});

router.patch('/appointments/:id/status',requirePermission('appointment.update'),async(request,response)=>{
  const status=z.enum(['Present','Absent','Waiting','Skip']).parse(request.body?.status),identity=uuid.parse(request.params.id);
  const saved=await transaction(async session=>{
    const filter=await encounterScope(response,false,{id:identity},session),row=await db.collection('clinical_appointments').findOne(filter,{session});
    if(!row)throw failure('Appointment not found in your queue.',404);
    if(!['Checked In','Waiting','In Consultation','Present','Absent'].includes(row.status))throw failure('Reception must check in this appointment before a doctor changes its attendance.',409);
    const timing=status==='Present'?await beginQueueVisit(row,session):{queue_skipped:status==='Skip'};
    const updated=await db.collection('clinical_appointments').findOneAndUpdate(filter,{$set:{...timing,status:status==='Absent'?'No Show':status==='Present'?'In Consultation':'Waiting',updated_at:new Date()}},{session,returnDocument:'after',projection:{_id:0}});
    await writeAudit(response,status==='Skip'?'patient_skipped':status==='Present'?'patient_presented':'doctor_attendance_updated',identity,session,{status:updated.status});return updated;
  });response.json(saved);
});
router.post('/appointments/:id/notify',requirePermission('appointment.update'),async(request,response)=>{
  const target=z.enum(['reception','patient']).parse(request.body?.target),identity=uuid.parse(request.params.id);
  const result=await transaction(async session=>{
    const appointment=await db.collection('clinical_appointments').findOne(await encounterScope(response,false,{id:identity},session),{session});if(!appointment)throw failure('Appointment not found in your queue.',404);
    if(target==='patient'&&appointment.status!=='In Consultation')throw failure('Start this patient before making a call announcement.',409);
    if(target==='patient')await db.collection('clinical_appointments').updateOne({tenant_id:appointment.tenant_id,id:identity},{$set:{queue_call_id:randomUUID()}},{session});
    const now=new Date(),row={id:randomUUID(),tenant_id:appointment.tenant_id,branch_id:appointment.branch_id,patient_id:appointment.patient_id,created_by:response.locals.account.id,workspace:target,kind:'notification',title:`Doctor called token ${appointment.token_number||appointment.appointment_number}`,status:'Pending',priority:'High',data:{appointment_id:identity,token_number:appointment.token_number,appointment_time:appointment.appointment_time},occurred_at:now,created_at:now,updated_at:now};await db.collection('role_work_items').insertOne({...row},{session});await writeAudit(response,'doctor_queue_notification_created',row.id,session);return row;
  });response.status(201).json(result);
});
const recordInput=z.object({patient_id:uuid,appointment_id:uuid.nullable().optional(),admission_id:uuid.nullable().optional(),record_id:uuid.optional(),record_type:z.enum(['consultation','discharge_summary','diagnosis','prescription','order','voice_documentation']),data:consultationData,updated_at:z.string().datetime().optional()}).refine(body=>Boolean(body.appointment_id)!==Boolean(body.admission_id),'Select one clinical encounter.');
router.post('/records',requirePermission('opd.create'),async(request,response)=>{
  const body=recordInput.parse(request.body),tenant_id=response.locals.account.tenant_id;
  const result=await transaction(async session=>{
    const admission=Boolean(body.admission_id),identity=body.admission_id??body.appointment_id,collection=admission?'ipd_admissions':'clinical_appointments';
    const filter=await encounterScope(response,admission,{id:identity,patient_id:body.patient_id,...(admission?{active:true}:{})},session),encounter=await db.collection(collection).findOne(filter,{session});
    if(!encounter)throw failure('Patient encounter is not assigned to you.',403);
    const patient=await db.collection('patients').findOne({tenant_id,id:body.patient_id,deleted_at:null},{session});if(!patient)throw failure('Patient unavailable.');
    await db.collection(collection).updateOne(filter,{$inc:{clinical_version:1}},{session});
    if(!admission&&body.record_type==='consultation'&&!['Checked In','Waiting','In Consultation','Present','Completed'].includes(encounter.status))throw failure('Reception must check in this appointment before consultation.',409);
    if(body.record_id&&(!admission||body.record_type!=='consultation'))throw failure('Only saved inpatient consultations can be selected by record ID.');
    let previous=body.record_id?await db.collection('doctor_clinical_records').findOne({tenant_id,id:body.record_id,patient_id:body.patient_id,admission_id:body.admission_id,record_type:'consultation'},{session}):!admission&&body.record_type==='consultation'?await db.collection('doctor_clinical_records').findOne({tenant_id,appointment_id:identity,record_type:'consultation'},{session}):null;
    if(body.record_id&&!previous)throw failure('Saved inpatient consultation not found.',404);
    if(previous&&body.updated_at&&new Date(previous.updated_at).toISOString()!==body.updated_at)throw failure('Consultation changed. Refresh before editing.',409);
    const data=consultationData.parse({...previous?.data,...body.data});
    if(previous?.data.encounter_status==='Completed'||!admission&&encounter.status==='Completed'){
      if(previous&&canonicalClinical({...previous.data,completed_at:undefined,completed_by:undefined})===canonicalClinical({...data,completed_at:undefined,completed_by:undefined})){delete previous._id;return previous;}
      throw failure('This consultation is completed and cannot be overwritten.',409);
    }
    const conflicts=allergyConflicts(patient.allergies,data.medicines??[]);if(conflicts.length)throw Object.assign(failure(conflicts.join(' '),422),{code:'DRUG_ALLERGY_CONFLICT'});
    if(data.encounter_status==='Completed'){data.completed_at=new Date().toISOString();data.completed_by=response.locals.account.id;}
    const now=new Date(),row={id:previous?.id??randomUUID(),tenant_id,branch_id:encounter.branch_id,doctor_id:encounter.doctor_id??encounter.consultant_doctor_id??response.locals.account.id,patient_id:body.patient_id,appointment_id:body.appointment_id??null,admission_id:body.admission_id??null,record_type:body.record_type,data,created_at:previous?.created_at??now,updated_at:now};
    const tests=combinedDiagnosticTests(data.lab_tests??[],data.radiology_tests??[]);
    for(const test of tests){const master=await db.collection('hospital_diagnostic_masters').findOne({tenant_id,id:uuid.parse(test.test_id),domain:'pathology',kind:'test'},{session});if(!master||!laboratoryTestAvailable(master.data??{},row.branch_id))throw failure('Select diagnostic tests available in this branch.');test.name=master.name;test.test_type=master.data?.test_type??'Pathology';test.amount=laboratoryPrice(master.data??{},row.branch_id);}
    if(body.record_type==='consultation')for(const [workspace,kind,items] of [['pharmacy','prescription',data.medicines??[]],['laboratory','orders',tests]]){
      const old=await db.collection('role_work_items').findOne({tenant_id,workspace,'data.consultation_record_id':row.id},{session});
      const processed=old&&(!['Pending','Cancelled'].includes(old.status)||old.data.bill_id||old.data.collected_at),oldItems=old?.data?.[workspace==='laboratory'?'tests':'medicines']??[];
      if(processed){const compare=values=>canonicalClinical(workspace==='laboratory'?comparableDiagnosticTests(values):values);if(compare(oldItems)!==compare(items))throw failure('An order is already being processed. Change it through the receiving department.',409);continue;}
      if(!items.length){if(old)await db.collection('role_work_items').updateOne({tenant_id,id:old.id},{$set:{status:'Cancelled',updated_at:now}},{session});continue;}
      const orderData={appointment_id:row.appointment_id,admission_id:row.admission_id,consultation_record_id:row.id,visit_id:row.id,visit_at:row.created_at,doctor_id:row.doctor_id,medical_record_number:patient.medical_record_number,...(workspace==='laboratory'?{tests:items,investigation:data.investigation??''}:{medicines:items,advice:data.advice??''}),diagnosis:data.diagnosis??''};
      const order={id:old?.id??randomUUID(),tenant_id,branch_id:row.branch_id,patient_id:row.patient_id,created_by:response.locals.account.id,workspace,kind,title:`${workspace==='laboratory'?'Lab Order':'Prescription'} - ${patient.first_name} ${patient.last_name}`,status:'Pending',priority:items.some(item=>['urgent','stat'].includes(String(item.priority??'').toLowerCase()))?'High':'Normal',data:{...old?.data,...orderData},occurred_at:old?.occurred_at??now,created_at:old?.created_at??now,updated_at:now};
      if(old)await db.collection('role_work_items').replaceOne({tenant_id,id:old.id},order,{session});else await db.collection('role_work_items').insertOne({...order},{session});
    }
    if(previous)await db.collection('doctor_clinical_records').replaceOne({tenant_id,id:row.id},row,{session});else await db.collection('doctor_clinical_records').insertOne({...row},{session});
    if(!admission&&body.record_type==='consultation'){
      const timing=data.encounter_status==='Completed'?{consultation_completed_at:now}:await beginQueueVisit(encounter,session);
      await db.collection('clinical_appointments').updateOne(filter,{$set:{...timing,status:data.encounter_status==='Completed'?'Completed':'In Consultation',updated_at:now}},{session});
    }
    await writeAudit(response,previous?'clinical_record_updated':'clinical_record_created',row.id,session,{record_type:row.record_type});return row;
  });response.status(201).json(result);
});
export default router;
