import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {medicityDentalRetirementSql} from '../src/medicity-dental-retirement.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

async function fixture(){
  const db=new PGlite();
  await db.exec(`CREATE TABLE hospitals(id uuid PRIMARY KEY,deleted_at timestamptz);
    CREATE TABLE branches(id uuid PRIMARY KEY,tenant_id uuid REFERENCES hospitals(id),name text,is_active boolean DEFAULT true,updated_at timestamptz DEFAULT now());
    CREATE TABLE departments(id uuid PRIMARY KEY,tenant_id uuid REFERENCES hospitals(id),branch_id uuid REFERENCES branches(id),name text,is_active boolean DEFAULT true,updated_at timestamptz DEFAULT now());
    CREATE TABLE patients(id int PRIMARY KEY,branch_id uuid REFERENCES branches(id));
    CREATE TABLE clinical_appointments(id int PRIMARY KEY,patient_id int REFERENCES patients(id),branch_id uuid REFERENCES branches(id),department_id uuid REFERENCES departments(id));
    CREATE TABLE finance_records(id int PRIMARY KEY,patient_id int REFERENCES patients(id),branch_id uuid REFERENCES branches(id),total numeric);`);
  await db.query('INSERT INTO hospitals VALUES($1,null),($2,null),($3,now())',[id(1),id(2),id(3)]);
  for(const [branch,tenant,name] of [
    [10,1,'MEDICITY GUWAHATI HOSPITAL'],[11,1,'Medicity Guwahati Diagnostics'],
    [12,1,'Medicity Guwahati Dental Braces & Implant Center'],[13,1,'Medicity Multispeciality Dental Clinic'],
    [14,1,'Another Dental Centre'],[20,2,'Other Hospital'],[21,2,'Medicity Multispeciality Dental Clinic'],
    [30,3,'Medicity Guwahati'],[31,3,'Medicity Guwahati Diagnostics'],[32,3,'Medicity Multispeciality Dental Clinic'],
  ] as const)await db.query('INSERT INTO branches(id,tenant_id,name) VALUES($1,$2,$3)',[id(branch),id(tenant),name]);
  for(const [department,tenant,branch,name] of [
    [100,1,10,'DENTAL'],[101,1,11,' Dental '],[102,1,12,'Dental'],[103,1,13,'DENTAL'],
    [104,1,10,'Dermatology'],[105,1,11,'ENT'],[106,1,12,'Dental Surgery'],[107,1,14,'Surgery'],
    [200,2,20,'DENTAL'],[201,2,21,'DENTAL'],[300,3,30,'DENTAL'],
  ] as const)await db.query('INSERT INTO departments(id,tenant_id,branch_id,name) VALUES($1,$2,$3,$4)',[id(department),id(tenant),id(branch),name]);
  await db.query('INSERT INTO patients VALUES(1,$1)',[id(12)]);
  await db.query('INSERT INTO clinical_appointments VALUES(1,1,$1,$2)',[id(12),id(102)]);
  await db.query('INSERT INTO finance_records VALUES(1,1,$1,1250.50)',[id(12)]);
  return db;
}

test('retires exactly the requested centres and Dental departments, retaining history and a one-time recovery snapshot',async()=>{
  const db=await fixture();
  try{
    const other=await db.query('SELECT * FROM branches WHERE tenant_id<>$1 ORDER BY id',[id(1)]);
    const history=async()=>Promise.all(['patients','clinical_appointments','finance_records'].map(table=>db.query(`SELECT * FROM ${table} ORDER BY id`)));
    const before=await history();await db.exec(medicityDentalRetirementSql);
    assert.deepEqual((await db.query('SELECT name FROM branches WHERE tenant_id=$1 AND is_active ORDER BY id',[id(1)])).rows.map(row=>row.name),['MEDICITY GUWAHATI HOSPITAL','Medicity Guwahati Diagnostics','Another Dental Centre']);
    assert.deepEqual((await db.query('SELECT name FROM departments WHERE tenant_id=$1 AND is_active ORDER BY id',[id(1)])).rows.map(row=>row.name),['Dermatology','ENT','Surgery']);
    assert.deepEqual((await db.query('SELECT * FROM branches WHERE tenant_id<>$1 ORDER BY id',[id(1)])).rows,other.rows);
    assert.equal((await db.query('SELECT count(*)::int n FROM departments WHERE tenant_id<>$1 AND is_active',[id(1)])).rows[0].n,3);
    assert.deepEqual(await history(),before);
    const audit=await db.query<any>('SELECT * FROM erp_catalog_retirements');
    assert.equal(audit.rows.length,1);assert.equal(audit.rows[0].snapshot.branches.length,2);assert.equal(audit.rows[0].snapshot.departments.length,5);
    assert.ok(audit.rows[0].snapshot.branches.every((branch:any)=>branch.is_active));
    const retired=await db.query('SELECT * FROM branches ORDER BY id');await db.exec(medicityDentalRetirementSql);
    assert.deepEqual((await db.query('SELECT * FROM branches ORDER BY id')).rows,retired.rows);
    assert.deepEqual((await db.query('SELECT * FROM erp_catalog_retirements')).rows,audit.rows);
    const migration=await readFile(new URL('../../database/migrations/027_retire_medicity_dental_catalog.sql',import.meta.url),'utf8');assert.ok(!migration.includes(medicityDentalRetirementSql.trim()),'a fresh clinic must not automatically run the previous-client retirement');
  }finally{await db.close();}
});

test('ambiguous matching hospitals abort retirement without modifying their catalogue',async()=>{
  const db=await fixture();
  try{
    await db.query('INSERT INTO branches(id,tenant_id,name) VALUES($1,$2,$3),($4,$2,$5)',[id(22),id(2),'Medicity Guwahati',id(23),'Medicity Guwahati Diagnostics']);
    const before=await db.query('SELECT * FROM branches ORDER BY id');
    await assert.rejects(()=>db.exec(medicityDentalRetirementSql),/Ambiguous Medicity hospital/);
    assert.deepEqual((await db.query('SELECT * FROM branches ORDER BY id')).rows,before.rows);
  }finally{await db.close();}
});
