import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cancellationBlockReason,cancellationBookedTests,moneyCents,refundBalance} from '../src/cancellation-policy.js';
test('OPD cancellation is blocked for present, absent and all attended states',()=>{
  for(const status of ['Present','Absent','Checked In','Waiting','In Consultation','Completed','No Show','Cancelled'])assert.ok(cancellationBlockReason('OPD',[{status}]),status);
  for(const status of ['Booked','Confirmed'])assert.equal(cancellationBlockReason('OPD',[{status}]),'');
});
test('any collected order sharing a lab invoice blocks cancellation, including legacy result rows',()=>{
  const pending={kind:'pos',status:'Partially Paid',data:{}};
  assert.equal(cancellationBlockReason('Lab',[pending]),'');
  assert.ok(cancellationBlockReason('Lab',[pending,{kind:'sample collection',data:{collected_at:'2026-10-09'}}]));
  assert.ok(cancellationBlockReason('Lab',[pending,{kind:'reports',data:{}}]));
  assert.ok(cancellationBlockReason('Lab',[pending,{kind:'sample collection',data:{sample_records:[{status:'Sample Collected'}]}}]));
});
test('partial refunds preserve paise and cannot exceed accountant approval',()=>{
  assert.deepEqual(refundBalance(200.55,50.10,100.25),{refunded:150.35,remaining:50.20,status:'Partially Refunded'});
  assert.deepEqual(refundBalance(200.55,150.35,50.20),{refunded:200.55,remaining:0,status:'Completed'});
  assert.throws(()=>refundBalance(100,90,10.01),/exceeds/);assert.throws(()=>refundBalance(100,0,0),/greater than zero/);
  for(const amount of [-1,NaN,Infinity,12.345])assert.throws(()=>moneyCents(amount),/valid amount/);
});
test('booked tests use invoice details and fall back to shared orders without duplicate test IDs',()=>{
  const test={test_id:'rbs',name:'RBS',amount:60};
  assert.deepEqual(cancellationBookedTests({data:{tests:[test]}},[{data:{tests:[{...test,amount:90}]}}]),[test]);
  assert.deepEqual(cancellationBookedTests({data:{}},[{data:{tests:[test]}},{data:{tests:[test,{test_id:'cbc',name:'CBC',amount:200}]}}]),[test,{test_id:'cbc',name:'CBC',amount:200}]);
  assert.deepEqual(cancellationBookedTests({data:{}},[]),[]);
});
