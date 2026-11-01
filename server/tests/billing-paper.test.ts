import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {jsPDF} from 'jspdf';
import {createInvoicePdf,createPaymentReceiptPdf} from '../../src/hospital/invoice-pdf.js';
import {createLabBillingPdf} from '../../src/hospital/lab-billing-pdf.js';
import {opdDocumentHtml} from '../../src/hospital/OpdDocuments.js';

function checkPages(pdf:jsPDF) {
  for(let page=1;page<=pdf.getNumberOfPages();page++) {
    pdf.setPage(page);
    assert.ok(Math.abs(pdf.internal.pageSize.getWidth()-210)<0.1);
    assert.ok(Math.abs(pdf.internal.pageSize.getHeight()-148)<0.1);
    // PDF text uses bottom-left coordinates in points. No text may fall off a half sheet.
    const content=(pdf.internal as any).pages[page].join('\n');
    for(const match of content.matchAll(/(-?[\d.]+) (-?[\d.]+) Td/g)) {
      assert.ok(Number(match[1])>=0 && Number(match[1])<=596,`text outside page width: ${match[0]}`);
      assert.ok(Number(match[2])>=0 && Number(match[2])<=420,`text outside page height: ${match[0]}`);
    }
  }
}
const text=(pdf:jsPDF)=>Array.from({length:pdf.getNumberOfPages()},(_,i)=>(pdf.internal as any).pages[i+1].join('\n')).join('\n');
const invoice={hospital_name:'Medicity',record_number:'INV-100',patient_name:'Test Patient',medical_record_number:'UHID-100',record_date:'2026-10-26',total:3000,paid:1000,due:2000,data:{consultation_fee:3000}};
test('patient invoices and payment receipts use half-A4 paper and retain totals',()=>{
  const bill=createInvoicePdf(invoice),receipt=createPaymentReceiptPdf({record_number:'REC-100',amount:1000,data:{payment_method:'Cash'}},invoice);
  for(const pdf of [bill,receipt])checkPages(pdf);
  assert.match(text(bill),/Rs. 3000.00/);assert.match(text(bill),/Rs. 2000.00/);assert.match(text(receipt),/Rs. 1000.00/);
});
test('long patient bills paginate on half sheets without losing the last charge or summary',()=>{
  const pdf=createInvoicePdf({...invoice,data:{admission_charges:Array.from({length:60},(_,i)=>({label:`Charge ${i+1}`,amount:50}))}});
  assert.ok(pdf.getNumberOfPages()>1);checkPages(pdf);
  assert.match(text(pdf),/Charge 60/);assert.match(text(pdf),/Net Payable/);
});
test('laboratory customer and pharmacy invoices and payment receipts use half sheets',async()=>{
  const bill={...invoice,amount:3000,tests:[{name:'Blood Test',amount:3000}],pathology_footer_content:'Clinic billing footer'};
  for(const pdf of [await createLabBillingPdf(bill),await createLabBillingPdf(bill,undefined,'pharmacy'),await createLabBillingPdf(bill,{record_number:'REC-100',amount:1000,data:{payment_mode:'Cash'}})]) {
    checkPages(pdf);assert.match(text(pdf),/Clinic billing footer/);
  }
  const long=await createLabBillingPdf({...bill,tests:Array.from({length:60},(_,i)=>({name:`Test ${i+1}`,amount:50}))});
  assert.ok(long.getNumberOfPages()>1);checkPages(long);assert.match(text(long),/Test 60/);assert.match(text(long),/Balance due/);
});
test('OPD bills and consultation receipts select half-A4 while prescriptions retain their paper',()=>{
  for(const kind of ['bill','consultation'] as const) {
    const html=opdDocumentHtml(invoice,{},kind);
    assert.match(html.slice(html.lastIndexOf('@page')),kind === 'bill' ? /size:A5 portrait/ : /size:A5 landscape/);
  }
  const prescription=opdDocumentHtml(invoice,{},'prescription');
  assert.match(prescription,/size:A4 portrait/);assert.doesNotMatch(prescription,/size:A5/);
});
