import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
import {ZodError} from 'zod';
import {clinicalDoctorLookupSql} from '../src/clinical-doctors.js';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='paginated-clinical-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:patients}=await import('../src/patient-management.js');
const {default:clinical}=await import('../src/clinical-operations.js');
const {default:selfRegistration}=await import('../src/self-registration.js');
const db=new PGlite(),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(10000),foreign=id(10001),branch=id(10002),otherBranch=id(10003),doctor=id(10004),otherDoctor=id(10005);
await db.exec(`CREATE TABLE branches(id uuid,tenant_id uuid,name text,is_active boolean DEFAULT true);
  CREATE TABLE hospitals(id uuid,name text,logo_url text,status text,deleted_at timestamptz);
  CREATE TABLE users(id uuid,tenant_id uuid,branch_id uuid,first_name text,last_name text);
  CREATE TABLE departments(id uuid,tenant_id uuid,branch_id uuid,name text,is_active boolean DEFAULT true);
  CREATE TABLE patients(id uuid PRIMARY KEY,tenant_id uuid,branch_id uuid,medical_record_number text,first_name text,last_name text,phone text,email text,created_at timestamptz,deleted_at timestamptz,
    address jsonb DEFAULT '{}',date_of_birth date,sex text,allergies text,existing_conditions text,registration_fee numeric DEFAULT 0,maintenance_fee numeric DEFAULT 0,registration_addons jsonb DEFAULT '[]',discount numeric DEFAULT 0,total_amount numeric DEFAULT 0,payment_mode text,payment_reference text,registration_payment_status text);
  CREATE TABLE clinical_appointments(id uuid PRIMARY KEY,tenant_id uuid,branch_id uuid,patient_id uuid,doctor_id uuid,department_id uuid,appointment_number text,token_number text,status text,slot_serial int,appointment_date date,appointment_time time);`);
await db.query(`INSERT INTO branches VALUES($1,$2,'Main'),($3,$2,'Second')`,[branch,tenant,otherBranch]);
await db.query(`INSERT INTO hospitals VALUES($1,'Hospital',null,'active',null)`,[tenant]);
await db.query(`INSERT INTO users VALUES($1,$2,$3,'UniqueDoctor','Example'),($4,$2,$3,'Other','Doctor')`,[doctor,tenant,branch,otherDoctor]);
await db.query(`INSERT INTO patients(id,tenant_id,branch_id,medical_record_number,first_name,last_name,phone,email,created_at,deleted_at)
  SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n<=60 THEN $1::uuid ELSE $2::uuid END,CASE WHEN n%2=0 THEN $3::uuid ELSE $4::uuid END,
    'UHID-'||n,'Patient','Person'||n,'98765'||lpad(n::text,5,'0'),'person'||n||'@example.test',now()-n*interval '1 minute',CASE WHEN n=60 THEN now() ELSE null END
  FROM generate_series(1,65)n`,[tenant,foreign,branch,otherBranch]);
await db.query(`INSERT INTO clinical_appointments SELECT id,tenant_id,branch_id,id,CASE WHEN (substring(medical_record_number FROM '[0-9]+'))::int%2=0 THEN $1::uuid ELSE $2::uuid END,null,
  'APT-'||medical_record_number,'TOKEN/'||medical_record_number,CASE WHEN (substring(medical_record_number FROM '[0-9]+'))::int%2=0 THEN 'Booked' ELSE 'Completed' END,
  (substring(medical_record_number FROM '[0-9]+'))::int,date '2026-10-29'-(substring(medical_record_number FROM '[0-9]+'))::int,time '09:00' FROM patients`,[doctor,otherDoctor]);
const original=pool.query,queries:string[]=[];
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}],rowCount:1};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:['patient.view','appointment.view','ipd.view'].map(code=>({code}))};
  if(sql.includes('SELECT branch_id FROM user_branch_access'))return {rows:[{branch_id:branch}]};
  if(/\b(CREATE|ALTER|INSERT|DELETE)\b/.test(sql))return {rows:[],rowCount:0};
  if(sql===clinicalDoctorLookupSql||/FROM (wards|rooms|beds|hospital_diagnostic_masters|hospital_charge_masters|hospital_settings)\b/.test(sql))return {rows:[],rowCount:0};
  queries.push(sql);return db.query(sql,args);
};
const app=express();app.use('/patients',patients);app.use('/clinical',clinical);app.use('/self-registration',selfRegistration);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error instanceof ZodError?400:500).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
function headers(scoped=false){return {Authorization:`Bearer ${jwt.sign({sub:doctor,tenantId:tenant,branchId:branch,role:scoped?'receptionist':'hospital_admin',portal:scoped?'receptionist':'hospital_admin'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'})}`};}
async function load(path:string,scoped=false){const response=await fetch(base+path,{headers:headers(scoped)}),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}

