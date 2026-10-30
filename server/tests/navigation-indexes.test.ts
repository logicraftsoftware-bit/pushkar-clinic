import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {navigationIndexesSql} from '../src/navigation-indexes.js';

test('navigation indexes support login and newest-first patient lists with tenant isolation',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE TABLE users(id int,email text,phone text);
      CREATE TABLE patients(id int,tenant_id text,created_at timestamptz,deleted_at timestamptz);
      CREATE TABLE clinical_appointments(tenant_id text,patient_id int,doctor_id int,appointment_date date,appointment_time time);
      CREATE TABLE ipd_admissions(tenant_id text,patient_id int,admitted_at timestamptz);
      CREATE TABLE finance_records(tenant_id text,patient_id int,created_at timestamptz);
      CREATE TABLE inventory_records(tenant_id text,kind text,created_at timestamptz);
      CREATE TABLE staff_members(user_id int);
      INSERT INTO users SELECT n,'person'||n||'@example.test','phone'||n FROM generate_series(1,10000) n;
      INSERT INTO patients SELECT n,CASE WHEN n<=6000 THEN 'hospital' ELSE 'other' END,now()-n*interval '1 minute',CASE WHEN n=1 THEN now() ELSE null END FROM generate_series(1,10000) n;`);
    await db.exec(navigationIndexesSql);await db.exec(navigationIndexesSql);
    await db.exec('ANALYZE users; ANALYZE patients');
    const loginPlan=await db.query(`EXPLAIN SELECT id FROM users WHERE lower(email::text)=lower($1) OR phone=$1`,['PERSON50@EXAMPLE.TEST']);
    const plan=JSON.stringify(loginPlan.rows);assert.match(plan,/users_login_email_idx/);assert.match(plan,/users_login_phone_idx/);
    const rows=await db.query<{id:number}>(`SELECT id FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`,['hospital']);
    assert.deepEqual(rows.rows.map(row=>row.id),[2,3,4,5,6]);
    const patientPlan=await db.query(`EXPLAIN SELECT id FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`,['hospital']);
    assert.match(JSON.stringify(patientPlan.rows),/patients_tenant_created_idx/);
    const migration=await readFile(new URL('../../database/migrations/026_navigation_performance_indexes.sql',import.meta.url),'utf8');
    assert.ok(migration.includes(navigationIndexesSql.trim()));
  }finally{await db.close();}
});
