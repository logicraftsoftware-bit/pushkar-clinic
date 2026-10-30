import assert from "node:assert/strict";
import { test } from "node:test";
import { laboratoryPrice } from "../src/lab-branch-pricing.js";
import { laboratoryTestAvailable } from "../src/lab-branch-pricing.js";
test("lab billing selects the branch rate and preserves explicitly free branch tests",()=>{
  const data={amount:500,branch_prices:{bhangagarh:650,dispur:0}};
  assert.equal(laboratoryPrice(data,"bhangagarh"),650);
  assert.equal(laboratoryPrice(data,"dispur"),0);
  assert.equal(laboratoryPrice(data,"main"),500);
});
test("invalid configured branch prices cannot generate a bill",()=>{
  assert.throws(()=>laboratoryPrice({amount:500,branch_prices:{dispur:-1}},"dispur"));
  assert.throws(()=>laboratoryPrice({amount:500,branch_prices:{dispur:"unknown"}},"dispur"));
});
test('branch-scoped radiology tests cannot fall back to the global price at other branches',()=>{
  const data={amount:350,available_branch_ids:['hospital','diagnostics'],branch_prices:{hospital:350,diagnostics:0}};
  assert.equal(laboratoryPrice(data,'hospital'),350);assert.equal(laboratoryPrice(data,'diagnostics'),0);
  assert.equal(laboratoryTestAvailable(data,'hatigaon'),false);
  assert.throws(()=>laboratoryPrice(data,'hatigaon'),/not available/);
  assert.throws(()=>laboratoryPrice(data,null),/not available/);
  assert.equal(laboratoryTestAvailable({amount:500},'hatigaon'),true);
});
