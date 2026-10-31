import test from 'node:test';
import assert from 'node:assert/strict';
import {maskSettings,preserveSettingsSecrets,secretMask} from '../settings-secrets.mjs';
test('settings responses hide nested gateway credentials and preserve masked edits',()=>{
  const original={PaymentMethods:[{name:'Razorpay',api_key:'private-key',password:'private-secret',enabled:true}]};
  const masked=maskSettings(original);
  assert.equal(masked.PaymentMethods[0].api_key,secretMask);
  assert.equal(masked.PaymentMethods[0].password,secretMask);
  assert.equal(original.PaymentMethods[0].password,'private-secret');
  assert.deepEqual(preserveSettingsSecrets(masked,original),original);
  masked.PaymentMethods[0].password='replacement';
  assert.equal(preserveSettingsSecrets(masked,original).PaymentMethods[0].password,'replacement');
  masked.PaymentMethods[0].password='';
  assert.equal(preserveSettingsSecrets(masked,original).PaymentMethods[0].password,'');
});
