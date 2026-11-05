import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectQueue} from '../queue-engine.mjs';
const settings={date:'2026-11-06',opd_start_time:'11:00',average_consultation_minutes:5,room_chamber:'Room 2'};
const rows=()=>[1,2,3,4].map(serial=>({id:String(serial),queue_serial:serial,appointment_time:`11:${String((serial-1)*5).padStart(2,'0')}`,status:'Checked In'}));
test('scheduled estimates use configurable duration before OPD begins',()=>{
  const queue=projectQueue(rows(),settings,{},new Date('2026-11-06T05:00:00Z'));
  assert.equal(queue.status,'NOT STARTED');assert.equal(queue.rows[0].estimated_at,'2026-11-06T05:30:00.000Z');assert.equal(queue.rows[3].estimated_at,'2026-11-06T05:45:00.000Z');
  assert.equal(projectQueue(rows(),{...settings,average_consultation_minutes:7},{},new Date()).rows[1].estimated_at,'2026-11-06T05:37:00.000Z');
});
test('late actual start and an overdue consultation shift subsequent estimates',()=>{
  const appointments=rows();appointments[0]={...appointments[0],status:'In Consultation',consultation_started_at:'2026-11-06T06:00:00Z'};
  const queue=projectQueue(appointments,settings,{actual_start_at:'2026-11-06T06:00:00Z'},new Date('2026-11-06T06:01:00Z'));
  assert.equal(queue.status,'LIVE');assert.equal(queue.current.serial,1);assert.equal(queue.rows[1].estimated_at,'2026-11-06T06:05:00.000Z');
  const late=projectQueue(appointments,settings,{actual_start_at:'2026-11-06T06:00:00Z'},new Date('2026-11-06T06:12:00Z'));
  assert.equal(late.next.estimated_at,'2026-11-06T06:12:00.000Z');
});
test('skipped and absent patients do not block the next patient or become now serving',()=>{
  const appointments=rows();appointments[0].queue_skipped=true;appointments[1].status='No Show';appointments[3].status='Completed';
  const queue=projectQueue(appointments,settings,{},new Date());
  assert.equal(queue.current,null);assert.equal(queue.next.serial,3);assert.equal(queue.waiting_count,1);assert.equal(queue.counts.skipped,1);assert.equal(queue.counts.absent,1);
  assert.equal(queue.rows.find(row=>row.serial===1).estimated_at,null);
});
test('completed consultations advance the estimate while original serials remain stable',()=>{
  const appointments=rows();appointments[0]={...appointments[0],status:'Completed',consultation_completed_at:'2026-11-06T06:08:00Z'};
  const queue=projectQueue(appointments,settings,{actual_start_at:'2026-11-06T06:00:00Z'},new Date('2026-11-06T06:09:00Z'));
  assert.equal(queue.next.serial,2);assert.equal(queue.next.estimated_at,'2026-11-06T06:09:00.000Z');assert.equal(appointments[0].queue_serial,1);
});
