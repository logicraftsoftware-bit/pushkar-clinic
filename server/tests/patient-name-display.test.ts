import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import express from 'express';
import {readFileSync} from 'node:fs';
import {jsPDF} from 'jspdf';
import {displayPatientNames,patientName} from '../src/patient-name-display.js';
import {patientNameResponse} from '../src/patient-name-response.js';
import {createLabReportPdf} from '../../src/hospital/lab-report-pdf.js';
import {createInvoicePdf,createPaymentReceiptPdf} from '../../src/hospital/invoice-pdf.js';
import {laboratoryWorksheetHtml} from '../../src/hospital/lab-worksheet.js';
import {opdDocumentHtml} from '../../src/hospital/OpdDocuments.js';

test('patient names are uppercase across records, lookups, nested snapshots and patient login without mutating saved data',()=>{
  const source={patients:[{name:'Anita Das',first_name:'Anita',last_name:'Das'}],patient:{first_name:'Rina',last_name:'Devi'},orders:[{patient_name:'Anita Das',title:'Lab Order - Anita Das',doctor_name:'Dr. Sharma',data:{customer_name:'Rina Devi',notes:'Mixed case clinical findings'}}],user:{role:'patient',name:'Rina Devi'},staff:[{name:'Dr. Sharma',first_name:'Ajay',last_name:'Sharma'}],queue:[{medical_record_number:'UHID-1',name:'Anita Das'}]};
  const original=structuredClone(source),view=displayPatientNames(source);
  assert.equal(view.patients[0].name,'ANITA DAS');assert.equal(view.patient.first_name,'RINA');
  assert.equal(view.orders[0].patient_name,'ANITA DAS');assert.equal(view.orders[0].title,'Lab Order - ANITA DAS');
  assert.equal(view.orders[0].data.customer_name,'RINA DEVI');assert.equal(view.user.name,'RINA DEVI');
  assert.equal(view.queue[0].name,'ANITA DAS');assert.deepEqual(view.staff,source.staff);
  assert.equal(view.orders[0].doctor_name,'Dr. Sharma');assert.equal(view.orders[0].data.notes,source.orders[0].data.notes);
  assert.deepEqual(source,original);assert.equal(patientName('Élise Das'),'ÉLISE DAS');assert.equal(patientName(null),'');
  const worksheet=laboratoryWorksheetHtml({patient_name:'Anita Das',title:'Lab Order - Anita Das',tests:[]});
  assert.ok(worksheet.includes('ANITA DAS'));assert.ok(!worksheet.includes('Anita Das'));
  for(const kind of ['consultation','bill','prescription'] as const){
    const html=opdDocumentHtml({patient_name:'Anita Das',doctor_name:'Dr. Sharma'}, {}, kind);
    assert.ok(html.includes('ANITA DAS'));assert.ok(!html.includes('Anita Das'));assert.ok(html.includes('Dr. Sharma'));
  }
});

const app=express();app.use(patientNameResponse);
app.get('/view',(_req,res)=>res.json({patient_name:'Anita Das',doctor_name:'Dr. Sharma',patient:{first_name:'Anita',last_name:'Das'}}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
test('the shared API response sends uppercase patient names for views and HTML printing',async()=>{
  const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/view`);
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.patient_name,'ANITA DAS');assert.equal(body.patient.last_name,'DAS');assert.equal(body.doctor_name,'Dr. Sharma');
});
after(()=>{server.close();});

test('lab, invoice and payment PDFs uppercase patient names even with an unformatted source record',async()=>{
  const record={patient_name:'Anita Das',data:{doctor_approval:{test_ids:['cbc'],name:'Dr. Sharma'}}};
  const tests=[{test_id:'cbc',name:'CBC',parameters:[{name:'Count',value:'5000',result_type_id:'1'}]}];
  const fonts={regular:readFileSync(new URL('../../public/fonts/NotoSans-Regular.ttf',import.meta.url)).toString('base64'),bold:readFileSync(new URL('../../public/fonts/NotoSans-Bold.ttf',import.meta.url)).toString('base64')};
  const calls:string[]=[];const hook:any=['postProcessText',(args:any)=>calls.push(JSON.stringify(args.text))];jsPDF.API.events.push(hook);
  try{
    await createLabReportPdf(record,tests,fonts);
    assert.ok(calls.some(value=>value.includes('ANITA DAS')));assert.ok(!calls.some(value=>value.includes('Anita Das')));
    calls.length=0;createInvoicePdf({...record,record_number:'INV-1',total:100,paid:100,data:{items:[]}});
    assert.ok(calls.some(value=>value.includes('ANITA DAS')));
    calls.length=0;createPaymentReceiptPdf({record_number:'PAY-1',amount:100},record);
    assert.ok(calls.some(value=>value.includes('ANITA DAS')));
    assert.equal(record.patient_name,'Anita Das');
  }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
});
