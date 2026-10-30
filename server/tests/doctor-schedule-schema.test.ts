import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {doctorScheduleSchemaSql} from '../src/doctor-schedule-schema.js';
import {doctorDay,doctorSlots,upcomingDoctorSlots} from '../src/doctor-availability.js';

test('deployment schedules every doctor, removes future blocks, preserves history and covers new doctors',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE TABLE staff_members(id serial PRIMARY KEY,staff_type text,professional jsonb)');
    const old={consultation_fee:750,appointment_schedule:[
      {appointment_date:'24-10-2026',from_time:'09:00',to_time:'10:00'},
      {appointment_date:'25-10-2026',from_time:'07:00',to_time:'07:00'},
    ],appointment_unavailable_dates:['24-10-2026','25-10-2026','2027-01-01']};
    await db.query("INSERT INTO staff_members(staff_type,professional) VALUES ('Doctor',$1),('Doctor','{}'),('Nurse','{}')",[old]);
    await db.exec(doctorScheduleSchemaSql);
    await db.exec("INSERT INTO staff_members(staff_type,professional) VALUES ('Doctor','{}')");
    const {rows}=await db.query<any>('SELECT * FROM staff_members ORDER BY id');
    for(const row of rows.filter(row=>row.staff_type==='Doctor')){
      const p=row.professional;
      for(const date of ['2026-10-25','2027-01-01','2029-01-01']){
        const day=doctorDay(p.appointment_schedule,p.appointment_default_schedule,date,p.appointment_unavailable_dates)!;
        assert.ok(day);
        const slots=doctorSlots(day,p.slot_duration,p.maximum_appointments);
        assert.equal(slots.length,180);assert.equal(slots[0].time,'07:00');assert.equal(slots.at(-1)!.time,'21:55');
        if(date==='2026-10-25'){
          const future=upcomingDoctorSlots(slots,date,new Date('2026-10-25T06:10:00Z'));
          assert.equal(future[0].time,'11:45');assert.equal(future.length,123);
        }
      }
    }
    assert.equal(rows[0].professional.consultation_fee,750);
    assert.deepEqual(rows[0].professional.daily_schedule_backup,old);
    assert.deepEqual(rows[0].professional.appointment_schedule,[old.appointment_schedule[0]]);
    assert.deepEqual(rows[0].professional.appointment_unavailable_dates,['24-10-2026']);
    assert.deepEqual(rows[2].professional,{});
    await db.exec(doctorScheduleSchemaSql);
    assert.deepEqual((await db.query('SELECT * FROM staff_members ORDER BY id')).rows,rows);
  } finally {await db.close();}
});
