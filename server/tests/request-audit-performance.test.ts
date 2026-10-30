import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='request-audit-performance-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {enforceLiveAccount}=await import('../src/live-access.js');
const {trackSiteRequest}=await import('../src/site-audit.js');
const {auditContext}=await import('../src/audit-context.js');
const original=pool.query;

test('authenticated requests reuse the fresh account name for auditing and still check revocation on every request',async()=>{
  let calls=0,active=true,name='Test Staff';
  (pool as any).query=async(sql:string)=>{
    calls++;assert.match(sql,/SELECT u.force_password_change/);
    return {rows:[{actor_name:name,role:'nurse',is_active:active,hospital_status:'active',deleted_at:null,account_expires_at:null,role_codes:['NURSE'],assigned_roles:1}]};
  };
  const app=express();app.use(enforceLiveAccount);app.use(trackSiteRequest);
  app.get('/fixture',(_req,res)=>res.json(auditContext.getStore()));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture`;
  const headers={Authorization:`Bearer ${jwt.sign({sub:'user',tenantId:'hospital',role:'nurse',portal:'nurse'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'})}`};
  try{
    let response=await fetch(base,{headers});assert.equal(response.status,200);assert.equal((await response.json()).actor_name,'Test Staff');assert.equal(calls,1);
    name='Updated Staff';response=await fetch(base,{headers});assert.equal((await response.json()).actor_name,'Updated Staff');assert.equal(calls,2);
    active=false;response=await fetch(base,{headers});assert.equal(response.status,401);assert.equal(calls,3);
  }finally{pool.query=original;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
after(()=>pool.end());
