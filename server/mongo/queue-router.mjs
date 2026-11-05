import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {requirePermission,scopeFor,assertBranch,allowedBranches,writeAudit} from './access.mjs';
import {config} from './config.mjs';
import {hospitalDay} from './finance-ledger.mjs';
import {appointmentTotal} from './money.mjs';
import {attachPass,queueSnapshot,safeQueue,secretHash,secretToken} from './queue-service.mjs';

export const queueRouter=Router(),publicQueueRouter=Router();
const uuid=z.string().uuid(),time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),failure=(message,status=400)=>Object.assign(new Error(message),{status});
const announcements=z.object({enabled:z.boolean().prefault(true),language:z.enum(['en-IN','bn-IN','hi-IN']).prefault('en-IN'),voice:z.string().max(200).prefault(''),include_patient_name:z.boolean().prefault(false),include_doctor_name:z.boolean().prefault(true),include_room:z.boolean().prefault(true),repeat:z.boolean().prefault(false),repeat_interval:z.coerce.number().int().min(20).max(300).prefault(30)});
const timing=z.object({average_consultation_minutes:z.coerce.number().int().min(1).max(120),opd_start_time:time,room_chamber:z.string().trim().max(80),live_queue_enabled:z.boolean(),announcements:announcements.optional()});
queueRouter.use(requirePermission('appointment.view'));
queueRouter.use((_request,response,next)=>['hospital_admin','branch_admin','receptionist','doctor'].includes(response.locals.account.role)?next():response.status(403).json({error:'Queue workspace access required.'}));
async function doctorScope(response,doctorId,branchId){
  if(response.locals.account.role==='doctor'&&doctorId!==response.locals.account.id)throw failure('Select your own queue.',403);
  await assertBranch(response,branchId);
  const doctor=await db.collection('users').findOne({tenant_id:response.locals.account.tenant_id,id:doctorId,role:'doctor',is_active:true});
  const staff=await db.collection('staff_members').findOne({tenant_id:response.locals.account.tenant_id,user_id:doctorId,staff_type:'Doctor',status:'Active'});
  if(!doctor||!staff||!(staff.branch_ids??[doctor.branch_id]).includes(branchId))throw failure('Doctor is not assigned to this branch.',404);
  return staff;
}
queueRouter.get('/live',async(request,response)=>{
  const date=z.string().date().prefault(hospitalDay()).parse(request.query.date),doctorId=request.query.doctor_id?uuid.parse(request.query.doctor_id):null;
  const branchId=request.query.branch_id?uuid.parse(request.query.branch_id):null;
  const extra={appointment_date:date,...(doctorId?{doctor_id:doctorId}:{}),...(branchId?{branch_id:branchId}:{}),...(response.locals.account.role==='doctor'?{doctor_id:response.locals.account.id}:{})};
  const distinct=await db.collection('clinical_appointments').aggregate([{$match:await scopeFor(response,extra)},{$group:{_id:{doctor_id:'$doctor_id',branch_id:'$branch_id'}}}]).toArray();
  if(doctorId&&branchId&&!distinct.some(row=>row._id.doctor_id===doctorId&&row._id.branch_id===branchId))distinct.push({_id:{doctor_id:doctorId,branch_id:branchId}});
  const queues=[];
  for(const row of distinct.slice(0,100)){
    await doctorScope(response,row._id.doctor_id,row._id.branch_id);
    const snapshot=await queueSnapshot({tenant_id:response.locals.account.tenant_id,...row._id,date,from:request.query.from?time.parse(request.query.from):undefined,to:request.query.to?time.parse(request.query.to):undefined});
    const ids=snapshot.appointments.map(item=>item.patient_id),patients=await db.collection('patients').find({tenant_id:response.locals.account.tenant_id,id:{$in:ids}},{projection:{id:1,first_name:1,last_name:1,medical_record_number:1}}).toArray();
    snapshot.appointments.forEach(item=>{const patient=patients.find(row=>row.id===item.patient_id);item.patient_name=patient?`${patient.first_name} ${patient.last_name}`:'';});
    queues.push(safeQueue(snapshot,true));
  }
  response.json({queues});
});
queueRouter.get('/settings/:doctor',async(request,response)=>{
  const staff=await doctorScope(response,uuid.parse(request.params.doctor),uuid.parse(request.query.branch_id));
  const pro=staff.professional??{};
  response.json({average_consultation_minutes:Number(pro.average_consultation_minutes)||Number(pro.slot_duration)||10,opd_start_time:pro.opd_start_time||'09:00',room_chamber:pro.branch_rooms?.[request.query.branch_id]??pro.room_chamber??'',live_queue_enabled:pro.live_queue_enabled!==false,announcements:announcements.parse(pro.announcements??{})});
});
queueRouter.put('/settings/:doctor',requirePermission('appointment.update'),async(request,response)=>{
  const doctorId=uuid.parse(request.params.doctor),staff=await doctorScope(response,doctorId,uuid.parse(request.query.branch_id)),body=timing.parse(request.body);
  const set=Object.fromEntries(Object.entries(body).map(([key,value])=>['professional.'+key,value]));
  set['professional.branch_rooms.'+uuid.parse(request.query.branch_id)]=body.room_chamber;
  await transaction(async session=>{await db.collection('staff_members').updateOne({tenant_id:staff.tenant_id,id:staff.id},{$set:{...set,updated_at:new Date()}},{session});await writeAudit(response,'doctor_queue_settings_updated',doctorId,session);});
  response.json(body);
});
queueRouter.post('/passes/:id',requirePermission('appointment.update'),async(request,response)=>{
  const result=await transaction(async session=>{
    const filter=await scopeFor(response,{id:uuid.parse(request.params.id)},session),row=await db.collection('clinical_appointments').findOne(filter,{session});
    if(!row||(response.locals.account.role==='doctor'&&row.doctor_id!==response.locals.account.id))throw failure('Appointment unavailable.',404);
    const path=attachPass(row);
    await db.collection('clinical_appointments').updateOne(filter,{$set:{public_pass_hash:row.public_pass_hash,public_pass_revoked:false,public_pass_created_at:row.public_pass_created_at,public_pass_expires_at:row.public_pass_expires_at}},{session});
    await writeAudit(response,'appointment_pass_rotated',row.id,session);
    return {path,url:config.FRONTEND_ORIGIN+path,expires_at:row.public_pass_expires_at};
  });response.status(201).json(result);
});
queueRouter.delete('/passes/:id',requirePermission('appointment.update'),async(request,response)=>{
  await transaction(async session=>{const filter=await scopeFor(response,{id:uuid.parse(request.params.id)},session);if(response.locals.account.role==='doctor')filter.$and.push({doctor_id:response.locals.account.id});const result=await db.collection('clinical_appointments').updateOne(filter,{$set:{public_pass_revoked:true}},{session});if(!result.matchedCount)throw failure('Appointment unavailable.',404);await writeAudit(response,'appointment_pass_revoked',request.params.id,session);});response.status(204).end();
});
const screenInput=z.object({name:z.string().trim().min(2).max(100),branch_id:uuid,doctor_id:uuid.nullable(),department_id:uuid.nullable().optional(),room:z.string().max(80).prefault(''),type:z.enum(['doctor','reception','department','announcement']),enabled:z.boolean().prefault(true),announcements:announcements.optional()}).refine(value=>!['doctor','announcement'].includes(value.type)||Boolean(value.doctor_id),'Assign a doctor to this screen.');
function screenManager(response){if(!['hospital_admin','branch_admin','receptionist'].includes(response.locals.account.role))throw failure('Reception or administrator access required.',403);}
queueRouter.get('/screens',async(_request,response)=>{
  screenManager(response);
  const rows=await db.collection('waiting_screens').find(await scopeFor(response,{}),{projection:{_id:0,token_hash:0}}).sort({name:1}).toArray();
  response.json(rows.map(row=>({...row,online:row.enabled&&row.last_seen_at&&Date.now()-new Date(row.last_seen_at).getTime()<45000})));
});
queueRouter.post('/screens',requirePermission('appointment.update'),async(request,response)=>{
  screenManager(response);const body=screenInput.parse(request.body);await assertBranch(response,body.branch_id);if(body.doctor_id)await doctorScope(response,body.doctor_id,body.branch_id);
  const token=secretToken(),row={...body,id:randomUUID(),tenant_id:response.locals.account.tenant_id,token_hash:secretHash(token),created_at:new Date(),updated_at:new Date()};
  await transaction(async session=>{if(await db.collection('waiting_screens').countDocuments({tenant_id:row.tenant_id},{session})>=100)throw failure('A clinic can register up to 100 screens.');await db.collection('waiting_screens').insertOne({...row},{session});if(body.doctor_id&&body.room)await db.collection('staff_members').updateOne({tenant_id:row.tenant_id,user_id:body.doctor_id},{$set:{['professional.branch_rooms.'+body.branch_id]:body.room}},{session});await writeAudit(response,'waiting_screen_registered',row.id,session);});
  const {_id,token_hash,...safe}=row;response.status(201).json({...safe,path:`/waiting/${token}`});
});
queueRouter.put('/screens/:id',requirePermission('appointment.update'),async(request,response)=>{
  screenManager(response);const body=screenInput.parse(request.body);await assertBranch(response,body.branch_id);if(body.doctor_id)await doctorScope(response,body.doctor_id,body.branch_id);
  await transaction(async session=>{const result=await db.collection('waiting_screens').updateOne(await scopeFor(response,{id:uuid.parse(request.params.id)},session),{$set:{...body,updated_at:new Date()}},{session});if(!result.matchedCount)throw failure('Screen unavailable.',404);if(body.doctor_id&&body.room)await db.collection('staff_members').updateOne({tenant_id:response.locals.account.tenant_id,user_id:body.doctor_id},{$set:{['professional.branch_rooms.'+body.branch_id]:body.room}},{session});await writeAudit(response,'waiting_screen_updated',request.params.id,session);});response.json({saved:true});
});
queueRouter.post('/screens/:id/link',requirePermission('appointment.update'),async(request,response)=>{
  screenManager(response);const token=secretToken();await transaction(async session=>{const result=await db.collection('waiting_screens').updateOne(await scopeFor(response,{id:uuid.parse(request.params.id)},session),{$set:{token_hash:secretHash(token),updated_at:new Date()}},{session});if(!result.matchedCount)throw failure('Screen unavailable.',404);await writeAudit(response,'waiting_screen_link_rotated',request.params.id,session);});response.json({path:`/waiting/${token}`});
});
queueRouter.delete('/screens/:id',requirePermission('appointment.update'),async(request,response)=>{
  screenManager(response);await transaction(async session=>{const result=await db.collection('waiting_screens').deleteOne(await scopeFor(response,{id:uuid.parse(request.params.id)},session),{session});if(!result.deletedCount)throw failure('Screen unavailable.',404);await writeAudit(response,'waiting_screen_deleted',request.params.id,session);});response.status(204).end();
});

