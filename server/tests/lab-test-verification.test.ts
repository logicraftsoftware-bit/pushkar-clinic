import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyLabTests,disapproveLabTests} from '../src/lab-test-verification.js';
import {reportableLabTests,lockedLabTestIds,resultEntryForTest} from '../src/lab-result-completion.js';
import {prepareLabResults} from '../src/lab-result-entry.js';
const tests=['a','b','c'].map(id=>({test_id:id,name:id,parameters:[{parameter_id:id,value:id==='c'?'':'12',remarks:''}]}));
test('doctor approval releases complete tests without manual technician verification and preserves earlier verifier attribution',()=>{
  let data:any={lab_results:tests};
  assert.deepEqual(reportableLabTests(tests,data),[]);
  data={...data,...verifyLabTests(data,'doctor',['a'],{name:'Doctor A',pathologist_ids:['d1'],pathologist_names:['Doctor A']})};
  assert.deepEqual(reportableLabTests(tests,data).map(t=>t.test_id),['a']);
  data={...data,...verifyLabTests(data,'technician',['b'],{name:'Technician B'})};
  assert.deepEqual(reportableLabTests(tests,data).map(t=>t.test_id),['a']);
  data={...data,...verifyLabTests(data,'technician',['a'],{name:'Technician A'})};
  assert.deepEqual(reportableLabTests(tests,data).map(t=>t.test_id),['a']);
  data={...data,...verifyLabTests(data,'doctor',['b'],{name:'Doctor B',pathologist_ids:['d2'],pathologist_names:['Doctor B']})};
  assert.deepEqual(reportableLabTests(tests,data).map(t=>t.test_id),['a','b']);
  assert.equal(data.doctor_approval.tests.a.name,'Doctor A');
  assert.equal(data.technician_approval.tests.b.name,'Technician B');
  assert.deepEqual(data.doctor_approval.pathologist_ids,['d1','d2']);
  for(const stage of ['doctor','technician'] as const){
    assert.throws(()=>verifyLabTests(data,stage,['c'],{}),/completed/);
    assert.throws(()=>verifyLabTests(data,stage,['foreign'],{}),/completed/);
    assert.throws(()=>verifyLabTests(data,stage,[],{}),/Select/);
    assert.throws(()=>verifyLabTests(data,stage,['a'],{}),/already/);
  }
});
test('doctor-approved results stay locked while old technician-only records remain editable',()=>{
  const data={doctor_approval:{test_ids:['a']}};
  const changed=tests.map(t=>({...t,parameters:[{...t.parameters[0],value:'99'}]}));
  assert.throws(()=>prepareLabResults(tests,changed,data),/read only/);
  assert.doesNotThrow(()=>prepareLabResults(tests,[tests[0],...changed.slice(1)],data));
});

test('both stages accept a saved partial CBC but reject blank and heading-only tests',()=>{
  const partial={test_id:'cbc',parameters:[{parameter_id:'count',result_type_id:'1',value:'7770'},{parameter_id:'segmented',result_type_id:'3',value:''}]};
  let data:any={lab_results:[partial,{test_id:'blank',parameters:[{value:''}]},{test_id:'heading',parameters:[{result_type_id:'0',value:'Heading'}]}]};
  for(const stage of ['doctor','technician'] as const){
    for(const id of ['blank','heading','foreign'])assert.throws(()=>verifyLabTests(data,stage,[id],{}),/saved results/);
    data={...data,...verifyLabTests(data,stage,['cbc'],{name:stage})};
    assert.deepEqual(data[stage==='doctor'?'doctor_approval':'technician_approval'].test_ids,['cbc']);
  }
  assert.deepEqual(data.lab_results[0],partial);
  assert.deepEqual(reportableLabTests(data.lab_results,data).map((test:any)=>test.test_id),['cbc'],'doctor approval releases the saved partial CBC');
});
