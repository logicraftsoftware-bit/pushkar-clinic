import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureDailyDoctorSchedule} from '../src/daily-doctor-schedule.js';
import {doctorDay,doctorSlots} from '../src/doctor-availability.js';

test('every remaining 2026 day and every 2027 and 2028 day has 180 five-minute slots including leap day',()=>{
  const p=configureDailyDoctorSchedule({},'2026-10-24');
  let days=0;
  for(let date=new Date('2026-10-24T00:00:00Z');date.toISOString().slice(0,10)<='2028-12-31';date.setUTCDate(date.getUTCDate()+1)){
    const selected=date.toISOString().slice(0,10),day=doctorDay(p.appointment_schedule,p.appointment_default_schedule,selected,p.appointment_unavailable_dates)!;
    assert.ok(day,selected);
    const slots=doctorSlots(day,p.slot_duration,p.maximum_appointments);
    assert.equal(slots.length,180);assert.equal(slots[0]!.time,'07:00');assert.equal(slots.at(-1)!.time,'21:55');
    slots.forEach((slot,index)=>{const minutes=Number(slot.time.slice(0,2))*60+Number(slot.time.slice(3));assert.equal(minutes,420+index*5);assert.equal(slot.serial,index+1);});
    days++;
  }
  assert.equal(days,800);
  assert.equal(doctorDay([],p.appointment_default_schedule,'2026-10-23'),undefined);
  assert.equal(doctorDay([],p.appointment_default_schedule,'2029-01-01'),undefined);
});
test('dated overrides and unavailable days are reset only in the requested range while fees and recovery data are preserved',()=>{
  const old={consultation_fee:750,branch_fees:{one:{consultation_fee:600}},slot_duration:20,maximum_appointments:200,
    appointment_default_schedule:{from_time:'09:00',to_time:'18:00'},
    appointment_unavailable_dates:['2026-10-23','2026-12-25','2028-02-29','2029-01-01'],
    appointment_schedule:[{appointment_date:'23-10-2026',from_time:'09:00'}, {appointment_date:'25-12-2026',from_time:'09:00'}, {appointment_date:'2029-01-01',from_time:'09:00'}]};
  const before=structuredClone(old),p=configureDailyDoctorSchedule(old,'2026-10-24');
  assert.deepEqual(old,before);assert.equal(p.consultation_fee,750);assert.deepEqual(p.branch_fees,old.branch_fees);
  assert.deepEqual(p.appointment_unavailable_dates,['2026-10-23','2029-01-01']);
  assert.equal(p.appointment_schedule[0].from_time,'09:00');assert.equal(p.appointment_schedule[1].from_time,'07:00');assert.equal(p.appointment_schedule[2].from_time,'09:00');
  assert.deepEqual(p.appointment_five_minute_backup.appointment_schedule,old.appointment_schedule);
  assert.equal(p.appointment_five_minute_backup.slot_duration,20);
  assert.deepEqual(configureDailyDoctorSchedule(p,'2026-10-24'),p);
});
