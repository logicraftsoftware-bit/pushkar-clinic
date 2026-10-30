import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
import {performance} from 'node:perf_hooks';
import {labOrderSummarySql} from '../src/lab-order-list.js';
import {labNavigationIndexesSql} from '../src/lab-list-query.js';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='lab-navigation-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js'),{default:router}=await import('../src/role-panels.js');
const db=new PGlite(),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),other=id(2),patient=id(3);
await db.exec(`CREATE TABLE role_work_items(id uuid,tenant_id uuid,branch_id uuid,workspace text,kind text,title text,status text,priority text,occurred_at timestamptz,updated_at timestamptz,patient_id uuid,data jsonb);
  CREATE TABLE patients(id uuid,first_name text,last_name text,medical_record_number text,phone text);
  CREATE TABLE finance_records(id uuid,tenant_id uuid,record_number text,status text,total numeric,paid numeric,due numeric,data jsonb);`);
await db.exec(labNavigationIndexesSql);
await db.query("INSERT INTO patients VALUES($1,'UniquePatient','Example','UHID-TEST','9876543210')",[patient]);
await db.query(`INSERT INTO role_work_items SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  CASE WHEN n<=6000 THEN $1::uuid ELSE $2::uuid END,null,'laboratory','results','Lab Order','Sample Collected','Normal',now()-n*interval '1 minute',now(),
  CASE WHEN n=1 THEN $3::uuid ELSE null END,
  jsonb_build_object('tests',jsonb_build_array(jsonb_build_object('name','Blood test')),'collected_at','2026-10-27','result_status','Completed','doctor_approval',jsonb_build_object('by','doctor'))
  FROM generate_series(1,6037) n`,[tenant,other,patient]);
