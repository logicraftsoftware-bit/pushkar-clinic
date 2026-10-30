import {test} from 'node:test';
import assert from 'node:assert/strict';
import {labOrderFilterSql,labOrderSummarySql,labBillingSummarySql} from '../src/lab-order-list.js';
import {labOrderPages,labOrderPresentation,labOrderTrend} from '../../src/hospital/lab-orders-model.js';
test('date and type filters are parameterized and cover the entire final day in the hospital timezone',()=>{
  const filter=labOrderFilterSql({from:'2026-01-01',to:'2026-10-09',status:'Processing',orderType:'results'});
  assert.deepEqual(filter.values,['2026-01-01','2026-10-09','Processing','results']);
  assert.match(filter.sql,/Asia\/Kolkata/);assert.match(filter.sql,/::date <= \$6::date/);assert.doesNotMatch(filter.sql,/2026-10-09/);
  assert.deepEqual(labOrderFilterSql({from:'',to:'',status:'',orderType:''}).values,[null,null,'','']);
});
test('summary metrics count all matching rows and use actual monthly counts without pagination',()=>{
  const sql=labOrderSummarySql();assert.match(sql,/unpaid_previous/);assert.match(sql,/f.due>0/);assert.match(sql,/doctor_approval/);assert.doesNotMatch(sql,/LIMIT|OFFSET/);
});
test('billing payment filter follows invoice balances even after the order reaches sample collection',()=>{
  const filter=labOrderFilterSql({from:'',to:'',status:'Partially Paid',orderType:''},true);
  assert.match(filter.sql,/f.due<=0/);assert.match(filter.sql,/f.paid>0/);assert.doesNotMatch(filter.sql,/collected_at/);
  assert.deepEqual(filter.values,[null,null,'Partially Paid','']);
});
test('billing summary preserves currency precision and includes cash retained until refunds are paid',()=>{
  const sql=labBillingSummarySql();assert.match(sql,/sum\(bill_paid\)/);assert.doesNotMatch(sql,/NOT IN \('Cancelled','Refunded'\)/);
  assert.match(sql,/partial_previous/);assert.match(sql,/revenue_current/);assert.match(sql,/Asia\/Kolkata/);
  assert.doesNotMatch(sql,/sum\(bill_paid\).*?::int revenue/);assert.doesNotMatch(sql,/LIMIT|OFFSET/);
});
test('sample status follows collection and completion rather than a stale billing status',()=>{
  const partial={kind:'results',status:'Partially Paid',bill_id:'bill',bill_paid:50,bill_due:50,data:{collected_at:'2026-10-09',processing_status:'Accepted',result_status:'Completed',doctor_approval:{by:'doctor'}}};
  assert.equal(labOrderPresentation(partial).sample,'Sample Collected');assert.equal(labOrderPresentation(partial).resultLabel,'Doctor Approved');assert.equal(labOrderPresentation(partial).billingLabel,'Bill Generated');
  assert.equal(labOrderPresentation({...partial,data:{collected_at:'2026-10-09',result_status:'In Progress'}}).sample,'Processing');
  assert.equal(labOrderPresentation({kind:'sample collection',status:'Awaiting Sample',data:{}}).sample,'Awaiting Sample');
  assert.equal(labOrderPresentation({...partial,status:'Cancelled'}).sample,'Cancelled');
});
test('unpaid bills and incomplete test results remain visible without being labeled approved',()=>{
  const display=labOrderPresentation({kind:'results',status:'In Progress',bill_id:'bill',bill_paid:0,bill_due:100,data:{result_status:'Partially Completed',collected_at:'now'}});
  assert.equal(display.billingLabel,'Unpaid');assert.equal(display.resultLabel,'Partially Completed');assert.equal(display.resultTone,'amber');
});
test('month-over-month trends handle zero baselines without invented percentages',()=>{
  assert.deepEqual(labOrderTrend(12,10),{label:'+20%',direction:'up'});assert.deepEqual(labOrderTrend(5,10),{label:'-50%',direction:'down'});
  assert.equal(labOrderTrend(12,0).label,'New this month');assert.equal(labOrderTrend(0,0).label,'No change');
});
test('pagination remains compact for thousands of orders and handles a single page',()=>{
  assert.deepEqual(labOrderPages(1,1195),[1,2,'gap',1195]);assert.deepEqual(labOrderPages(600,1195),[1,'gap',599,600,601,'gap',1195]);assert.deepEqual(labOrderPages(1,1),[1]);
});
