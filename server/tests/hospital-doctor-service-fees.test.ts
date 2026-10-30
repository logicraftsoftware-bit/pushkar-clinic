import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setHospitalDoctorServiceFees} from '../src/hospital-doctor-service-fees.js';
test('Hospital doctors get registration 200 and maintenance 100 without changing other branches or default fees',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE hospitals(id text,name text,deleted_at timestamptz);CREATE TABLE branches(id text,tenant_id text,name text,is_active boolean);CREATE TABLE users(id text,tenant_id text,branch_id text);CREATE TABLE user_branch_access(user_id text,tenant_id text,branch_id text);CREATE TABLE staff_members(id text,tenant_id text,user_id text,staff_type text,branch_id text,professional jsonb,updated_at timestamptz);
  INSERT INTO hospitals VALUES('med','Medicity Guwahati',NULL),('other','Other Hospital',NULL);INSERT INTO branches VALUES('hospital','med','MEDICITY GUWAHATI HOSPITAL',true),('diagnostics','med','Medicity Guwahati Diagnostics',true);
  INSERT INTO users VALUES('user1','med','hospital'),('user2','med','diagnostics'),('user3','med','diagnostics');INSERT INTO user_branch_access VALUES('user2','med','hospital');
  INSERT INTO staff_members VALUES('a','med','user1','Doctor','hospital','{"consultation_fee":1100,"registration_fee":100,"maintenance_fee":100,"branch_fees":{"hospital":{"consultation_fee":1200,"department_id":"keep"},"diagnostics":{"consultation_fee":1000,"registration_fee":100,"maintenance_fee":100}}}',now()),('b','med','user2','Doctor','diagnostics','{"consultation_fee":600}',now()),('c','med','user3','Doctor','diagnostics','{"registration_fee":100,"maintenance_fee":100}',now()),('d','other',NULL,'Doctor','hospital','{}',now()),('e','med',NULL,'Nurse','hospital','{}',now());`);
  const result=await setHospitalDoctorServiceFees(db as any);assert.equal(result.doctors_updated,2);
  const rows=(await db.query<any>('SELECT id,professional FROM staff_members ORDER BY id')).rows;
  assert.deepEqual(rows[0].professional.branch_fees.hospital,{consultation_fee:1200,department_id:'keep',registration_fee:200,maintenance_fee:100});assert.equal(rows[0].professional.consultation_fee,1100);assert.equal(rows[0].professional.registration_fee,100);
  assert.deepEqual(rows[0].professional.branch_fees.diagnostics,{consultation_fee:1000,registration_fee:100,maintenance_fee:100});assert.equal(rows[1].professional.branch_fees.hospital.registration_fee,200);
  assert.deepEqual(rows[2].professional,{registration_fee:100,maintenance_fee:100});assert.deepEqual(rows[3].professional,{});assert.deepEqual(rows[4].professional,{});
  const backup=(await db.query<any>('SELECT backup FROM doctor_service_fee_initialisations')).rows[0].backup;assert.equal(backup.doctors.length,2);assert.equal(backup.doctors[0].professional.branch_fees.hospital.registration_fee,undefined);
  await db.exec(`UPDATE staff_members SET professional=jsonb_set(professional,'{branch_fees,hospital,registration_fee}','250') WHERE id='a'`);
  assert.equal((await setHospitalDoctorServiceFees(db as any)).already_applied,true);assert.equal((await db.query<any>("SELECT professional FROM staff_members WHERE id='a'")).rows[0].professional.branch_fees.hospital.registration_fee,250);
 }finally{await db.close();}
});
