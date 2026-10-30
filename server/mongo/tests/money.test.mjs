import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cents,appointmentTotal,paymentStatus} from '../money.mjs';
test('money uses integer cents and rejects overprecision and invalid values',()=>{
  assert.equal(cents('12.34'),1234);
  for(const value of [-1,Infinity,NaN,'1.001',100000000])assert.throws(()=>cents(value));
  assert.equal(appointmentTotal({consultation_fee:100,charges:[{amount:20}],discount:10}),11000);
  assert.throws(()=>appointmentTotal({consultation_fee:10,discount:20}));
  assert.equal(paymentStatus(100,0),'Unpaid');assert.equal(paymentStatus(100,50),'Partially Paid');assert.equal(paymentStatus(100,100),'Paid');
});
