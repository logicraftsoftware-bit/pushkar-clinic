import {test,after} from 'node:test';import assert from 'node:assert/strict';import express from 'express';import jwt from 'jsonwebtoken';import {once} from 'node:events';import type{AddressInfo}from'node:net';import{PGlite}from'@electric-sql/pglite';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';process.env.JWT_SECRET='recent-opd-regression-secret-at-least-32-characters';
const{pool}=await import('../src/db.js');const{default:router}=await import('../src/role-panels.js');
const db=new PGlite();const tenant='00000000-0000-4000-8000-000000000001',branch='00000000-0000-4000-8000-000000000002',otherBranch='00000000-0000-4000-8000-000000000003',patient='00000000-0000-4000-8000-000000000004',doctor='00000000-0000-4000-8000-000000000005',testId='00000000-0000-4000-8000-000000000006';
await db.exec('CREATE TABLE patients(id uuid,tenant_id uuid,first_name text,last_name text,medical_record_number text,phone text,sex text,date_of_birth date,deleted_at timestamptz);CREATE TABLE users(id uuid,tenant_id uuid,first_name text,last_name text);CREATE TABLE clinical_appointments(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,branch_id uuid,patient_id uuid,doctor_id uuid,appointment_date date,appointment_time time,appointment_number text,status text,appointment_type text,created_at timestamptz DEFAULT now());');
await db.query("INSERT INTO patients VALUES($1,$2,'Test','Patient','UHID-1','9999999999','male',null,null)",[patient,tenant]);await db.query("INSERT INTO users VALUES($1,$2,'Test','Doctor')",[doctor,tenant]);
for(const [date,visitBranch,status,visitTenant]of [['2026-10-15',branch,'Booked',tenant],['2026-10-14',branch,'Completed',tenant],['2026-10-16',otherBranch,'Booked',tenant],['2026-10-17',branch,'Cancelled',tenant],['2026-10-18',branch,'Booked',otherBranch]])await db.query("INSERT INTO clinical_appointments(tenant_id,branch_id,patient_id,doctor_id,appointment_date,appointment_time,appointment_number,status,appointment_type)VALUES($1,$2,$3,$4,$5,'09:00','APT-1',$6,'OPD')",[visitTenant,visitBranch,patient,doctor,date,status]);
let allowed=true;const original=pool.query;
(pool as any).query=async(sql:string,args:any[]=[])=>{
 if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return{rows:[{id:tenant,code:'HOSPITAL_ADMIN'}]};
 if(sql.includes('SELECT DISTINCT rp.permission_code'))return{rows:allowed?[{code:'lab.order.view'}]:[]};
 if(sql.includes('SELECT branch_id FROM user_branch_access'))return{rows:[{branch_id:branch}]};
 if(sql.includes('FROM hospital_diagnostic_masters'))return{rows:[{id:testId,name:'CBC',data:{amount:100}}],rowCount:1};
 if(sql.startsWith('SELECT p.id,p.first_name')||sql.startsWith('SELECT id,concat_ws')||sql.startsWith('SELECT id FROM clinical_appointments')){const result=await db.query(sql,args.map(v=>Array.isArray(v)?v:v));return{...result,rowCount:result.rows.length};}
 return{rows:[],rowCount:0};
};
const app=express();app.use(express.json());app.use(router);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
const token=jwt.sign({sub:doctor,tenantId:tenant,branchId:branch,role:'laboratory',portal:'lab_manager'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'}),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
test('recent OPD selection is newest-first, branch-scoped, patient-linked and excludes cancellations',async()=>{
 const response=await fetch(base+'/lab-recent-appointments',{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const rows=await response.json();assert.equal(rows.length,2);assert.equal(rows[0].appointment_date,'2026-10-15T00:00:00.000Z');assert.equal(rows[0].patient_name,'TEST PATIENT');assert.equal(rows[0].doctor_id,doctor);assert.equal(rows[0].id,patient);assert.ok(rows[0].appointment_id);
});
test('revoked lab access and missing authentication cannot list recent OPD patients',async()=>{
 allowed=false;assert.equal((await fetch(base+'/lab-recent-appointments',{headers})).status,403);allowed=true;assert.equal((await fetch(base+'/lab-recent-appointments')).status,401);
});
test('lab orders reject forged or different-branch OPD appointment links',async()=>{
 const foreign=(await db.query<any>('SELECT id FROM clinical_appointments WHERE branch_id=$1',[otherBranch])).rows[0].id;
 for(const appointment_id of [foreign,testId]){const response=await fetch(base+'/lab-own-orders',{method:'POST',headers,body:JSON.stringify({patient_id:patient,test_ids:[testId],appointment_id})});assert.equal(response.status,400);assert.match((await response.json()).error,/OPD appointment/);}
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await db.close();await pool.end();});
