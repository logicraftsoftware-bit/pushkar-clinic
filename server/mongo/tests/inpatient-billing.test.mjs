import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bedStayAmount,inpatientTotal} from '../inpatient-billing.mjs';
test('bed-stay snapshots preserve each room rate across transfers',()=>{
  const stays=[{daily_rate:100,started_at:'2030-01-01T00:00:00Z',ended_at:'2030-01-02T00:00:01Z'},
    {daily_rate:200,started_at:'2030-01-02T00:00:01Z',ended_at:'2030-01-02T01:00:00Z'}];
  assert.deepEqual(bedStayAmount(stays[0]),{days:2,amount:200});
  assert.deepEqual(inpatientTotal(stays,[{amount:50}],25),{bed_amount:400,total_amount:425});
  assert.throws(()=>bedStayAmount({daily_rate:100,started_at:'2030-01-03',ended_at:'2030-01-02'}));
});
