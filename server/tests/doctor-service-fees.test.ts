import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {doctorServiceFees,doctorAppointmentCharges,initialiseDoctorServiceFees} from '../src/doctor-service-fees.js';

test('each doctor has separate registration and maintenance defaults and can set them independently',()=>{
 assert.deepEqual(doctorServiceFees(),{registration_fee:100,maintenance_fee:100});
 assert.deepEqual(doctorServiceFees({registration_fee:'150',maintenance_fee:0,consultation_fee:800}),{registration_fee:150,maintenance_fee:0});
 assert.throws(()=>doctorServiceFees({registration_fee:-1}),/non-negative/);
});
test('doctor selection adds both charges once, refreshes them for another doctor and retains other services',()=>{
 const original=[{label:'Dressing',amount:50}];
 const first=doctorAppointmentCharges(original,{});
 assert.equal(first.length,3);assert.equal(first.reduce((sum,row)=>sum+row.amount,0),250);assert.equal(original.length,1);
 const second=doctorAppointmentCharges(first,{registration_fee:200,maintenance_fee:75});
 assert.equal(second.length,3);assert.equal(second[0].label,'Dressing');assert.equal(second[1].amount,200);assert.equal(second[2].amount,75);
});
test('initialisation sets doctor fields to 100 once without changing consultation fees or other hospitals',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE hospitals(id text,name text,deleted_at timestamptz);CREATE TABLE staff_members(id text,tenant_id text,staff_type text,professional jsonb,updated_at timestamptz);
  INSERT INTO hospitals VALUES('med','Medicity Guwahati',NULL),('other','Other hospital',NULL);
  INSERT INTO staff_members VALUES('a','med','Doctor','{"consultation_fee":700,"branch_fees":{"branch":{"consultation_fee":800}}}',now()),('b','med','Doctor','{"registration_fee":0,"maintenance_fee":150}',now()),('c','other','Doctor','{}',now()),('d','med','Nurse','{}',now());`);
  const result=await initialiseDoctorServiceFees(db as any);assert.equal(result.doctors_initialised,2);
  const rows=(await db.query<any>('SELECT id,professional FROM staff_members ORDER BY id')).rows;
  assert.deepEqual(rows[0].professional,{registration_fee:100,maintenance_fee:100,consultation_fee:700,branch_fees:{branch:{consultation_fee:800}}});
  assert.deepEqual(rows[1].professional,{registration_fee:100,maintenance_fee:100});assert.deepEqual(rows[2].professional,{});assert.deepEqual(rows[3].professional,{});
  await db.exec(`UPDATE staff_members SET professional=professional||'{"maintenance_fee":150}'::jsonb WHERE id='a'`);
  assert.equal((await initialiseDoctorServiceFees(db as any)).already_applied,true);
  assert.equal((await db.query<any>("SELECT professional FROM staff_members WHERE id='a'")).rows[0].professional.maintenance_fee,150);
 }finally{await db.close();}
});

import {clinicalDoctorLookupSql} from '../src/clinical-doctors.js';
test('appointment doctor lookup resolves registration and maintenance fees for the selected branch',async()=>{
 const db=new PGlite();
 const tenant='00000000-0000-4000-8000-000000000001',doctor='00000000-0000-4000-8000-000000000002',a='00000000-0000-4000-8000-000000000003',b='00000000-0000-4000-8000-000000000004';
 try{
  await db.exec(`CREATE TABLE users(id uuid,tenant_id uuid,branch_id uuid,department_id uuid,role text,is_active boolean);CREATE TABLE staff_members(user_id uuid,tenant_id uuid,first_name text,last_name text,department_id uuid,staff_type text,status text,professional jsonb);CREATE TABLE user_branch_access(user_id uuid,tenant_id uuid,branch_id uuid);`);
  await db.query("INSERT INTO users VALUES($1,$2,$3,NULL,'doctor',true)",[doctor,tenant,a]);
  await db.query('INSERT INTO user_branch_access VALUES($1,$2,$3),($1,$2,$4)',[doctor,tenant,a,b]);
  const profile={consultation_fee:1100,registration_fee:100,maintenance_fee:100,branch_fees:{[a]:{consultation_fee:1200,registration_fee:75,maintenance_fee:0},[b]:{consultation_fee:950,registration_fee:'',maintenance_fee:50}}};
  await db.query("INSERT INTO staff_members VALUES($1,$2,'Example','Doctor',NULL,'Doctor','Active',$3::jsonb)",[doctor,tenant,JSON.stringify(profile)]);
  const rows=(await db.query<any>(clinicalDoctorLookupSql,[tenant,null])).rows;
  assert.equal(rows.length,2);const first=rows.find(row=>row.branch_id===a),second=rows.find(row=>row.branch_id===b);
  assert.deepEqual([Number(first.consultation_fee),Number(first.registration_fee),Number(first.maintenance_fee)],[1200,75,0]);
  assert.deepEqual([Number(second.consultation_fee),Number(second.registration_fee),Number(second.maintenance_fee)],[950,100,50]);
  assert.deepEqual(doctorAppointmentCharges([],second).map(row=>row.amount),[100,50]);
 }finally{await db.close();}
});

test('appointment fees are included only when their checkboxes are selected and save their amounts',()=>{
 const doctor={registration_fee:200,maintenance_fee:100};
 const extra=[{label:'Dressing',amount:50}];
 assert.deepEqual(doctorAppointmentCharges(extra,doctor,{registration_fee:false,maintenance_fee:false}),extra);
 const registration=doctorAppointmentCharges(extra,doctor,{registration_fee:true,maintenance_fee:false});assert.deepEqual(registration.map(row=>row.amount),[50,200]);assert.equal(registration[1].fee_snapshot_version,2);
 const maintenance=doctorAppointmentCharges(registration,doctor,{registration_fee:false,maintenance_fee:true});assert.deepEqual(maintenance.map(row=>row.amount),[50,100]);assert.equal(maintenance[1].doctor_fee,'maintenance_fee');
 assert.equal(registration[1].amount,200,'previous saved snapshot is not mutated when the selection changes');
 const free=doctorAppointmentCharges([],{registration_fee:0,maintenance_fee:0},{registration_fee:true,maintenance_fee:false});assert.equal(free.length,1);assert.equal(free[0].amount,0);
});
