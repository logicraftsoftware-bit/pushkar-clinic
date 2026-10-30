import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='report-print-confirmation-test-secret-at-least-32';
const {pool}=await import('../src/db.js');
const {confirmReportPrint,reportPrintSchemaSql,reportPrintEvents}=await import('../src/lab-report-prints.js');
const {reportPrintRevisionSql}=await import('../src/lab-report-print-model.js');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,db=new PGlite();
const tenant=id(1),order=id(2),actor=id(3),branch=id(4),invoice=id(5),test1=id(6),test2=id(7);
await db.exec(`CREATE TABLE hospitals(id uuid PRIMARY KEY);CREATE TABLE users(id uuid PRIMARY KEY,tenant_id uuid,branch_id uuid,first_name text,last_name text);
  CREATE TABLE user_branch_access(tenant_id uuid,user_id uuid,branch_id uuid);
  CREATE TABLE role_work_items(id uuid PRIMARY KEY,tenant_id uuid,branch_id uuid,workspace text,status text,data jsonb,updated_at timestamptz);
  CREATE TABLE finance_records(id uuid PRIMARY KEY,tenant_id uuid,total numeric,paid numeric,due numeric,status text);
  INSERT INTO hospitals VALUES('${tenant}');INSERT INTO users VALUES('${actor}','${tenant}','${branch}','Actual','Collector');
  INSERT INTO finance_records VALUES('${invoice}','${tenant}',100,100,0,'Paid');`);
await db.exec(reportPrintSchemaSql);
const data={bill_id:invoice,collected_at:'2026-10-27',result_status:'Completed',tests:[{test_id:test1,name:'SGOT'},{test_id:test2,name:'SGPT'}],lab_results:[{test_id:test1,parameters:[{value:'20'}]},{test_id:test2,parameters:[{value:'30'}]}],technician_approval:{test_ids:[test1,test2]},doctor_approval:{test_ids:[test1,test2]}};
await db.query("INSERT INTO role_work_items VALUES($1,$2,$3,'laboratory','Doctor Approved',$4,'2026-10-27T10:00:00Z')",[order,tenant,branch,data]);
const originalQuery=pool.query,originalConnect=pool.connect;
(pool as any).query=async(sql:string,args:any[]=[])=>sql.startsWith('CREATE TABLE')?{rows:[]} : db.query(sql,args);
(pool as any).connect=async()=>({query:(sql:string,args:any[]=[])=>db.query(sql,args),release(){}});
let role='hospital_admin';
const app=express();app.use(express.json());app.post('/orders/:id/print',(req,res)=>confirmReportPrint(Object.assign(req,{portalUser:{sub:actor,tenantId:tenant,branchId:branch,role,portal:role}}),res));
app.use((error:any,_req:any,res:any,_next:any)=>res.status(400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/orders/${order}/print`;
async function revision(){return (await db.query<any>(`SELECT ${reportPrintRevisionSql} revision FROM role_work_items w WHERE id=$1`,[order])).rows[0].revision;}
async function confirm(extra:any={}){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({test_ids:[test1],revision:await revision(),request_id:id(20),...extra})});}
test('explicit print confirmation persists selected tests and actual actor, survives reload and retries without duplicates',async()=>{
  const current=await revision();assert.equal((await reportPrintEvents(order,tenant,current)).length,0);
  const response=await confirm({confirmed_by:'invented user'});assert.equal(response.status,200,await response.clone().text());
  const saved=await response.json();assert.deepEqual(saved.events[0].test_ids,[test1]);assert.equal(saved.events[0].confirmed_by_name,'Actual Collector');
  assert.equal((await confirm()).status,200);assert.equal((await reportPrintEvents(order,tenant,current)).length,1);
  assert.equal((await db.query<any>('SELECT count(*)::int total FROM lab_report_print_events')).rows[0].total,1);
  assert.equal(new Date((await db.query<any>('SELECT updated_at FROM role_work_items')).rows[0].updated_at).toISOString(),'2026-10-27T10:00:00.000Z','print history must not change clinical version timestamps');
});
test('stale reports, reused confirmation selections, incomplete tests and unapproved tests cannot be recorded as printed',async()=>{
  assert.equal((await confirm({revision:'0'.repeat(32),request_id:id(21)})).status,409);
  assert.equal((await confirm({test_ids:[test2]})).status,409);
  await db.query('UPDATE role_work_items SET data=$1',[{...data,doctor_approval:{test_ids:[test1]},lab_results:[data.lab_results[0],{test_id:test2,parameters:[{value:''}]}]}]);
  assert.equal((await confirm({test_ids:[test2],request_id:id(22)})).status,409);
  assert.equal((await reportPrintEvents(order,tenant,await revision())).length,0,'old print ticks do not apply to changed reports');
  await db.query('UPDATE role_work_items SET data=$1',[data]);
});
test('doctor-approved partial CBC can be confirmed printed and disapproval immediately blocks it',async()=>{
  const partial={...data,result_status:'Partially Completed',technician_approval:null,lab_results:[{test_id:test1,parameters:[{value:'7770'},{value:''}]},data.lab_results[1]]};
  await db.query('UPDATE role_work_items SET data=$1',[partial]);
  const response=await confirm({request_id:id(24)});assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual((await response.json()).events[0].test_ids,[test1]);
  await db.query('UPDATE role_work_items SET data=$1',[{...partial,doctor_approval:{test_ids:[test2]}}]);
  assert.equal((await confirm({request_id:id(25)})).status,409);
  for(const value of ['',0,'0','0.00']){
    await db.query('UPDATE role_work_items SET data=$1',[{...partial,lab_results:[{test_id:test1,parameters:[{value}]}]}]);
    assert.equal((await confirm({request_id:id(25)})).status,409);
  }
  await db.query('UPDATE role_work_items SET data=$1',[data]);
});

test('reception payment restrictions, cancellation and branch access remain enforced',async()=>{
  role='receptionist';await db.exec("UPDATE finance_records SET paid=0,due=100,status='Unpaid'");
  assert.equal((await confirm({request_id:id(23)})).status,409);
  await db.exec("UPDATE finance_records SET paid=100,due=0,status='Paid';UPDATE role_work_items SET status='Cancelled'");
  assert.equal((await confirm({request_id:id(23)})).status,409);
  await db.query("UPDATE role_work_items SET status='Doctor Approved',branch_id=$1",[id(40)]);
  assert.equal((await confirm({request_id:id(23)})).status,409);
});
test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=originalQuery;pool.connect=originalConnect;await pool.end();await db.close();});
