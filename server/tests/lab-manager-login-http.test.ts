import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='lab-login-regression-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/portal-auth.js');
const original=pool.query;
let active=true,roleActive=true,roleCode='LAB_MANAGER',successes=0;
const user={id:'lab-user',tenant_id:'hospital',branch_id:'branch',role:'laboratory',email:'lab@example.test',phone:'',first_name:'Lab',last_name:'Manager',hospital_name:'Test Hospital',hospital_code:'TEST',hospital_status:'active',branch_name:'Main',force_password_change:true};
const valid=(args:any[],passwordIndex:number)=>active&&roleActive&&String(args[0]).toLowerCase()==='lab@example.test'&&args[passwordIndex]==='temporary-test-password';
(pool as any).query=async(sql:string,args:any[]=[])=>{
 if(sql.includes('CREATE TABLE'))return {rows:[]};
 if(sql.includes('SELECT u.role::text')){
   assert.match(sql,/rr.status='Active'/);assert.match(sql,/u.is_active/);assert.match(sql,/password_hash=crypt/);
   return {rows:valid(args,1)?[{role:'laboratory',role_codes:[roleCode]}]:[]};
 }
 if(sql.includes('UPDATE users u SET last_login_at')){
   assert.match(sql,/rr.status='Active'/);assert.match(sql,/u.is_active/);
   if(valid(args,3)&&args[1]==='laboratory'&&args[2].includes(roleCode))return {rows:[user],rowCount:1};
   return {rows:[],rowCount:0};
 }
 if(sql.includes('SELECT u.id,u.tenant_id'))return {rows:[{...user,employee_id:'employee'}]};
 if(sql.includes("u.role<>'hospital_admin'")){
   assert.match(sql,/account_expires_at>now\(\)/);assert.match(sql,/r.status='Active'/);
   return {rows:valid(args,1)?[{id:user.id}]:[],rowCount:valid(args,1)?1:0};
 }
 if(sql.includes('INSERT INTO rbac_user_roles')){assert.equal(args[2],'LAB_MANAGER');return {rows:[]};}
 if(sql.includes('SELECT m.code'))return {rows:[{code:'laboratory'}]};
 if(sql.includes('SELECT key,value'))return {rows:[]};
 if(sql.includes('INSERT INTO login_activity')){if(sql.includes("'Success'")){successes++;return {rows:[{id:'login-activity'}]};}return {rows:[]};}
 // No matching staff credentials: do not accidentally authenticate as a broker.
 if(sql.includes('referral_partners')||sql.includes('referral_'))return {rows:[],rowCount:0};
 return {rows:[],rowCount:0};
};
const app=express();app.use(express.json());app.use(router);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/login`;
const login=(portal='staff',password='temporary-test-password')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({portal,identifier:' LAB@EXAMPLE.TEST ',password})});
test('Lab Manager, technician and pathologist staff logins open laboratory with matching token claims',async()=>{
 for(const code of ['LAB_MANAGER','LAB_TECHNICIAN','PATHOLOGIST']){
  roleCode=code;const response=await login();assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.user.portal,'lab_manager');assert.equal(data.user.role,'laboratory');assert.equal(data.forcePasswordChange,true);
  const claims=jwt.verify(data.token,process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'}) as jwt.JwtPayload;
  assert.equal(claims.role,'laboratory');assert.equal(claims.portal,'lab_manager');assert.equal(claims.tenantId,user.tenant_id);
  assert.equal(data.password,undefined);assert.equal(data.user.password_hash,undefined);
 }
});
test('wrong account type gives staff guidance without issuing an administrator token',async()=>{
 roleCode='LAB_MANAGER';const before=successes;const response=await login('hospital_admin');assert.equal(response.status,401);const data=await response.json();assert.equal(data.code,'STAFF_LOGIN_REQUIRED');assert.equal(data.token,undefined);assert.equal(successes,before);
 // Correct account type succeeds with the same credentials and grants no admin role.
 assert.equal((await login()).status,200);
});
test('wrong passwords, disabled accounts and inactive roles receive generic rejection',async()=>{
 const before=successes;
 for(const state of ['wrong-password','disabled','inactive-role']){
  active=state!=='disabled';roleActive=state!=='inactive-role';
  const response=await login('hospital_admin',state==='wrong-password'?'incorrect-password':'temporary-test-password');
  assert.equal(response.status,401);const data=await response.json();assert.equal(data.code,undefined);assert.equal(data.token,undefined);assert.match(data.error,/Invalid login/);
 }
 active=true;roleActive=true;assert.equal(successes,before);
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await pool.end();});
