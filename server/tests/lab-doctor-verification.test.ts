import {test} from "node:test";
import assert from "node:assert/strict";
import {verificationPathologists} from "../src/lab-doctor-verification.js";
import {reportSignatories} from "../src/lab-signatories.js";
const profiles=[{id:"a",name:"Doctor A",professional:{digital_signature:"signature-a"}},{id:"b",name:"Doctor B",professional:{digital_signature:"signature-b"}},{id:"c",name:"Doctor C",professional:{}}];
test("pathologists verify using their own staff profile and ignore a submitted alternative",()=>{
  assert.deepEqual(verificationPathologists({staff_type:"Pathologist",staff_id:"a"},["b"],profiles).map(row=>row.id),["a"]);
});
test('radiologists verify through the shared laboratory signatory workflow with their own signature',()=>{
  assert.deepEqual(verificationPathologists({staff_type:'Radiologist',staff_id:'b'},['a'],profiles).map(row=>row.id),['b']);
  const signatories=reportSignatories({by:'user-b',pathologist_ids:['b']},[{...profiles[1],user_id:'user-b',first_name:'Doctor B',staff_type:'Radiologist'}],[]);
  assert.equal(signatories[0].designation,'Consultant Radiologist');assert.equal(signatories[0].signature,'signature-b');
});
test("technicians select multiple hospital pathologists without a prior technician verification",()=>{
  const selected=verificationPathologists({staff_type:"LabTechnician"},["a","b","a"],profiles);
  assert.deepEqual(selected.map(row=>row.id),["a","b"]);
  const signed=reportSignatories({by:"technician",pathologist_ids:selected.map(row=>row.id)},profiles.map(row=>({...row,first_name:row.name})),[]);
  assert.deepEqual(signed.map(row=>row.signature),["signature-a","signature-b",""]);
});
test("verification rejects missing, foreign and unsigned pathologists",()=>{
  assert.throws(()=>verificationPathologists({},[],profiles),/at least one/);
  assert.throws(()=>verificationPathologists({},["other-hospital"],profiles),/this hospital/);
  assert.throws(()=>verificationPathologists({},["c"],profiles),/Upload the digital signature/);
  assert.throws(()=>verificationPathologists({staff_type:"Pathologist",staff_id:"c"},["a"],profiles),/Upload the digital signature/);
});
