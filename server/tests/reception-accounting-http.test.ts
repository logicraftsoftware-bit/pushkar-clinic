import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';process.env.JWT_SECRET='reception-accounting-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js'),{default:router}=await import('../src/finance-inventory.js');
const db=new PGlite(),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),user1=id(2),user2=id(3),branch1=id(4),branch2=id(5),otherTenant=id(6);
await db.exec(`
CREATE TABLE finance_records(id uuid,tenant_id uuid,branch_id uuid,created_by uuid,patient_id uuid,invoice_id uuid,kind text,data jsonb DEFAULT '{}',record_number text,record_date date,created_at timestamptz DEFAULT now(),amount numeric,total numeric);
CREATE TABLE patients(id uuid,tenant_id uuid,medical_record_number text,first_name text,last_name text,phone text,date_of_birth date,address jsonb);
CREATE TABLE hospitals(id uuid,name text);
CREATE TABLE branches(id uuid,tenant_id uuid,name text,is_active boolean DEFAULT true);
CREATE TABLE users(id uuid,tenant_id uuid,branch_id uuid,first_name text,last_name text);
CREATE TABLE user_branch_access(tenant_id uuid,user_id uuid,branch_id uuid);
CREATE TABLE clinical_appointments(id uuid,tenant_id uuid,branch_id uuid,doctor_id uuid,department_id uuid,appointment_number text,visit_type text,discount numeric,consultation_fee numeric,charges jsonb);
CREATE TABLE ipd_admissions(id uuid,tenant_id uuid,consultant_doctor_id uuid,department_id uuid,admission_type text);
CREATE TABLE departments(id uuid,tenant_id uuid,name text,branch_id uuid,is_active boolean DEFAULT true);
CREATE TABLE role_work_items(id uuid,tenant_id uuid,data jsonb);
CREATE TABLE hospital_print_templates(tenant_id uuid,document_type text,header_image text,footer_content text);
`);
for(const user of [user1,user2])await db.query('INSERT INTO users VALUES($1,$2,$3,$4,$5)',[user,tenant,branch1,user===user1?'Reception One':'Reception Two','']);
for(const [branch,name] of [[branch1,'Hatigaon'],[branch2,'Guwahati']])await db.query('INSERT INTO branches VALUES($1,$2,$3)',[branch,tenant,name]);
for(const [department,branch,name] of [[id(20),branch1,'Cardiology'],[id(21),branch2,'Neurology'],[id(22),null,'Laboratory']])await db.query('INSERT INTO departments(id,tenant_id,name,branch_id) VALUES($1,$2,$3,$4)',[department,tenant,name,branch]);
for(const [record,user,branch,t] of [[id(10),user1,branch1,tenant],[id(11),user2,branch1,tenant],[id(12),user1,branch2,tenant],[id(13),user1,branch1,otherTenant]])await db.query("INSERT INTO finance_records(id,tenant_id,branch_id,created_by,kind,record_number,record_date,amount) VALUES($1,$2,$3,$4,'payments',$5,'2026-10-09',100)",[record,t,branch,user,record]);
const originalQuery=pool.query,originalConnect=pool.connect;
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'},{id:branch1,code:'RECEPTIONIST'}]};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'billing.view'}]};
  if(sql.startsWith('SELECT f.*')||sql.startsWith('SELECT DISTINCT u.id')||sql.includes('SELECT branch_id FROM user_branch_access')||sql.startsWith('SELECT id,name FROM branches')||sql.startsWith('SELECT id,name,branch_id FROM departments'))return db.query(sql,args);
  return {rows:[],rowCount:0};
};
(pool as any).connect=async()=>({query:async()=>({rows:[],rowCount:0}),release(){}});
const app=express();app.use(express.json());app.use(router);app.use((error:any,_req:any,res:any,_next:any)=>res.status(500).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function request(user:string,kind:string,portal='receptionist',role='receptionist',expectedStatus=200){
  const token=jwt.sign({sub:user,tenantId:tenant,branchId:branch1,portal,role},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});
  const response=await fetch(base+`/finance/${kind}${kind.includes('?')?'&':'?'}user=${user2}`,{headers:{Authorization:`Bearer ${token}`}});const data=await response.json();assert.equal(response.status,expectedStatus,JSON.stringify(data));return data;
}

test('accounting reads only the requested date range and keeps user and branch restrictions',async()=>{
  const rows=await request(user1,'reception-accounting?from=2026-10-09&to=2026-10-09');
  assert.ok(rows.length>0);assert.ok(rows.every((row:any)=>String(row.record_date).startsWith('2026-10-09')));
  assert.deepEqual(await request(user1,'reception-accounting?from=2026-10-10&to=2026-10-10'),[]);
  assert.deepEqual(await request(user1,'reception-accounting?to=2026-10-08'),[]);
  assert.equal((await request(user1,'reception-accounting?from=2026-10-10&to=2026-10-09','receptionist','receptionist',400)).error,'From Date must be on or before To Date');
});

