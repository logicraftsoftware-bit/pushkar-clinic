import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='doctor-login-regression-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/portal-auth.js');
const {loginServiceFailure}=await import('../src/login-failure.js');
const db=new PGlite(),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),branch=id(2),doctor=id(3),role=id(4);
await db.exec(`CREATE TYPE user_role AS ENUM('doctor','hospital_admin');
 CREATE TABLE hospitals(id uuid,name text,code text,logo_url text,status text,deleted_at timestamptz);
 CREATE TABLE branches(id uuid,tenant_id uuid,name text);
 CREATE TABLE users(id uuid,tenant_id uuid,branch_id uuid,email text,phone text,password_hash text,role user_role,is_active boolean,account_expires_at timestamptz,first_name text,last_name text,force_password_change boolean,last_login_at timestamptz);
 CREATE TABLE staff_members(id uuid,user_id uuid,tenant_id uuid,staff_type text,account jsonb,personal jsonb);
 CREATE TABLE rbac_roles(id uuid,tenant_id uuid,code text,status text,is_system boolean);
 CREATE TABLE rbac_user_roles(tenant_id uuid,user_id uuid,role_id uuid,UNIQUE(tenant_id,user_id,role_id));
 CREATE TABLE crypt_calls(id int GENERATED ALWAYS AS IDENTITY);
 CREATE FUNCTION crypt(text,text) RETURNS text LANGUAGE plpgsql AS $$BEGIN
   IF $2='unrelated-invalid-hash' THEN RAISE EXCEPTION 'Password checked for an unrelated user'; END IF;
   INSERT INTO crypt_calls DEFAULT VALUES;
   RETURN $1;
 END$$;`);
await db.query("INSERT INTO hospitals VALUES($1,'Test Hospital','TEST',null,'active',null)",[tenant]);
await db.query("INSERT INTO branches VALUES($1,$2,'Main')",[branch,tenant]);
await db.query("INSERT INTO users VALUES($1,$2,$3,'doctor@example.test','1234567890','correct-password','doctor',true,null,'Test','Doctor',false,null)",[doctor,tenant,branch]);
await db.query("INSERT INTO users VALUES($1,$2,$3,'other@example.test','0987654321','unrelated-invalid-hash','doctor',true,null,'Other','Doctor',false,null)",[id(7),tenant,branch]);
await db.query("INSERT INTO rbac_roles VALUES($1,$2,'DOCTOR','Active',true)",[role,tenant]);
await db.query('INSERT INTO rbac_user_roles VALUES($1,$2,$3)',[tenant,doctor,role]);
await db.query("INSERT INTO staff_members VALUES($1,null,$2,'Doctor',$3,'{}')",[id(5),tenant,JSON.stringify({login_email:'unlinked@example.test'})]);
const original=pool.query;
let serviceError:string|undefined;
let changePasswordDuringLogin=false;
(pool as any).query=async(sql:string,args:any[]=[])=>{
 if(serviceError)throw Object.assign(new Error('Private database details'),{code:serviceError});
 if(sql.includes('CREATE TABLE')||sql.includes('INSERT INTO rbac_user_roles'))return {rows:[]};
 if(sql.includes('SELECT m.code')||sql.includes('SELECT key,value'))return {rows:[]};
 if(sql.includes('INSERT INTO login_activity'))return {rows:[{id:id(6)}]};
 if(changePasswordDuringLogin&&sql.includes('UPDATE users u SET last_login_at')){
   changePasswordDuringLogin=false;
   await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',['changed-password',doctor]);
 }
 return db.query(sql,args);
};
const app=express();app.use(express.json());app.use(router);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(500).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/login`;
async function login(identifier='doctor@example.test',password='correct-password',portal='staff'){
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,password,portal})});
 return {status:response.status,data:await response.json()};
}

test('doctor email and phone logins select Doctor workspace and never expose the password hash',async()=>{
 for(const identifier of [' DOCTOR@EXAMPLE.TEST ','1234567890']){
  const result=await login(identifier);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.user.portal,'doctor');
  const claims=jwt.verify(result.data.token,process.env.JWT_SECRET!) as jwt.JwtPayload;
  assert.equal(claims.role,'doctor');assert.equal(claims.portal,'doctor');assert.equal(result.data.user.password_hash,undefined);
 }
});

test('staff login checks the password once and rejects a password reset between discovery and session creation',async()=>{
 await db.exec('TRUNCATE crypt_calls');
 assert.equal((await login()).status,200);
 assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM crypt_calls')).rows[0]!.n,1);
 try{
  changePasswordDuringLogin=true;
  const result=await login();assert.equal(result.status,401);assert.equal(result.data.token,undefined);
 }finally{changePasswordDuringLogin=false;await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',['correct-password',doctor]);}
 assert.equal((await login()).status,200);
});

test('missing doctors and registered doctors without login accounts receive distinct errors',async()=>{
 const missing=await login('missing@example.test','correct-password','doctor');
 assert.equal(missing.status,401);assert.equal(missing.data.code,'DOCTOR_NOT_REGISTERED');assert.match(missing.data.error,/Doctor is not registered/);
 const staff=await login('missing@example.test');assert.equal(staff.data.code,'STAFF_NOT_REGISTERED');assert.match(staff.data.error,/not registered/);
 const unlinked=await login('unlinked@example.test');assert.equal(unlinked.status,401);assert.equal(unlinked.data.code,'LOGIN_NOT_PROVISIONED');assert.match(unlinked.data.error,/Doctor is registered/);
 assert.equal((await login()).status,200);
});

test('password, account, hospital, branch and role failures explain the actual reason without issuing tokens',async()=>{
 const wrong=await login('doctor@example.test','incorrect-password');assert.equal(wrong.data.code,'INCORRECT_PASSWORD');
 for(const [change,restore,code] of [
  ["UPDATE users SET is_active=false","UPDATE users SET is_active=true",'ACCOUNT_INACTIVE'],
  ["UPDATE users SET account_expires_at=now()-interval '1 day'","UPDATE users SET account_expires_at=null",'ACCOUNT_EXPIRED'],
  ["UPDATE hospitals SET status='inactive'","UPDATE hospitals SET status='active'",'HOSPITAL_ACCESS_INACTIVE'],
  ["UPDATE users SET branch_id=null",`UPDATE users SET branch_id='${branch}'`,'BRANCH_NOT_ASSIGNED'],
  ["UPDATE rbac_roles SET status='Inactive'","UPDATE rbac_roles SET status='Active'",'STAFF_ROLE_INACTIVE'],
 ]){
  await db.exec(change);
  const result=await login();assert.equal(result.status,401,JSON.stringify(result.data));assert.equal(result.data.code,code);assert.equal(result.data.token,undefined);
  await db.exec(restore);assert.equal((await login()).status,200);
 }
});

test('database failures have specific service codes instead of incorrect registration messages or raw database text',async()=>{
 for(const [code,expected] of [['57014','LOGIN_DATABASE_TIMEOUT'],['55P03','LOGIN_DATABASE_BUSY'],['ECONNREFUSED','LOGIN_DATABASE_UNAVAILABLE'],['42P01','LOGIN_SETUP_INCOMPLETE']]){
  serviceError=code;const result=await login();serviceError=undefined;
  assert.equal(result.status,503);assert.equal(result.data.code,expected);assert.doesNotMatch(result.data.error,/Private database details|not registered/);
 }
 assert.equal(loginServiceFailure({code:'unknown'}),null);
});

after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await pool.end();await db.close();});
