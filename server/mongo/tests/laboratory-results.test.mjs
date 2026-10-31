import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareLabResults} from '../lab-result-entry.mjs';
import {verifyLabTests,disapproveLabTests} from '../lab-test-verification.mjs';
test('lab values are validated and doctor-reviewed tests cannot be overwritten',()=>{
  const tests=[{test_id:'test',name:'Synthetic Test',parameters:[{parameter_id:'parameter',name:'Measurement',result_type_id:'1',value:'',remarks:''}]}];
  assert.throws(()=>prepareLabResults(tests,[{test_id:'test',parameters:[{parameter_id:'parameter',value:'not numeric'}]}],{}));
  const saved=prepareLabResults(tests,[{test_id:'test',parameters:[{parameter_id:'parameter',value:'12.34',remarks:''}]}],{});
  assert.equal(saved[0].parameters[0].value,'12.34');
  const data={lab_results:saved,...verifyLabTests({lab_results:saved},'doctor',['test'],{by:'reviewer'})};
  assert.throws(()=>prepareLabResults(saved,[{test_id:'test',parameters:[{parameter_id:'parameter',value:'13',remarks:''}]}],data),/read only/i);
  const reopened={...data,...disapproveLabTests(data,['test'])};
  assert.equal(reopened.doctor_approval,null);
  assert.equal(prepareLabResults(saved,[{test_id:'test',parameters:[{parameter_id:'parameter',value:'13',remarks:''}]}],reopened)[0].parameters[0].value,'13');
});
