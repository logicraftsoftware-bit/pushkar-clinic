import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapLaboratoryBranches, type LabBranchMap } from "../src/lab-branch-map.js";
import type { LabImportPlan } from "../src/lab-import-plan.js";
const main="20000000-0000-4000-8000-000000000001",bg="20000000-0000-4000-8000-000000000002",dispur="20000000-0000-4000-8000-000000000003";
const mapping:LabBranchMap={tenant_id:"tenant",centers:{C100:main,C155:bg,C159:dispur},primary_centers:{[main]:"C100",[bg]:"C155",[dispur]:"C159"},price_sources:{[main]:"default",[bg]:"bgarh",[dispur]:"bgarh"}};
function fixture(){return {version:1,tenant_id:"tenant",branch_id:main,summary:{},masters:[{id:"test",kind:"test",data:{legacy_id:"33",amount:100,legacy_branch_rates:{bgarh:"150"}}}],patients:[{legacy_id:"patient"}],orders:[{id:"first",legacy_patient_id:"patient",legacy_center:"C155",data:{tests:[{amount:75}]}},{id:"second",legacy_center:"C159",data:{tests:[{amount:80}]}},{id:"third",legacy_center:null,data:{tests:[]}}],invoices:[{id:"invoice",order_ids:["second"],amount:80,total:80}],legacy:[]} as LabImportPlan;}
test("branch mapping separates Dispur and Bhangagarh, flags unknown centres and preserves historical charges",()=>{
  const directory=mkdtempSync(join(tmpdir(),"lab-branch-test-")),file=join(directory,"testmaster_rate.csv");writeFileSync(file,'testid,rate,centreno\n33,175,C159\n');
  try{const plan=fixture();mapLaboratoryBranches(plan,mapping,directory);
    assert.equal(plan.orders[0]!.branch_id,bg);assert.equal(plan.orders[1]!.branch_id,dispur);assert.equal(plan.orders[2]!.branch_id,null);assert.equal(plan.orders[2]!.data.branch_review_required,true);
    assert.equal(plan.patients[0]!.branch_id,bg);assert.equal(plan.invoices[0]!.branch_id,dispur);assert.equal(plan.invoices[0]!.total,80);assert.equal(plan.orders[0]!.data.tests[0].amount,75);
    assert.deepEqual(plan.masters[0]!.data.branch_prices,{[main]:100,[bg]:150,[dispur]:175});
  }finally{unlinkSync(file);rmdirSync(directory);}
});
test("mapping rejects cross-hospital configuration and unknown legacy centres",()=>{
  assert.throws(()=>mapLaboratoryBranches(fixture(),{...mapping,tenant_id:"other"},"unused"),/different hospital/);
  const plan=fixture();plan.orders[0]!.legacy_center="C999";assert.throws(()=>mapLaboratoryBranches(plan,mapping,"unused"),/C999/);
});
test("a bill cannot be silently reassigned across branches",()=>{
  const plan=fixture();plan.invoices[0]!.order_ids=["first","second"];
  assert.throws(()=>mapLaboratoryBranches(plan,mapping,"unused"),/spans multiple branches/);
});
