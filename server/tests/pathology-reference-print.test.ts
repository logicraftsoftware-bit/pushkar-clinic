import assert from "node:assert/strict";
import { test } from "node:test";
import { printPathologyReport } from "../../src/hospital/pathology-print.js";
test("printed reports show escaped multiline source reference text alongside the unchanged result",()=>{
  let html="";const previous=globalThis.window;
  globalThis.window={open:()=>({document:{open(){},write(value:string){html=value;},close(){}}})} as unknown as Window & typeof globalThis;
  try{printPathologyReport({patient_name:"Patient",data:{}},[{name:"Glucose",parameters:[{name:"Fasting",value:"188",reference_text:"Normal: <100 mg/dl\nOther source bands",reference_from:"",reference_to:""}]}],()=>assert.fail("Printing blocked"));
    assert.match(html,/Normal: &lt;100 mg\/dl\nOther source bands/);assert.match(html,/white-space:pre-line/);assert.match(html,/>188</);
  }finally{globalThis.window=previous;}
});
