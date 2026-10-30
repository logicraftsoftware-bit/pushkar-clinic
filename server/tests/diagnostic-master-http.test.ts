import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
import {ZodError} from 'zod';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='diagnostic-master-regression-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/hospital-management.js');
const db=new PGlite(),tenant='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',branch='00000000-0000-4000-8000-000000000003';
await db.exec(`CREATE TABLE hospital_diagnostic_masters(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,domain text,kind text,name text,data jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());CREATE TABLE branches(id uuid,tenant_id uuid,name text,code text,is_active boolean);CREATE TABLE users(id uuid,tenant_id uuid,branch_id uuid);CREATE TABLE user_branch_access(tenant_id uuid,user_id uuid,branch_id uuid);`);
await db.query("INSERT INTO branches VALUES($1,$2,'Main','MAIN',true)",[branch,tenant]);
await db.query('INSERT INTO users VALUES($1,$2,$3)',[user,tenant,branch]);
const original=pool.query;
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}]};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'lab.order.view'},{code:'lab.result.create'},{code:'radiology.view'},{code:'radiology.report.create'}]};
  if(sql.includes('rbac_')||/^\s*(CREATE|ALTER)/.test(sql))return {rows:[],rowCount:0};
  const result=await db.query(sql,args.map(value=>value&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value));
  return {...result,rowCount:result.rows.length||result.affectedRows||0};
};
const app=express();app.use(express.json());app.use(router);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status||(error instanceof ZodError?400:500)).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const headers={Authorization:'Bearer '+jwt.sign({sub:user,tenantId:tenant,branchId:branch,role:'laboratory'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'}),'Content-Type':'application/json'};
async function request(path:string,body?:any,method='POST') {
  const response=await fetch(base+path,{headers,...(body?{method,body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
}
test('existing clients default to Pathology and both test types share one master',async()=>{
  const branches=await request('/diagnostic-branches');assert.equal(branches.status,200,JSON.stringify(branches.data));assert.equal(branches.data[0].id,branch);
  const pathology=await request('/diagnostic-masters/pathology/test',{name:'CBC',data:{amount:500}});
  assert.equal(pathology.status,201,JSON.stringify(pathology.data));assert.equal(pathology.data.data.test_type,'Pathology');
  const radiology=await request('/diagnostic-masters/pathology/test',{name:'CT Chest',data:{test_type:'Radiology',amount:2000}});
  assert.equal(radiology.status,201,JSON.stringify(radiology.data));assert.equal(radiology.data.domain,'pathology');
  const list=await request('/diagnostic-masters/pathology/test');assert.equal(list.status,200);assert.equal(list.data.length,2);
  assert.deepEqual(list.data.map((row:any)=>row.data.test_type).sort(),['Pathology','Radiology']);
  const updated=await request('/diagnostic-masters/pathology/test/'+radiology.data.id,{name:'CT Chest Updated',data:{test_type:'Radiology',amount:2500}},'PUT');
  assert.equal(updated.status,200);assert.equal(updated.data.data.test_type,'Radiology');
});
test('Neurology tests can be created and edited in the shared master',async()=>{
  const created=await request('/diagnostic-masters/pathology/test',{name:'EEG',data:{test_type:'Neurology',amount:2200}});
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data.data.test_type,'Neurology');
  const updated=await request('/diagnostic-masters/pathology/test/'+created.data.id,{name:'EEG Updated',data:{test_type:'Neurology',amount:2300}},'PUT');
  assert.equal(updated.status,200,JSON.stringify(updated.data));
  assert.equal(updated.data.data.test_type,'Neurology');
  assert.equal(updated.data.data.amount,2300);
});

test('separate radiology master is retired and invalid types cannot be saved',async()=>{
  assert.equal((await request('/diagnostic-masters/radiology/test')).status,410);
  assert.equal((await request('/diagnostic-masters/radiology/test',{name:'Legacy X-Ray',data:{}})).status,410);
  assert.equal((await request('/diagnostic-masters/pathology/test',{name:'Bad Test',data:{test_type:'Other'}})).status,400);
});
after(async()=>{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  pool.query=original;await pool.end();await db.close();
});
