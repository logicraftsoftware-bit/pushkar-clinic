import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appointmentSelection} from '../../src/hospital/appointment-selection.js';
import {PGlite} from '@electric-sql/pglite';
import {appointmentDoctorSelectionSql} from '../src/clinical-doctors.js';

test('appointment choices require branch then its department, and use branch-specific doctor details',()=>{
  const departments=[{id:'a',branch_id:'one'},{id:'b',branch_id:'two'},{id:'c',branch_id:'one',is_active:false}];
  const doctors=[{id:'shared',branch_id:'one',department_id:'a',consultation_fee:500},{id:'shared',branch_id:'two',department_id:'b',consultation_fee:700}];
  assert.deepEqual(appointmentSelection(departments,doctors,'','','').departments,[]);
  assert.deepEqual(appointmentSelection(departments,doctors,'one','','').doctors,[]);
  assert.deepEqual(appointmentSelection(departments,doctors,'one','b','shared').doctors,[]);
  assert.deepEqual(appointmentSelection(departments,doctors,'one','a','shared').departments,[departments[0]]);
  assert.equal(appointmentSelection(departments,doctors,'one','a','shared').doctor?.consultation_fee,500);
  assert.equal(appointmentSelection(departments,doctors,'two','b','shared').doctor?.consultation_fee,700);
  assert.equal(appointmentSelection(departments,doctors,'two','a','shared').doctor,undefined);
});

test('server validates the exact branch and department assignment, including per-branch department overrides',async()=>{
  const db=new PGlite(),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const tenant=id(1),doctor=id(2),branch1=id(3),branch2=id(4),department1=id(5),department2=id(6);
  try {
    await db.exec(`CREATE TABLE users(id uuid,tenant_id uuid,branch_id uuid,department_id uuid,role text,is_active boolean);
      CREATE TABLE staff_members(user_id uuid,tenant_id uuid,first_name text,last_name text,staff_type text,status text,department_id uuid,professional jsonb);
      CREATE TABLE user_branch_access(user_id uuid,tenant_id uuid,branch_id uuid);
      CREATE TABLE departments(id uuid,tenant_id uuid,branch_id uuid,is_active boolean);`);
    await db.query("INSERT INTO users VALUES($1,$2,$3,$4,'doctor',true)",[doctor,tenant,branch1,department1]);
    await db.query("INSERT INTO staff_members VALUES($1,$2,'Test','Doctor','Doctor','Active',$3,$4)",[doctor,tenant,department1,{branch_fees:{[branch2]:{department_id:department2,consultation_fee:700}}}]);
    await db.query('INSERT INTO user_branch_access VALUES($1,$2,$3),($1,$2,$4)',[doctor,tenant,branch1,branch2]);
    await db.query('INSERT INTO departments VALUES($1,$2,$3,true),($4,$2,$5,true)',[department1,tenant,branch1,department2,branch2]);
    assert.equal((await db.query(appointmentDoctorSelectionSql,[tenant,[branch2],doctor,department2])).rows.length,1);
    for(const args of [[tenant,[branch2],doctor,department1],[tenant,[branch1],doctor,department2],[id(99),[branch2],doctor,department2]])assert.equal((await db.query(appointmentDoctorSelectionSql,args)).rows.length,0);
    await db.query('UPDATE departments SET is_active=false WHERE id=$1',[department2]);
    assert.equal((await db.query(appointmentDoctorSelectionSql,[tenant,[branch2],doctor,department2])).rows.length,0);
  } finally {await db.close();}
});
