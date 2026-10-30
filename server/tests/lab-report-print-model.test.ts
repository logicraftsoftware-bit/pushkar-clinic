import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reportPrintStatus,reportPrintTestKey,savedPrintableKeys} from '../src/lab-report-print-model.js';
const tests=[{test_id:'one',name:'SGOT',parameters:[{result_type_id:'3',value:'20'}]},{test_id:'two',name:'SGPT',parameters:[{result_type_id:'3',value:''}]}];
test('workflow ticks reflect actual collection, completed entry and each approved test',()=>{
  const record={report_revision:'current',data:{collected_at:'now',technician_approval:{test_ids:['one']},doctor_approval:{test_ids:['one']}}};
  const events=[{revision:'current',test_ids:['one'],confirmed_by_name:'Reception'}];
  assert.deepEqual({...reportPrintStatus(tests[0],0,record,events),event:undefined},{sample:true,entered:true,technician:true,doctor:true,printed:true,event:undefined});
  const second=reportPrintStatus(tests[1],1,record,events);assert.equal(second.entered,false);assert.equal(second.doctor,false);assert.equal(second.printed,false);
  assert.equal(reportPrintStatus(tests[0],0,{...record,report_revision:'changed'},events).printed,false);
  assert.equal(reportPrintStatus(tests[0],0,record,[]).printed,false,'a preview or PDF alone has no confirmed print event');
});
test('print confirmation accepts saved doctor-approved tests and blocks legacy tests without matched test approval',()=>{
  assert.deepEqual(savedPrintableKeys({tests,lab_results:tests,technician_approval:{test_ids:["one"]},doctor_approval:{test_ids:['one']}}),['one']);
  const legacy={name:'Legacy test',parameters:[{value:'Normal'}]};
  assert.equal(reportPrintTestKey(legacy,2),'index:2');
  assert.deepEqual(savedPrintableKeys({tests:[{name:'Legacy test'}],lab_results:[legacy],technician_approval:{test_ids:[null]},doctor_approval:{}}),[]);
});

test('a doctor-approved partial CBC is printable while unapproved and blank tests stay blocked',()=>{
  const cbc={test_id:'cbc',name:'CBC',parameters:[{result_type_id:'1',value:'7770'},{result_type_id:'3',value:''}]};
  const blank={test_id:'blank',parameters:[{result_type_id:'1',value:''}]};
  const data={tests:[cbc,blank],lab_results:[cbc,blank],doctor_approval:{test_ids:['cbc','blank']}};
  assert.deepEqual(savedPrintableKeys(data),['cbc']);
  assert.equal(reportPrintStatus(cbc,0,{data},[]).doctor,true);
  assert.equal(reportPrintStatus(cbc,0,{data},[]).entered,false,'partial results must not be relabelled as fully complete');
  assert.deepEqual(savedPrintableKeys({...data,doctor_approval:{test_ids:['blank']}}),[]);
  assert.equal(cbc.parameters[1].value,'','printing must not manufacture missing results');
});
