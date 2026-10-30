import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPapSmearTest,normalizeLabResultFormats} from '../src/lab-result-format.js';
import {prepareLabResults} from '../src/lab-result-entry.js';
import {reportRows,createLabReportPdf} from '../../src/hospital/lab-report-pdf.js';
import {readFileSync} from 'node:fs';
import {jsPDF} from 'jspdf';
const pap={test_id:'pap',name:'PAP SMEAR',parameters:[{parameter_id:'report',name:'PAP Smear',result_type_id:'3',value:'Existing description',remarks:'Previous note'}]};
const text='SPECIMEN ADEQUACY\nSatisfactory for evaluation.\n\nMICROSCOPIC DESCRIPTION\n'+('Descriptive cytology report text. '.repeat(50))+'\n\nIMPRESSION\nFinal narrative impression.';

test('Pap smear uses a multiline description field while procedure charges and other tests keep their formats',()=>{
  for(const name of ['PAP SMEAR','Pap Smear [123]','Pap Smear (Cytology)']){
    assert.equal(isPapSmearTest({name}),true);
    const result=normalizeLabResultFormats([{...pap,name}])[0];
    assert.equal(result.parameters[0].result_type_id,'27');assert.equal(result.parameters[0].value,'Existing description');assert.equal(result.parameters[0].remarks,'Previous note');
  }
  assert.equal(normalizeLabResultFormats([{...pap,name:'PAP SMEAR PROCEDURE CHARGE'}])[0].parameters[0].result_type_id,'3');
  assert.equal(isPapSmearTest({name:'CBC'}),false);
});

test('long multiline Pap descriptions save without truncation and preserve approval locks and other result limits',()=>{
  assert.ok(text.length>500);
  const submitted=[{test_id:'pap',parameters:[{parameter_id:'report',value:text,remarks:'Note'}]}];
  const saved=prepareLabResults([pap],submitted,{})[0];assert.equal(saved.parameters[0].value,text);assert.equal(reportRows(saved)[0][1],text);
  assert.throws(()=>prepareLabResults([pap],submitted,{doctor_approval:{test_ids:['pap']}}),/read only/);
  assert.throws(()=>prepareLabResults([pap],[{test_id:'pap',parameters:[{parameter_id:'report',value:'a'.repeat(20001)}]}],{}),/20000/);
  assert.throws(()=>prepareLabResults([{...pap,name:'Other test'}],submitted,{}),/500/);
});

test('Pap smear PDFs render long descriptions across the page with line breaks and final text intact',async()=>{
  const fonts={regular:readFileSync(new URL('../../public/fonts/NotoSans-Regular.ttf',import.meta.url)).toString('base64'),bold:readFileSync(new URL('../../public/fonts/NotoSans-Bold.ttf',import.meta.url)).toString('base64')};
  const saved=prepareLabResults([pap],[{test_id:'pap',parameters:[{parameter_id:'report',value:text}]}],{})[0];
  const calls:string[]=[];const hook:any=['postProcessText',(args:any)=>calls.push(JSON.stringify(args.text))];jsPDF.API.events.push(hook);
  try{
    const pdf=await createLabReportPdf({data:{doctor_approval:{test_ids:['pap'],name:'Doctor'}}},[{...saved,notes:"AUTOMATIC MASTER NOTES",summaries:[{summary:"AUTOMATIC SPECIMEN TEMPLATE"}]}],fonts);
    assert.equal(pdf.getNumberOfPages(),1);assert.ok(calls.some(value=>value.includes('REPORT DESCRIPTION')));
    assert.ok(calls.every(value=>!value.includes('AUTOMATIC')));assert.ok(calls.some(value=>value.includes('SPECIMEN ADEQUACY')));assert.ok(calls.some(value=>value.includes('Final narrative impression.')));
    const extended=text+'\n'+('Additional descriptive report line.\n'.repeat(250))+'End of extended Pap report.';
    const long=prepareLabResults([pap],[{test_id:'pap',parameters:[{parameter_id:'report',value:extended}]}],{})[0];
    const multipage=await createLabReportPdf({data:{doctor_approval:{test_ids:['pap'],name:'Doctor'}}},[long],fonts);
    assert.ok(multipage.getNumberOfPages()>1);assert.ok(calls.some(value=>value.includes('End of extended Pap report.')));
  }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
});
