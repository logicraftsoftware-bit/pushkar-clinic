import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='lab-sample-dates-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/laboratory.js');

test('sample processing dates include the entire India day, newest first, with matching counts',async()=>{
  const db=new PGlite(),original=pool.query;
  await db.exec(`CREATE TABLE patients(id uuid,first_name text,last_name text,phone text,medical_record_number text);
    CREATE TABLE role_work_items(id uuid,tenant_id uuid,patient_id uuid,workspace text,kind text,title text,status text,occurred_at timestamptz,data jsonb)`);
  const tenant='00000000-0000-4000-8000-000000000001';
  for(const [index,stamp] of ['2026-10-24T18:29:59Z','2026-10-24T18:30:00Z','2026-10-25T18:29:59Z','2026-10-25T18:30:00Z'].entries()){
    await db.query("INSERT INTO role_work_items VALUES($1,$2,null,'laboratory','sample collection','Sample','Collected',$3,$4)",[`00000000-0000-4000-8000-${String(index+10).padStart(12,'0')}`,tenant,stamp,{collected_at:stamp,tests:[]}]);
  }
  (pool as any).query=(sql:string,args:any[])=>sql.includes('FROM role_work_items w')?db.query(sql,args):Promise.resolve({rows:[]});
  const app=express();app.use((req,_res,next)=>{Object.assign(req,{portalUser:{sub:tenant,tenantId:tenant,role:'hospital_admin'}});next();});app.use(router);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/workflow?view=processing`;
  try{
    const response=await fetch(base+'&from=2026-10-25&to=2026-10-25');assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.total,2);assert.equal(data.rows.length,2);
    assert.ok(data.rows[0].occurred_at>data.rows[1].occurred_at);
    assert.equal((await (await fetch(base+'&from=2026-10-26&to=2026-10-26')).json()).total,1);
    assert.equal((await fetch(base+'&from=2026-10-26&to=2026-10-25')).status,400);
    assert.equal((await (await fetch(base)).json()).total,4);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await db.close();await pool.end();}
});
