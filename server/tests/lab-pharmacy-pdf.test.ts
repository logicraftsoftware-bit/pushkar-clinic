import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLabBillingPdf,printLabBillingPdf} from '../../src/hospital/lab-billing-pdf.js';

test('a two-test paid laboratory invoice and its receipt each fit one page with patient and referral details',async()=>{
  // Raw base64 bypasses browser image optimisation while exercising PDF artwork placement.
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const payment={record_number:'LAB-PAY-EXAMPLE-RECEIPT',record_date:'2026-10-27',amount:3000,data:{payment_method:'Cash',balance_after:0}};
  const bill={record_number:'LAB-EXAMPLE',patient_name:'Example Patient',medical_record_number:'UHID-EXAMPLE',patient_phone:'9876543210',
    patient_address:{line:'12 Example Road',city:'Guwahati',state:'Assam',pincode:'781006',age_years:29},record_date:'2026-10-27',
    pathology_header_image:image,pathology_footer_content:'Hospital billing footer',
    tests:[{name:'PAP SMEAR',amount:2000},{name:'PAP SMEAR PROCEDURE CHARGE',amount:1000}],amount:3000,total:3000,paid:3000,due:0,
    data:{referred_by_name:'Dr Example Referral'},payments:[payment]};
  for(const receipt of [undefined,payment]){
    const pdf=await createLabBillingPdf(bill,receipt);
    assert.equal(pdf.getNumberOfPages(),1);
    const content=(pdf.internal as any).pages[1].join('\n');
    for(const value of ['9876543210','29 years','Dr Example Referral','12 Example Road','Guwahati','781006',payment.record_number,'INR 3000.00','Hospital billing footer'])assert.ok(content.includes(value),value);
  }
});
test('customer PDF hides pharmacy details and both copies keep identical payable totals',async()=>{
  const bill={record_number:'LAB-TEST',patient_name:'Patient',amount:1000,total:500,paid:200,due:300,tests:[{name:'Blood test',amount:1000}],data:{refer_pharmacy_name:'PRIVATE PHARMACY',refer_pharmacy_address:'PRIVATE ADDRESS',pharmacy_discount_percentage:50,pharmacy_discount_amount:500,manual_discount_amount:0,discount_amount:500}};
  function text(pdf:any){return Array.from({length:pdf.getNumberOfPages()},(_,i)=>pdf.internal.pages[i+1].join('\n')).join('\n');}
  const customer=text(await createLabBillingPdf(bill)),pharmacy=text(await createLabBillingPdf(bill,undefined,'pharmacy'));
  assert.doesNotMatch(customer,/PRIVATE PHARMACY|PRIVATE ADDRESS|Pharmacy discount|Refer pharmacy/);
  assert.match(pharmacy,/PRIVATE PHARMACY/);assert.match(pharmacy,/PRIVATE ADDRESS/);assert.match(pharmacy,/Pharmacy discount/);
  for(const copy of [customer,pharmacy]){assert.match(copy,/INR 500.00/);assert.match(copy,/INR 200.00/);assert.match(copy,/INR 300.00/);}
});

test('printing opens the preview before loading the complete bill and closes it if loading fails',async()=>{
  const previous=globalThis.window;
  const events:string[]=[];
  const popup={opener:{},document:{body:{textContent:''}},close(){events.push('close');}};
  globalThis.window={open(){events.push('open');return popup;}} as unknown as Window & typeof globalThis;
  try{
    await assert.rejects(printLabBillingPdf(async()=>{events.push('load');throw new Error('Bill unavailable');}),/Bill unavailable/);
    assert.deepEqual(events,['open','load','close']);
    assert.equal(popup.opener,null);
  }finally{globalThis.window=previous;}
});

