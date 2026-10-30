import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {labListCountPlan,labNavigationIndexesSql,labOrderFastSummarySql} from '../src/lab-list-query.js';
import {labOrderSummarySql} from '../src/lab-order-list.js';
import {performance} from 'node:perf_hooks';

test('results and reports count without dashboard aggregates or unneeded joins; searches and bill filters retain their joins',()=>{
  for(const stage of ['Results','Reports','Sample Collection','Verification']){
    const plan=labListCountPlan(stage,'',false);
    assert.equal(plan.aggregate,'count(*)::int total');assert.equal(plan.joins,'');
  }
  assert.match(labListCountPlan('Orders','',false).aggregate,/ready_previous/);
  assert.match(labListCountPlan('Orders','',false).joins,/finance_records/);
  assert.doesNotMatch(labListCountPlan('Orders','',false).joins,/patients/);
  assert.match(labListCountPlan('Results','Smith',false).joins,/patients/);
  assert.match(labListCountPlan('Results','Smith',false).joins,/finance_records/);
  assert.match(labListCountPlan('Results','',true).joins,/finance_records/);
});

test('summary projection retains all counters and monthly trends with large result payloads',async t=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE TABLE role_work_items(id int,tenant_id text,branch_id text,workspace text,kind text,status text,occurred_at timestamptz,data jsonb);
      CREATE TABLE finance_records(id uuid PRIMARY KEY,tenant_id text,due numeric);
      INSERT INTO finance_records SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'hospital',CASE WHEN n%2=0 THEN 100 ELSE 0 END FROM generate_series(1,30)n;
      INSERT INTO role_work_items SELECT n,CASE WHEN n<=6000 THEN 'hospital' ELSE 'other' END,CASE WHEN n%2=0 THEN 'main' ELSE 'second' END,'laboratory','results',
        CASE WHEN n%11=0 THEN 'Cancelled' WHEN n%13=0 THEN 'Rejected' ELSE 'Paid' END,now()-(n%4)*interval '1 month',
        jsonb_build_object('bill_id','00000000-0000-4000-8000-'||lpad((n%30+1)::text,12,'0'),
          'collected_at',CASE WHEN n%2=0 THEN '2026-10-29' ELSE null END,
          'result_status',CASE WHEN n%3=0 THEN 'Completed' WHEN n%3=1 THEN 'In Progress' ELSE 'Partially Completed' END,
          'doctor_approval',CASE WHEN n%5=0 THEN null ELSE jsonb_build_object('by','doctor') END,
          'lab_results',repeat(md5(n::text),250),'result_history',repeat(md5((n+1)::text),125)) FROM generate_series(1,6051)n;
      ANALYZE role_work_items; ANALYZE finance_records;`);
    const filters=`w.tenant_id=$1 AND w.workspace='laboratory' AND ($2::text IS NULL OR w.branch_id=$2)`;
    const previous=`SELECT ${labOrderSummarySql()} FROM role_work_items w LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id WHERE ${filters}`;
    const optimized=labOrderFastSummarySql(filters);
    for(const branch of [null,'main','second']){
      const args=['hospital',branch];
      assert.deepEqual((await db.query(optimized,args)).rows,(await db.query(previous,args)).rows);
    }
    const args=['hospital',null];
    let start=performance.now();await db.query(previous,args);const before=performance.now()-start;
    start=performance.now();const result=await db.query<any>(optimized,args);const after=performance.now()-start;
    assert.equal(result.rows[0].total,6000);
    t.diagnostic(`6,051 large-result fixtures, local PGlite summary: previous ${before.toFixed(1)} ms; optimized ${after.toFixed(1)} ms. Production timing still requires a deployed measurement.`);
  }finally{await db.close();}
});

test('navigation indexes retain matching result/report rows, newest-first order and hospital scope',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE TABLE role_work_items(id int,tenant_id text,workspace text,kind text,status text,occurred_at timestamptz,data jsonb);
      INSERT INTO role_work_items SELECT n,CASE WHEN n<=6000 THEN 'hospital' ELSE 'other' END,'laboratory','results','Sample Collected',now()-n*interval '1 minute',
        jsonb_build_object('collected_at','2026-10-27','result_status','Completed','doctor_approval',jsonb_build_object('id','doctor')) FROM generate_series(1,6037) n;`);
    await db.exec(labNavigationIndexesSql);
    const plan=labListCountPlan('Results','',false);
    const result=await db.query<any>(`SELECT ${plan.aggregate} FROM role_work_items w ${plan.joins}
      WHERE w.tenant_id=$1 AND w.workspace='laboratory' AND w.data->>'collected_at' IS NOT NULL AND ${plan.search}`,['hospital','',[]]);
    assert.equal(result.rows[0].total,6000);
    const rows=await db.query<any>(`SELECT id FROM role_work_items WHERE tenant_id='hospital' AND workspace='laboratory' AND data->>'collected_at' IS NOT NULL ORDER BY occurred_at DESC,id DESC LIMIT 50`);
    assert.equal(rows.rows.length,50);assert.equal(rows.rows[0].id,1);assert.equal(rows.rows.at(-1).id,50);
  }finally{await db.close();}
});
