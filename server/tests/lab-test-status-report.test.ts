import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {groupTestStatusRows,reportStatusLabel,testStatusPrintHtml,type TestStatusRow} from '../../src/hospital/lab-test-status-model.js';
import {labTestStatusReportSql,labTestStatusSummarySql} from '../src/lab-test-status-report.js';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='test-status-report-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/laboratory.js');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1);
let role='hospital_admin',reportCalls=0;
let queryArgs:any[]=[];
let summaryArgs:any[]=[],emptyRows=false;
const original=pool.query;
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}]};
  if(sql===labTestStatusReportSql){
    reportCalls++;queryArgs=args;
    return {rows:emptyRows?[]:[{order_id:id(4),test_id:id(2),result_status:'Partially Completed',total:230,group_total:110}]};
  }
  if(sql===labTestStatusSummarySql){summaryArgs=args;return {rows:[{total:300,pending:230,conducted:70}]};}
  return {rows:[]};
};
const app=express();app.use((req:any,_res,next)=>{req.portalUser={sub:id(3),tenantId:tenant,role};next();});app.use(router);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/test-status-report`;

test('test report binds tenant, dates, selected test, status, literal search and page',async()=>{
  const search='Patient_100%';
  const response=await fetch(`${url}?${new URLSearchParams({from:'2026-10-12',to:'2026-10-28',test_id:id(2),status:'pending',search,page:'2'})}`);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.total,230);assert.equal(result.page_size,100);assert.equal(result.page,2);
  assert.equal(result.rows[0].total,undefined);assert.equal(result.rows[0].group_total,110);
  assert.deepEqual(queryArgs,[tenant,'2026-10-12','2026-10-28',id(2),'pending','%Patient\\_100\\%%',100,'']);
  assert.deepEqual(result.summary,{total:300,pending:230,conducted:70});
  assert.deepEqual(summaryArgs,[tenant,'2026-10-12','2026-10-28',id(2),'%Patient\\_100\\%%','']);
});

test('summary cards retain full filtered counts even on an empty result page',async()=>{
  emptyRows=true;
  try{
    const response=await fetch(`${url}?from=2026-10-12&to=2026-10-28&status=conducted&page=20`);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.deepEqual(result.rows,[]);
    assert.deepEqual(result.summary,{total:300,pending:230,conducted:70});
    assert.deepEqual(summaryArgs,[tenant,'2026-10-12','2026-10-28','','','']);
  }finally{emptyRows=false;}
});

test('test-name text filter is bound independently from patient search for rows and cards',async()=>{
  const response=await fetch(`${url}?${new URLSearchParams({from:'2026-10-01',to:'2026-10-28',test_search:'CBC_100%',search:'Patient',status:'conducted'})}`);
  assert.equal(response.status,200);
  assert.deepEqual(queryArgs,[tenant,'2026-10-01','2026-10-28','','conducted','%Patient%',0,'%CBC\\_100\\%%']);
  assert.deepEqual(summaryArgs,[tenant,'2026-10-01','2026-10-28','','%Patient%','%CBC\\_100\\%%']);
});

test('invalid date ranges and report filters do not query patient data',async()=>{
  const before=reportCalls;
  for(const query of ['from=2026-10-29&to=2026-10-01','from=2026-02-30&to=2026-03-01','from=invalid&to=2026-10-28','from=2026-10-01&to=2026-10-28&status=anything','from=2026-10-01&to=2026-10-28&page=0','from=2026-10-01&to=2026-10-28&test_id=foreign'])assert.equal((await fetch(`${url}?${query}`)).status,400);
  assert.equal(reportCalls,before);
});

test('report requires laboratory report data access',async()=>{
  const before=reportCalls;role='laboratory';
  assert.equal((await fetch(`${url}?from=2026-10-01&to=2026-10-28`)).status,403);
  assert.equal(reportCalls,before);role='hospital_admin';
});

const row:TestStatusRow={order_id:id(4),test_id:id(2),test_name:'HbA1c',report_date:'2026-10-12',registered_at:'2026-10-12T04:00:00Z',uhid:'UHID-1',patient_name:'Patient <script>alert(1)</script>',bill_number:'B-1',barcode:'LAB-1',result_status:'Completed'};
test('report groups each date and test separately and printing includes every supplied row safely',()=>{
  const rows=[row,{...row,order_id:id(5)}, {...row,test_id:id(6),test_name:'CBC',result_status:'Partially Completed'}, {...row,report_date:'2026-10-13'}];
  assert.deepEqual(groupTestStatusRows(rows).map(group=>group.rows.length),[2,1,1]);
  assert.equal(reportStatusLabel('Completed'),'Done');
  assert.equal(reportStatusLabel('Partially Completed'),'Partially Completed');
  const html=testStatusPrintHtml(rows,'2026-10-12','2026-10-13','All Tests');
  assert.match(html,/4 tests/);assert.match(html,/Total: 2/);assert.match(html,/CBC/);assert.match(html,/09:30:00/);
  assert.ok(!html.includes('<script>alert(1)</script>'));assert.match(html,/&lt;script&gt;/);
  assert.match(html,/Partially Completed/);
});

test.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await pool.end();});
