import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountingEncounterGroup,accountingRecord,accountingReportRows,accountingTotals,accountingPaymentSummary,filterAccounting,type AccountingFilters} from '../../src/hospital/accounting-model.js';
import {accountingPrintDocument,accountingWorkbook} from '../../src/hospital/accounting-export.js';
const filters:AccountingFilters={from:'2026-01-01',to:'2026-10-09',department:'',user:'',encounter:'',status:'',entryType:'',paymentMethod:'',query:''};
const row=(values:Record<string,any>)=>accountingRecord({id:'one',record_date:'2026-10-09',data:{},...values});

test('patient phone is available below the name and supports Accounting search',()=>{
  const receipt=row({kind:'payments',amount:500,patient_phone:' 9876543210 ',data:{phone:'9000000000'}});
  assert.equal(receipt.patientPhone,'9876543210');
  assert.equal(filterAccounting([receipt],{...filters,query:'987654'}).length,1);
  assert.equal(row({data:{phone:'9123456780'}}).patientPhone,'9123456780');
  assert.equal(row({}).patientPhone,'');
});

test('Laboratory and Radiology share the encounter option, report rows, refunds and balances',()=>{
  const rows=[row({id:'lab',kind:'payments',amount:100,data:{source:'Laboratory'}}),row({id:'radio',kind:'payments',amount:200,data:{source:'Radiology'}}),row({id:'refund',kind:'refunds',amount:20,data:{source:'Radiology'}}),row({id:'due',kind:'invoices',due:50,data:{source:'Laboratory'}}),row({id:'opd',kind:'payments',amount:999,data:{source:'OPD'}})];
  const selected=filterAccounting(rows,{...filters,encounter:'Laboratory & Radiology'});
  assert.equal(selected.length,4);
  assert.deepEqual(accountingTotals(selected).receipts,{count:2,total:300});
  assert.equal(accountingTotals(selected).refunds.total,20);assert.equal(accountingTotals(selected).balance.total,50);
  assert.deepEqual([...new Set(rows.map(row=>accountingEncounterGroup(row.encounter)))],['Laboratory & Radiology','OPD']);
  assert.equal(accountingPaymentSummary(selected).net,280);
});

test('OPD fee columns use this appointment breakdown and never re-add previous registration to receipts',()=>{
  const receipt=row({kind:'payments',amount:800,accounting_encounter:'OPD',accounting_opd_amount:600,accounting_appointment_charges:[{label:'Registration Fee',amount:100},{name:'Maintenance Fee',amount:100}],data:{appointment_id:'appointment'}});
  assert.equal(receipt.opdAmount,600);assert.equal(receipt.registrationAmount,100);assert.equal(receipt.maintenanceAmount,100);
  assert.equal(accountingTotals([receipt]).receipts.total,800);
  const followUp=row({kind:'payments',amount:600,accounting_encounter:'OPD',accounting_opd_amount:600,registration_fee_amount:100,maintenance_fee:100});
  assert.equal(followUp.registrationAmount,0);assert.equal(followUp.maintenanceAmount,0);
  const saved=row({kind:'payments',amount:900,accounting_encounter:'OPD',data:{consultation_fee:700,registration_fee:100,maintenance_fee:100}});
  assert.deepEqual([saved.opdAmount,saved.registrationAmount,saved.maintenanceAmount],[700,100,100]);
});