test('patient pages contain 25 newest records, retain totals and search beyond the first page',async()=>{
  queries.length=0;
  const first=await load('/patients?page=1');assert.equal(first.rows.length,25);assert.equal(first.total,59);assert.equal(first.rows[0].id,id(1));
  assert.ok(queries.some(sql=>sql.includes('LIMIT $4 OFFSET $5')));
  const second=await load('/patients?page=2');assert.equal(second.rows[0].id,id(26));assert.equal(second.rows.length,25);
  assert.equal((await load('/patients?page=3')).rows.length,9);
  const searched=await load('/patients?page=1&search=Person57');assert.equal(searched.total,1);assert.equal(searched.rows[0].id,id(57));
  assert.equal((await load('/patients?page=1&search=98765%2000057')).total,1);
  assert.equal((await load('/patients?page=1&search=Person60')).total,0);
  assert.equal((await load('/patients?page=1',true)).total,29);
  assert.equal((await load('/patients?page=1&search=Person57',true)).total,0);
});

test('appointment pages and status summaries cover all filtered records while returning only 25 rows',async()=>{
  const first=await load('/clinical/appointments?page=1');assert.equal(first.total,60);assert.equal(first.rows.length,25);assert.equal(first.summary.Booked,30);assert.equal(first.summary.Completed,30);
  assert.equal((await load('/clinical/appointments?page=2')).rows[0].id,id(26));
  const searched=await load('/clinical/appointments?page=1&search=Person57');assert.equal(searched.total,1);assert.equal(searched.rows[0].id,id(57));
  const byDoctor=await load('/clinical/appointments?page=1&search=UniqueDoctor');assert.equal(byDoctor.total,30);
  assert.equal((await load('/clinical/appointments?page=1',true)).total,30);
  const queue=await load(`/clinical/appointments?page=1&queue=1&doctor_ids=${doctor}`);
  assert.equal(queue.total,30);assert.equal(queue.dates.length,30);assert.equal(queue.rows[0].slot_serial,2);
  const filtered=await load(`/clinical/appointments?page=1&queue=1&doctor_ids=${doctor}&date=${queue.dates[0]}`);
  assert.equal(filtered.total,1);assert.equal(filtered.dates.length,30);
});

test('booking patient search is bounded, includes other registration branches and excludes other hospitals and deleted records',async()=>{
  const matches=await load('/clinical/patient-search?search=Patient',true);assert.equal(matches.length,25);
  const match=await load('/clinical/patient-search?search=Person57',true);assert.equal(match[0].id,id(57));assert.equal(match[0].branch_id,otherBranch);
  assert.equal((await load(`/clinical/patient-search?patient_id=${id(57)}`,true))[0].id,id(57));
  assert.deepEqual(await load(`/clinical/patient-search?patient_id=${id(61)}`,true),[]);
  assert.deepEqual(await load(`/clinical/patient-search?patient_id=${id(60)}`,true),[]);
  assert.equal((await load('/clinical/patient-search?search=P',true)).length,25);
  assert.equal((await load('/clinical/patient-search?search=a',true)).length,25);
  assert.equal((await load('/clinical/patient-search?search=9',true)).length,25);
  assert.deepEqual(await load('/clinical/patient-search?search=',true),[]);
  assert.deepEqual(await load('/clinical/patient-search?search=%25',true),[]);
  assert.equal((await fetch(base+'/patients?page=0',{headers:headers()})).status,400);
  assert.equal((await fetch(base+'/clinical/appointments?page=1&page_size=101',{headers:headers()})).status,400);
});

test('list lookup options skip the patient directory and queue shortcuts are capped at 25 recent patients',async()=>{
  queries.length=0;
  const options=await load('/clinical/lookups?patients=none');assert.deepEqual(options.patients,[]);
  assert.ok(!queries.some(sql=>sql.includes('FROM patients')));
  const recent=await load('/clinical/lookups?patients=recent');assert.equal(recent.patients.length,25);assert.equal(recent.patients[0].id,id(1));
  assert.equal((await load('/patients/branches',true)).length,1);
});

test('inactive centres disappear from options and old public QR codes stop opening while historical records remain readable',async()=>{
  const token=jwt.sign({purpose:'patient-self-registration',tenantId:tenant,branchId:otherBranch},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'patient-self-registration'});
  assert.equal((await fetch(`${base}/self-registration/${token}`)).status,200);
  try{
    await db.query('UPDATE branches SET is_active=false WHERE id=$1',[otherBranch]);
    assert.equal((await load('/patients/branches')).length,1);
    assert.equal((await load('/clinical/lookups?patients=none')).branches.length,1);
    assert.equal((await fetch(`${base}/self-registration/${token}`)).status,404);
    assert.equal((await load('/patients?page=1')).total,59);
    assert.equal((await load('/clinical/appointments?page=1')).total,60);
  }finally{await db.query('UPDATE branches SET is_active=true WHERE id=$1',[otherBranch]);}
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await pool.end();await db.close();});
