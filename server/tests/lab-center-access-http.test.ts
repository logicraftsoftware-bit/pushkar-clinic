import assert from 'node:assert/strict';
import {test} from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='lab-center-access-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/role-panels.js');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),user=id(2),primary=id(3),second=id(4),unassigned=id(5),inactive=id(6),foreign=id(7),patient=id(8),testId=id(9);
const db=new PGlite();
await db.exec('CREATE TABLE branches(id uuid,tenant_id uuid,name text,is_active boolean)');
for(const [branch,t,name,active] of [[primary,tenant,'Primary',true],[second,tenant,'Second',true],[unassigned,tenant,'Unassigned',true],[inactive,tenant,'Inactive',false],[foreign,id(10),'Other hospital',true]])await db.query('INSERT INTO branches VALUES($1,$2,$3,$4)',[branch,t,name,active]);
const originalQuery=pool.query,originalConnect=pool.connect;
let assigned=[primary,second,inactive,foreign],writtenBranch='',invoiceArgs:any[]=[],orderData:any,invoiceWrites=0;
let testData:Record<string,any>={amount:100};
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'},{id:id(20),code:'RECEPTIONIST'}]};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'lab.order.view'},{code:'billing.create'},{code:'billing.view'}]};
  if(sql.includes('SELECT branch_id FROM user_branch_access'))return {rows:assigned.map(branch_id=>({branch_id}))};
  if(sql.includes('FROM branches')){const result=await db.query(sql,args);return {...result,rowCount:result.rows.length||result.affectedRows||0};}
  if(sql.includes('FROM hospital_refer_pharmacies')){assert.equal(args[1]||args[0],tenant);return {rows:args[0]===id(30)?[{id:id(30),name:'Town Pharmacy',address:'Assam',discount_percentage:50}]:[]};}
  if(sql.includes('FROM hospital_diagnostic_masters'))return {rows:[{id:testId,name:'Glucose',data:testData}],rowCount:1};
  if(sql.includes('FROM patients'))return {rows:[{id:patient,patient_name:'Test Patient'}]};
  return {rows:[]};
};
(pool as any).connect=async()=>({release(){},query:async(sql:string,args:any[]=[])=>{
  if(sql.includes('INSERT INTO role_work_items')){writtenBranch=args[1];orderData=args[5];return {rows:[{id:id(11)}]};}
  if(sql.includes('INSERT INTO finance_records')){invoiceWrites++;invoiceArgs=args;assert.equal(args[3],writtenBranch);return {rows:[{id:id(12)}]};}
  return {rows:[]};
}});
const app=express();app.use(express.json());app.use(router);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status||500).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const token=jwt.sign({sub:user,tenantId:tenant,branchId:primary,role:'receptionist',portal:'receptionist'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});
const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
test('center options include both assigned active branches and exclude inactive, unassigned and foreign branches',async()=>{
  const response=await fetch(base+'/lab-registration-options',{headers});assert.equal(response.status,200);
  const data=await response.json();assert.deepEqual(data.centers.map((row:any)=>row.id),[primary,second]);assert.equal(data.current_center_id,primary);
});
test('reception can save lab orders and invoices under the second assigned branch',async()=>{
  const response=await fetch(base+'/lab-own-orders',{method:'POST',headers,body:JSON.stringify({patient_id:patient,test_ids:[testId],center_id:second})});
  assert.equal(response.status,201,JSON.stringify(await response.json()));assert.equal(writtenBranch,second);
});
test('pharmacy lookup is tenant scoped and the server calculates discounts rather than trusting submitted percentages',async()=>{
  const request=(refer_pharmacy_id:string)=>fetch(base+'/lab-own-orders',{method:'POST',headers,body:JSON.stringify({patient_id:patient,test_ids:[testId],center_id:second,refer_pharmacy_id,pharmacy_discount_percentage:100})});
  const response=await request(id(30));assert.equal(response.status,201);
  assert.equal(orderData.refer_pharmacy_name,'Town Pharmacy');assert.equal(orderData.pharmacy_discount_percentage,50);assert.equal(orderData.pharmacy_discount_amount,50);
  assert.deepEqual(invoiceArgs.slice(5,10),[100,50,0,50,'Unpaid']);
  assert.equal((await request(id(31))).status,400);
});

test('scoped tests are hidden outside their branches and forged order submissions cannot create a bill',async()=>{
  testData={amount:100,test_type:'Radiology',available_branch_ids:[second],branch_prices:{[second]:250}};
  try{
    const hidden=await fetch(base+'/lab-tests?center_id='+primary,{headers});assert.equal(hidden.status,200);assert.deepEqual(await hidden.json(),[]);
    const visible=await fetch(base+'/lab-tests?center_id='+second,{headers});assert.equal(visible.status,200);assert.equal((await visible.json())[0].data.amount,250);
    const before=invoiceWrites;
    const blocked=await fetch(base+'/lab-own-orders',{method:'POST',headers,body:JSON.stringify({patient_id:patient,test_ids:[testId],center_id:primary})});
    assert.equal(blocked.status,400);assert.match((await blocked.json()).error,/not available/);assert.equal(invoiceWrites,before);
    const allowed=await fetch(base+'/lab-own-orders',{method:'POST',headers,body:JSON.stringify({patient_id:patient,test_ids:[testId],center_id:second})});
    assert.equal(allowed.status,201);assert.equal(invoiceArgs[5],250);
  }finally{testData={amount:100};}
});

test('forged branch selection and revoked membership cannot create orders',async()=>{
  for(const branch of [unassigned,inactive,foreign]){
    const response=await fetch(base+'/lab-own-orders',{method:'POST',headers,body:JSON.stringify({patient_id:patient,test_ids:[testId],center_id:branch})});
    assert.ok([400,403].includes(response.status));
  }
  assigned=[primary];
  const response=await fetch(base+'/lab-own-orders',{method:'POST',headers,body:JSON.stringify({patient_id:patient,test_ids:[testId],center_id:second})});assert.equal(response.status,403);
});
test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=originalQuery;pool.connect=originalConnect;await pool.end();await db.close();});
