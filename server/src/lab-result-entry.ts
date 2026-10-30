import {calculateLabFormula} from "./lab-clinical.js";
import {normalizeLabResultFormats,isPapSmearTest} from './lab-result-format.js';
import {lockedLabTestIds,labTestHasResults,resultEntryForTest} from "./lab-result-completion.js";
type Row=Record<string,any>;

export function attributeLabResults(data:Row,before:Row[],after:Row[],submitted:Row[],actor:Row){
  const entries={...data.result_entry?.tests},locked=new Set(lockedLabTestIds(data));
  for(const test of before){
    const prior=labTestHasResults(test)?resultEntryForTest(data,test.test_id):undefined;
    if(!entries[test.test_id]&&prior)entries[test.test_id]={...prior};
  }
  const changed=new Set(labResultChanges(before,after).map(change=>change.test_id));
  for(const test of submitted){
    if(locked.has(test.test_id))continue;
    const saved=after.find(item=>item.test_id===test.test_id);
    if(!saved||!labTestHasResults(saved)){delete entries[test.test_id];continue;}
    if(changed.has(test.test_id)||!entries[test.test_id])entries[test.test_id]={...actor};
  }
  return {tests:entries};
}

export function labResultChanges(before:Row[], after:Row[]) {
  return after.flatMap(test=>{
    const previous=before.find(item=>item.test_id===test.test_id);
    return test.parameters.flatMap((parameter:Row)=>{
      const old=previous?.parameters.find((item:Row)=>(item.parameter_id||null)===(parameter.parameter_id||null));
      const from=String(old?.value??""),to=String(parameter.value??"");
      const fromRemarks=String(old?.remarks??""),toRemarks=String(parameter.remarks??"");
      return from===to&&fromRemarks===toRemarks?[]:[{test_id:test.test_id,test_name:test.name,parameter_id:parameter.parameter_id,parameter_name:parameter.name,previous_value:from,value:to,previous_remarks:fromRemarks,remarks:toRemarks}];
    });
  });
}

export function prepareLabResults(tests:Row[], submitted:Row[], data:Row) {
  const approved=new Set(lockedLabTestIds(data));
  const byTest=new Map(submitted.map(test=>[test.test_id,test]));
  return normalizeLabResultFormats(tests).map(test=>{
    const input=byTest.get(test.test_id);
    if(!input)return {...test};
    const parameters:Row[]=test.parameters.map((parameter:Row)=>{
      const value=input?.parameters.find((item:Row)=>(item.parameter_id||null)===(parameter.parameter_id||null));
      const result=["0","5"].includes(String(parameter.result_type_id))?"":String(value?.value??"").trim();
      const limit=isPapSmearTest(test)?20000:500;
      if(result.length>limit)throw Error(`${parameter.name} result must be ${limit} characters or fewer`);
      return {...parameter,value:result,remarks:String(value?.remarks??"").trim()};
    });
    if(approved.has(test.test_id)){
      if(parameters.some((parameter,index)=>parameter.value!==String(test.parameters[index].value??"").trim()||parameter.remarks!==String(test.parameters[index].remarks??"").trim()))throw new Error("Verified test results are read only");
      return {test_id:test.test_id,name:test.name,test_name:test.name,parameters};
    }
    const values:Record<string,string>={};
    for(const parameter of parameters){
      if(parameter.formula)parameter.value="";
      else if(parameter.legacy_id)values[parameter.legacy_id]=parameter.value;
      if(parameter.value&&parameter.result_type_id==="1"&&!Number.isFinite(Number(parameter.value)))throw new Error(`Enter a numeric result for ${parameter.name}`);
      if(parameter.value&&parameter.result_type_id==="2"&&!(parameter.choices||[]).includes(parameter.value))throw new Error(`Select a configured result for ${parameter.name}`);
    }
    let remaining=parameters.filter(parameter=>parameter.formula);
    for(let pass=0;remaining.length&&pass<parameters.length;pass++){
      const pending:Row[]=[];
      for(const parameter of remaining){
        const refs=[...String(parameter.formula).matchAll(/p(\d+)/g)].map(match=>match[1]!);
        if(refs.some(id=>!String(values[id]??"").trim())){pending.push(parameter);continue;}
        parameter.value=calculateLabFormula(parameter.formula,values,parameter.decimals===""?2:Number(parameter.decimals??2));
        if(parameter.legacy_id)values[parameter.legacy_id]=parameter.value;
      }
      if(pending.length===remaining.length)break;
      remaining=pending;
    }
    return {test_id:test.test_id,name:test.name,test_name:test.name,parameters};
  });
}
