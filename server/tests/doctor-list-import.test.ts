import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import type {PoolClient} from 'pg';
import {planDoctorList,type DoctorListRow} from '../src/doctor-list-plan.js';
import {importDoctorList} from '../src/doctor-list-import.js';
const row=(name:string,fee='600',department='Medicine',n=2):DoctorListRow=>({name,fee,department,row:n});

test('first Excel row wins, services are excluded, and uncertain spelling matches need review',()=>{
  const plan=planDoctorList([row('DR ADAM ALI','1500'),row('Dr. Adam Ali','600','Medicine',3),row('EAR CLEANING'),row('Dr. Example Sharma')],
    [{id:'one',name:'Dr Adam Ali',status:'Active'},{id:'two',name:'Dr Example Sarma',status:'Active'}],'first');
  assert.equal(plan.ready.length,1);assert.equal(plan.ready[0]!.source.fee,'1500');
  assert.equal(plan.ready[0]!.matches[0].id,'one');assert.equal(plan.excluded.length,1);assert.equal(plan.review.length,1);
  assert.equal(planDoctorList([row('Adam Ali','1500'),row('Adam Ali','600')],[],'skip').review.length,1);
});

test('same-name Jyotirmoy specialties use separate existing identities',()=>{
  const result=planDoctorList([row('DR JYOTIRMOY DAS(GYNE)','700','OBSTERICS & GYNAECOLOGY'),row('DR.JYOTIRMOY DAS','1000','PSYCHIATRY')],
    [{id:'gyne',name:'Jyotirmoy Das',department:'Gynecology',status:'Active'}, {id:'psych',name:'Jyotirmoy Das',department:'Psychiatry',status:'Active'}],'first');
  assert.deepEqual(result.ready.map(item=>item.matches.map(match=>match.id)),[['gyne'],['psych']]);
});

