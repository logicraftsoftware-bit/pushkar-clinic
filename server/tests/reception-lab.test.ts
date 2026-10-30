import {test} from "node:test";
import assert from "node:assert/strict";
import {receptionReportAllowed,labCollectionTotals} from "../src/reception-lab.js";
test("reception report requires both full payment and doctor approval",()=>{
  const bill={total:100,paid:100,due:0,status:"Paid"};
  assert.equal(receptionReportAllowed(bill,{by:"doctor"}),true);
  assert.equal(receptionReportAllowed(bill,null),false);
  assert.equal(receptionReportAllowed({...bill,paid:50,due:50,status:"Partially Paid"},{by:"doctor"}),false);
  assert.equal(receptionReportAllowed(null,{by:"doctor"}),false);
  assert.equal(receptionReportAllowed({...bill,paid:0},{by:"doctor"}),false);
  assert.equal(receptionReportAllowed(bill,"approved"),false);
  assert.equal(receptionReportAllowed({...bill,total:null},{by:"doctor"}),false);
});
test("partial collections add to earlier payments and unlock only on final payment",()=>{
  const first=labCollectionTotals(1000,100,200,300);
  assert.deepEqual(first,{total:900,paid:500,due:400,status:"Partially Paid"});
  assert.deepEqual(labCollectionTotals(1000,100,first.paid,400),{total:900,paid:900,due:0,status:"Paid"});
  assert.throws(()=>labCollectionTotals(1000,100,500,401),/remaining balance/);
  assert.throws(()=>labCollectionTotals(1000,100,500,0),/valid payment/);
  assert.throws(()=>labCollectionTotals(1000,100,500,0.001),/valid payment/);
});
