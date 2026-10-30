import {test,after} from 'node:test';import assert from 'node:assert/strict';import express from 'express';import jwt from 'jsonwebtoken';import{once}from'node:events';import type{AddressInfo}from'node:net';import{PGlite}from'@electric-sql/pglite';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';process.env.JWT_SECRET='staff-retest-secret-at-least-32-characters';
const{pool}=await import('../src/db.js');const{default:staffRouter}=await import('../src/hospital-management.js');const{default:authRouter}=await import('../src/portal-auth.js');const{enforceLiveAccount}=await import('../src/live-access.js');
const db=new PGlite();const tenant='00000000-0000-4000-8000-000000000001',admin='00000000-0000-4000-8000-000000000002',branch='00000000-0000-4000-8000-000000000003',clerkRole='00000000-0000-4000-8000-000000000004';
await db.exec(`CREATE TYPE user_role AS ENUM('hospital_admin','receptionist');CREATE TABLE hospitals(id uuid,name text,code text,logo_url text,status text,deleted_at timestamptz);CREATE TABLE branches(id uuid,tenant_id uuid,name text);CREATE TABLE departments(id uuid,tenant_id uuid,name text);CREATE TABLE users(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,branch_id uuid,department_id uuid,email text,phone text,username text,password_hash text,first_name text,last_name text,role user_role,is_active boolean,force_password_change boolean DEFAULT false,two_factor_enabled boolean,account_expires_at timestamptz,last_login_at timestamptz,updated_at timestamptz);CREATE TABLE staff_members(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,employee_id text,first_name text,middle_name text,last_name text,profile_photo text,staff_type text,branch_id uuid,department_id uuid,designation text,employment_type text,joining_date date,status text,personal jsonb,employment jsonb,account jsonb,professional jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz);CREATE TABLE rbac_roles(id uuid,tenant_id uuid,name text,code text,status text,is_system boolean);CREATE TABLE rbac_user_roles(tenant_id uuid,user_id uuid,role_id uuid,UNIQUE(tenant_id,user_id,role_id));CREATE TABLE user_branch_access(tenant_id uuid,user_id uuid,branch_id uuid);CREATE TABLE hospital_settings(tenant_id uuid,section text,key text,value jsonb);CREATE FUNCTION gen_salt(text,integer) RETURNS text LANGUAGE SQL AS 'SELECT ''test-salt''::text';CREATE FUNCTION crypt(text,text) RETURNS text LANGUAGE SQL AS 'SELECT $1';`);
await db.query("INSERT INTO hospitals VALUES($1,'Test Hospital','TEST',null,'active',null)",[tenant]);await db.query("INSERT INTO branches VALUES($1,$2,'Main')",[branch,tenant]);await db.query("INSERT INTO users(id,tenant_id,branch_id,role,is_active)VALUES($1,$2,$3,'hospital_admin',true)",[admin,tenant,branch]);await db.query("INSERT INTO rbac_roles VALUES($1,$2,'Billing Clerk','BILL_CLK','Active',false)",[clerkRole,tenant]);
const originalQuery=pool.query,originalConnect=pool.connect;
const query=async(sql:string,args:any[]=[])=>{
 if(/CREATE TABLE|ALTER TABLE/.test(sql))return{rows:[],rowCount:0};
 if(sql.includes('SELECT DISTINCT rp.permission_code'))return{rows:['staff.view','staff.create','staff.update','hospital.manage'].map(code=>({code}))};
 if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles')&&!sql.includes("status='Active'"))return{rows:[{id:tenant,code:'HOSPITAL_ADMIN'}]};
 if(sql.includes('INSERT INTO rbac_permissions')||sql.includes('INSERT INTO rbac_roles(')||sql.includes('INSERT INTO rbac_role_defaults_applied')||sql.includes('INSERT INTO rbac_role_template_migrations')||sql.includes('INSERT INTO rbac_user_roles SELECT')||sql.includes('INSERT INTO rbac_user_roles(tenant_id,user_id,role_id)\n')||sql.includes('DELETE FROM rbac_roles'))return{rows:[],rowCount:0};
 if(sql.includes('INSERT INTO login_activity'))return{rows:[{id:clerkRole}],rowCount:1};
 if(sql.includes('SELECT m.code')||sql.includes('referral_partners'))return{rows:[],rowCount:0};
 const result=await db.query(sql,args.map(value=>value&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value));return{...result,rowCount:result.rows.length||result.affectedRows||0};
};
(pool as any).query=query;(pool as any).connect=async()=>({query,release(){}});
const app=express();app.use(express.json());app.use(enforceLiveAccount);app.use('/staff-api',staffRouter);app.use('/auth',authRouter);app.get('/protected',(_req,res)=>res.json({ok:true}));app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status||500).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
const jwtFor=(sub:string,role:string,portal:string)=>jwt.sign({sub,tenantId:tenant,branchId:branch,role,portal},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});
const headers={Authorization:'Bearer '+jwtFor(admin,'hospital_admin','hospital_admin'),'Content-Type':'application/json'};
const input={first_name:'Clerk',last_name:'Retest',staff_type:'Billing Clerk',branch_ids:[branch],status:'Active',personal:{},employment:{status:'Active'},professional:{},account:{role:'Billing Clerk',username:'clerk@test.example',login_email:'clerk@test.example',password:'temporary-password',account_status:'Active',force_password_change:false}};
let staff:any,userId='';const save=(body:any)=>fetch(base+'/staff-api/staff/save',{method:'POST',headers,body:JSON.stringify(body)});
const login=()=>fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({portal:'staff',identifier:input.account.login_email,password:input.account.password})});
test('staff form account Inactive persists independently and revokes both old and fresh sessions',async()=>{
 const created=await save(input);assert.equal(created.status,200,await created.clone().text());staff=await created.json();userId=staff.user_id;
 const session=await login();assert.equal(session.status,200,await session.clone().text());const token=(await session.json()).token;
 const disabled=await save({...input,id:staff.id,account:{...input.account,account_status:'Inactive',password:''}});assert.equal(disabled.status,200,await disabled.clone().text());
 const state=(await db.query<any>('SELECT is_active FROM users WHERE id=$1',[userId])).rows[0];assert.equal(state.is_active,false);assert.equal((await disabled.json()).account.account_status,'Inactive');
 assert.equal((await login()).status,401);const action=await fetch(base+'/protected',{headers:{Authorization:'Bearer '+token}});assert.equal(action.status,401);assert.equal((await action.json()).code,'ACCESS_REVOKED');
 const again=await save({...input,id:staff.id,account:{...input.account,account_status:'Active',password:''}});assert.equal(again.status,200);assert.equal((await login()).status,200);
});
test('staff password-reset flag reaches the login response and gates an existing token',async()=>{
 const updated=await save({...input,id:staff.id,account:{...input.account,force_password_change:true}});assert.equal(updated.status,200);
 const response=await login();assert.equal(response.status,200);const session=await response.json();assert.equal(session.forcePasswordChange,true);
 const list=await fetch(base+'/staff-api/staff/list',{headers});assert.equal(list.status,200);assert.equal((await list.json())[0].account_force_password_change,true);
 const protectedResponse=await fetch(base+'/protected',{headers:{Authorization:'Bearer '+session.token}});assert.equal(protectedResponse.status,403);assert.equal((await protectedResponse.json()).code,'PASSWORD_CHANGE_REQUIRED');
});
test('custom Staff Management lists match assigned role even when the staff type differs',async()=>{
 await db.query("UPDATE staff_members SET staff_type='Receptionist',account='{}' WHERE id=$1",[staff.id]);
 const list=await fetch(base+'/staff-api/staff/list?type=Billing%20Clerk',{headers});assert.equal(list.status,200,await list.clone().text());const rows=await list.json();assert.equal(rows.length,1);assert.equal(rows[0].id,staff.id);
 const empty=await fetch(base+'/staff-api/staff/list?type=Different%20Role',{headers});assert.equal(empty.status,200);assert.deepEqual(await empty.json(),[]);
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=originalQuery;pool.connect=originalConnect;await db.close();await pool.end();});