test('accounting invoice synchronization avoids downloading the invoice ledger',async()=>{
  const queries:string[]=[];
  const query=pool.query;
  (pool as any).query=async(sql:string,args:any[]=[])=>{queries.push(sql);return (query as any)(sql,args);};
  try{
    assert.deepEqual(await request(user1,'invoices?sync_only=true','hospital_admin','hospital_admin'),{synced:true});
    assert.ok(queries.some(sql=>sql.includes('INSERT INTO finance_records')));
    assert.ok(!queries.some(sql=>sql.startsWith('SELECT f.*')));
  }finally{pool.query=query;}
});
test('reception accounting cannot expose another receptionist, branch or hospital, even with a forged user filter',async()=>{
  const one=await request(user1,'reception-accounting'),two=await request(user2,'reception-accounting');assert.deepEqual(one.map((row:any)=>row.id),[id(10)]);assert.deepEqual(two.map((row:any)=>row.id),[id(11)]);
  assert.equal(one[0].created_by,user1);assert.ok(Object.hasOwn(one[0],'accounting_doctor_id'));
});
test('reception cannot bypass ownership through the combined ledger endpoint while accountant access stays branch-scoped',async()=>{
  assert.deepEqual((await request(user1,'all')).map((row:any)=>row.id),[id(10)]);
  assert.deepEqual((await request(user1,'all','accountant','accountant')).map((row:any)=>row.id).sort(),[id(10),id(11)].sort());
  assert.equal((await request(user1,'all','hospital_admin','hospital_admin')).length,3);
  assert.equal((await request(user1,'reception-accounting','hospital_admin','hospital_admin')).length,3);
});
test('accounting filters include encounters and departments within authorized branches, with hospital-wide admin options',async()=>{
  const reception=await request(user1,'accounting-options');
  assert.deepEqual(reception.branches.map((row:any)=>row.id),[branch1]);
  assert.deepEqual(reception.departments.map((row:any)=>row.name),['Cardiology','Laboratory']);
  assert.ok(reception.encounters.includes('OPD'));assert.ok(reception.encounters.includes('IPD'));
  assert.ok(reception.encounters.includes('Laboratory & Radiology'));
  assert.ok(!reception.encounters.includes('Laboratory'));assert.ok(!reception.encounters.includes('Radiology'));
  const admin=await request(user1,'accounting-options','hospital_admin','hospital_admin');
  assert.equal(admin.branches.length,2);assert.equal(admin.departments.length,3);
});
test('laboratory bill downloads enforce tenant, branch and reception ownership restrictions',async()=>{
  for(const [invoice,user,branch,t] of [[id(30),user1,branch1,tenant],[id(31),user2,branch1,tenant],[id(32),user1,branch2,tenant],[id(33),user1,branch1,otherTenant]]){
    await db.query("INSERT INTO finance_records(id,tenant_id,branch_id,created_by,kind,record_number,data) VALUES($1::uuid,$2,$3,$4,'invoices',$1::uuid::text,$5)",[invoice,t,branch,user,{lab_order_id:id(40),tests:[{name:'Blood test',amount:1000}],refer_pharmacy_name:'Town Pharmacy',pharmacy_discount_percentage:50}]);
  }
  const own=await request(user1,'lab-invoices/'+id(30));assert.equal(own.id,id(30));assert.equal(own.data.refer_pharmacy_name,'Town Pharmacy');
  await db.query("INSERT INTO patients(id,tenant_id,first_name,last_name,phone,date_of_birth,address) VALUES($1,$2,'Example','Patient','9876543210','1997-01-01',$3)",[id(74),tenant,{line:'12 Example Road',city:'Guwahati'}]);
  await db.query('UPDATE finance_records SET patient_id=$1 WHERE id=$2',[id(74),id(30)]);
  const details=await request(user1,'lab-invoices/'+id(30));
  assert.equal(details.patient_phone,'9876543210');assert.ok(String(details.patient_date_of_birth).startsWith('1997-01-01'));assert.equal(details.patient_address.line,'12 Example Road');
  for(const hidden of [id(31),id(32),id(33)])assert.equal((await request(user1,'lab-invoices/'+hidden,'receptionist','receptionist',404)).error,'Laboratory invoice not found');
  assert.equal((await request(user1,'lab-invoices/'+id(31),'hospital_admin','hospital_admin')).id,id(31));
  assert.equal((await request(user1,'lab-invoices/'+id(32),'hospital_admin','hospital_admin')).id,id(32));
});

