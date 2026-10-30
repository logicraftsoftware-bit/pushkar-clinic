import {test} from "node:test";
import assert from "node:assert/strict";
import {prepareLabResults} from "../src/lab-result-entry.js";
import {defaultLabNumericResults,labTestComplete,labTestResultStatus,labResultProgress,reportableLabTests,labOrderEditable} from "../src/lab-result-completion.js";
const parameter=(id:string,value="",type="1")=>({parameter_id:id,name:id,result_type_id:type,value,remarks:""});
const tests=["a","b","c","d"].map(id=>({test_id:id,name:id,parameters:[parameter(id)]}));

test("a saved CBC shows partially completed until all its result parameters are saved",()=>{
  const cbc={test_id:"cbc",name:"CBC",parameters:[parameter("count","7770"),parameter("heading","","0"),parameter("segmented","","3")]};
  assert.equal(labTestResultStatus({parameters:[]}),"Pending");
  assert.equal(labTestResultStatus({parameters:[parameter("blank")]}),"Pending");
  const partial=prepareLabResults([cbc],[cbc],{})[0]!;
  assert.equal(labTestResultStatus(partial),"Partially Completed");
  assert.equal(labTestComplete(partial),false);
  const completed=prepareLabResults([cbc],[{...cbc,parameters:[...cbc.parameters.slice(0,2),parameter("segmented","0","3")]}],{})[0]!;
  assert.equal(labTestResultStatus(completed),"Completed");
  assert.equal(labTestComplete(completed),true);
});

test("numeric defaults complete a CBC while preserving entered values and headings",()=>{
  const cbc={test_id:"cbc",name:"CBC",parameters:[parameter("count","7770"),parameter("heading","","0"),parameter("poly","58"),parameter("segmented"),parameter("eosinophil","02")]};
  const defaults=defaultLabNumericResults([cbc],{});
  assert.deepEqual(defaults[0]!.parameters.map((p:any)=>p.value),["7770","","58","0","02"]);
  assert.equal(labTestComplete(prepareLabResults([cbc],defaults,{})[0]!),true);
  assert.equal(cbc.parameters[3]!.value,"");
});

test("numeric defaults leave verified results, formulas, choices and narrative inputs unchanged",()=>{
  assert.deepEqual(defaultLabNumericResults(tests,{doctor_approval:{test_ids:tests.map(test=>test.test_id)}}),tests);
  const test={test_id:"mixed",parameters:[parameter("choice","","2"),parameter("text","","27"),{...parameter("calc"),formula:"p1*2"}]};
  assert.deepEqual(defaultLabNumericResults([test],{}),[test]);
});

test("saving one test preserves other saved results and verified tests",()=>{
  const existing=tests.map((test,index)=>({...test,parameters:[parameter(test.test_id,index===0?"7":"")]}));
  const results=prepareLabResults(existing,[{...tests[1],parameters:[parameter("b","12")]}],{technician_approval:{test_ids:["a"]}});
  assert.deepEqual(results[0],existing[0]);
  assert.equal(results[1]!.parameters[0].value,"12");
  assert.deepEqual(results.slice(2),existing.slice(2));
  assert.deepEqual(labResultProgress(results).completed.map(test=>test.test_id),["a","b"]);
});
test("three complete tests and one blank test save and only complete tests are reportable",()=>{
  const results=prepareLabResults(tests,tests.map((test,index)=>({...test,parameters:[parameter(test.test_id,index===3?"":"1")]})),{});
  const progress=labResultProgress(results);
  assert.equal(progress.status,"Partially Completed");
  assert.equal(progress.completed.length,3);
  assert.deepEqual(reportableLabTests(results,{doctor_approval:{test_ids:["a","b","c","d"]},technician_approval:{test_ids:["a","b","c","d"]}}).map(test=>test.test_id),["a","b","c"]);
  assert.equal(results[3]!.parameters[0].value,"");
});
test("a panel is incomplete until all result parameters have values; headings need no value",()=>{
  assert.equal(labTestComplete({parameters:[parameter("heading","","0"),parameter("a","1"),parameter("b")]}),false);
  assert.equal(labTestComplete({parameters:[parameter("heading","","5"),parameter("a","1")]}),true);
  assert.equal(labTestComplete({parameters:[]}),false);
  assert.equal(labTestComplete({parameters:[parameter("heading","","0")]}),false);
  assert.equal(labResultProgress(tests).status,"In Progress");
  const partial=labResultProgress([{parameters:[parameter("a","1"),parameter("b")]}]);
  assert.equal(partial.status,"Partially Completed");
  assert.equal(partial.completed.length,0);
});
test("blank inputs leave calculated results blank and complete inputs calculate normally",()=>{
  const panel={test_id:"panel",name:"Panel",parameters:[{...parameter("input"),legacy_id:"1"},{...parameter("calculated","stale"),formula:"p1*2"}]};
  const blank=prepareLabResults([panel],[panel],{})[0]!;
  assert.equal(blank.parameters[1].value,"");
  const complete=prepareLabResults([panel],[{...panel,parameters:[parameter("input","3")]}],{})[0]!;
  assert.equal(complete.parameters[1].value,"6.00");
  assert.equal(labTestComplete(complete),true);
});
test("blank numeric and choice results are allowed, invalid nonblank results are rejected",()=>{
  assert.doesNotThrow(()=>prepareLabResults(tests,[],{}));
  assert.throws(()=>prepareLabResults(tests,[{test_id:"a",parameters:[parameter("a","invalid")]}],{}),/numeric/);
  const choice={test_id:"choice",name:"Choice",parameters:[{...parameter("c","","2"),choices:["Positive","Negative"]}]};
  assert.doesNotThrow(()=>prepareLabResults([choice],[],{}));
  assert.throws(()=>prepareLabResults([choice],[{test_id:"choice",parameters:[parameter("c","Unknown")]}],{}),/configured/);
});
test("approved tests stay locked while remaining tests can be completed and await their own approval",()=>{
  const existing=[{...tests[0],parameters:[parameter("a","1")]},tests[1]!];
  const data={technician_approval:{test_ids:["a"]},doctor_approval:{test_ids:["a"]},lab_results:existing};
  const saved=prepareLabResults(existing,[existing[0]!,{...tests[1],parameters:[parameter("b","2")]}],data);
  assert.equal(labResultProgress(saved).status,"Completed");
  assert.deepEqual(reportableLabTests(saved,data).map(test=>test.test_id),["a"]);
  assert.throws(()=>prepareLabResults(existing,[{...tests[0],parameters:[parameter("a","9")]}],data),/read only/);
});
test("order editing ends when sent to collection, including before actual sample collection",()=>{
  assert.equal(labOrderEditable({kind:"pos",status:"Paid",data:{}}),true);
  for(const order of [{kind:"sample collection",data:{}},{kind:"pos",data:{sample_requested_at:"now"}},{kind:"pos",data:{collected_at:"now"}},{kind:"orders",status:"Cancelled",data:{}},{kind:"pos",data:{import_source:"legacy"}}])assert.equal(labOrderEditable(order),false);
});
