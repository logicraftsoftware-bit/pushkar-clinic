import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pool } from "./db.js";
import type { LabBranchMap } from "./lab-branch-map.js";
const {values}=parseArgs({options:{tenant:{type:"string"},central:{type:"string"},output:{type:"string",default:"/root/hospital-lab-import/branch-map.json"}}});
if(!values.tenant||!values.central)throw new Error("Use --tenant HOSPITAL_UUID --central MAIN_BRANCH_UUID --output PRIVATE_MAPPING_FILE");
const output=resolve(values.output!),client=await pool.connect();
try{
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`lab-branches:${values.tenant}`]);
  const branches=await client.query(`SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true`,[values.tenant]);
  const central=branches.rows.find(branch=>branch.id===values.central),bhangagarh=branches.rows.filter(branch=>/bhangagarh/i.test(branch.name)),dispur=branches.rows.filter(branch=>/dispur/i.test(branch.name));
  if(!central||bhangagarh.length!==1||dispur.length>1)throw new Error("Expected one active main branch and one Bhangagarh branch; resolve duplicate or missing names first");
  const target=dispur[0]||(await client.query(`INSERT INTO branches(tenant_id,name,code) VALUES($1,'Medicity Guwahati Dispur','DISPUR') RETURNING id,name`,[values.tenant])).rows[0];
  const bg=bhangagarh[0]!;
  const map:LabBranchMap={tenant_id:values.tenant,centers:{C100:central.id,C151:central.id,C147:central.id,C155:bg.id,C159:target.id},primary_centers:{[central.id]:"C100",[bg.id]:"C155",[target.id]:"C159"},price_sources:{[central.id]:"default",[bg.id]:"bgarh",[target.id]:"bgarh"}};
  mkdirSync(dirname(output),{recursive:true,mode:0o700});writeFileSync(output,JSON.stringify(map,null,2),{mode:0o600});
  await client.query("COMMIT");
  console.table([{legacy_center:"C100 / C151 / C147",...central},{legacy_center:"C155",...bg},{legacy_center:"C159",...target}]);console.log(`Branch mapping saved: ${output}`);
}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();await pool.end();}