const original=pool.query,queries:string[]=[];
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}],rowCount:1};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'lab.order.view'}],rowCount:1};
  if(sql.includes('FROM role_work_items w')){queries.push(sql);return db.query(sql,args);}
  return {rows:[],rowCount:0};
};
const app=express();app.use(router);app.use((error:any,_req:any,res:any,_next:any)=>res.status(500).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/lab-orders?`;
const token=jwt.sign({sub:tenant,tenantId:tenant,role:'hospital_admin',portal:'hospital_admin'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});
async function load(query:string){const response=await fetch(base+query,{headers:{Authorization:`Bearer ${token}`}});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
test('Results and Reports paginate 6,037 orders with correct tenant counts and lean count queries',async()=>{
  for(const stage of ['Results','Reports']){
    queries.length=0;
    const data=await load(`stage=${stage}&page_size=5`);
    assert.equal(data.total,6000);assert.equal(data.rows.length,5);assert.equal(data.rows[0].id,id(1));
    const count=queries.find(query=>query.startsWith('SELECT count(*)::int total'))!;
    assert.ok(count);assert.doesNotMatch(count,/JOIN patients|JOIN finance_records|_previous/);
    assert.equal((await load(`stage=${stage}&search=UniquePatient`)).total,1);
    assert.equal((await load(`stage=${stage}&billed_only=1`)).total,0);
  }
});
test('Orders retain dashboard summaries and search filtering',async()=>{
  const data=await load('stage=Orders&page_size=5');assert.equal(data.total,6000);assert.equal(data.summary.ready,6000);
  assert.equal((await load('stage=Orders&search=UniquePatient')).total,1);
});

test('Orders load rows without dashboard work and fetch summaries independently',async()=>{
  queries.length=0;
  const page=await load('stage=Orders&page_size=5&include_summary=0');
  assert.equal(page.total,6000);assert.equal(page.rows.length,5);assert.equal(page.rows[0].id,id(1));
  assert.deepEqual(page.summary,{total:6000});
  const count=queries.find(sql=>sql.startsWith('SELECT count(*)::int total'))!;
  assert.ok(count);assert.doesNotMatch(count,/JOIN patients|JOIN finance_records|_previous/);
  assert.ok(queries.some(sql=>sql.startsWith('WITH lab_page AS MATERIALIZED')));
  const second=await load('stage=Orders&page_size=5&page=2&include_summary=0');
  assert.equal(second.rows[0].id,id(6));
  queries.length=0;
  const summary=await load('stage=Orders&include_summary=0&summary_only=1');
  assert.equal(summary.summary.ready,6000);assert.equal(summary.rows,undefined);assert.equal(queries.length,1);
  const searched=await load('stage=Orders&include_summary=0&search=UniquePatient');
  assert.equal(searched.total,1);assert.equal(searched.rows[0].patient_name,'UniquePatient Example');
  const filtered=await load('stage=Orders&include_summary=0&status=Sample%20Collected');
  assert.equal(filtered.total,6000);
});

test('billing counts and pagination deduplicate invoices before loading patient and report payloads',async()=>{
  const first=id(7000),second=id(7001);
  try{
    await db.query("INSERT INTO finance_records(id,tenant_id,record_number,status,total,paid,due) VALUES($1,$2,'LAB-A','Paid',100,100,0),($3,$2,'LAB-B','Partially Paid',300,200,100)",[first,tenant,second]);
    await db.query("UPDATE role_work_items SET data=data||jsonb_build_object('bill_id',$1::text) WHERE id IN ($2,$3)",[first,id(1),id(2)]);
    await db.query("UPDATE role_work_items SET data=data||jsonb_build_object('bill_id',$1::text) WHERE id=$2",[second,id(3)]);
    queries.length=0;
    const one=await load('stage=Orders&billing=1&page_size=1');
    assert.equal(one.total,2);assert.equal(Number(one.summary.revenue),300);assert.equal(one.rows.length,1);assert.equal(one.rows[0].id,id(1));
    const summary=queries.find(sql=>sql.includes('SELECT count(*) FILTER'))!;
    assert.ok(summary);assert.doesNotMatch(summary,/w\.data-'lab_results'|JOIN patients/);
    const two=await load('stage=Orders&billing=1&page_size=1&page=2');assert.equal(two.rows[0].id,id(3));
    const searched=await load('stage=Orders&billing=1&search=UniquePatient');assert.equal(searched.total,1);assert.equal(searched.rows[0].bill_number,'LAB-A');
    const lean=await load('stage=Orders&billing=1&include_summary=0&page_size=1');
    assert.equal(lean.total,2);assert.equal(lean.rows[0].id,id(1));assert.deepEqual(lean.summary,{total:2});
    const paid=await load('stage=Orders&billing=1&include_summary=0&status=Paid');
    assert.equal(paid.total,1);assert.equal(paid.rows[0].bill_number,'LAB-A');
    const dashboard=await load('stage=Orders&billing=1&summary_only=1');
    assert.equal(dashboard.total,2);assert.equal(Number(dashboard.summary.revenue),300);
  }finally{
    await db.query("UPDATE role_work_items SET data=data-'bill_id' WHERE id IN ($1,$2,$3)",[id(1),id(2),id(3)]);
    await db.query('DELETE FROM finance_records WHERE id IN ($1,$2)',[first,second]);
  }
});
test('compare lean Results counts with the previous full-dashboard query on 6,037 fixtures',async t=>{
  queries.length=0;await load('stage=Results&page_size=5');
  const lean=queries.find(sql=>sql.startsWith('SELECT count(*)::int total'))!;
  const previous=lean.replace('count(*)::int total',labOrderSummarySql()).replace('FROM role_work_items w',"FROM role_work_items w LEFT JOIN patients p ON p.id=w.patient_id LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id");
  const args=[tenant,'',[],null,null,null,'','',JSON.stringify({})];
  await db.query(previous,args);await db.query(lean,args);
  let before=0,after=0;
  for(let n=0;n<5;n++){
    let start=performance.now();const a=await db.query<any>(previous,args);before+=performance.now()-start;
    start=performance.now();const b=await db.query<any>(lean,args);after+=performance.now()-start;
    assert.equal(a.rows[0].total,b.rows[0].total);
  }
  t.diagnostic(`Local PGlite mean count latency: previous ${(before/5).toFixed(1)} ms; optimized ${(after/5).toFixed(1)} ms. This is not a production latency measurement.`);
});
test('workflow filters combine across full result, verification and report queues',async()=>{
  await db.exec(`CREATE TABLE hospital_diagnostic_masters(id uuid,tenant_id uuid,kind text,name text,data jsonb);`);
  const testId=id(8000),category=id(8001);
  await db.query(`INSERT INTO hospital_diagnostic_masters VALUES($1::uuid,$3::uuid,'test','Blood test',jsonb_build_object('category_id',$2::text)),($2::uuid,$3::uuid,'category','Hematology','{}')`,[testId,category,tenant]);
  await db.query(`UPDATE role_work_items SET data=data||jsonb_build_object('tests',jsonb_build_array(jsonb_build_object('test_id',$1::text,'name','Blood test')),'barcodes',jsonb_build_array(jsonb_build_object('value','BC-123'))) WHERE id=$2`,[testId,id(1)]);
  for(const stage of ['Results','Verification','Reports']){
    const query=new URLSearchParams({stage,name:'UniquePatient',uhid:'UHID-TEST',barcode:'BC-123',test_id:testId,department:'Hematology',result_status:'Completed',include_summary:'0'});
    const found=await load(query.toString());assert.equal(found.total,1);assert.equal(found.rows[0].id,id(1));
    query.set('barcode','missing');assert.equal((await load(query.toString())).total,0);
    query.set('barcode','BC-123');query.set('department','Other');assert.equal((await load(query.toString())).total,0);
  }
});

test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=original;await pool.end();await db.close();});
