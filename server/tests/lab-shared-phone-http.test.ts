import assert from 'node:assert/strict';
import {test} from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='shared-family-phone-registration-test-secret';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/role-panels.js');
const db=new PGlite();
const tenant='00000000-0000-4000-8000-000000000001',branch='00000000-0000-4000-8000-000000000002';
await db.exec(`CREATE TABLE patients(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,branch_id uuid,medical_record_number text,first_name text,last_name text,date_of_birth date,sex text,blood_group text,phone text,email text,address jsonb,emergency_contact jsonb,allergies text,existing_conditions text,current_medication text,registration_fee numeric,maintenance_fee numeric,registration_addons jsonb,payment_mode text,payment_reference text,discount numeric,discount_remarks text,registration_payment_status text,payment_status_remarks text,total_amount numeric,status text,deleted_at timestamptz,created_at timestamptz DEFAULT now(),UNIQUE(tenant_id,medical_record_number));`);
const original=pool.query;
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}],rowCount:1};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'lab.order.view'},{code:'billing.create'},{code:'billing.view'}],rowCount:3};
  if(sql.includes('FROM hospital_settings'))return {rows:[],rowCount:0};
  if(/^(SELECT|INSERT INTO patients)/.test(sql.trim())&&sql.includes('patients'))return db.query(sql,args);
  return {rows:[],rowCount:0};
};
const app=express();app.use(express.json());app.use(router);app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.name==='ZodError'?400:500).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
function headers(role='hospital_admin',tenantId=tenant){return {authorization:'Bearer '+jwt.sign({sub:branch,tenantId,branchId:branch,role},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'}),'Content-Type':'application/json'};}
async function register(first_name:string,last_name:string,phone='9876543210',role='hospital_admin'){
 const response=await fetch(base+'/lab-patients',{method:'POST',headers:headers(role),body:JSON.stringify({first_name,last_name,phone,age_years:30})});
 return {status:response.status,body:await response.json()};
}
test('different patients can share a phone, keep separate UHIDs and remain selectable in search',async()=>{
 const first=await register('Anita','Das');assert.equal(first.status,201,JSON.stringify(first.body));
 const second=await register('Rahul','Das');assert.equal(second.status,201,JSON.stringify(second.body));
 assert.notEqual(first.body.id,second.body.id);assert.notEqual(first.body.medical_record_number,second.body.medical_record_number);
 assert.equal(first.body.phone,second.body.phone);
 for(const role of ['hospital_admin','laboratory','receptionist']){
  const response=await fetch(base+'/lab-patients?search=9876543210',{headers:headers(role)});assert.equal(response.status,200);
  const found=await response.json();assert.equal(found.length,2);assert.deepEqual(new Set(found.map((row:any)=>row.id)),new Set([first.body.id,second.body.id]));
 }
 const response=await fetch(base+'/lab-patients?search=9876543210',{headers:headers('hospital_admin','00000000-0000-4000-8000-000000000003')});
 assert.deepEqual(await response.json(),[],'shared phone search remains tenant scoped');
});
test('matching name and phone still rejects an accidental duplicate',async()=>{
 const duplicate=await register('  ANITA  ','das');assert.equal(duplicate.status,409);assert.match(duplicate.body.error,/same name and phone/);
 const result=await db.query<{total:number}>('SELECT count(*)::int total FROM patients');assert.equal(result.rows[0].total,2);
});
test('phone validation and registration permissions are unchanged',async()=>{
 assert.equal((await register('Other','Person','invalid')).status,400);
 assert.equal((await register('Other','Person','9876543210','patient')).status,403);
});
test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=original;await pool.end();await db.close();});
