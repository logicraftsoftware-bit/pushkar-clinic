import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,requirePermission,writeAudit} from './access.mjs';
import {nursingAdmission} from './clinical-access.mjs';
import {nursingVitals,medicationScheduleError,hasClinicalTimestamp} from './nursing-validation.mjs';
import {laboratoryPrice,laboratoryTestAvailable} from './lab-branch-pricing.mjs';
import {allergyConflicts} from './consultation-validation.mjs';
const router=Router(),uuid=z.string().uuid(),text=z.string().trim().min(1).max(4000),context={patient_id:uuid,admission_id:uuid};
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
router.use('/nursing-station',(_request,response,next)=>{if(!['nurse','hospital_admin'].includes(response.locals.account.role))return response.status(403).json({error:'Nursing workspace access required.'});next();});
async function lock(response,admission,session){await db.collection('ipd_admissions').updateOne({tenant_id:admission.tenant_id,id:admission.id,active:true},{$inc:{clinical_version:1}},{session});}
async function item(response,admission,kind,title,data,session,{status='Recorded',priority='Normal',occurred_at=new Date(),workspace='nurse',assigned=true}={}){
  const now=new Date(),row={id:randomUUID(),tenant_id:admission.tenant_id,branch_id:admission.branch_id,patient_id:admission.patient_id,...(assigned?{assigned_user_id:response.locals.account.id}:{}),created_by:response.locals.account.id,workspace,kind,title,status,priority,data:{...data,admission_id:admission.id},occurred_at,created_at:now,updated_at:now};
  await db.collection('role_work_items').insertOne({...row},{session});await writeAudit(response,'nursing_entry_created',row.id,session,{kind,workspace});return row;
}
router.get('/nursing-station',requirePermission('ipd.view'),async(_request,response)=>{
  const account=response.locals.account,tenant_id=account.tenant_id,admin=account.role==='hospital_admin';
  const staff=admin?null:await db.collection('staff_members').findOne({tenant_id,user_id:account.id,staff_type:'Nurse',status:'Active'}),wardId=staff?.professional?.ward_assignment;
  if(!admin&&!wardId)return response.json({ward:null,patients:[],diagnostics:[],prescriptions:[],nursing:[],medicines:[],diagnostic_masters:[]});
  const ward=wardId?await db.collection('wards').findOne({tenant_id,id:wardId}):null;
  const admissions=await db.collection('ipd_admissions').find(await scopeFor(response,{active:true,...(admin?{}:{ward_id:wardId})})).sort({room_id:1,bed_id:1}).toArray(),patients=[];
  for(const admission of admissions){const patient=await db.collection('patients').findOne({tenant_id,id:admission.patient_id,deleted_at:null});if(!patient)continue;
    const row={admission_id:admission.id,patient_id:patient.id,ipd_number:admission.ipd_number,admitted_at:admission.admitted_at,reason_diagnosis:admission.reason_diagnosis,status:admission.status};for(const key of ['medical_record_number','first_name','last_name','sex','date_of_birth','blood_group','allergies','existing_conditions','current_medication'])row[key]=patient[key];
    for(const [collection,key,label,fields] of [['wards','ward_id','ward_name',['name']],['rooms','room_id','room_number',['room_number']],['beds','bed_id','bed_number',['bed_number']],['users','consultant_doctor_id','doctor_name',['first_name','last_name']]]){const ref=admission[key]?await db.collection(collection).findOne({tenant_id,id:admission[key]}):null;row[label]=ref?fields.map(field=>ref[field]??'').join(' '):'';}patients.push(row);
  }
  const ids=admissions.map(row=>row.id),prescriptions=await db.collection('doctor_clinical_records').find({tenant_id,admission_id:{$in:ids},record_type:{$in:['consultation','prescription','discharge_summary']}},{projection:{_id:0}}).sort({created_at:-1}).toArray();
  for(const row of prescriptions){const user=await db.collection('users').findOne({tenant_id,id:row.doctor_id});row.doctor_name=user?`${user.first_name} ${user.last_name}`:'';}
  const nursing=await db.collection('role_work_items').find({tenant_id,workspace:'nurse','data.admission_id':{$in:ids}},{projection:{_id:0}}).sort({occurred_at:-1}).toArray();
  for(const row of nursing){const receiving=await db.collection('role_work_items').findOne({tenant_id,workspace:'pharmacy','data.nurse_request_id':row.id},{sort:{updated_at:-1}});row.effective_status=receiving?.status??row.status;}
  const diagnostics=await db.collection('role_work_items').find({tenant_id,workspace:{$in:['laboratory','radiology']},'data.admission_id':{$in:ids}},{projection:{_id:0}}).sort({created_at:-1}).toArray();
  const medicines=await db.collection('hospital_pharmacy_masters').find({tenant_id,kind:'medicine','data.status':{$ne:'Inactive'}},{projection:{_id:0,id:1,name:1,data:1}}).sort({name:1}).toArray();
  for(const medicine of medicines){const batches=await db.collection('inventory_records').find(await scopeFor(response,{kind:'pharmacy-batch','data.medicine_id':medicine.id,quantity:{$gt:0}}),{projection:{quantity:1}}).toArray();medicine.current_stock=batches.reduce((sum,row)=>sum+row.quantity,0);}
  const masters=await db.collection('hospital_diagnostic_masters').find({tenant_id,domain:'pathology',kind:'test'},{projection:{_id:0}}).sort({name:1}).toArray();
  response.json({ward:admin?{id:null,name:'All wards'}:{id:wardId,name:ward?.name??''},patients,prescriptions,nursing,medicines,diagnostics,diagnostic_masters:masters.filter(row=>laboratoryTestAvailable(row.data??{},account.branch_id)).map(row=>({...row,domain:row.data?.test_type==='Radiology'?'radiology':'pathology'}))});
});
router.post('/nursing-station/diagnostic-orders',requirePermission('ipd.update'),async(request,response)=>{
  const body=z.object({...context,domain:z.enum(['pathology','radiology']),test_ids:z.array(uuid).min(1).max(100),priority:z.enum(['Routine','Urgent','STAT']).prefault('Routine'),instruction:z.string().max(1000).prefault(''),clinical_note:z.string().max(2000).prefault('')}).parse(request.body);
  const result=await transaction(async session=>{
    const admission=await nursingAdmission(response,body.admission_id,body.patient_id,session);await lock(response,admission,session);
    const tenant_id=admission.tenant_id,ids=[...new Set(body.test_ids)],masters=await db.collection('hospital_diagnostic_masters').find({tenant_id,id:{$in:ids},domain:'pathology',kind:'test'},{session}).toArray();if(masters.length!==ids.length)throw failure('Selected tests are unavailable.');
    const tests=masters.map(master=>({test_id:master.id,name:master.name,test_type:master.data?.test_type??'Pathology',priority:body.priority,instruction:body.instruction,amount:laboratoryPrice(master.data??{},admission.branch_id)})),patient=await db.collection('patients').findOne({tenant_id,id:body.patient_id},{session});
    return item(response,admission,'orders','Nursing diagnostic order',{medical_record_number:patient?.medical_record_number??'',tests,diagnosis:body.clinical_note,investigation:body.instruction,requested_by_nurse:true,nurse_id:response.locals.account.id,request_source:'Nursing Station'},session,{workspace:'laboratory',assigned:false,status:'Pending',priority:body.priority==='Routine'?'Normal':'High'});
  });response.status(201).json(result);
});
router.post('/nursing-station/medications',requirePermission('ipd.update'),async(request,response)=>{
  if(hasClinicalTimestamp(request.body))throw failure('Clinical entry times are recorded by the server.');
  const body=z.object({...context,name:text,dose:text,route:z.string().max(100).prefault('Oral'),schedule:z.enum(['Once','Every 4 hours','Every 6 hours','Every 8 hours','Every 12 hours','Daily']),first_due_at:z.string().datetime({offset:true}),instructions:z.string().max(4000).prefault(''),start_date:z.union([z.string().date(),z.literal('')]).optional(),end_date:z.union([z.string().date(),z.literal('')]).optional(),prn:z.boolean().prefault(false),indication:z.string().max(2000).prefault(''),double_check:z.boolean().prefault(false)}).parse(request.body);
  const timing=medicationScheduleError(body);if(timing)throw failure(timing);
  const result=await transaction(async session=>{const admission=await nursingAdmission(response,body.admission_id,body.patient_id,session);await lock(response,admission,session);const patient=await db.collection('patients').findOne({tenant_id:admission.tenant_id,id:body.patient_id},{session});const conflicts=allergyConflicts(patient?.allergies,[{name:body.name}]);if(conflicts.length)throw failure(conflicts.join(' '),422);return item(response,admission,'medication-plan',`Previous medicine - ${body.name}`,body,session,{status:'Active',occurred_at:new Date(body.first_due_at)});});response.status(201).json(result);
});
router.post('/nursing-station/medications/:id/administer',requirePermission('ipd.update'),async(request,response)=>{
  if(hasClinicalTimestamp(request.body))throw failure('Administration time is recorded by the server.');
  const identity=uuid.parse(request.params.id),body=z.object({outcome:z.enum(['Given','Missed','Refused','Held']),notes:z.string().max(4000).prefault(''),scheduled_at:z.string().datetime({offset:true})}).parse(request.body);
  const result=await transaction(async session=>{
    const plan=await db.collection('role_work_items').findOne(await scopeFor(response,{id:identity,workspace:'nurse',kind:'medication-plan'},session),{session});if(!plan)throw failure('Medication plan not found.',404);
    const admission=await nursingAdmission(response,plan.data.admission_id,plan.patient_id,session);await lock(response,admission,session);
    const scheduled_at=new Date(body.scheduled_at),prior=await db.collection('role_work_items').findOne({tenant_id:plan.tenant_id,workspace:'nurse',kind:'medication-administration','data.plan_id':identity,'data.scheduled_at':scheduled_at},{session,projection:{_id:0}});
    if(prior){if(prior.data.outcome!==body.outcome||prior.data.notes!==body.notes)throw failure('This medication occurrence already has a recorded outcome.',409);return prior;}
    if(plan.status!=='Active'||new Date(plan.occurred_at).getTime()!==scheduled_at.getTime())throw failure('Medication schedule changed. Refresh before recording an outcome.',409);
    const now=new Date(),result=await item(response,admission,'medication-administration',`${body.outcome} - ${plan.data.name}`,{plan_id:identity,medicine:plan.data.name,dose:plan.data.dose,route:plan.data.route,scheduled_at,outcome:body.outcome,notes:body.notes,administered_at:now.toISOString()},session,{status:body.outcome});
    const hours={'Every 4 hours':4,'Every 6 hours':6,'Every 8 hours':8,'Every 12 hours':12,Daily:24},once=plan.data.schedule==='Once';
    await db.collection('role_work_items').updateOne({tenant_id:plan.tenant_id,id:identity},{$set:{status:once?'Completed':'Active',occurred_at:once?plan.occurred_at:new Date(scheduled_at.getTime()+hours[plan.data.schedule]*3600000),updated_at:now}},{session});return result;
  });response.status(201).json(result);
});
const forms={
  notes:z.object({...context,text,input_mode:z.enum(['written','voice']).prefault('written')}),
  pharmacy:z.object({...context,action:z.enum(['request','return']),medicine:text,quantity:z.number().finite().positive().max(100000),reason:z.string().max(4000).prefault('')}),
  clinical:z.object({...context,type:z.enum(['vitals','intake-output','assessment']),data:z.record(z.string(),z.unknown())}),
  'care-plans':z.object({...context,problem:text,goal:text,intervention:text,due_at:z.string().datetime({offset:true}),priority:z.enum(['Low','Normal','High','Critical']).prefault('Normal')}),
  handover:z.object({...context,shift:z.enum(['Morning','Evening','Night']),situation:text,background:z.string().max(4000).prefault(''),assessment:z.string().max(4000).prefault(''),recommendation:text}),
};
for(const [path,schema] of Object.entries(forms))router.post(`/nursing-station/${path}`,requirePermission('ipd.update'),async(request,response)=>{
  const body=schema.parse(request.body);if(hasClinicalTimestamp(request.body)||body.data&&hasClinicalTimestamp(body.data))throw failure('Clinical entry timestamps are recorded by the server.');
  if(path==='clinical'&&body.type==='vitals')body.data=nursingVitals.parse(body.data);
  const result=await transaction(async session=>{
    const admission=await nursingAdmission(response,body.admission_id,body.patient_id,session);await lock(response,admission,session);
    if(path==='notes')return item(response,admission,'nursing-note','Nursing instruction',body,session);
    if(path==='pharmacy'){
      const kind=body.action==='request'?'pharmacy-request':'pharmacy-return',title=`Nurse ${body.action} - ${body.medicine}`,entry=await item(response,admission,kind,title,body,session,{status:'Pending',priority:'High'});
      await item(response,admission,kind,title,{...body,nurse_request_id:entry.id},session,{workspace:'pharmacy',assigned:false,status:'Pending',priority:'High'});return entry;
    }
    if(path==='care-plans')return item(response,admission,'care-plan',`Care plan - ${body.problem}`,body,session,{status:'Pending',priority:body.priority,occurred_at:new Date(body.due_at)});
    if(path==='handover')return item(response,admission,'shift-handover',`${body.shift} shift handover`,body,session,{status:'Pending',priority:'High'});
    const alerts=[];if(body.type==='vitals'){const data=body.data;if(data.spo2<94)alerts.push('Low SpO2');if(data.temperature>38)alerts.push('Fever');if(data.pulse>120||data.pulse<50)alerts.push('Abnormal pulse');if(data.systolic>180||data.systolic<90)alerts.push('Abnormal blood pressure');}
    return item(response,admission,'clinical-chart',`Clinical chart - ${body.type}`,{...body.data,chart_type:body.type,alerts},session,{priority:alerts.length?'High':'Normal'});
  });response.status(201).json(result);
});
export default router;
