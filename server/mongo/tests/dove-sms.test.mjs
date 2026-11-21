import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.MONGODB_URI??='mongodb://127.0.0.1:27017';
process.env.JWT_SECRET??='synthetic-sms-test-secret-not-production';
process.env.FRONTEND_ORIGIN??='https://example.invalid';
const {deliverDove,sealSmsKey}=await import('../patient-app/sms-gateway.mjs');
const settings={username:'synthetic',sender_id:'TESTID',message:'Code {code} for testing.',success_prefix:'ACCEPTED:',entity_id:'123',template_id:'456',entity_param:'entityid',template_param:'templateid'};
test('Dove transport encodes approved content and requires documented acceptance',async()=>{
 await deliverDove(settings,'private-test-key','+919999999999','123456',async(url,options)=>{
  assert.equal(url.origin,'https://mobicomm.dove-sms.com');assert.equal(url.searchParams.get('message'),'Code 123456 for testing.');assert.equal(url.searchParams.get('mobile'),'919999999999');assert.equal(url.searchParams.get('key'),'private-test-key');assert.equal(options.redirect,'error');return new Response('ACCEPTED: synthetic-id');
 });
 await assert.rejects(deliverDove(settings,'private-test-key','+919999999999','123456',async()=>new Response('ERROR: insufficient balance')),e=>e.code==='SMS_DELIVERY_FAILED'&&!e.message.includes('private-test-key'));
 await assert.rejects(deliverDove(settings,'private-test-key','+919999999999','123456',async()=>new Response('ACCEPTED: false',{status:500})),e=>e.status===503);
 const first=sealSmsKey('private-test-key'),second=sealSmsKey('private-test-key');assert.notEqual(first,second);assert.ok(!first.includes('private-test-key'));
});
