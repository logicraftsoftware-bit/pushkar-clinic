import {test} from "node:test";
import assert from "node:assert/strict";
import {labPaymentHistory} from "../src/lab-payment-history.js";
import {createLabBillingPdf} from "../../src/hospital/lab-billing-pdf";
const payments=[100,200,300].map((amount,index)=>({id:`payment-${index}`,record_number:`Receipt-${index+1}`,record_date:`2026-10-0${index+1}`,amount,data:{payment_mode:"Cash",balance_after:600-[100,300,600][index]}}));
const bill={record_number:"Invoice-1",patient_name:"Test Patient",medical_record_number:"TEST-001",record_date:"2026-10-01",amount:600,total:600,paid:600,due:0,data:{},tests:[{name:"Test One",amount:600}],payments};
test("all three payments keep their original receipt references and amounts",()=>{
  assert.deepEqual(labPaymentHistory(payments),payments);
  const rows=labPaymentHistory(payments,[{pay_id:"old-1",amount:"50",payment_mode:"UPI",date:"2026-09-30",balance_amount:"550"},{pay_id:"zero",amount:"0"}]);
  assert.equal(rows.length,4);assert.equal(rows[0].amount,50);assert.equal(rows[0].data.balance_after,550);
});
test("each payment PDF includes only that transaction's received amount",async()=>{
  for(const payment of payments){const pdf=await createLabBillingPdf(bill,payment),table=(pdf as any).lastAutoTable;const rows=table.body.map((row:any)=>Object.values(row.cells).map((cell:any)=>cell.raw));
    assert.ok(rows.some((row:any[])=>row[0]==="Receipt number"&&row[1]===payment.record_number));
    assert.ok(rows.some((row:any[])=>row[0]==="Amount received in this payment"&&row[1]===`INR ${payment.amount.toFixed(2)}`));
    assert.equal(pdf.getNumberOfPages(),1);
  }
});
test("full invoice PDF includes all three individual payments",async()=>{
  const pdf=await createLabBillingPdf(bill),table=(pdf as any).lastAutoTable;
  assert.equal(table.body.length,3);
  assert.deepEqual(table.body.map((row:any)=>row.cells[0].raw),payments.map(row=>row.record_number));
});
test("missing initial payment is recovered from the original invoice without duplicating an existing receipt",()=>{
  const original={id:"bill",record_number:"Invoice",created_at:"2026-10-01",paid:300,data:{paid_amount:100,due_amount:500,payment_updated_at:"2026-10-02",payment_mode:"UPI"}};
  const later=[{id:"second",amount:200,data:{previous_paid:100,payment_mode:"UPI"}}];
  const history=labPaymentHistory(later,[],original);
  assert.equal(history.length,2);assert.equal(history[0].amount,100);assert.equal(history[0].record_date,"2026-10-01");assert.equal(history[0].data.initial_payment,true);
  assert.equal(history[0].data.payment_mode,undefined);
  const already=[{id:"first",amount:100,data:{previous_paid:0}},...later];
  assert.deepEqual(labPaymentHistory(already,[],original),already);
  assert.equal(labPaymentHistory(later,[],{...original,paid:200}).length,1);
  assert.equal(labPaymentHistory(later,[],{...original,data:{...original.data,read_only:true}}).length,1);
});
