import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attributeLabResults,prepareLabResults} from '../src/lab-result-entry.js';
import {disapproveLabTests,verifyLabTests} from '../src/lab-test-verification.js';
import {resultEntryForTest,reportableLabTests,lockedLabTestIds} from '../src/lab-result-completion.js';
const tests=['a','b'].map(id=>({test_id:id,name:id,parameters:[{parameter_id:id,result_type_id:'1',value:'12',remarks:''}]}));

test('the authenticated result entrant is recorded per changed test without overwriting other technicians',()=>{
  const data={result_entry:{tests:{a:{by:'old-a',name:'Technician A'},b:{by:'old-b',name:'Technician B'}}}};
  const submitted=[{...tests[0],parameters:[{...tests[0].parameters[0],value:'13'}]}];
  const saved=prepareLabResults(tests,submitted,data);
  const entry=attributeLabResults(data,tests,saved,submitted,{by:'actual-user',name:'Entry Technician',at:'now'});
  assert.equal(entry.tests.a.name,'Entry Technician');assert.equal(entry.tests.a.by,'actual-user');assert.equal(entry.tests.b.name,'Technician B');
  const unchanged=attributeLabResults({...data,result_entry:entry},saved,saved,saved,{by:'other-user',name:'Other'});
  assert.equal(unchanged.tests.a.by,'actual-user');assert.equal(unchanged.tests.b.by,'old-b');
});

test('disapproving a single test preserves saved results and other approvals, unlocks only that test, and requires doctor reapproval',()=>{
  let data:any={lab_results:tests,technician_approval:{test_ids:['a','b']},doctor_approval:{test_ids:['a','b'],tests:{a:{name:'Doctor A'},b:{name:'Doctor B'}}}};
  const patch=disapproveLabTests(data,['a']);data={...data,...patch};
  assert.deepEqual(lockedLabTestIds(data),['b']);assert.deepEqual(reportableLabTests(tests,data).map(t=>t.test_id),['b']);
  const submitted=[{...tests[0],parameters:[{...tests[0].parameters[0],value:'20'}]}];
  const edited=prepareLabResults(tests,submitted,data);assert.equal(edited[0].parameters[0].value,'20');assert.deepEqual(edited[1],tests[1]);
  assert.equal(data.lab_results[0].parameters[0].value,'12');
  assert.throws(()=>disapproveLabTests(data,['foreign']),/doctor-approved/);
  assert.throws(()=>disapproveLabTests(data,[]),/Select/);
  data={...data,lab_results:edited,...verifyLabTests({...data,lab_results:edited},'doctor',['a'],{name:'Doctor C'})};
  assert.deepEqual(data.disapproved_test_ids,[]);assert.deepEqual(reportableLabTests(edited,data).map(t=>t.test_id),['a','b']);
});

test('previous entry history and legacy technician attribution remain available without inventing a collector name',()=>{
  assert.equal(resultEntryForTest({result_history:[{by:'u',changes:[{test_id:'a'}]}],result_entry_names:{u:'Earlier Technician'}},'a')?.name,'Earlier Technician');
  assert.equal(resultEntryForTest({technician_approval:{test_ids:['a'],name:'Legacy Technician'}},'a')?.name,'Legacy Technician');
  assert.equal(resultEntryForTest({collector:'Collector'},'a'),undefined);
  const oldData={result_completed_by:'earlier-user',result_entry_names:{'earlier-user':'Earlier Technician'}};
  const changed=[{...tests[1],parameters:[{...tests[1].parameters[0],value:'99'}]}];
  const saved=prepareLabResults(tests,changed,oldData);
  const attribution=attributeLabResults(oldData,tests,saved,changed,{by:'new-user',name:'New Technician'});
  assert.equal(attribution.tests.a.name,'Earlier Technician');
  assert.equal(attribution.tests.b.name,'New Technician');
});
