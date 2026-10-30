import assert from "node:assert/strict";
import { test } from "node:test";
import { opdDocumentHtml } from "../../src/hospital/OpdDocuments.tsx";
import {prescriptionObservationsHtml} from "../../src/hospital/prescription-paper.ts";

const appointment = {patient_name:"A <Patient>",patient_phone:"9876543210",medical_record_number:"UHID-100",doctor_name:"Dr Smith",appointment_number:"APT-100",token_number:"07102026/DS/GEN/003",appointment_date:"2026-10-07",appointment_time:"09:30:00",appointment_type:"OPD",visit_type:"New",consultation_fee:500,charges:[{label:"Service",amount:100}],discount:50,paid_amount:200,payment_status:"Partially Paid",payment_mode:"Cash",notes:"Private clinical note"};
const template = {header_image:"data:image/png;base64,ADMIN_HEADER",footer_content:"<p>Admin hospital footer</p>"};

test("OPD bill includes Admin artwork and footer with discounted total and balance",()=>{
  const html=opdDocumentHtml(appointment,template,"bill");
  for(const text of ["ADMIN_HEADER","<p>Admin hospital footer</p>","INR 550.00","INR 350.00","Service","A &lt;PATIENT&gt;"])assert.ok(html.includes(text),text);
});
test("consultation receipt displays the doctor token and visit type",()=>{
  const html=opdDocumentHtml(appointment,template,"consultation");
  for(const text of ["Consultation Receipt",appointment.token_number,"Dr Smith","Appointment type","Visit type"])assert.ok(html.includes(text),text);
});
test("blank prescription reserves preprinted stationery and excludes artwork, charges and clinical notes",()=>{
  const html=opdDocumentHtml(appointment,template,"prescription");
  for(const text of ["Clinical details:","Investigation:","Vital signs","BP:","Pulse:","Height:","Weight:","Allergic to:","Next follow-up:","Doctor signature","margin:82mm 10mm 15mm","height:32mm",appointment.patient_phone])assert.ok(html.includes(text),text);
  assert.ok(!html.includes("ADMIN_HEADER")); assert.ok(!html.includes("Admin hospital footer")); assert.ok(!html.includes("INR 550.00"));
  assert.ok(!html.includes(appointment.notes));
  assert.ok(html.indexOf('<section class="meta">') < html.indexOf('<header class="title">'));
});

test("prescription uses the patient phone field and supports patient records with phone",()=>{
  const html=opdDocumentHtml({...appointment,patient_phone:undefined,phone:"9123456780"},template,"prescription");
  assert.ok(html.includes('<b>Phone</b><span>9123456780</span>'));
  assert.ok(html.includes('@page:first{margin-top:50mm}'));
});

test("blank prescriptions leave vitals for handwriting and doctor observations escape recorded values",()=>{
  const blank=opdDocumentHtml({...appointment,vitals:{blood_pressure:'120/80'},allergies:'Sensitive information'},template,'prescription');
  assert.ok(blank.includes('____________'));assert.ok(!blank.includes('120/80'));assert.ok(!blank.includes('Sensitive information'));
  const filled=prescriptionObservationsHtml({blood_pressure:'120/80',pulse:72,height:165,weight:60},'Penicillin <reported>');
  for(const value of ['120/80','72','165 cm','60 kg','Penicillin &lt;reported&gt;'])assert.ok(filled.includes(value),value);
  assert.ok(!opdDocumentHtml(appointment,template,'bill').includes('<h3>Vital signs</h3>'));
});