test('pharmacy discounts inherit onto receipts but are counted once on the invoice',()=>{
  const data={source:'Laboratory',lab_order_id:'lab',tests:[{amount:1000}],refer_pharmacy_name:'Town Pharmacy',refer_pharmacy_id:'p',pharmacy_discount_percentage:50,pharmacy_discount_amount:500,discount_amount:500};
  const invoice=row({id:'bill',kind:'invoices',amount:1000,total:500,paid:300,due:200,data});
  const payment=row({id:'payment',kind:'payments',amount:300,invoice_data:data,data:{invoice_total:500}});
  assert.equal(payment.referPharmacy,'Town Pharmacy');assert.equal(payment.pharmacyDiscount,500);assert.equal(payment.pharmacyDiscountPercentage,50);assert.equal(payment.grossBill,1000);assert.equal(payment.netBill,500);
  assert.deepEqual(accountingTotals([invoice,payment]).discounts,{count:1,total:500});
  assert.deepEqual(accountingTotals([invoice,payment]).receipts,{count:1,total:300});
  assert.deepEqual(accountingTotals([invoice,payment]).balance,{count:1,total:200});
});
test('branch and multiple OPD doctors filter receipts and refunds together',()=>{
  const rows=[row({kind:'payments',amount:100,branch_id:'hat',accounting_encounter:'OPD',accounting_doctor_id:'d1'}),row({kind:'payments',amount:200,branch_id:'hat',accounting_encounter:'OPD',accounting_doctor_id:'d2'}),row({kind:'payments',amount:300,branch_id:'main',accounting_encounter:'OPD',accounting_doctor_id:'d1'}),row({kind:'refunds',amount:20,branch_id:'hat',accounting_encounter:'OPD',accounting_doctor_id:'d2'})];
  const selected=filterAccounting(rows,{...filters,branch:'hat',encounter:'OPD',doctors:['d1','d2']});assert.equal(selected.length,3);assert.equal(accountingPaymentSummary(selected).net,280);assert.equal(filterAccounting(rows,{...filters,branch:'hat',encounter:'OPD',doctors:['d1']}).length,1);
});
test('cash, card, UPI and total net amounts do not double-count invoices or subtract card refunds from cash',()=>{
  const rows=[row({kind:'payments',amount:100.1,data:{payment_method:'Cash'}}),row({kind:'payments',amount:20.2,data:{payment_method:'Debit Card'}}),row({kind:'payments',amount:30.3,data:{payment_method:'UPI'}}),row({kind:'payments',amount:40,data:{payment_method:'Bank Transfer'}}),row({kind:'refunds',amount:10,data:{payment_method:'Cash'}}),row({kind:'refunds',amount:5,data:{payment_method:'Card'}}),row({kind:'invoices',total:99999})];
  assert.deepEqual(accountingPaymentSummary(rows),{cash:100.1,card:20.2,upi:30.3,other:40,received:190.6,refunded:15,net:175.6,netCash:90.1});
  assert.equal(accountingPaymentSummary(filterAccounting(rows,{...filters,paymentMethod:'Cash'})).received,100.1);
  assert.deepEqual(accountingPaymentSummary([]),{cash:0,card:0,upi:0,other:0,received:0,refunded:0,net:0,netCash:0});
});
test('receipts and pending balances use payment and invoice amounts without counting invoices as cash',()=>{
  const rows=[row({kind:'invoices',total:1000,paid:700,due:300,data:{discount_amount:100}}),row({id:'pay',kind:'payments',amount:700,invoice_data:{discount_amount:100}}),row({id:'refund',kind:'refunds',amount:50})];
  const totals=accountingTotals(rows);
  assert.deepEqual(totals.receipts,{count:1,total:700});assert.deepEqual(totals.discounts,{count:1,total:100});assert.deepEqual(totals.refunds,{count:1,total:50});assert.deepEqual(totals.balance,{count:1,total:300});
});
test('linked laboratory receipts inherit the bill department, referral and patient context',()=>{
  const payment=row({kind:'payments',amount:500,invoice_number:'LAB-001',invoice_data:{source:'Laboratory',lab_order_id:'lab',payment_method:'Cash'},accounting_lab_data:{referred_by_name:'Dr Example'},patient_name:'Example Patient'});
  assert.equal(payment.encounter,'Laboratory');assert.equal(payment.department,'Laboratory');assert.equal(payment.doctor,'Dr Example');assert.equal(payment.bill,'LAB-001');assert.equal(payment.method,'Cash');
});

