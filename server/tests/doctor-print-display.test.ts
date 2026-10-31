import assert from 'node:assert/strict';
import {test} from 'node:test';
import {doctorWithQualification,addPrintDoctorDetails} from '../src/doctor-print-display.js';
import {opdDocumentHtml} from '../../src/hospital/OpdDocuments.js';
import {labBillingPrintHtml} from '../../src/hospital/lab-billing-print.js';
const doctors=[{id:'staff-gyne',user_id:'user-gyne',name:'DR. JYOTIRMOY DAS',department_id:'gyne',professional:{doctor_qualification:'MD (Obs & Gyne)'}},{id:'staff-psych',user_id:'user-psych',name:'DR. JYOTIRMOY DAS',department_id:'psych',professional:{doctor_qualification:'MD (Psychiatry)'}}];
test('doctor print names use parentheses once, omit unavailable qualifications and preserve Self',()=>{
 assert.equal(doctorWithQualification('Dr Example','MBBS, MD'),'Dr Example (MBBS, MD)');
 assert.equal(doctorWithQualification('Dr Example (MD)','MD'),'Dr Example (MD)');
 for(const q of ['',undefined,'Not specified','N/A'])assert.equal(doctorWithQualification('Dr Example',q),'Dr Example');
 assert.equal(doctorWithQualification('Self','MBBS'),'Self');
});
test('saved appointments and laboratory referrals resolve qualifications using doctor identity without modifying bill data',()=>{
 const source={doctor_id:'user-gyne',doctor_name:'DR. JYOTIRMOY DAS',total:600,data:{referred_by_id:'staff-psych',referred_by:'DR. JYOTIRMOY DAS'}};
 const before=JSON.stringify(source),row=addPrintDoctorDetails(source,doctors);
 assert.equal(row.doctor_qualification,'MD (Obs & Gyne)');assert.equal(row.referred_by_qualification,'MD (Psychiatry)');assert.equal(row.total,600);assert.equal(JSON.stringify(source),before);
 assert.equal(addPrintDoctorDetails({data:{referred_by:'DR. JYOTIRMOY DAS'}},doctors).referred_by_qualification,'');
 assert.equal(addPrintDoctorDetails({data:{referred_by:'Self',referred_by_id:'user-gyne'}},doctors).referred_by_qualification,'');
 assert.equal(addPrintDoctorDetails({data:{referred_by:'Self'},accounting_lab_data:{referred_by:'DR. JYOTIRMOY DAS',referred_by_id:'user-gyne'}},doctors).referred_by_qualification,'MD (Obs & Gyne)');
});
test('OPD prescription, bill and receipt print the escaped qualification after the doctor name',()=>{
 for(const kind of ['prescription','bill','consultation'] as const){const html=opdDocumentHtml({doctor_name:'Dr Example',doctor_qualification:'MD (Obs & Gyne)',consultation_fee:500},{},kind);assert.ok(html.includes('Dr Example (MD (Obs &amp; Gyne))'));assert.ok(!html.includes('Dr Example (MD (Obs & Gyne))'));}
});
test('laboratory invoice and payment receipt include the referring qualification and preserve totals',()=>{
 const bill={record_number:'LAB-TEST',referred_by_name:'Dr Example',referred_by_qualification:'MBBS, MD',amount:500,total:500,paid:200,due:300,data:{}};
 for(const payment of [undefined,{record_number:'PAY-TEST',amount:200,data:{balance_after:300}}]){const html=labBillingPrintHtml(bill,payment);assert.ok(html.includes('Dr Example (MBBS, MD)'));assert.ok(html.includes('INR 300.00'));}
});
import {readFileSync} from 'node:fs';
import {jsPDF} from '../../src/hospital/pdf-engine.js';
import {createLabReportPdf} from '../../src/hospital/lab-report-pdf.js';
import {createLabBillingPdf} from '../../src/hospital/lab-billing-pdf.js';
test('generated laboratory PDFs include referring and signing doctor qualifications in brackets',async()=>{
 const texts:string[]=[],hook:any=['postProcessText',(args:any)=>texts.push(JSON.stringify(args.text))];jsPDF.API.events.push(hook);
 try{
  const fonts={regular:readFileSync(new URL('../../public/fonts/NotoSans-Regular.ttf',import.meta.url)).toString('base64'),bold:readFileSync(new URL('../../public/fonts/NotoSans-Bold.ttf',import.meta.url)).toString('base64')};
  await createLabReportPdf({referred_by_name:'Dr Referrer',referred_by_qualification:'MBBS',data:{doctor_approval:{test_ids:['cbc'],name:'Dr Signer'}},report_signatories:[{id:'signer',name:'Dr Signer',qualification:'MD',approved:true}]},[{test_id:'cbc',name:'CBC',parameters:[{name:'Count',value:'10'}]}],fonts);
  assert.ok(texts.some(text=>text.includes('Dr Referrer (MBBS)')));assert.ok(texts.some(text=>text.includes('Dr Signer (MD)')));
  texts.length=0;
  await createLabBillingPdf({record_number:'LAB-TEST',referred_by_name:'Dr Referrer',referred_by_qualification:'MBBS',amount:500,total:500,paid:200,due:300,tests:[],data:{}});
  assert.ok(texts.some(text=>text.includes('Dr Referrer (MBBS)')));
 }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
});
