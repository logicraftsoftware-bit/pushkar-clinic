import {test} from "node:test";
import assert from "node:assert/strict";
import {labSearchPatterns} from "../src/lab-search.js";

test("combined test and patient searches match all words regardless of order",()=>{
  const patterns=labSearchPatterns("  Anita   fasting glucose ");
  assert.deepEqual(patterns,["%Anita%","%fasting%","%glucose%"]);
});
test("formatted phone searches use digits and UHIDs retain their identifier",()=>{
  assert.deepEqual(labSearchPatterns("+91 (98765) 43210"),["%9876543210%"]);
  assert.deepEqual(labSearchPatterns("UHID-001060"),["%UHID-001060%"]);
});
test("wildcards and backslashes in user input are literal search characters",()=>{
  assert.deepEqual(labSearchPatterns("100% A_B C\\D"),["%100\\%%","%A\\_B%","%C\\\\D%"]);
  assert.deepEqual(labSearchPatterns("   "),[]);
});