test('imports missing doctors once, replaces both branch fees, preserves schedules and existing IDs, and saves recovery data',async()=>{
  const db=new PGlite();const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const tenant=id(1),main=id(2),diagnostics=id(3),outside=id(4),existing=id(5);
  const branches=[{id:main,name:'Medicity Guwahati'},{id:diagnostics,name:'Medicity Guwahati Diagnostics'}];
  const client={query:async(sql:string,args:any[]=[])=>db.query(sql,args)} as unknown as PoolClient;
  try {
    await db.exec(`CREATE TABLE hospitals(id uuid PRIMARY KEY);
      CREATE TABLE departments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,branch_id uuid,name text,code text,is_active boolean DEFAULT true,updated_at timestamptz DEFAULT now());
      CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid,branch_id uuid,department_id uuid,email text UNIQUE,password_hash text,first_name text,last_name text,role text,is_active boolean,force_password_change boolean,updated_at timestamptz);
      CREATE TABLE staff_members(id uuid PRIMARY KEY,tenant_id uuid,user_id uuid,employee_id text,first_name text,middle_name text,last_name text,staff_type text,branch_id uuid,department_id uuid,designation text,status text,employment jsonb,account jsonb,professional jsonb,updated_at timestamptz);
      CREATE TABLE user_branch_access(tenant_id uuid,user_id uuid,branch_id uuid,UNIQUE(tenant_id,user_id,branch_id));
      CREATE FUNCTION gen_salt(text,int) RETURNS text LANGUAGE sql AS $$ SELECT 'test-salt'::text $$;
      CREATE FUNCTION crypt(text,text) RETURNS text LANGUAGE sql AS $$ SELECT 'test-password-hash'::text $$;`);
    await db.query('INSERT INTO hospitals VALUES($1)',[tenant]);
    await db.query("INSERT INTO staff_members(id,tenant_id,employee_id,first_name,last_name,staff_type,branch_id,status,professional) VALUES($1,$2,'OLD-ID','Existing','Doctor','Doctor',$3,'Active',$4)",[existing,tenant,main,{consultation_fee:500,appointment_schedule:[{day:'Monday'}],branch_fees:{[outside]:{consultation_fee:900}}}]);
    const source=[row('Dr. Existing Doctor','750'),row('Dr. Brandnew Specialist','1000','Cardiology')];
    const result=await importDoctorList(client,tenant,branches,source,'first');
    assert.equal(result.added,1);assert.equal(result.updated,1);assert.equal(result.accounts_added,2);assert.equal(result.departments_added,4);
    const current=(await db.query<any>('SELECT * FROM staff_members WHERE id=$1',[existing])).rows[0];
    assert.equal(current.employee_id,'OLD-ID');assert.equal(current.first_name,'Existing');
    assert.deepEqual(current.professional.appointment_schedule,[{day:'Monday'}]);
    assert.equal(current.professional.branch_fees[outside].consultation_fee,900);
    for(const branch of branches){assert.equal(current.professional.branch_fees[branch.id].consultation_fee,750);assert.ok(current.professional.branch_fees[branch.id].department_id);}
    assert.equal((await db.query('SELECT * FROM user_branch_access')).rows.length,4);
    const backup=(await db.query<any>('SELECT backup FROM doctor_list_import_runs')).rows[0].backup;
    assert.equal(backup.staff[0].professional.consultation_fee,500);assert.equal(backup.new_staff_ids.length,1);
    assert.equal((await importDoctorList(client,tenant,branches,source,'first')).already_applied,true);
    assert.equal((await db.query('SELECT * FROM staff_members')).rows.length,2);
    const scoped=[{...row('Dr. Existing Doctor','600'),qualification:'MD (Medicine)',registration_fee:100,maintenance_fee:100}];
    const options={source:'Diagnostics roster test',preserveDefaultFees:true};
    await importDoctorList(client,tenant,[branches[1]!],scoped,'first',options);
    const scopedDoctor=(await db.query<any>('SELECT professional FROM staff_members WHERE id=$1',[existing])).rows[0].professional;
    assert.equal(scopedDoctor.doctor_qualification,'MD (Medicine)');assert.equal(scopedDoctor.consultation_fee,750);
    assert.equal(scopedDoctor.branch_fees[main].consultation_fee,750);assert.equal(scopedDoctor.branch_fees[outside].consultation_fee,900);
    assert.equal(scopedDoctor.branch_fees[diagnostics].consultation_fee,600);assert.equal(scopedDoctor.branch_fees[diagnostics].registration_fee,100);assert.equal(scopedDoctor.branch_fees[diagnostics].maintenance_fee,100);
    await importDoctorList(client,tenant,[branches[1]!],[{...scoped[0]!,qualification:'Not specified',fee:'601'}],'first',options);
    assert.equal((await db.query<any>('SELECT professional FROM staff_members WHERE id=$1',[existing])).rows[0].professional.doctor_qualification,'MD (Medicine)');
  } finally {await db.close();}
});

test('any database failure rolls back the import',async()=>{
  const calls:string[]=[];
  const client={query:async(sql:string)=>{calls.push(sql);if(sql.startsWith('CREATE TABLE'))throw Error('write failed');return {rows:[]};}} as unknown as PoolClient;
  await assert.rejects(importDoctorList(client,'tenant',[],[],'first'),/write failed/);
  assert.equal(calls.at(-1),'ROLLBACK');
});

test('complete roster imports roll back before editing when an identity requires review',async()=>{
 const calls:string[]=[];
 const client={query:async(sql:string)=>{calls.push(sql);return {rows:sql.includes('SELECT s.*')?[{id:'inactive',name:'Dr Example',status:'Inactive'}]:[]};}} as unknown as PoolClient;
 await assert.rejects(importDoctorList(client,'tenant',[],[row('Dr Example')],'first',{requireComplete:true}),/identity review/);
 assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.some(sql=>sql.startsWith('UPDATE')||sql.startsWith('INSERT')));
});