// Opaque links are bearer capabilities, not account sessions. Never return clinical data.
const attempts=new Map(),connections=new Map();let totalConnections=0;
publicQueueRouter.use((request,response,next)=>{
  response.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});
  const key=request.ip||'unknown',now=Date.now(),entry=attempts.get(key);
  if(!entry&&attempts.size>=5000)return response.status(429).json({error:'Please retry shortly.'});
  if(!entry||now-entry.at>60000)attempts.set(key,{at:now,count:1});else if(++entry.count>180)return response.status(429).json({error:'Please wait before trying again.'});
  if(attempts.size>5000)for(const [key,value] of attempts)if(now-value.at>60000)attempts.delete(key);
  next();
});
function validToken(value){return /^[A-Za-z0-9_-]{43}$/.test(value);}
async function passSnapshot(token){
  if(!validToken(token))throw failure('This appointment link is invalid or has expired.',404);
  const row=await db.collection('clinical_appointments').findOne({public_pass_hash:secretHash(token),public_pass_revoked:{$ne:true},public_pass_expires_at:{$gt:new Date()}});
  if(!row)throw failure('This appointment link is invalid or has expired.',404);
  const [patient,clinic]=await Promise.all([db.collection('patients').findOne({tenant_id:row.tenant_id,id:row.patient_id,deleted_at:null}),db.collection('hospitals').findOne({id:row.tenant_id,deleted_at:null})]);
  if(!patient||!clinic)throw failure('This appointment is unavailable.',404);
  const staff=await db.collection('staff_members').findOne({tenant_id:row.tenant_id,user_id:row.doctor_id});
  const snapshot=await queueSnapshot({tenant_id:row.tenant_id,branch_id:row.branch_id,doctor_id:row.doctor_id,date:row.appointment_date});
  const queue=safeQueue(snapshot),own=snapshot.rows.find(item=>item.id===row.id),index=snapshot.rows.filter(item=>['Waiting','Awaiting check-in','In Consultation'].includes(item.status)).findIndex(item=>item.id===row.id);
  const appointment={appointment_number:row.appointment_number,token_number:row.token_number,serial:own?.serial||row.queue_serial||row.slot_serial,appointment_date:row.appointment_date,appointment_time:row.appointment_time,status:row.status,queue_status:own?.status,patient_name:`${patient.first_name} ${patient.last_name}`.trim(),patient_phone:patient.phone??'',doctor_name:snapshot.doctor_name,doctor_qualification:snapshot.doctor_qualification,department_name:snapshot.department,branch_name:snapshot.branch_name,clinic_name:clinic.name,consultation_fee:row.consultation_fee??0,charges:row.charges??[],discount:row.discount??0,amount:appointmentTotal(row)/100,paid_amount:row.paid_amount??0,payment_status:row.payment_status,payment_mode:row.payment_mode,estimated_at:own?.estimated_at??null,started_at:own?.started_at,completed_at:own?.completed_at,patients_before:Math.max(0,index),room:snapshot.room};
  const live=staff?.professional?.live_queue_enabled!==false;
  // Other patients are represented by serial/status/time only, never names, IDs or phone numbers.
  return {appointment,queue:live?queue:null,updated_at:new Date().toISOString()};
}
async function displaySnapshot(token){
  if(!validToken(token))throw failure('This screen link is invalid or disabled.',404);
  const screen=await db.collection('waiting_screens').findOne({token_hash:secretHash(token),enabled:true});
  if(!screen)throw failure('This screen link is invalid or disabled.',404);
  if(!screen.last_seen_at||Date.now()-new Date(screen.last_seen_at).getTime()>20000)await db.collection('waiting_screens').updateOne({id:screen.id,enabled:true},{$set:{last_seen_at:new Date()}});
  const clinic=await db.collection('hospitals').findOne({id:screen.tenant_id,deleted_at:null});if(!clinic)throw failure('Clinic unavailable.',404);
  const date=hospitalDay(),filter={tenant_id:screen.tenant_id,branch_id:screen.branch_id,appointment_date:date,...(screen.doctor_id?{doctor_id:screen.doctor_id}:{}),...(screen.department_id?{department_id:screen.department_id}:{})};
  const groups=await db.collection('clinical_appointments').aggregate([{$match:filter},{$group:{_id:'$doctor_id'}}]).toArray();
  if(screen.doctor_id&&!groups.length)groups.push({_id:screen.doctor_id});
  const queues=[];
  for(const group of groups.slice(0,100)){
    let snapshot;try{snapshot=await queueSnapshot({tenant_id:screen.tenant_id,branch_id:screen.branch_id,doctor_id:group._id,date});}catch(error){if(error.status===404)continue;throw error;}
    if(snapshot.settings.live_queue_enabled===false)continue;
    const queue=safeQueue(snapshot),prefs=announcements.parse(screen.announcements??snapshot.settings.announcements??{});
    // Room is projected from the shared branch/doctor configuration.
    if(prefs.include_patient_name&&queue.current){const appointment=snapshot.appointments.find(item=>item.id===snapshot.current.id),patient=await db.collection('patients').findOne({tenant_id:screen.tenant_id,id:appointment.patient_id});queue.current.patient_name=patient?`${patient.first_name} ${patient.last_name}`.trim():'';}
    queues.push({...queue,announcements:prefs});
  }
  return {screen:{name:screen.name,type:screen.type},clinic_name:clinic.name,queues,updated_at:new Date().toISOString()};
}
function stream(loader){return async(request,response)=>{
  const ip=request.ip||'unknown';if((connections.get(ip)||0)>=20||totalConnections>=200)return response.status(429).json({error:'Too many live connections. Please retry shortly.'});
  // Validate before opening a stream, and again for every snapshot (revocation takes effect live).
  const initial=await loader(request.params.token);
  response.set({'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});response.flushHeaders();
  connections.set(ip,(connections.get(ip)||0)+1);totalConnections++;
  let stopped=false,busy=false,timer,lifetime;
  const close=()=>{if(stopped)return;stopped=true;clearInterval(timer);clearTimeout(lifetime);connections.set(ip,Math.max(0,(connections.get(ip)||1)-1));totalConnections--;response.end();};
  const send=value=>{if(!stopped&&!response.destroyed){if(response.writableLength>1000000){close();return;}response.write(`event: snapshot\ndata: ${JSON.stringify(value)}\n\n`);}};
  send(initial);timer=setInterval(async()=>{if(busy||stopped)return;busy=true;try{send(await loader(request.params.token));}catch(error){response.write(`event: unavailable\ndata: ${JSON.stringify({error:error.status===404?error.message:'Live updates interrupted. Reconnecting…'})}\n\n`);close();}finally{busy=false;}},4000);
  lifetime=setTimeout(close,8*60000);request.on('close',close);response.on('close',close);
};}
publicQueueRouter.get('/appointments/:token',async(request,response)=>response.json(await passSnapshot(request.params.token)));
publicQueueRouter.get('/appointments/:token/events',stream(passSnapshot));
publicQueueRouter.get('/screens/:token',async(request,response)=>response.json(await displaySnapshot(request.params.token)));
publicQueueRouter.get('/screens/:token/events',stream(displaySnapshot));
