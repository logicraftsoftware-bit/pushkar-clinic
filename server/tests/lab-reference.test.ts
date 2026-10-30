import assert from "node:assert/strict";
import { test } from "node:test";
import { laboratoryReference } from "../src/lab-clinical.js";
test("historical result uses its recorded reference ID even without demographics",()=>{
  const ranges=[{slno:"321",sex:"0",age_from:"0",age_to:"0",value_from:"",value_to:"",normal_range:"Normal: <100 mg/dl\nPrediabetes: 100-125 mg/dl\nDiabetes: >126 mg/dl"}];
  const reference=laboratoryReference(ranges,"",null,"321");
  assert.equal(reference.reference_rule_id,"321");assert.match(reference.reference_text,/Normal: <100/);assert.equal(reference.reference_from,"");
});
test("zero-to-zero age limits allow a general text reference without a date of birth",()=>{
  assert.equal(laboratoryReference([{slno:"389",sex:"0",age_from:"0",age_to:"0",age_type:"Days",normal_range:"Up to 140"}],"",null).reference_text,"Up to 140");
});
test("textual ranges never turn placeholder numeric zeroes into a zero interval",()=>{
  const reference=laboratoryReference([{slno:"43",age_from:"0",age_to:"0",value_from:"0",value_to:"0",normal_range:"up to 24"}],"",null);
  assert.equal(reference.reference_from,"");assert.equal(reference.reference_to,"");assert.equal(reference.reference_text,"up to 24");
});
test("unmatched demographics show labelled source alternatives without assigning numeric flags",()=>{
  const reference=laboratoryReference([{sex:"MALE",age_from:"0",age_to:"200",value_from:"1",value_to:"2",normal_range:"1 - 2"},{sex:"FEMALE",age_from:"0",age_to:"200",normal_range:"3 - 4"}],"",null);
  assert.match(reference.reference_text,/MALE/);assert.match(reference.reference_text,/FEMALE/);assert.equal(reference.reference_from,"");assert.equal(reference.reference_to,"");
});
