import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildLabImportPlan } from "./lab-import-plan.js";
import { validateLabImportPlan } from "./validate-lab-import.js";
import { mapLaboratoryBranches, type LabBranchMap } from "./lab-branch-map.js";

const {values}=parseArgs({options:{source:{type:"string"},tenant:{type:"string"},branch:{type:"string"},"branch-map":{type:"string"},output:{type:"string",default:".lab-import-private"},apply:{type:"boolean",default:false},replace:{type:"boolean",default:false},env:{type:"string"}}});
if(!values.source||!values.tenant||!values.branch)throw new Error("Use --source CSV_DIRECTORY --tenant UUID --branch UUID [--apply --replace --env ENV_FILE]");
if(!/^[0-9a-f-]{36}$/i.test(values.tenant)||!/^[0-9a-f-]{36}$/i.test(values.branch))throw new Error("Tenant and branch must be UUIDs");
const plan=buildLabImportPlan(resolve(values.source),values.tenant,values.branch),output=resolve(values.output!);
if(values["branch-map"])mapLaboratoryBranches(plan,JSON.parse(readFileSync(resolve(values["branch-map"]),"utf8")) as LabBranchMap,resolve(values.source));
if(values.apply&&!values["branch-map"]&&new Set(plan.orders.map(order=>order.legacy_center).filter(Boolean)).size>1)throw new Error("A branch map is required before replacing multi-centre laboratory history");
validateLabImportPlan(plan);
mkdirSync(output,{recursive:true});
writeFileSync(join(output,"lab-import-plan.json"),JSON.stringify(plan));
writeFileSync(join(output,"lab-import-summary.json"),JSON.stringify(plan.summary,null,2));
console.log(JSON.stringify({masters:plan.masters.length,orders:plan.orders.length,patients:plan.patients.length,unlinked_patients:plan.summary.unlinked_patient_ids.length,missing_parameters:plan.summary.missing_parameters,branch_counts:plan.summary.branch_counts,branch_review_orders:plan.summary.branch_review_orders,mode:values.apply?"apply":"validated plan"}));
if(values.apply){
  if(!values.replace)throw new Error("--apply requires --replace because existing laboratory masters/history will be replaced");
  if(values.env)process.env.ENV_FILE=resolve(values.env);
  const {pool}=await import("./db.js"),{applyLabImport}=await import("./apply-lab-import.js");
  try{const result=await applyLabImport(pool,plan,async backup=>{writeFileSync(join(output,`lab-backup-${Date.now()}.json`),JSON.stringify(backup));});console.log(JSON.stringify(result));}finally{await pool.end();}
}
