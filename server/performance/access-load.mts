// Runs only on a loopback HTTP listener with an in-memory PostgreSQL database.
// It never accepts a remote target or reads production credentials.
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://isolated:isolated@127.0.0.1/isolated';
process.env.DATABASE_SSL='false';process.env.NODE_ENV='test';
process.env.JWT_SECRET='isolated-access-load-test-secret-never-used-for-live';
const {pool}=await import('../src/db.js');
const {enforceLiveAccount}=await import('../src/live-access.js');
const db=new PGlite();
const tenant='00000000-0000-4000-8000-000000000001',role='00000000-0000-4000-8000-000000000002';
await db.exec(`CREATE TABLE hospitals(id uuid PRIMARY KEY,status text,deleted_at timestamptz);
CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid,role text,is_active boolean,account_expires_at date,force_password_change boolean DEFAULT false,first_name text DEFAULT 'Test',last_name text DEFAULT 'Staff');
CREATE TABLE rbac_roles(id uuid PRIMARY KEY,code text,is_system boolean,status text);
CREATE TABLE rbac_user_roles(tenant_id uuid,user_id uuid,role_id uuid);
CREATE INDEX user_roles_lookup ON rbac_user_roles(tenant_id,user_id);
CREATE TABLE clinical_fixture_changes(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,staff_id uuid);
INSERT INTO hospitals VALUES('${tenant}','active',null);
INSERT INTO rbac_roles VALUES('${role}','RECEPTIONIST',true,'Active');
INSERT INTO users(id,tenant_id,role,is_active,account_expires_at) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${tenant}','receptionist',true,null FROM generate_series(100,1099) n;
INSERT INTO rbac_user_roles SELECT '${tenant}',id,'${role}' FROM users;`);
const original=pool.query;
(pool as any).query=(sql:string,args:any[]=[])=>db.query(sql,args);
const app=express();app.use(enforceLiveAccount);
app.get('/fixture',(_req,res)=>res.json({status:'ok'}));
app.post('/fixture',async(req,res)=>{const claims=jwt.decode(req.header('authorization')!.slice(7)) as {sub:string};await db.query('INSERT INTO clinical_fixture_changes(staff_id) VALUES($1)',[claims.sub]);res.status(201).json({saved:true});});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const target=`http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture`;
const headers=Array.from({length:1000},(_,i)=>({authorization:`Bearer ${jwt.sign({sub:'00000000-0000-4000-8000-'+String(i+100).padStart(12,'0'),tenantId:tenant,role:'receptionist',portal:'receptionist'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal',expiresIn:'1h'})}`}));
const results:any[]=[];
async function phase(name:string,concurrency:number,requests:number,expected=200){
  const durations:number[]=[];let next=0,failures=0;const started=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{while(next<requests){const index=next++,start=performance.now();const response=await fetch(target,{headers:headers[index%headers.length],signal:AbortSignal.timeout(10000)});await response.arrayBuffer();durations.push(performance.now()-start);if(response.status!==expected)failures++;}}));
  durations.sort((a,b)=>a-b);const elapsed=performance.now()-started;
  const result={name,concurrency,requests,failures,requests_per_second:Math.round(requests*1000/elapsed),p95_ms:Math.round(durations[Math.floor(durations.length*.95)]!),max_ms:Math.round(durations.at(-1)!)};
  results.push(result);console.log(JSON.stringify(result));assert.equal(failures,0);
}
try{
  await phase('baseline',10,300);
  await phase('scalability',50,1500);
  await phase('spike',150,2000);
  await phase('sustained-stress',200,5000);
  await phase('recovery',10,300);
  const first=headers[0]!;
  assert.equal((await fetch(target,{method:'POST',headers:first})).status,201);
  await db.query('UPDATE users SET is_active=false WHERE id=$1',['00000000-0000-4000-8000-000000000100']);
  assert.equal((await fetch(target,{method:'POST',headers:first})).status,401);
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM clinical_fixture_changes')).rows[0]!.n,1);
  await db.query("UPDATE rbac_roles SET status='Inactive'");
  await phase('revoked-role-under-load',50,500,401);
  await db.query("UPDATE rbac_roles SET status='Active'");await db.query('UPDATE users SET is_active=true');
  await phase('role-restored-recovery',10,300);
  console.log(JSON.stringify({result:'PASS',scope:'Isolated real HTTP account guard with 1,000 PostgreSQL-backed staff fixtures; does not establish production clinical-module capacity.',total_requests:results.reduce((sum,item)=>sum+item.requests,0)+2,production_requests:0}));
}finally{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=original;await pool.end();await db.close();
}
