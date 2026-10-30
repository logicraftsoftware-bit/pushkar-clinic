import {test} from 'node:test';
import assert from 'node:assert/strict';
import {laboratoryPrice,laboratoryTestAvailable} from '../lab-branch-pricing.mjs';
import {labPharmacyBilling} from '../lab-billing.mjs';
test('lab bills use branch prices and keep paid amounts below the discounted total',()=>{
  const data={amount:100,available_branch_ids:['branch-one'],branch_prices:{'branch-one':120}};
  assert.equal(laboratoryTestAvailable(data,'branch-two'),false);assert.equal(laboratoryPrice(data,'branch-one'),120);
  assert.throws(()=>laboratoryPrice(data,'branch-two'));
  const bill=labPharmacyBilling([120],0,20,50);
  assert.equal(bill.total,60);assert.equal(bill.due,40);assert.equal(bill.pharmacy_discount_amount,60);
  assert.throws(()=>labPharmacyBilling([120],0,61,50));assert.throws(()=>labPharmacyBilling([120],0,0,101));
});
