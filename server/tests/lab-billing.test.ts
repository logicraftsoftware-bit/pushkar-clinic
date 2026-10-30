import assert from "node:assert/strict";
import { test } from "node:test";
import { labBillingTotals,labPharmacyBilling } from "../src/lab-billing.js";

test("lab billing rounds decimals and calculates partial payment after discount", () => {
  assert.deepEqual(labBillingTotals([121,198.24,198.24],17.48,200), {subtotal:517.48,discount:17.48,paid:200,total:500,due:300,status:"Partially Paid"});
  assert.equal(labBillingTotals([0.1,0.2],0,0.3).status,"Paid");
});
test("lab billing supports unpaid and fully discounted bills", () => {
  assert.equal(labBillingTotals([100],0,0).status,"Unpaid");
  assert.equal(labBillingTotals([100],100,0).status,"Paid");
});
test("lab billing rejects overpayments, excessive discounts and invalid prices", () => {
  for (const args of [[[100],101,0],[[100],10,91],[[NaN],0,0],[[-1],0,0],[[100],0,-1]] as [number[],number,number][]) assert.throws(()=>labBillingTotals(...args));
});

test('pharmacy discount is calculated after the additional discount, rounded once, and included in net due',()=>{
  assert.deepEqual(labPharmacyBilling([1000],0,200,50),{subtotal:1000,discount:500,paid:200,total:500,due:300,status:'Partially Paid',manual_discount_amount:0,pharmacy_discount_percentage:50,pharmacy_discount_amount:500});
  const combined=labPharmacyBilling([1000],100,0,50);
  assert.equal(combined.pharmacy_discount_amount,450);assert.equal(combined.discount,550);assert.equal(combined.total,450);
  assert.equal(labPharmacyBilling([99.99],0,0,33.33).pharmacy_discount_amount,33.33);
  assert.equal(labPharmacyBilling([100],0,0,100).status,'Paid');
  for(const percentage of [-1,101,NaN])assert.throws(()=>labPharmacyBilling([100],0,0,percentage));
  assert.throws(()=>labPharmacyBilling([100],0,51,50));
});
