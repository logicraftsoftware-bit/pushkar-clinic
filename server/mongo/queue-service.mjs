import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {db} from './database.mjs';
import {doctorDay} from './doctor-availability.mjs';
import {projectQueue} from './queue-engine.mjs';
export const secretHash=value=>createHash('sha256').update(value).digest('hex');
export const secretToken=()=>randomBytes(32).toString('base64url');
export function sessionStart(professional,date,time){
  const day=doctorDay(professional.appointment_schedule??[],professional.default_schedule,date,professional.unavailable_dates??[]);
  return String(day?.from_time||professional.opd_start_time||time||'09:00').slice(0,5);
}
export function queueIdentity(row){return `${row.tenant_id}:${row.branch_id}:${row.doctor_id}:${row.appointment_date}:${row.queue_session_start||'day'}`;}
export async function assignQueueSerial(row,session){
  const key=`queue:${row.tenant_id}:${row.branch_id}:${row.doctor_id}:${row.appointment_date}`;
  // On an existing clinic start after its legacy slot serials; never renumber old bills.
  const scope={tenant_id:row.tenant_id,branch_id:row.branch_id,doctor_id:row.doctor_id,appointment_date:row.appointment_date};
  const prior=await db.collection('clinical_appointments').aggregate([{$match:scope},{$group:{_id:null,max:{$max:{$ifNull:['$queue_serial','$slot_serial']}}}}],{session}).next();
  await db.collection('counters').updateOne({_id:key},{$max:{value:Number(prior?.max||0)}},{session,upsert:true});
  const counter=await db.collection('counters').findOneAndUpdate({_id:key},{$inc:{value:1}},{session,returnDocument:'after'});
  row.queue_serial=counter.value;
}
export function attachPass(row){
  const token=secretToken();row.public_pass_hash=secretHash(token);row.public_pass_revoked=false;row.public_pass_created_at=new Date();
  row.public_pass_expires_at=new Date(Math.max(Date.now(),new Date(`${row.appointment_date}T23:59:59+05:30`).getTime())+7*86400000);
  return `/p/${token}`;
}
export async function beginQueueVisit(row,session){
  if(!row.queue_session_start){
    const staff=await db.collection('staff_members').findOne({tenant_id:row.tenant_id,user_id:row.doctor_id},{session});
    row.queue_session_start=sessionStart(staff?.professional??{},row.appointment_date,row.appointment_time);
  }
  const now=new Date(),key=queueIdentity(row);
  const state=await db.collection('opd_queue_sessions').findOneAndUpdate({_id:key},{$setOnInsert:{actual_start_at:now,tenant_id:row.tenant_id,branch_id:row.branch_id},$inc:{version:1}},{session,upsert:true,returnDocument:'after'});
  const other=await db.collection('clinical_appointments').findOne({tenant_id:row.tenant_id,doctor_id:row.doctor_id,branch_id:row.branch_id,appointment_date:row.appointment_date,id:{$ne:row.id},status:{$in:['In Consultation','Present']},queue_skipped:{$ne:true}},{session});
  if(other)throw Object.assign(new Error('Complete or skip the current consultation before starting another patient.'),{status:409});
  return {queue_session_start:row.queue_session_start,consultation_started_at:row.status==='In Consultation'&&!row.queue_skipped?(row.consultation_started_at??now):now,queue_skipped:false,queue_call_id:row.status==='In Consultation'&&row.queue_call_id?row.queue_call_id:randomUUID(),opd_started_at:state.actual_start_at};
}
export async function queueSnapshot({tenant_id,branch_id,doctor_id,date,from,to},now=new Date()){
  const staff=await db.collection('staff_members').findOne({tenant_id,user_id:doctor_id,staff_type:'Doctor'});
  const doctor=await db.collection('users').findOne({tenant_id,id:doctor_id,is_active:true,role:'doctor'});
  if(!doctor||!staff||staff.status!=='Active')throw Object.assign(new Error('Doctor is unavailable.'),{status:404});
  const professional=staff.professional??{},day=doctorDay(professional.appointment_schedule??[],professional.default_schedule,date,professional.unavailable_dates??[]);
  const start=from||day?.from_time||professional.opd_start_time||'09:00';
  const filter={tenant_id,branch_id,doctor_id,appointment_date:date,...(from||to?{appointment_time:{...(from?{$gte:from}:{}),...(to?{$lt:to}:{})}}:{})};
  const appointments=await db.collection('clinical_appointments').find(filter).sort({slot_serial:1,created_at:1}).toArray();
  const states=await db.collection('opd_queue_sessions').find({tenant_id,branch_id,_id:{$in:[`${tenant_id}:${branch_id}:${doctor_id}:${date}:${start}`,`${tenant_id}:${branch_id}:${doctor_id}:${date}:day`]}}).toArray();
  const actual=states.map(row=>row.actual_start_at).filter(Boolean).sort((a,b)=>a-b)[0]??appointments.map(row=>row.opd_started_at).filter(Boolean).sort((a,b)=>new Date(a)-new Date(b))[0];
  const projected=projectQueue(appointments,{...professional,room_chamber:professional.branch_rooms?.[branch_id]??professional.room_chamber,average_consultation_minutes:Number(professional.average_consultation_minutes)||Number(professional.slot_duration)||10,date,opd_start_time:professional.opd_start_time||start},{actual_start_at:actual},now);
  const department=await db.collection('departments').findOne({tenant_id,id:staff.department_id??doctor.department_id});
  const branch=await db.collection('branches').findOne({tenant_id,id:branch_id});
  return {...projected,doctor_id,branch_id,date,from:start,to:to||day?.to_time||'23:59',doctor_name:`${doctor.first_name} ${doctor.last_name}`.trim(),doctor_qualification:professional.doctor_qualification??professional.qualification??'',department:department?.name??professional.specialization??'',branch_name:branch?.name??'',settings:{...professional,room_chamber:professional.room_chamber??''},appointments};
}
export function safeQueue(snapshot,staffView=false){
  const {appointments,settings,...queue}=snapshot;
  const withoutId=row=>{if(!row)return null;const {id,...rest}=row;return rest;};
  return {...queue,...(!staffView?{doctor_id:undefined,branch_id:undefined}:{}),
    current:staffView?queue.current:withoutId(queue.current),next:staffView?queue.next:withoutId(queue.next),
    rows:queue.rows.map(row=>{
      if(!staffView)return withoutId(row);
      const appointment=appointments.find(item=>item.id===row.id);
      return {...row,patient_id:appointment.patient_id,appointment_number:appointment.appointment_number,token_number:appointment.token_number,patient_name:appointment.patient_name??''};
    })};
}
