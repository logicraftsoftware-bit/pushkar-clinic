import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {accountAccessProblem,type LiveAccount} from '../src/live-access-policy.js';
import {liveAccessSchemaSql} from '../src/live-access-schema.js';
import {roleLabel,baseRoleForCode} from '../src/role-label.js';
const account:LiveAccount={role:'laboratory',is_active:true,hospital_status:'active',deleted_at:null,account_expires_at:null,role_codes:['LAB_TECHNICIAN'],assigned_roles:1};
test('role labels are consistent while standard role changes select the correct login workspace',()=>{
  assert.equal(roleLabel('  senior  lab TECHNICIAN '),'Senior Lab Technician');
  assert.equal(roleLabel('hr manager'),'HR Manager');
  assert.equal(baseRoleForCode('LAB_TECHNICIAN'),'laboratory');
  assert.equal(baseRoleForCode('ACCOUNTANT'),'accountant');
  assert.equal(baseRoleForCode('CUSTOM_BILLING'),undefined);
});
test('current account state blocks disabled, expired, inactive-role and stale-role sessions',()=>{
  const claims={role:'laboratory',portal:'lab_manager'};
  assert.equal(accountAccessProblem(account,claims),null);
  assert.match(accountAccessProblem({...account,is_active:false},claims)!,/disabled/);
  assert.match(accountAccessProblem({...account,hospital_status:'suspended'},claims)!,/hospital account/);
  assert.match(accountAccessProblem({...account,account_expires_at:'2020-01-01'},claims)!,/expired/);
  assert.match(accountAccessProblem({...account,role_codes:[]},claims)!,/inactive/);
  assert.match(accountAccessProblem({...account,role:'accountant'},claims)!,/role has changed/);
  assert.match(accountAccessProblem({...account,role_codes:['ACCOUNTANT']},claims)!,/workspace access has changed/);
  assert.equal(accountAccessProblem({...account,role_codes:['CUSTOM']},claims),null);
  assert.equal(accountAccessProblem({...account,assigned_roles:0,role_codes:[]},claims),null);
});
test('notification triggers cover access tables and late-created role tables without modifying existing records',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE users(id int PRIMARY KEY,is_active boolean,last_login_at timestamptz,updated_at timestamptz); INSERT INTO users VALUES(1,true,now(),now());');
    await db.exec(liveAccessSchemaSql);
    const notifications:string[]=[];await db.listen('careframe_access_changed',payload=>notifications.push(payload));
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM pg_trigger WHERE tgname='access_changed'")).rows[0].n,1);
    await db.exec('CREATE TABLE rbac_roles(id int PRIMARY KEY,status text); SELECT install_access_notification_triggers(); SELECT install_access_notification_triggers();');
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM pg_trigger WHERE tgname='access_changed'")).rows[0].n,2);
    await db.exec('UPDATE users SET last_login_at=now(); BEGIN; UPDATE users SET is_active=false; ROLLBACK;');
    assert.equal(notifications.length,0,'login timestamps and rolled-back access changes do not notify browsers');
    assert.equal((await db.query<{is_active:boolean}>('SELECT is_active FROM users')).rows[0].is_active,true);
    await db.exec('BEGIN; UPDATE users SET is_active=false;');assert.equal(notifications.length,0);
    await db.exec('COMMIT;');assert.deepEqual(notifications,['refresh'],'access change is published only after commit');
    await db.exec("INSERT INTO rbac_roles VALUES(1,'Active'); UPDATE rbac_roles SET status='Inactive'; DELETE FROM rbac_roles;");
  }finally{await db.close();}
});
