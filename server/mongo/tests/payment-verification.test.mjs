import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyCapturedCheckout} from '../payment-verification.mjs';
test('booking payment verification binds signature amount currency capture and order',()=>{
  const secret='synthetic-not-a-real-gateway-secret',orderId='order_synthetic',paymentId='pay_synthetic',signature=createHmac('sha256',secret).update(orderId+'|'+paymentId).digest('hex');
  const input={secret,signature,amount:10000,orderId,paymentId,order:{id:orderId,amount:10000,amount_paid:10000,currency:'INR',status:'paid'},payment:{id:paymentId,order_id:orderId,amount:10000,currency:'INR',status:'captured',captured:true,amount_refunded:0}};
  assert.equal(verifyCapturedCheckout(input),true);
  for(const changes of [{signature:'0'.repeat(64)},{payment:{...input.payment,order_id:'order_other'}},{payment:{...input.payment,status:'authorized',captured:false}},{payment:{...input.payment,amount_refunded:100}},{payment:{...input.payment,currency:'USD'}},{order:{...input.order,amount_paid:1}},{amount:1}])assert.throws(()=>verifyCapturedCheckout({...input,...changes}),{status:402});
});
