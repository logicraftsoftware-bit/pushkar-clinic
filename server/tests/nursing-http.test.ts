import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
import {ZodError} from 'zod';
import {hospitalDate,medicationScheduleError} from '../src/nursing-validation.js';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='nursing-regression-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/role-panels.js');
const db=new PGlite();
const tenant='00000000-0000-4000-8000-000000000001',branch='00000000-0000-4000-8000-000000000002',nurse='00000000-0000-4000-8000-000000000003',patient='00000000-0000-4000-8000-000000000004',admission='00000000-0000-4000-8000-000000000005',ward='00000000-0000-4000-8000-000000000006',foreign='00000000-0000-4000-8000-000000000007';
await db.exec(`CREATE TABLE ipd_admissions(id uuid,tenant_id uuid,patient_id uuid,branch_id uuid,ward_id uuid,status text);
CREATE TABLE staff_members(user_id uuid,tenant_id uuid,staff_type text,professional jsonb);
CREATE TABLE role_work_items(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,branch_id uuid,patient_id uuid,assigned_user_id uuid,created_by uuid,workspace text,kind text,title text,status text,priority text,data jsonb,occurred_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
await db.query("INSERT INTO staff_members VALUES($1,$2,'Nurse',$3)",[nurse,tenant,JSON.stringify({ward_assignment:ward})]);
await db.query("INSERT INTO ipd_admissions VALUES($1,$2,$3,$4,$5,'Admitted'),($6,$2,$3,$6,$6,'Admitted')",[admission,tenant,patient,branch,ward,foreign]);
await db.exec(`ALTER TABLE ipd_admissions ADD COLUMN ipd_number text,ADD COLUMN admitted_at timestamptz,ADD COLUMN reason_diagnosis text,ADD COLUMN room_id uuid,ADD COLUMN bed_id uuid,ADD COLUMN consultant_doctor_id uuid;
ALTER TABLE staff_members ADD COLUMN id uuid DEFAULT gen_random_uuid();
CREATE TABLE wards(id uuid,tenant_id uuid,name text);
CREATE TABLE rooms(id uuid,room_number text);
CREATE TABLE beds(id uuid,bed_number text);
CREATE TABLE users(id uuid,first_name text,last_name text);
CREATE TABLE patients(id uuid,tenant_id uuid,medical_record_number text,first_name text,last_name text,sex text,date_of_birth date,blood_group text,allergies text,existing_conditions text,current_medication text);
CREATE TABLE doctor_clinical_records(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,patient_id uuid,admission_id uuid,doctor_id uuid,record_type text,data jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE hospital_pharmacy_masters(id uuid,tenant_id uuid,name text,kind text,data jsonb);
CREATE TABLE inventory_records(tenant_id uuid,branch_id uuid,kind text,data jsonb,quantity numeric);
CREATE TABLE hospital_diagnostic_masters(id uuid,tenant_id uuid,name text,domain text,kind text,data jsonb);`);
await db.query("INSERT INTO wards VALUES($1,$2,'General Ward A')",[ward,tenant]);
await db.query("INSERT INTO patients(id,tenant_id,first_name,last_name,medical_record_number) VALUES($1,$2,'Test','Patient','UHID-1')",[patient,tenant]);
const original=pool.query;
(pool as any).query=async(sql:string,args:any[]=[])=>{
 if(sql.includes('CREATE TABLE IF NOT EXISTS role_work_items'))return {rows:[],rowCount:0};
 const result=await db.query(sql,args.map(v=>v&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v));
 return {...result,rowCount:result.rows.length||result.affectedRows||0};
};
const app=express();app.use(express.json());app.use(router);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status||(error instanceof ZodError?400:500)).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const headers={Authorization:'Bearer '+jwt.sign({sub:nurse,tenantId:tenant,branchId:branch,role:'nurse'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'}),'Content-Type':'application/json'};
const post=(path:string,body:any)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
const vitals={temperature:'37',pulse:'80',systolic:'120',diastolic:'80',spo2:'98',respiratory_rate:'16',pain_score:'0'};
const chart=(data:any,extra:any={})=>post('/nursing-station/clinical',{patient_id:patient,admission_id:admission,type:'vitals',data,...extra});
const count=async()=>(await db.query<any>('SELECT count(*)::int n FROM role_work_items')).rows[0].n;

test('valid vitals persist as numbers; abnormal but plausible observations retain alerts',async()=>{
 const response=await chart(vitals);assert.equal(response.status,201,await response.clone().text());const record=await response.json();
 assert.equal(record.data.temperature,37);assert.equal(record.data.pain_score,0);assert.equal(record.created_by,nurse);
 const abnormal=await chart({...vitals,temperature:39,pulse:130,spo2:90,systolic:190});assert.equal(abnormal.status,201);assert.equal((await abnormal.json()).data.alerts.length,4);
});
test('negative, implausible, blank, non-numeric and inconsistent vitals fail without inserts',async()=>{
 const before=await count();
 for(const patch of [{temperature:-10},{temperature:100},{temperature:''},{pulse:'abc'},{pulse:true},{pulse:999},{systolic:999,diastolic:999},{spo2:-2},{spo2:101},{respiratory_rate:-8},{respiratory_rate:999},{pain_score:-1},{pain_score:11},{diastolic:130},{pulse:null}]){
  const response=await chart({...vitals,...patch});assert.equal(response.status,400,JSON.stringify(patch)+': '+await response.text());
 }
 assert.equal(await count(),before);
});
test('chart and medication writes remain restricted to assigned ward and active admission',async()=>{
 assert.equal((await chart(vitals,{admission_id:foreign})).status,403);
 await db.query("UPDATE ipd_admissions SET status='Discharged' WHERE id=$1",[admission]);assert.equal((await chart(vitals)).status,403);
 await db.query("UPDATE ipd_admissions SET status='Admitted' WHERE id=$1",[admission]);
});
let planId:string;
const schedule=(patch:any={})=>({patient_id:patient,admission_id:admission,name:'Paracetamol',dose:'500 mg',schedule:'Once',first_due_at:new Date(Date.now()+600000).toISOString(),...patch});
test('past medication times, invalid dates and forged clinical timestamps fail before insert',async()=>{
 const before=await count();
 for(const patch of [{first_due_at:new Date(Date.now()-3600000).toISOString()},{first_due_at:'not-a-date'},{first_due_at:'2026-10-22T10:00'},{start_date:'2000-01-01'},{end_date:'2000-01-01'},{start_date:'2099-02-31'},{start_date:'2099-02-02',end_date:'2099-02-01'},{occurred_at:'2000-01-01'}]){
  const response=await post('/nursing-station/medications',schedule(patch));assert.equal(response.status,400,await response.text());
 }
 assert.equal((await post('/nursing-station/medications',schedule({admission_id:foreign}))).status,403);assert.equal(await count(),before);
 const response=await post('/nursing-station/medications',schedule());assert.equal(response.status,201,await response.clone().text());planId=(await response.json()).id;
});
test('MAR uses server administration time; backdated overrides and cross-ward access fail',async()=>{
 const before=await count();
 for(const key of ['administered_at','occurred_at','recorded_at','created_at','date','entry_time']){
  const response=await post(`/nursing-station/medications/${planId}/administer`,{outcome:'Given',[key]:'2000-01-01'});assert.equal(response.status,400);
  assert.equal((await chart({...vitals,[key]:'2000-01-01'})).status,400);
 }
 assert.equal((await chart(vitals,{occurred_at:'2000-01-01'})).status,400);assert.equal(await count(),before);
 const start=Date.now();const response=await post(`/nursing-station/medications/${planId}/administer`,{outcome:'Given'});assert.equal(response.status,201,await response.clone().text());const record=await response.json();
 assert.ok(Date.parse(record.data.administered_at)>=start);assert.ok(Date.parse(record.data.administered_at)<=Date.now());assert.equal(record.created_by,nurse);
 assert.equal((await db.query<any>('SELECT status FROM role_work_items WHERE id=$1',[planId])).rows[0].status,'Completed');
 await db.query("UPDATE ipd_admissions SET ward_id=$1 WHERE id=$2",[foreign,admission]);
 assert.equal((await post(`/nursing-station/medications/${planId}/administer`,{outcome:'Given'})).status,404);
 await db.query("UPDATE ipd_admissions SET ward_id=$1 WHERE id=$2",[ward,admission]);
});
test('generic work items cannot bypass chart or MAR safeguards',async()=>{
 const before=await count();
 assert.equal((await post('/work-items',{kind:'clinical-chart',title:'Bypass',patient_id:patient,data:{temperature:-10}})).status,403);
 const response=await fetch(base+`/work-items/${planId}`,{method:'PATCH',headers,body:JSON.stringify({status:'Given',data:{administered_at:'2000-01-01'}})});assert.equal(response.status,409);assert.equal(await count(),before);
});
test('nursing prescription list exposes saved medicines only for currently assigned admissions',async()=>{
 for(const admissionId of [admission,foreign,null])await db.query("INSERT INTO doctor_clinical_records(tenant_id,patient_id,admission_id,doctor_id,record_type,data) VALUES($1,$2,$3,$4,'consultation',$5)",[tenant,patient,admissionId,nurse,JSON.stringify({medicines:[{name:'Paracetamol',dose:'500 mg',quantity:14}]})]);
 const response=await fetch(base+'/nursing-station',{headers});assert.equal(response.status,200,await response.clone().text());const station=await response.json();
 assert.equal(station.patients.length,1);assert.equal(station.patients[0].admission_id,admission);
 assert.equal(station.prescriptions.length,1);assert.equal(station.prescriptions[0].admission_id,admission);assert.equal(station.prescriptions[0].data.medicines[0].quantity,14);
});
test('shared diagnostic masters route radiology orders by test type and retain branch pricing',async()=>{
 const labTest='00000000-0000-4000-8000-000000000100',radiologyTest='00000000-0000-4000-8000-000000000101';
 await db.query("INSERT INTO hospital_diagnostic_masters(id,tenant_id,name,domain,kind,data) VALUES($1,$3,'CBC','pathology','test',$4),($2,$3,'CT Chest','pathology','test',$5)",[labTest,radiologyTest,tenant,JSON.stringify({test_type:'Pathology',amount:500}),JSON.stringify({test_type:'Radiology',branch_prices:{[branch]:2000}})]);
 const station=await (await fetch(base+'/nursing-station',{headers})).json();
 assert.equal(station.diagnostic_masters.find((row:any)=>row.id===labTest).domain,'pathology');
 assert.equal(station.diagnostic_masters.find((row:any)=>row.id===radiologyTest).domain,'radiology');
 const body={patient_id:patient,admission_id:admission,domain:'radiology',test_ids:[radiologyTest]};
 const response=await post('/nursing-station/diagnostic-orders',body);assert.equal(response.status,201,await response.clone().text());
 const order=await response.json();assert.equal(order.workspace,'laboratory');assert.equal(order.data.tests[0].amount,2000);assert.equal(order.data.tests[0].test_type,'Radiology');
 const mixed=await post('/nursing-station/diagnostic-orders',{...body,domain:'pathology',test_ids:[labTest,radiologyTest]});assert.equal(mixed.status,201);
 assert.deepEqual((await mixed.json()).data.tests.map((test:any)=>test.test_type).sort(),['Pathology','Radiology']);
});

test('schedule dates use the hospital timezone at midnight and current-minute precision',()=>{
 const now=new Date('2026-10-21T18:35:45Z');assert.equal(hospitalDate(now),'2026-10-22');
 assert.equal(medicationScheduleError({first_due_at:'2026-10-22T00:05:00+05:30',start_date:'2026-10-22'},now),null);
 assert.match(medicationScheduleError({first_due_at:'2026-10-22T00:04:00+05:30'},now)!,/Past/);
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await db.close();await pool.end();});
