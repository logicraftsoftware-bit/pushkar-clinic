import {test} from 'node:test';
import assert from 'node:assert/strict';
import {doctorDay,doctorSlots,availableDoctorSlots,upcomingDoctorSlots} from '../src/doctor-availability.js';
const recurring={from_time:'07:00',to_time:'22:00',max_slots:200,slot_mode:'capacity',start_date:'2026-10-09'};
test('today only offers slots after the current India time and preserves token serials',()=>{
  const now=new Date('2026-10-24T12:02:30Z'); // 17:32:30 India time.
  const slots=[{time:'09:00',serial:1},{time:'17:30',serial:2},{time:'17:32',serial:3},{time:'17:35',serial:4},{time:'18:00',serial:5}];
  assert.deepEqual(upcomingDoctorSlots(slots,'2026-10-24',now),slots.slice(3));
  assert.deepEqual(upcomingDoctorSlots(slots,'2026-10-25',now),slots);
  assert.deepEqual(upcomingDoctorSlots(slots,'2026-10-23',now),[]);
  assert.deepEqual(upcomingDoctorSlots(slots,'2026-10-24',new Date('2026-10-24T12:05:00Z')),slots.slice(4));
});
test('India midnight changes the date even while UTC is on the previous day',()=>{
  const now=new Date('2026-10-24T19:00:00Z'); // 25 October, 00:30 India time.
  const slots=[{time:'00:30',serial:1},{time:'00:35',serial:2}];
  assert.deepEqual(upcomingDoctorSlots(slots,'2026-10-24',now),[]);
  assert.deepEqual(upcomingDoctorSlots(slots,'2026-10-25',now),[slots[1]]);
});
test('daily availability continues beyond a fixed calendar range and supplies 200 unique slots inside opening hours',()=>{
  const day=doctorDay([],recurring,'2028-12-31')!,slots=doctorSlots(day);
  assert.equal(slots.length,200);assert.equal(new Set(slots.map(slot=>slot.time)).size,200);
  assert.equal(slots[0].time,'07:00');assert.equal(slots.at(-1)!.time,'21:55');assert.equal(slots.at(-1)!.serial,200);
  assert.ok(slots.every(slot=>slot.time>='07:00'&&slot.time<'22:00'));
  assert.equal(doctorDay([],recurring,'2026-10-08'),undefined);
});
test('manual date overrides and removed availability take precedence over the recurring schedule',()=>{
  const override={appointment_date:'10-10-2026',from_time:'09:00',to_time:'12:00',max_slots:9};
  assert.equal(doctorDay([override],recurring,'2026-10-10'),override);
  assert.equal(doctorDay([override],recurring,'2026-10-10',['2026-10-10']),undefined);
  assert.equal(doctorSlots(override,20).length,9);
});
test('existing appointments retain their occupied times and serials, and reduce the remaining daily capacity',()=>{
  const slots=doctorSlots(recurring);
  const available=availableDoctorSlots(slots,[{appointment_time:'07:00:00',slot_serial:1},{appointment_time:'08:20:00',slot_serial:5}]);
  assert.equal(available.length,198);assert.ok(available.every(slot=>slot.time!=='07:00'&&slot.serial!==5));
  assert.equal(availableDoctorSlots(slots,Array.from({length:200},()=>({appointment_time:'08:20'}))).length,0);
});
