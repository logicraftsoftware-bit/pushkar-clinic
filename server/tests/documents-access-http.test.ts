import {test,after} from 'node:test';import assert from 'node:assert/strict';import express from 'express';import jwt from 'jsonwebtoken';import{once}from'node:events';import type{AddressInfo}from'node:net';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';process.env.JWT_SECRET='document-access-retest-secret-at-least-32-characters';
const{pool}=await import('../src/db.js');const{default:router}=await import('../src/admin-operations.js');const original=pool.query;let granted=['documents.view'];
(pool as any).query=async(sql:string)=>{
 if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return{rows:[{id:'tenant',code:'HOSPITAL_ADMIN'}],rowCount:1};
 if(sql.includes('SELECT DISTINCT rp.permission_code'))return{rows:granted.map(code=>({code})),rowCount:granted.length};
 if(sql.includes('FROM hospital_documents'))return{rows:[{id:'doc',name:'Test Document'}],rowCount:1};
 return{rows:[],rowCount:0};
};
const app=express();app.use(express.json());app.use(router);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;const token=jwt.sign({sub:'clerk',tenantId:'tenant',branchId:'branch',role:'receptionist'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
test('custom role with documents.view can read documents but cannot upload or update',async()=>{
 const read=await fetch(base+'/documents',{headers});assert.equal(read.status,200);assert.equal((await read.json())[0].name,'Test Document');
 for(const method of ['POST','PUT'])assert.equal((await fetch(base+'/documents'+(method==='PUT'?'/doc':''),{method,headers,body:JSON.stringify({name:'Changed',document_type:'Policy'})})).status,403);
});
test('document manager can load document pickers without unrelated settings permissions',async()=>{
 granted=['documents.manage'];const response=await fetch(base+'/lookups',{headers});assert.equal(response.status,200);assert.deepEqual((await response.json()).branches,[]);
 granted=[];assert.equal((await fetch(base+'/documents',{headers})).status,403);assert.equal((await fetch(base+'/lookups',{headers})).status,403);
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await pool.end();});
