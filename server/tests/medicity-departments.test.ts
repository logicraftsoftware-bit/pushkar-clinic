import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {medicityDepartmentSyncSql} from '../src/medicity-departments.js';

test('copies the catalogue to both Medicity branches without changing references or duplicating names',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE hospitals(id int,deleted_at timestamptz);
      CREATE TABLE branches(id int,tenant_id int,name text);
      CREATE TABLE departments(id serial PRIMARY KEY,tenant_id int,branch_id int,name text,code text,
        is_active boolean DEFAULT true,hod_name text,location text,phone_extension text,description text DEFAULT '',
        created_at timestamptz DEFAULT now(),UNIQUE(tenant_id,branch_id,code));
      INSERT INTO hospitals VALUES(1,null),(2,null),(3,null),(4,now());
      INSERT INTO branches VALUES(10,1,'Medicity Guwahati'),(11,1,'Medicity Guwahati Diagnostics'),(12,1,'Dental'),
        (20,2,'Other Hospital'),(30,3,'Medicity Guwahati'),
        (40,4,'Medicity Guwahati'),(41,4,'Medicity Guwahati Diagnostics');
      INSERT INTO departments(tenant_id,branch_id,name,code,is_active) VALUES
        (1,10,'ENT','ENT',true),(1,11,'Dermatology','DERM',true),(1,12,'Surgery','SURG',true),
        (1,12,' ent ','ENT-DUP',true),(1,10,'Retired','OLD',false),
        (2,20,'Other Department','OTHER',true),(3,30,'Unpaired','UNPAIRED',true),
        (4,40,'Deleted Hospital','DELETED',true);`);
    const before=await db.query('SELECT * FROM departments ORDER BY id');
    const result=await db.query(medicityDepartmentSyncSql);
    assert.equal(result.rows.length,4);
    for(const branch of [10,11]) {
      const rows=await db.query<{name:string}>('SELECT lower(trim(name)) name FROM departments WHERE branch_id=$1 AND is_active ORDER BY name',[branch]);
      assert.deepEqual(rows.rows.map(row=>row.name),['dermatology','ent','surgery']);
    }
    assert.deepEqual((await db.query('SELECT * FROM departments WHERE id<=8 ORDER BY id')).rows,before.rows);
    assert.equal((await db.query(medicityDepartmentSyncSql)).rows.length,0);
    assert.equal((await db.query('SELECT count(*)::int total FROM departments WHERE tenant_id<>1')).rows[0].total,3);
  } finally {await db.close();}
});
