import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {clinicalDoctorLookupSql,labDoctorLookupSql} from '../src/clinical-doctors.js';
test('OPD and Lab share active doctors and lab referrals deduplicate branch assignments by doctor identity',async()=>{
 const db=new PGlite();const tenant='00000000-0000-4000-8000-000000000001',doctor='00000000-0000-4000-8000-000000000002',branch1='00000000-0000-4000-8000-000000000003',branch2='00000000-0000-4000-8000-000000000004';
 try{
 await db.exec('CREATE TABLE users(id uuid,tenant_id uuid,branch_id uuid,department_id uuid,role text,is_active boolean);CREATE TABLE staff_members(user_id uuid,tenant_id uuid,first_name text,last_name text,staff_type text,status text,department_id uuid,professional jsonb);CREATE TABLE user_branch_access(user_id uuid,tenant_id uuid,branch_id uuid);');
 await db.query("INSERT INTO users VALUES($1,$2,$3,null,'doctor',true)",[doctor,tenant,branch1]);await db.query("INSERT INTO staff_members VALUES($1,$2,'Test','Doctor','Doctor','Active',null,$3)",[doctor,tenant,{doctor_qualification:'MBBS, MD'}]);await db.query('INSERT INTO user_branch_access VALUES($1,$2,$3),($1,$2,$4)',[doctor,tenant,branch1,branch2]);
 const opd=await db.query<any>(clinicalDoctorLookupSql,[tenant,[branch1]]);assert.equal(opd.rows.length,1);assert.equal(opd.rows[0].id,doctor);
 const lab=await db.query<any>(labDoctorLookupSql,[tenant,null]);assert.deepEqual(lab.rows,[{id:doctor,name:'Test Doctor',doctor_qualification:'MBBS, MD'}]);assert.equal(lab.rows[0].id,opd.rows[0].id);
 assert.equal((await db.query(labDoctorLookupSql,[branch1,null])).rows.length,0);
 await db.exec("UPDATE staff_members SET status='Inactive'");assert.equal((await db.query(labDoctorLookupSql,[tenant,null])).rows.length,0);assert.equal((await db.query(clinicalDoctorLookupSql,[tenant,[branch1]])).rows.length,0);
 }finally{await db.close();}
});
