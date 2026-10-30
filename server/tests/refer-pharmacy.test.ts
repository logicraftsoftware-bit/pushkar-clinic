import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='refer-pharmacy-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/hospital-management.js');

test('refer pharmacy CRUD validates amounts and isolates hospital records',async()=>{
  const db=new PGlite(),original=pool.query;
  const tenant='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
  (pool as any).query=async(sql:string,args:any[]=[])=>{
    if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}],rowCount:1};
    if(sql.includes('CREATE TABLE IF NOT EXISTS hospital_refer_pharmacies')){
      await db.exec(sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS hospital_refer_pharmacies'),sql.indexOf('ALTER TABLE hospitals')));
      return {rows:[],rowCount:0};
    }
    if(sql.includes('hospital_refer_pharmacies'))return db.query(sql,args);
    if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'hospital.manage'}]};
    return {rows:[],rowCount:0};
  };
  await db.exec('CREATE TABLE hospitals(id uuid PRIMARY KEY)');
  await db.query('INSERT INTO hospitals VALUES ($1),($2)',[tenant,other]);
  const app=express();app.use(express.json());app.use(router);
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(400).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/refer-pharmacies`;
  const headers=(tenantId=tenant)=>({'Content-Type':'application/json',authorization:'Bearer '+jwt.sign({sub:tenant,tenantId,branchId:tenant,role:'hospital_admin'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'})});
  try{
    for(const body of [{name:' ',address:'Road',discount_percentage:0},{name:'Pharmacy',address:' ',discount_percentage:0},{name:'Pharmacy',address:'Road',discount_percentage:-1},{name:'Pharmacy',address:'Road',discount_percentage:101}]){
      assert.equal((await fetch(base,{method:'POST',headers:headers(),body:JSON.stringify(body)})).status,400);
    }
    const created=await fetch(base,{method:'POST',headers:headers(),body:JSON.stringify({name:' Town Pharmacy ',address:'Guwahati',discount_percentage:25.50})});
    assert.equal(created.status,201,await created.clone().text());const row=await created.json();assert.equal(row.name,'Town Pharmacy');
    assert.equal((await (await fetch(base,{headers:headers()})).json()).length,1);
    assert.deepEqual(await (await fetch(base,{headers:headers(other)})).json(),[]);
    assert.equal((await fetch(base+'/'+row.id,{method:'PUT',headers:headers(other),body:JSON.stringify({name:'Other',address:'Road',discount_percentage:0})})).status,404);
    assert.equal((await fetch(base+'/'+row.id,{method:'PUT',headers:headers(),body:JSON.stringify({name:'Updated',address:'New Road',discount_percentage:10.25})})).status,200);
    assert.equal((await fetch(base+'/'+row.id,{method:'DELETE',headers:headers()})).status,204);
    assert.deepEqual(await (await fetch(base,{headers:headers()})).json(),[]);
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await db.close();await pool.end();
  }
});
