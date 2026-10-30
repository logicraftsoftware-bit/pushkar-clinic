import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='patient-registration-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js'),{default:router}=await import('../src/patient-management.js');
const id='00000000-0000-4000-8000-000000000001';
const original=pool.query;
let inserted:any[]=[];
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id,code:'HOSPITAL_ADMIN'}],rowCount:1};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'patient.create'}],rowCount:1};
  if(sql.includes('SELECT 1 FROM branches'))return {rows:[{id}],rowCount:1};
  if(sql.includes('SELECT count(*)::int+1 n FROM patients'))return {rows:[{n:1}],rowCount:1};
  if(sql.startsWith('INSERT INTO patients')){inserted=args;return {rows:[{id,address:args[11],allergies:args[13]}],rowCount:1};}
  return {rows:[],rowCount:0};
};
const app=express();app.use(express.json());app.use(router);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
const token=jwt.sign({sub:id,tenantId:id,branchId:id,role:'hospital_admin',portal:'hospital_admin'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});
const body={branch_id:id,first_name:'Example',last_name:'Patient',address:{age_years:29},allergies:'Penicillin'};
async function register(address:any){return fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,address})});}
test('new registrations reject a missing or invalid patient title before writing',async()=>{
  assert.equal((await register(body.address)).status,400);assert.equal(inserted.length,0);
  assert.equal((await register({...body.address,title:'invalid'})).status,400);assert.equal(inserted.length,0);
});
test('new registration persists the selected title with age and clinical information',async()=>{
  const response=await register({...body.address,title:'Mrs.'});
  assert.equal(response.status,201,await response.clone().text());
  assert.equal(inserted[11].title,'Mrs.');assert.equal(inserted[11].age_years,29);assert.equal(inserted[13],'Penicillin');
});
test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=original;await pool.end();});
