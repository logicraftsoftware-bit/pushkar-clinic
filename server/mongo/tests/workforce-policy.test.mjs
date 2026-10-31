import {test} from 'node:test';
import assert from 'node:assert/strict';
import {payrollAmount,claimAmounts,attendanceStatus} from '../workforce-policy.mjs';
test('payroll net uses integer cents and rejects deductions beyond earnings',()=>{
  assert.equal(payrollAmount({basic_salary:100.10,allowances:20.20,overtime:5,deductions:10,tax:5}),110.30);
  assert.throws(()=>payrollAmount({basic_salary:1,deductions:2}),{status:400});
  assert.throws(()=>payrollAmount({basic_salary:-1}),{status:400});
});
test('claim settlements stay within approvals and rejected claims carry no settlement',()=>{
  assert.doesNotThrow(()=>claimAmounts({claimed_amount:100,approved_amount:80,settled_amount:80,status:'Settled'}));
  for(const body of [{claimed_amount:10,approved_amount:11},{claimed_amount:10,approved_amount:5,settled_amount:6},{claimed_amount:10,approved_amount:5,settled_amount:4,status:'Settled'},{claimed_amount:10,approved_amount:5,status:'Rejected'}])assert.throws(()=>claimAmounts(body),{status:400});
});
test('attendance rules handle overnight shifts and preserve unmatched status',()=>{
  assert.equal(attendanceStatus('23:00','Nurse',{Nurse:{Present:{from:'22:00',upto:'06:00'}}},'Late'),'Present');
  assert.equal(attendanceStatus('04:00','Nurse',{Nurse:{Present:{from:'22:00',upto:'06:00'}}},'Late'),'Present');
  assert.equal(attendanceStatus('12:00','Nurse',{Nurse:{Present:{from:'22:00',upto:'06:00'}}},'Late'),'Late');
});