test('lab invoices, payments and refunds linked to OPD remain Laboratory in filters and reports',()=>{
  const invoiceData={source:'Laboratory',lab_order_id:'lab',appointment_id:'opd'};
  const rows=[
    row({id:'bill',kind:'invoices',total:1000,due:500,accounting_encounter:'OPD',data:invoiceData}),
    row({id:'payment',kind:'payments',amount:500,accounting_encounter:'OPD',invoice_data:invoiceData,data:{source:'OPD',appointment_id:'opd'}}),
    row({id:'refund',kind:'refunds',amount:100,accounting_encounter:'OPD',invoice_data:invoiceData}),
  ];
  assert.deepEqual(rows.map(record=>record.encounter),['Laboratory','Laboratory','Laboratory']);
  assert.equal(filterAccounting(rows,{...filters,encounter:'OPD'}).length,0);
  const laboratory=filterAccounting(rows,{...filters,encounter:'Laboratory'});
  assert.equal(laboratory.length,3);
  assert.equal(accountingTotals(laboratory).receipts.total,500);
  assert.equal(accountingTotals(laboratory).refunds.total,100);
});
test('inclusive end-date filtering works for timestamp records and all dropdown filters combine',()=>{
  const rows=[row({kind:'payments',record_date:'2026-10-09T00:00:00.000Z',created_by:'u',created_by_name:'Cashier',accounting_encounter:'OPD',accounting_department_name:'Medicine',status:'Paid',patient_name:'Ajites Das',record_number:'OPD-1'}),row({kind:'payments',record_date:'2026-10-10'})];
  assert.equal(filterAccounting(rows,{...filters,department:'Medicine',user:'u',encounter:'OPD',status:'Paid',entryType:'Medical',query:'ajites'}).length,1);
  assert.equal(filterAccounting(rows,{...filters,department:'Surgery'}).length,0);
});
test('balance collections exclude initial receipts and include later installments',()=>{
  const rows=[row({kind:'payments',amount:100,invoice_record_date:'2026-10-09'}),row({id:'later',kind:'payments',amount:200,invoice_record_date:'2026-10-09',accounting_is_balance_payment:true})];
  assert.deepEqual(accountingTotals(rows)['balance-received'],{count:1,total:200});
});
test('payment-method filtering normalizes saved values and applies to amounts and reports',()=>{
  const rows=[row({kind:'payments',amount:100,data:{payment_method:' cash '}}),row({id:'upi',kind:'payments',amount:200,data:{payment_mode:'upi'}}),row({id:'unknown',kind:'payments',amount:50})];
  assert.deepEqual(rows.map(record=>record.method),['Cash','UPI','Unspecified']);
  assert.equal(accountingTotals(filterAccounting(rows,{...filters,paymentMethod:'Cash'})).receipts.total,100);
  assert.equal(accountingReportRows(filterAccounting(rows,{...filters,paymentMethod:'UPI'}),'receipts').length,1);
  assert.equal(filterAccounting(rows,{...filters,paymentMethod:'Card'}).length,0);
});
test('OPD discounts without invoices count once per appointment, even with multiple receipts',()=>{
  const rows=[row({kind:'payments',data:{appointment_id:'appt'},accounting_appointment_discount:50}),row({id:'next',kind:'payments',data:{appointment_id:'appt'},accounting_appointment_discount:50})];
  assert.deepEqual(accountingTotals(rows).discounts,{count:1,total:50});
  rows.push(row({id:'invoice',kind:'invoices',data:{appointment_id:'appt',discount:50}}));
  assert.deepEqual(accountingTotals(rows).discounts,{count:1,total:50});
});
test('receipt totals retain paise, and pharmacy entries can be selected independently',()=>{
  const rows=[row({kind:'payments',amount:0.1}),row({id:'two',kind:'payments',amount:0.2}),row({id:'pharmacy',kind:'payments',amount:50,invoice_data:{source:'Pharmacy'}})];
  assert.equal(accountingTotals(rows).receipts.total,50.3);
  assert.equal(filterAccounting(rows,{...filters,entryType:'Pharmacy'}).length,1);
  assert.equal(accountingReportRows(rows,'refunds').length,0);
});
test('Excel export creates an actual XLSX archive, preserves numbers and escapes user content as text',()=>{
  const file=accountingWorkbook(['Patient','Amount'],[['<Patient & Co>',500],['=HYPERLINK("unsafe")',12.5]]);
  assert.equal(new DataView(file.buffer).getUint32(0,true),0x04034b50);
  const content=new TextDecoder().decode(file);
  assert.match(content,/xl\/worksheets\/sheet1.xml/);assert.match(content,/&lt;Patient &amp; Co&gt;/);assert.match(content,/<v>12.5<\/v>/);assert.match(content,/t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);assert.doesNotMatch(content,/<f>/);
});
test('the isolated print report includes every supplied row and escapes patient-entered HTML',()=>{
  const rows=Array.from({length:18},(_,index)=>[`Patient ${index}`,index]);
  rows[0]![0]='<img src=x onerror=alert(1)>';
  const html=accountingPrintDocument('Receipt & Report','Cash only',['Patient','Amount'],rows);
  assert.equal((html.match(/<tr>/g)||[]).length,19);
  assert.match(html,/Receipt &amp; Report/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/Patient 17/);
});
import {accountingColumnTotals} from '../../src/hospital/accounting-model';

test('payment block column totals keep each fee separate and round currency in cents',()=>{
  const rows=[{method:'Cash',opdAmount:500.1,registrationAmount:100.2,maintenanceAmount:20.1,reportAmount:620.4},{method:'Cash',opdAmount:600.2,registrationAmount:200.1,maintenanceAmount:30.2,reportAmount:830.5},{method:'Card',opdAmount:1000,registrationAmount:200,maintenanceAmount:100,reportAmount:1300}];
  assert.deepEqual(accountingColumnTotals(rows.filter(row=>row.method==='Cash')),{opdAmount:1100.3,registrationAmount:300.3,maintenanceAmount:50.3,reportAmount:1450.9});
  assert.deepEqual(accountingColumnTotals(rows.filter(row=>row.method==='Card')),{opdAmount:1000,registrationAmount:200,maintenanceAmount:100,reportAmount:1300});
  assert.deepEqual(accountingColumnTotals([]),{opdAmount:0,registrationAmount:0,maintenanceAmount:0,reportAmount:0});
});

