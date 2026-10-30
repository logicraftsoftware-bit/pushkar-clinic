import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='access-regression-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {enforceLiveAccount}=await import('../src/live-access.js');
const {default:auth}=await import('../src/portal-auth.js');
let active=true,forced=true,correct=true,writes=0;
const query=pool.query;
(pool as any).query=async(sql:string)=>{
 if(sql.includes('SELECT u.force_password_change'))return {rows:[{role:'accountant',is_active:active,force_password_change:forced,hospital_status:'active',deleted_at:null,account_expires_at:null,role_codes:['CUSTOM'],assigned_roles:1}]};
 if(sql.includes('UPDATE users SET password_hash')){if(correct){forced=false;writes++;}return {rows:correct?[{id:'user'}]:[],rowCount:correct?1:0};}
 throw Error('Unexpected database operation');
};
const app=express();app.use(express.json());app.use(enforceLiveAccount);app.use('/api/v1/auth',auth);app.post('/api/v1/example',(_req,res)=>res.json({saved:true}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const token=jwt.sign({sub:'user',tenantId:'tenant',role:'accountant',portal:'accountant'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const change=(currentPassword='temporary123',newPassword='new-password123')=>fetch(base+'/api/v1/auth/change-password',{method:'POST',headers,body:JSON.stringify({currentPassword,newPassword})});
test('temporary sessions are blocked until password changes; disabled sessions cannot save or change passwords',async()=>{
 let response=await fetch(base+'/api/v1/example',{method:'POST',headers});assert.equal(response.status,403);assert.equal((await response.json()).code,'PASSWORD_CHANGE_REQUIRED');
 response=await change('temporary123','temporary123');assert.equal(response.status,400);assert.equal(writes,0);
 correct=false;assert.equal((await change()).status,400);assert.equal(writes,0);
 active=false;response=await fetch(base+'/api/v1/example',{method:'POST',headers});assert.equal(response.status,401);assert.equal((await response.json()).code,'ACCESS_REVOKED');assert.equal((await change()).status,401);assert.equal(writes,0);
 active=true;correct=true;assert.equal((await change()).status,204);assert.equal(writes,1);assert.equal((await fetch(base+'/api/v1/example',{method:'POST',headers})).status,200);
 assert.equal((await fetch(base+'/api/v1/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:'temporary123',newPassword:'new-password123'})})).status,401);
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=query;await pool.end();});
