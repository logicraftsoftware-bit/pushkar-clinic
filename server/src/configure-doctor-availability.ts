import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {doctorDay,doctorSlots} from './doctor-availability.js';
import {dailyDoctorSchedule,configureDailyDoctorSchedule} from './daily-doctor-schedule.js';
import {auditContext} from './audit-context.js';
const {values}=parseArgs({options:{mode:{type:'string',default:'preview'},env:{type:'string',default:'.env'}}});
if(!['preview','apply'].includes(values.mode!))throw Error('Invalid mode');
process.env.ENV_FILE=values.env;
const {pool}=await import('./db.js');
try{
  const targets=await pool.query(`SELECT DISTINCT h.id FROM hospitals h JOIN branches b ON b.tenant_id=h.id WHERE h.deleted_at IS NULL AND lower(h.name) LIKE '%medicity%' AND lower(trim(b.name))='medicity guwahati' AND EXISTS(SELECT 1 FROM branches paired WHERE paired.tenant_id=h.id AND lower(trim(paired.name))='medicity guwahati diagnostics')`);
  if(targets.rows.length!==1)throw Error('Expected exactly one Medicity hospital with Guwahati and Diagnostics branches');
  const tenant=targets.rows[0].id;
  const branches=await pool.query('SELECT id,name,code FROM branches WHERE tenant_id=$1 AND is_active ORDER BY name',[tenant]);
  if(!branches.rows.some(row=>String(row.code).toUpperCase()==='MAIN'))throw Error('Main branch missing');
  const today=(await pool.query("SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') today")).rows[0].today;
  const recurring=dailyDoctorSchedule(today);
  if(today>recurring.end_date)throw Error('The requested schedule ends on 31 December 2028');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const doctors=await client.query("SELECT id,branch_id,user_id,professional FROM staff_members WHERE tenant_id=$1 AND staff_type='Doctor' ORDER BY id FOR UPDATE",[tenant]);
    if(!doctors.rowCount)throw Error('No doctors found');
    console.log('DOCTOR_AVAILABILITY_PLAN',JSON.stringify({mode:values.mode,doctors:doctors.rowCount,branches:branches.rows.map(row=>({name:row.name,code:row.code,primary_doctors:doctors.rows.filter(doctor=>doctor.branch_id===row.id).length})),daily:recurring}));
    if(values.mode==='apply')await auditContext.run({tenant_id:tenant,actor_name:'System',actor_role:'system',ip_address:'',request_path:'maintenance/configure-doctor-availability',request_id:randomUUID()},async()=>{
      for(const doctor of doctors.rows){
        const professional=configureDailyDoctorSchedule(doctor.professional,today);
        await client.query('UPDATE staff_members SET professional=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3',[professional,doctor.id,tenant]);
      }
    });
    const saved=await client.query("SELECT id,user_id,professional FROM staff_members WHERE tenant_id=$1 AND staff_type='Doctor' ORDER BY id",[tenant]);
    const dates:string[]=[];
    for(let date=new Date(today+'T00:00:00Z');date.toISOString().slice(0,10)<=recurring.end_date;date.setUTCDate(date.getUTCDate()+1))dates.push(date.toISOString().slice(0,10));
    const errors=saved.rows.filter(row=>{
      const p=row.professional??{};
      return Number(p.slot_duration)!==5||Number(p.maximum_appointments)!==180||dates.some(date=>{
        const day=doctorDay(p.appointment_schedule??[],p.appointment_default_schedule,date,p.appointment_unavailable_dates??[]);
        return !day||day.from_time!=='07:00'||day.to_time!=='22:00'||Number(day.max_slots)!==180||doctorSlots(day,5).length!==180;
      });
    });
    if(values.mode==='apply'&&errors.length)throw Error(`Availability verification failed for ${errors.length} doctors`);
    await client.query(values.mode==='apply'?'COMMIT':'ROLLBACK');
    console.log('DOCTOR_AVAILABILITY_RESULT',JSON.stringify({mode:values.mode,doctors:saved.rowCount,linked_doctors:saved.rows.filter(row=>row.user_id).length,daily:recurring,days_checked:dates.length,verified:values.mode==='apply'&&errors.length===0,appointment_records_modified:false,fees_and_branch_access_modified:false}));
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}finally{await pool.end();}