test('lab referring doctor names saved in referred_by appear on invoices and receipts',()=>{
 const lab={referred_by:'DR. JYOTIRMOY DAS',referred_by_id:'doctor-jyotirmoy',source:'Social Media'};
 for(const kind of ['invoices','payments','refunds']){
  const record=row({kind,record_number:'LAB-20261029-8ECA3898',accounting_lab_data:lab,invoice_data:{lab_order_id:'order',source:'Laboratory',referred_by:'Self'},data:{source:'Laboratory',lab_order_id:'order'}});
  assert.equal(record.doctor,'DR. JYOTIRMOY DAS');assert.equal(record.doctorId,'doctor-jyotirmoy');
  assert.equal(filterAccounting([record],{...filters,query:'jyotirmoy'}).length,1);
 }
});
test('lab invoice referral names are used when a linked order is unavailable',()=>{
 assert.equal(row({kind:'payments',invoice_data:{source:'Laboratory',referred_by:'DR. EXAMPLE'},data:{source:'Laboratory'}}).doctor,'DR. EXAMPLE');
 assert.equal(row({kind:'invoices',data:{source:'Laboratory',referred_by:'DR. EXAMPLE'}}).doctor,'DR. EXAMPLE');
 for(const key of ['referred_by_name','referring_doctor_name','doctor_name'])assert.equal(row({data:{source:'Laboratory',[key]:'DR. LEGACY'}}).doctor,'DR. LEGACY');
});
test('an explicitly self-referred lab order overrides stale invoice and appointment doctors',()=>{
 const record=row({accounting_lab_data:{referred_by:'Self'},accounting_doctor_name:'Appointment Doctor',invoice_data:{source:'Laboratory',referred_by:'Old Doctor'},data:{lab_order_id:'order'}});
 assert.equal(record.doctor,'Self');
});
test('referral identifiers and missing values are not displayed as doctor names',()=>{
 const uuid='00000000-0000-4000-8000-000000000001';
 assert.equal(row({data:{source:'Laboratory',referred_by:uuid}}).doctor,'—');
 assert.equal(row({data:{source:'Laboratory',referred_by:'12345',referred_by_name:'DR. LEGACY'}}).doctor,'DR. LEGACY');
 assert.equal(row({data:{source:'Laboratory',referred_by:'   '}}).doctor,'—');
});
test('OPD continues to use the appointment consultant rather than a referral snapshot',()=>{
 assert.equal(row({accounting_doctor_name:'Dr Consultant',data:{source:'OPD',referred_by:'Dr Referrer'}}).doctor,'Dr Consultant');
});

test('new OPD doctor fee snapshots drive accounting columns without legacy registration defaults',()=>{
 const snapshot=[{label:'Registration Fee',amount:200,doctor_fee:'registration_fee',fee_snapshot_version:2},{label:'Maintenance Fee',amount:100,doctor_fee:'maintenance_fee',fee_snapshot_version:2}];
 const selected=row({kind:'payments',accounting_encounter:'OPD',accounting_appointment_charges:snapshot,data:{registration_fee:0,maintenance_fee:999}});
 assert.equal(selected.registrationAmount,200);assert.equal(selected.maintenanceAmount,100);
 const onlyMaintenance=row({kind:'payments',accounting_encounter:'OPD',accounting_appointment_charges:[snapshot[1]],data:{registration_fee:999,maintenance_fee:0}});
 assert.equal(onlyMaintenance.registrationAmount,0);assert.equal(onlyMaintenance.maintenanceAmount,100);
 const legacy=row({kind:'payments',accounting_encounter:'OPD',accounting_appointment_charges:[{label:'Registration Fee',amount:50}],data:{registration_fee:75}});assert.equal(legacy.registrationAmount,75,'previous accounting behavior retained for old records');
});

test('transaction times display in IST with AM/PM without inventing missing or legacy times',()=>{
  assert.equal(row({created_at:'2026-10-29T04:30:00Z'}).transactionTime,'10:00 AM');
  assert.equal(row({created_at:'2026-10-29T16:30:00Z'}).transactionTime,'10:00 PM');
  assert.equal(row({created_at:'2026-10-29T23:00:00Z'}).transactionTime,'04:30 AM');
  for(const created_at of [undefined,'invalid','2026-10-29'])assert.equal(row({created_at}).transactionTime,'');
  assert.equal(row({created_at:'2026-10-29T04:30:00Z',data:{legacy_receipt:true,date_basis:'appointment_date'}}).transactionTime,'');
});
