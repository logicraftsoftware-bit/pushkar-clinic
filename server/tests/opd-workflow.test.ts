import {test} from 'node:test';import assert from 'node:assert/strict';
import {hospitalClock,recentRegistrationGroups,currentAvailableSlot} from '../../src/hospital/opd-workflow.js';
import {fiveMinuteDoctorSlots} from '../src/doctor-availability.js';
test('hospital date and time use India time even across UTC date boundary',()=>{assert.deepEqual(hospitalClock(new Date('2026-10-14T20:31:00Z')),{date:'2026-10-15',time:'02:01'});});
test('recent registrations are grouped in India dates with newest patients and dates first',()=>{
 const rows=[{id:'old',created_at:'2026-10-13T10:00:00Z'},{id:'morning',created_at:'2026-10-15T02:00:00Z'},{id:'night',created_at:'2026-10-14T20:00:00Z'},{id:'new',created_at:'2026-10-15T10:00:00Z'}];
 const groups=recentRegistrationGroups(rows);assert.deepEqual(groups.map(g=>g.date),['2026-10-15','2026-10-13']);assert.deepEqual(groups[0].patients.map(p=>p.id),['new','morning','night']);assert.equal(recentRegistrationGroups(rows,2)[0].patients.length,2);
});
test('five-minute tokens align to the clock, respect schedule boundaries and default to the next future time',()=>{
 const slots=fiveMinuteDoctorSlots({from_time:'09:02',to_time:'10:00',max_slots:2,slot_mode:'capacity'});assert.equal(slots[0].time,'09:05');assert.equal(slots.at(-1)?.time,'09:55');for(let i=1;i<slots.length;i++)assert.equal(Number(slots[i].time.slice(3))-Number(slots[i-1].time.slice(3)),5);
 assert.equal(currentAvailableSlot(slots,'2026-10-15',new Date('2026-10-15T04:02:20Z')),'09:35');assert.equal(currentAvailableSlot(slots.filter(s=>s.time!=='09:35'),'2026-10-15',new Date('2026-10-15T04:02:20Z')),'09:40');assert.equal(currentAvailableSlot(slots,'2026-10-15',new Date('2026-10-15T05:00:00Z')),'');assert.equal(currentAvailableSlot(slots,'2026-10-14',new Date('2026-10-15T04:02:20Z')),'');
});
