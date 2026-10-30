import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { applyLabImport } from "../src/apply-lab-import.js";
import type { LabImportPlan } from "../src/lab-import-plan.js";
const plan:LabImportPlan={version:1,tenant_id:"hospital-a",branch_id:"branch-a",summary:{},masters:[{id:"test-a",kind:"test",name:"CBC",data:{legacy:{category_id:"1"}}}],patients:[],orders:[{id:"order-a",occurred_at:"2026-10-07T10:00:00+05:30",legacy_patient_id:"1",kind:"results",status:"Completed",data:{tests:[{test_id:"test-a"}],customer_name:"Source Patient"}}],invoices:[],legacy:[]};
function database(failInsert=false){
  const calls:Array<{sql:string;params:any[]}>=[];let released=false;
  const client={async query(sql:string,params:any[]=[]){calls.push({sql,params});
    if(sql.startsWith("SELECT h.name"))return {rows:[{name:"Hospital",branch_name:"Branch"}]};
    if(sql.startsWith("SELECT to_regclass"))return {rows:[{exists:null}]};
    if(sql.startsWith("SELECT * FROM role_work_items"))return {rows:[{id:"old-lab-order"}]};
    if(sql.startsWith("SELECT * FROM hospital_diagnostic_masters"))return {rows:[{id:"old-lab-master"}]};
    if(sql.startsWith("INSERT INTO lab_import_runs"))return {rows:[{id:"run-a"}]};
    if(failInsert&&sql.startsWith("INSERT INTO hospital_diagnostic_masters"))throw new Error("write failure");
    if(sql.startsWith("SELECT (SELECT count"))return {rows:[{masters:1,orders:1}]};
    return {rows:[],rowCount:1};
  },release(){released=true;}};
  return {db:{connect:async()=>client} as unknown as Pool,calls,released:()=>released};
}
test("replacement does not delete anything when the backup cannot be saved",async()=>{
  const d=database();await assert.rejects(applyLabImport(d.db,structuredClone(plan),async()=>{throw new Error("backup disk full");}),/backup disk full/);
  assert.ok(d.calls.some(c=>c.sql==="ROLLBACK"));assert.ok(!d.calls.some(c=>c.sql.startsWith("DELETE")));assert.ok(d.released());
});
test("replacement rolls back all data changes when importing a master fails",async()=>{
  const d=database(true);let saved=false;await assert.rejects(applyLabImport(d.db,structuredClone(plan),async()=>{saved=true;}),/write failure/);
  assert.ok(saved);assert.ok(d.calls.some(c=>c.sql==="ROLLBACK"));assert.ok(!d.calls.some(c=>c.sql==="COMMIT"));assert.ok(d.released());
});
test("replacement preserves shared patient records and scopes removal to the hospital laboratory",async()=>{
  const d=database();const result=await applyLabImport(d.db,structuredClone(plan),async()=>{});
  assert.equal(result.hospital,"Hospital");assert.ok(d.calls.some(c=>c.sql==="COMMIT"));
  const deletes=d.calls.filter(c=>c.sql.startsWith("DELETE"));assert.ok(deletes.every(c=>c.sql.includes("tenant_id=$1")&&c.params[0]==="hospital-a"));
  assert.ok(!deletes.some(c=>/DELETE FROM (patients|clinical_appointments|ipd_admissions)/.test(c.sql)));
  const masters=deletes.find(c=>c.sql.includes("hospital_diagnostic_masters"));assert.match(masters!.sql,/domain='pathology'/);
  const orders=deletes.find(c=>c.sql.includes("role_work_items"));assert.deepEqual(orders!.params[1],["old-lab-order"]);
});
