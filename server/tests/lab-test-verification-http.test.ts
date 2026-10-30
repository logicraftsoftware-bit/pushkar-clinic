import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='test-verification-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/laboratory.js');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let data:any={result_status:'Completed',lab_results:[1,2].map(n=>({test_id:id(n),parameters:[{value:'20'}]}))};
const originalQuery=pool.query,originalConnect=pool.connect;
const query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT * FROM role_work_items'))return {rows:[{id:id(10),updated_at:'2026-10-27T10:00:00Z',data,status:'Sample Collected'}]};
  if(sql.includes('FROM users u LEFT JOIN staff_members'))return {rows:[{name:'Actual Verifier',staff_type:'LabTechnician'}]};
  if(sql.startsWith('SELECT id,concat_ws'))return {rows:[{id:id(20),name:'Doctor One',professional:{digital_signature:'signature'}},{id:id(21),name:'Doctor Two',professional:{digital_signature:'signature-two'}},{id:id(22),name:'Unsigned Doctor',professional:{}}]};
  if(sql.startsWith('UPDATE role_work_items')){data={...data,...JSON.parse(args[1])};return {rowCount:1,rows:[]};}
  return {rows:[]};
};
(pool as any).query=query;(pool as any).connect=async()=>({query,release(){}});
const app=express();app.use(express.json());app.use((req:any,_res,next)=>{req.portalUser={sub:id(30),tenantId:id(40),role:'hospital_admin'};next();});app.use(router);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/orders/${id(10)}/approve`;
const approve=(body:any)=>fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({updated_at:"2026-10-27T10:00:00Z",...body})});
test('approval endpoint saves only selected tests with authenticated verifier and preserves previous selections',async()=>{
  assert.equal((await approve({stage:'technician',test_ids:[id(1)],name:'Fake'})).status,200);
  assert.deepEqual(data.technician_approval.test_ids,[id(1)]);assert.equal(data.technician_approval.tests[id(1)].name,'Actual Verifier');
  assert.equal((await approve({stage:'doctor',test_ids:[id(2)],pathologist_ids:[id(20)]})).status,200);
  assert.deepEqual(data.doctor_approval.test_ids,[id(2)]);
  assert.equal((await approve({stage:'technician',test_ids:[id(2)]})).status,200);
  assert.deepEqual(data.technician_approval.test_ids,[id(1),id(2)]);
  assert.equal((await approve({stage:'doctor',test_ids:[id(1)],pathologist_ids:[id(20)]})).status,200);
  assert.deepEqual(data.doctor_approval.test_ids,[id(2),id(1)]);
  assert.equal((await approve({stage:'technician',test_ids:[id(1)]})).status,409);
  assert.equal((await approve({stage:'technician',test_ids:[id(99)]})).status,409);
  assert.equal((await approve({stage:'technician',test_ids:[]})).status,409);
  assert.equal((await approve({stage:'technician',test_ids:[id(1)],updated_at:'2026-10-26T10:00:00Z'})).status,409);
});
test('each selected test can have its own doctor and every selection must be valid before saving',async()=>{
  data.doctor_approval=null;
  const body={stage:'doctor',test_ids:[id(1),id(2)],test_pathologists:{[id(1)]:id(20),[id(2)]:id(21)}};
  for(const assignments of [{[id(1)]:id(20)},{[id(1)]:id(20),[id(2)]:id(99)},{[id(1)]:id(20),[id(2)]:id(22)}]){
    assert.equal((await approve({...body,test_pathologists:assignments})).status,409);
    assert.equal(data.doctor_approval,null,'invalid selections must not partly verify an order');
  }
  assert.equal((await approve(body)).status,200);
  assert.deepEqual(data.doctor_approval.tests[id(1)].pathologist_names,['Doctor One']);
  assert.deepEqual(data.doctor_approval.tests[id(2)].pathologist_names,['Doctor Two']);
  assert.deepEqual(data.doctor_approval.pathologist_ids,[id(20),id(21)]);
  assert.equal(data.doctor_approval.tests[id(1)].by,id(30));
});
test('partial CBC can be verified after all other completed tests were already approved',async()=>{
  data={result_status:'Partially Completed',lab_results:[
    {test_id:id(1),parameters:[{value:'12'}]},
    {test_id:id(2),parameters:[{value:'7770'},{value:''}]},
    {test_id:id(3),parameters:[{value:''}]},
  ],doctor_approval:{test_ids:[id(1)]}};
  assert.equal((await approve({stage:'doctor',test_ids:[id(2)],pathologist_ids:[id(20)]})).status,200);
  assert.deepEqual(data.doctor_approval.test_ids,[id(1),id(2)]);
  assert.equal((await approve({stage:'technician',test_ids:[id(2)]})).status,200);
  assert.deepEqual(data.technician_approval.test_ids,[id(2)]);
  assert.equal(data.result_status,'Partially Completed');
  assert.equal(data.lab_results[1].parameters[1].value,'');
  assert.equal((await approve({stage:'technician',test_ids:[id(3)]})).status,409);
});

test('an order with only a partial test and no completed tests supports both verifications',async()=>{
  data={result_status:'Partially Completed',lab_results:[{test_id:id(2),parameters:[{value:'0'},{value:''}]}]};
  assert.equal((await approve({stage:'technician',test_ids:[id(2)]})).status,200);
  assert.equal((await approve({stage:'doctor',test_ids:[id(2)],pathologist_ids:[id(20)]})).status,200);
});

test('disapproval is test-specific, audited and rejects stale or unapproved selections',async()=>{
  data={result_status:'Completed',lab_results:[1,2].map(n=>({test_id:id(n),parameters:[{value:'20'}]})),doctor_approval:{test_ids:[id(1),id(2)],tests:{[id(1)]:{name:'First doctor'},[id(2)]:{name:'Second doctor'}}},technician_approval:{test_ids:[id(1),id(2)]}};
  const oldResults=JSON.stringify(data.lab_results);
  assert.equal((await approve({stage:'disapprove',test_ids:[id(1)],updated_at:'2026-10-26T10:00:00Z'})).status,409);
  assert.equal((await approve({stage:'disapprove',test_ids:[id(99)]})).status,409);
  assert.equal((await approve({stage:'disapprove',test_ids:[id(1)]})).status,200);
  assert.deepEqual(data.doctor_approval.test_ids,[id(2)]);assert.deepEqual(data.disapproved_test_ids,[id(1)]);assert.equal(JSON.stringify(data.lab_results),oldResults);
  const event=data.approval_history.at(-1);assert.equal(event.stage,'disapprove');assert.equal(event.by,id(30));assert.deepEqual(event.previous_approval.test_ids,[id(1),id(2)]);
  assert.equal((await approve({stage:'disapprove',test_ids:[id(1)]})).status,409);
  assert.equal((await approve({stage:'doctor',test_ids:[id(1)],pathologist_ids:[id(20)]})).status,200);
  assert.deepEqual(data.disapproved_test_ids,[]);
});

test.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=originalQuery;pool.connect=originalConnect;await pool.end();});
