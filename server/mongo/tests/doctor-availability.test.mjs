import {test} from 'node:test';
import assert from 'node:assert/strict';
import {doctorDay,doctorSlots,availableDoctorSlots,upcomingDoctorSlots} from '../doctor-availability.mjs';
test('doctor slots respect capacity, unavailable dates and existing reservations',()=>{
  const day={appointment_date:'2030-01-02',from_time:'10:00',to_time:'11:00',max_slots:3,slot_mode:'capacity'};
  const slots=doctorSlots(day);assert.equal(slots.length,3);assert.deepEqual(slots.map(row=>row.time),['10:00','10:20','10:40']);
  assert.equal(availableDoctorSlots(slots,[{appointment_time:'10:20',slot_serial:2}]).length,2);
  assert.equal(doctorDay([day],null,'2030-01-02',['2030-01-02']),undefined);
  assert.equal(upcomingDoctorSlots(slots,'2000-01-01',new Date('2026-10-31')).length,0);
});