test('receipt artwork, patient details and payment table share margins and currency is right aligned',async()=>{
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const pdf=await createLabBillingPdf({record_number:'LAB-20261029-5375566E',patient_name:'KAKUMONI SAIKIA',medical_record_number:'UHID-006458',patient_phone:'6002197399',age:49,patient_address:'Guwahati, Kamrup, Assam',pathology_header_image:image,data:{referred_by_name:'DR. JYOTIRMOY DAS'}},{record_number:'LAB-PAY-aeb89ce8-3e66-48ac-947c-39f9be8c107e',record_date:'2026-10-29',amount:6650.04,data:{payment_method:'UPI',balance_after:0}});
  assert.equal(pdf.getNumberOfPages(),1);
  const table=(pdf as any).lastAutoTable;
  assert.equal(table.body[0].cells[0].x,14);
  assert.equal(table.body[0].cells[1].x,78);
  assert.equal(table.body[3].cells[1].styles.halign,'right');
  assert.equal(table.body[4].cells[1].styles.halign,'right');
  assert.ok(table.finalY<122,'payment rows stay above the footer');
  const content=(pdf.internal as any).pages[1].join('\n');
  const matrix=content.match(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/I\d+ Do/);
  assert.ok(matrix,'header image is present');
  assert.ok(Math.abs(Number(matrix[3])/pdf.internal.scaleFactor-14)<.01,'letterhead aligns to left content margin');
  assert.equal((content.match(/Laboratory Payment Receipt/g)||[]).length,1);
  assert.match(content,/29\/10\/2026/);
});

test('long receipt values wrap within the page and invoice headings are drawn once per page',async()=>{
  const bill={record_number:'LAB-EXAMPLE',patient_name:'Example Patient',patient_address:'A long address with building and street details '.repeat(4),tests:Array.from({length:30},(_,index)=>({name:`Laboratory investigation ${index+1}`,amount:100})),amount:3000,total:3000,paid:3000,due:0,payments:[{record_number:'LAB-PAY-'+'a'.repeat(100),amount:3000,record_date:'2026-10-29',data:{payment_method:'Cash'}}]};
  const pdf=await createLabBillingPdf(bill);
  assert.ok(pdf.getNumberOfPages()>1);
  for(let page=1;page<=pdf.getNumberOfPages();page++){
    const content=(pdf.internal as any).pages[page].join('\n');
    assert.equal((content.match(/Laboratory Invoice/g)||[]).length,1,`single heading on page ${page}`);
  }
  const table=(pdf as any).lastAutoTable;
  assert.ok(table.body[0].cells[0].text.length>1,'long receipt ID wraps');
  assert.ok(table.finalY<122);
});
import {labBillingPrintHtml} from '../../src/hospital/lab-billing-print.js';

test('bill and receipt printing preserve the configured Pathology header and formatted footer',()=>{
  const bill={record_number:'LAB-EXAMPLE',patient_name:'Patient <Example>',pathology_header_image:'https://example.test/pathology-header.png',hospital_logo:'https://example.test/unrelated-logo.png',pathology_footer_content:'<table><tr><td><b>Pathology footer</b></td><td>Contact us</td></tr></table><img src="https://example.test/footer.png">',tests:[{name:'Blood test',amount:600}],total:600,paid:600,due:0};
  for(const payment of [undefined,{record_number:'LAB-PAY-EXAMPLE',record_date:'2026-10-29',amount:600,data:{payment_mode:'UPI',balance_after:0}}]){
    const html=labBillingPrintHtml(bill,payment);
    assert.ok(html.includes('src="https://example.test/pathology-header.png"'));
    assert.ok(html.includes(bill.pathology_footer_content),'footer HTML and images stay intact');
    assert.ok(!html.includes('unrelated-logo.png'));
    assert.match(html,/Patient &lt;Example&gt;/i);
    assert.match(html,/document.images/);
    assert.match(html,/document.fonts.ready/);
    assert.match(html,payment?/Laboratory Payment Receipt/:/Laboratory Invoice/);
  }
});

test('printing renders the latest loaded template instead of a flattened PDF footer',async()=>{
  const previous=globalThis.window,events:string[]=[];let output='';
  const popup={opener:{},document:{body:{textContent:''},open(){events.push('document.open');},write(html:string){output=html;},close(){events.push('document.close');}},close(){events.push('close');}};
  globalThis.window={open(){events.push('popup');return popup;}} as unknown as Window & typeof globalThis;
  try{
    await printLabBillingPdf(async()=>{events.push('load');return {record_number:'LAB-FRESH',pathology_header_image:'fresh-header.png',pathology_footer_content:'<b>Latest Pathology footer</b>'};});
    assert.deepEqual(events,['popup','load','document.open','document.close']);
    assert.match(output,/fresh-header.png/);assert.match(output,/<b>Latest Pathology footer<\/b>/);
  }finally{globalThis.window=previous;}
});