test('lab bills and their receipts and refunds keep Laboratory encounter despite an OPD appointment link',async()=>{
  const appointment=id(50),invoice=id(51),payment=id(52),refund=id(53),opdPayment=id(54),legacyPayment=id(55);
  try{
    await db.query("INSERT INTO clinical_appointments(id,tenant_id,appointment_number) VALUES($1,$2,'OPD-001')",[appointment,tenant]);
    for(const [record,kind,invoiceId,data] of [
      [invoice,'invoices',null,{source:'Laboratory',lab_order_id:id(56),appointment_id:appointment}],
      [payment,'payments',invoice,{source:'OPD',appointment_id:appointment}],
      [refund,'refunds',invoice,{appointment_id:appointment}],
      [opdPayment,'payments',null,{source:'OPD',appointment_id:appointment}],
      [legacyPayment,'payments',null,{source:'Laboratory',appointment_id:appointment}],
    ] as const){
      await db.query("INSERT INTO finance_records(id,tenant_id,branch_id,created_by,kind,record_number,invoice_id,data,amount,record_date) VALUES($1::uuid,$2,$3,$4,$5,$1::uuid::text,$6,$7,100,'2026-10-09')",[record,tenant,branch1,user1,kind,invoiceId,JSON.stringify(data)]);
    }
    const rows=await request(user1,'reception-accounting');
    for(const record of [invoice,payment,refund,legacyPayment])assert.equal(rows.find((row:any)=>row.id===record)?.accounting_encounter,'Laboratory',record);
    assert.equal(rows.find((row:any)=>row.id===opdPayment)?.accounting_encounter,'OPD');
  }finally{
    await db.query('DELETE FROM finance_records WHERE id=ANY($1::uuid[])',[[invoice,payment,refund,opdPayment,legacyPayment]]);
    await db.query('DELETE FROM clinical_appointments WHERE id=$1',[appointment]);
  }
});

test('OPD doctors load without receipts and recovered legacy receipts retain branch restrictions',async()=>{
  const doctor=id(70),appointment=id(71),record=id(72),hidden=id(73);
  try{
    await db.query("INSERT INTO users VALUES($1,$2,$3,'Doctor Available','')",[doctor,tenant,branch1]);
    await db.query("INSERT INTO clinical_appointments(id,tenant_id,branch_id,doctor_id,appointment_number) VALUES($1,$2,$3,$4,'APT-071')",[appointment,tenant,branch1,doctor]);
    await db.query('UPDATE clinical_appointments SET consultation_fee=600,charges=$1 WHERE id=$2',[JSON.stringify([{label:'Registration Fee',amount:100},{label:'Maintenance Fee',amount:100}]),appointment]);
    const options=await request(user1,'accounting-options');
    assert.ok(options.doctors.some((row:any)=>row.id===doctor&&row.name==='Doctor Available'));
    for(const [receipt,branch] of [[record,branch1],[hidden,branch2]])
      await db.query("INSERT INTO finance_records(id,tenant_id,branch_id,kind,record_number,data,amount,record_date) VALUES($1::uuid,$2,$3,'payments',$1::uuid::text,$4,500,'2026-10-27')",[receipt,tenant,branch,{source:'OPD Appointment',appointment_id:appointment,legacy_receipt:true}]);
    await db.query("INSERT INTO patients(id,tenant_id,first_name,last_name,phone) VALUES($1,$2,'Example','Patient','9876543210')",[id(75),tenant]);
    await db.query('UPDATE finance_records SET patient_id=$1 WHERE id=$2',[id(75),record]);
    const rows=await request(user1,'reception-accounting');
    assert.equal(rows.find((row:any)=>row.id===record)?.patient_phone,'9876543210');
    assert.equal(rows.find((row:any)=>row.id===record)?.accounting_doctor_name,'Doctor Available');
    assert.equal(Number(rows.find((row:any)=>row.id===record)?.accounting_opd_amount),600);
    assert.equal(rows.find((row:any)=>row.id===record)?.accounting_appointment_charges[1].amount,100);
    assert.ok(!rows.some((row:any)=>row.id===hidden));
  }finally{
    await db.query('DELETE FROM finance_records WHERE id=ANY($1::uuid[])',[[record,hidden]]);
    await db.query('DELETE FROM clinical_appointments WHERE id=$1',[appointment]);
    await db.query('DELETE FROM users WHERE id=$1',[doctor]);
    await db.query('DELETE FROM patients WHERE id=$1',[id(75)]);
  }
});

test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=originalQuery;pool.connect=originalConnect;await pool.end();await db.close();});
