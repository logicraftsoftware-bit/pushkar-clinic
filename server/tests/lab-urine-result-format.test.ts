import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLabResultFormats} from '../src/lab-result-format.js';
import {prepareLabResults} from '../src/lab-result-entry.js';
import {defaultLabNumericResults} from '../src/lab-result-completion.js';
import {reportRows} from '../../src/hospital/lab-report-pdf.js';
const urine={test_id:'urine',name:'URINE R/E',parameters:[
  {parameter_id:'heading',name:'Physical Examination',result_type_id:'0',value:'',remarks:''},
  {parameter_id:'sediment',name:'Sediment',result_type_id:'2',choices:['Absent','Present'],value:'Absent',remarks:'Existing note',reference_text:'Absent'},
  {parameter_id:'pus',name:'Pus cells',result_type_id:'1',value:'',remarks:'',unit:'/HPF'},
  {parameter_id:'colour',name:'Colour',result_type_id:'2',choices:['Yellow'],value:'Yellow',remarks:''},
  {parameter_id:'gravity',name:'Sp. gravity',result_type_id:'1',value:'1.015',remarks:''},
]};

test('Urine R/E Sediment and Pus cells use text inputs without changing other fields or existing values',()=>{
  for(const name of ['URINE R/E','Urine R / E','urine r.e.','URINE R/E [100]']){
    const formatted=normalizeLabResultFormats([{...urine,name}])[0];
    assert.deepEqual(formatted.parameters.map((p:any)=>p.result_type_id),['0','3','3','2','1']);
    assert.equal(formatted.parameters[1].value,'Absent');assert.equal(formatted.parameters[1].remarks,'Existing note');assert.equal(formatted.parameters[1].reference_text,'Absent');
    assert.equal(defaultLabNumericResults([formatted],{})[0].parameters[2].value,'','the new text field must not manufacture a numeric default');
  }
  assert.equal(urine.parameters[1].result_type_id,'2');
  assert.equal(normalizeLabResultFormats([{...urine,name:'URINE CULTURE & SENSITIVITY'}])[0].parameters[1].result_type_id,'2');
});

test('numeric, alphabetical and mixed urine results save and retain their exact report text',()=>{
  for(const [sediment,pus] of [['10','2'],['Absent','Nil'],['Fine sediment','5-8 /HPF']]){
    const submitted={...urine,parameters:urine.parameters.map(p=>({...p,value:p.parameter_id==='sediment'?sediment:p.parameter_id==='pus'?pus:p.value}))};
    const saved=prepareLabResults([urine],[submitted],{})[0];
    assert.equal(saved.parameters[1].value,sediment);assert.equal(saved.parameters[2].value,pus);
    assert.equal(saved.parameters[1].result_type_id,'3');assert.equal(saved.parameters[2].result_type_id,'3');
    const rows=reportRows(saved);assert.equal(rows[1][1],sediment);assert.equal(rows[2][1],pus);
  }
});

test('urine text fields retain doctor approval locks and unrelated numeric and choice validation',()=>{
  const changed={...urine,parameters:urine.parameters.map(p=>({...p,value:p.parameter_id==='sediment'?'Few':p.value}))};
  assert.throws(()=>prepareLabResults([urine],[changed],{doctor_approval:{test_ids:['urine']}}),/read only/);
  assert.throws(()=>prepareLabResults([{...urine,name:'Other Test'}],[{...changed,parameters:changed.parameters.map(p=>({...p,value:p.parameter_id==='pus'?'Nil':p.value}))}],{}),/configured|numeric/);
});

test('Urine R/E RBC accepts numeric, alphabetic and range values without altering CBC RBC formats',()=>{
  for(const name of ['R.B.C','R.B.C.','RBC','RBCs']){
    const panel={test_id:'urine',name:'URINE R/E',parameters:[{parameter_id:'rbc',name,result_type_id:'2',choices:['Absent'],value:'Absent',remarks:'Existing note',reference_text:'<2 RBCs/hpf'}]};
    for(const value of ['2','Nil','2-4 /hpf']){
      const saved=prepareLabResults([panel],[{test_id:'urine',parameters:[{parameter_id:'rbc',value}]}],{})[0];
      assert.equal(saved.parameters[0].result_type_id,'3');assert.equal(saved.parameters[0].value,value);
      assert.equal(reportRows(saved)[0][1],value);assert.equal(saved.parameters[0].reference_text,'<2 RBCs/hpf');
    }
    assert.equal(normalizeLabResultFormats([panel])[0].parameters[0].value,'Absent');
    assert.equal(normalizeLabResultFormats([{...panel,name:'Complete Blood Count (CBC)'}])[0].parameters[0].result_type_id,'2');
  }
});
