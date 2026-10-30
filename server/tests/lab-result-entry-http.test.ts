import assert from "node:assert/strict";
import {test} from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import {once} from "node:events";
import type {AddressInfo} from "node:net";
process.env.DATABASE_URL="postgresql://test:test@localhost/test";
process.env.JWT_SECRET="partial-lab-results-test-secret-at-least-32-characters";
delete process.env.GROQ_API_KEY;
const {pool}=await import("../src/db.js");
const {default:router}=await import("../src/role-panels.js");
const tenant="00000000-0000-4000-8000-000000000001",order="00000000-0000-4000-8000-000000000002";
const ids=[3,4,5,6].map(i=>`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`);
let resultAllowed=true;
let testSpecimens=false;
let papMode=false;
const specimenId='00000000-0000-4000-8000-000000000099';
let data:any={collected_at:"2026-10-09T10:00:00Z",tests:ids.map(test_id=>({test_id,name:test_id}))},writes=0;
const original=pool.query;
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes("SELECT id,trim(concat_ws(' ',first_name,last_name)) name FROM users"))return {rows:[{id:order,name:'Entry Technician'}]};
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}]};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'lab.order.view'},...(resultAllowed?[{code:'lab.result.create'}]:[]),{code:'billing.create'},{code:'billing.view'}]};
  if(sql.includes("FROM role_work_items w")&&sql.includes("w.data ? 'collected_at'")){
    assert.equal(args[1],tenant);
    return {rows:[{id:order,updated_at:new Date("2026-10-09T10:00:00Z"),patient_name:"Test Patient",data}]};
  }
  if(sql.includes("FROM hospital_diagnostic_masters")&&sql.includes("kind='test'"))return {rows:ids.map((id,index)=>({id,name:papMode&&index===0?'PAP SMEAR':id,data:{test_type:index===3?'Radiology':'Pathology',specimen_ids:testSpecimens&&index===0?[specimenId]:[]}}))};
  if(sql.includes("kind='specimen'")){assert.equal(args[0],tenant);return {rows:testSpecimens?[{id:specimenId,name:'Whole Blood (EDTA)'}]:[]};}
  if(sql.startsWith("UPDATE role_work_items SET data=data||jsonb_build_object('result_history'")){
    assert.equal(args[2],tenant);assert.match(sql,/date_trunc/);
    assert.match(sql,/'changes',\$6::jsonb/);
    const history=[...(data.result_history||[]),{results:data.lab_results,by:args[3],at:new Date().toISOString(),changes:JSON.parse(args[5])}];
    writes++;data={...data,...JSON.parse(args[0]),result_history:history};return {rowCount:1,rows:[{id:order,data}]};
  }
  return {rows:[]};
};
const app=express();app.use(express.json());app.use(router);
const server=app.listen(0,"127.0.0.1");await once(server,"listening");
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/work-items/${order}/lab-results`;
const token=jwt.sign({sub:order,tenantId:tenant,branchId:order,role:"hospital_admin"},process.env.JWT_SECRET!,{issuer:"careframe-api",audience:"careframe-portal"});
const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
async function save(values:string[]){return fetch(url,{method:"PATCH",headers,body:JSON.stringify({results:ids.map((test_id,i)=>({test_id,parameters:[{parameter_id:null,value:values[i]||"",remarks:""}]}))})});}
test("the result endpoint saves three completed tests with a fourth blank",async()=>{
  const response=await save(["1","2","3",""]);assert.equal(response.status,200);
  const saved=(await response.json()).data;
  assert.equal(saved.result_status,"Partially Completed");
  assert.deepEqual(saved.completed_test_ids,ids.slice(0,3));
  assert.equal(saved.lab_results[3].parameters[0].value,"");
  assert.equal(saved.report_narrative.findings.length,3);
  assert.equal(saved.result_entry.tests[ids[0]].name,'Entry Technician');
  assert.equal(saved.result_entry.tests[ids[0]].by,order);
  assert.equal(saved.result_entry.tests[ids[3]],undefined);
});
test("pending results can be finished after approval without changing approved test values",async()=>{
  data.doctor_approval={test_ids:ids.slice(0,3)};
  const response=await save(["1","2","3","4"]);assert.equal(response.status,200);
  assert.equal((await response.json()).data.result_status,"Completed");
  assert.deepEqual(data.doctor_approval.test_ids,ids.slice(0,3));
  const before=writes;
  assert.equal((await save(["9","2","3","4"])).status,400);
  assert.equal(writes,before);
});
test('revoked result permission blocks writes immediately on the same signed session',async()=>{const before=writes;resultAllowed=false;const response=await save(['1','2','3','4']);assert.equal(response.status,403);assert.match((await response.json()).error,/lab.result.create/);assert.equal(writes,before);resultAllowed=true;assert.equal((await fetch(url+'?mode=entry',{headers})).status,200);});
test('radiology findings are entered and saved through the same laboratory result endpoint',async()=>{
  const record=await (await fetch(url+'?mode=entry',{headers})).json();
  assert.equal(record.tests[3].parameters[0].name,'Findings / Impression');
  assert.equal(record.tests[3].parameters[0].result_type_id,'27');
  const response=await save(['1','2','3','Findings: No focal lesion.\nImpression: Normal study.']);
  assert.equal(response.status,200);const saved=(await response.json()).data;
  assert.equal(saved.result_status,'Completed');assert.match(saved.lab_results[3].parameters[0].value,/Impression: Normal study/);
});

test('radiology staff sessions use the shared laboratory results workflow',async()=>{
  const radiologyToken=jwt.sign({sub:order,tenantId:tenant,branchId:order,role:'radiology',portal:'radiologist'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});
  const response=await fetch(url+'?mode=entry',{headers:{...headers,authorization:`Bearer ${radiologyToken}`}});
  assert.equal(response.status,200);assert.equal((await response.json()).tests.length,4);
});

test('individual saves update partial and complete status and preserve prior values in edit history',async()=>{
  data={collected_at:"2026-10-09T10:00:00Z",tests:ids.map(test_id=>({test_id,name:test_id}))};
  const saveOne=(index:number,value:string)=>fetch(url,{method:"PATCH",headers,body:JSON.stringify({results:[{test_id:ids[index],parameters:[{parameter_id:null,value,remarks:""}]}]})});
  assert.equal((await saveOne(0,'7')).status,200);
  assert.equal(data.result_status,'Partially Completed');
  assert.deepEqual(data.completed_test_ids,[ids[0]]);
  for(let index=1;index<ids.length;index++)assert.equal((await saveOne(index,'0')).status,200);
  assert.equal(data.result_status,'Completed');
  assert.equal((await saveOne(0,'8')).status,200);
  assert.equal(data.lab_results[0].parameters[0].value,'8');
  const edit=data.result_history.at(-1);
  assert.equal(edit.by,order);
  assert.ok(edit.at);
  assert.equal(edit.results[0].parameters[0].value,'7');
  assert.equal(edit.changes[0].previous_value,'7');
  assert.equal(edit.changes[0].value,'8');
  assert.equal(data.result_status,'Completed');
});

test('a stale result page cannot overwrite a more recent saved value',async()=>{
  const before=writes;
  const response=await fetch(url,{method:'PATCH',headers,body:JSON.stringify({updated_at:'2026-10-08T10:00:00.000Z',results:[]})});
  assert.equal(response.status,409);
  assert.equal(writes,before);
});

test('report loading resolves primary specimen names from the test master even without parameter specimens',async()=>{
  testSpecimens=true;
  try{
    const response=await fetch(url+'?mode=entry',{headers});assert.equal(response.status,200);
    const record=await response.json();assert.deepEqual(record.tests[0].specimen_names,['Whole Blood (EDTA)']);assert.deepEqual(record.tests[1].specimen_names,[]);
  }finally{testSpecimens=false;}
});

test('the Pap smear endpoint accepts and reloads a description longer than the previous 500-character limit',async()=>{
  papMode=true;data={collected_at:'2026-10-09T10:00:00Z',tests:[{test_id:ids[0],name:'PAP SMEAR'}]};
  const narrative='DESCRIPTION\n'+('Report text on multiple lines.\n'.repeat(80))+'\nIMPRESSION\nFinal description.';
  try{
    const response=await fetch(url,{method:'PATCH',headers,body:JSON.stringify({results:[{test_id:ids[0],parameters:[{parameter_id:null,value:narrative}]}]})});
    assert.equal(response.status,200,await response.clone().text());
    const saved=(await response.json()).data.lab_results[0];assert.equal(saved.parameters[0].value,narrative);assert.equal(saved.parameters[0].result_type_id,'27');
    const reopened=await(await fetch(url+'?mode=entry',{headers})).json();assert.equal(reopened.tests[0].parameters[0].value,narrative);assert.equal(reopened.tests[0].parameters[0].result_type_id,'27');
  }finally{papMode=false;}
});

test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=original;await pool.end();});
