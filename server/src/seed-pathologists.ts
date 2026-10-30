import {parseArgs} from "node:util";
import {z} from "zod";

const {values}=parseArgs({options:{tenant:{type:"string"},branch:{type:"string"},env:{type:"string"},apply:{type:"boolean",default:false}}});
const tenant=z.string().uuid().parse(values.tenant),branch=z.string().uuid().parse(values.branch);
const profiles=[
  {first_name:"Dr. Ripunjoy",last_name:"Deka",employee_id:"PATH-RIPUNJOY-DEKA"},
  {first_name:"Dr. B.",last_name:"Dutta",employee_id:"PATH-B-DUTTA"},
  {first_name:"Dr. Sanjoy Krishna",last_name:"Handique",employee_id:"PATH-SANJOY-KRISHNA-HANDIQUE"},
];
if(!values.apply){console.table(profiles);console.log("Preview only. Use --apply --env /path/to/.env to add profiles. Registration, signatures and login details remain blank.");}
else{
  if(values.env)process.env.ENV_FILE=values.env;
  const {pool}=await import("./db.js");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const found=await client.query("SELECT b.name FROM branches b JOIN hospitals h ON h.id=b.tenant_id WHERE b.id=$1 AND b.tenant_id=$2 AND h.deleted_at IS NULL",[branch,tenant]);
    if(!found.rowCount)throw new Error("Branch must belong to the selected hospital");
    // Serialize repeated runs and preserve any existing profile, account or signature.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${tenant}:pathologist-profiles`]);
    for(const profile of profiles){
      const existing=await client.query("SELECT id FROM staff_members WHERE tenant_id=$1 AND (employee_id=$2 OR regexp_replace(regexp_replace(lower(concat_ws(' ',first_name,middle_name,last_name)),'[^a-z]','','g'),'^dr','')=$3) LIMIT 1",[tenant,profile.employee_id,`${profile.first_name} ${profile.last_name}`.replace(/^Dr\. /,"").toLowerCase().replace(/[^a-z]/g,"")]);
      if(existing.rowCount){console.log(`Already present: ${profile.first_name} ${profile.last_name}`);continue;}
      await client.query(`INSERT INTO staff_members(tenant_id,branch_id,employee_id,first_name,last_name,staff_type,designation,status,personal,employment,account,professional)
        VALUES($1,$2,$3,$4,$5,'Pathologist','Consultant Pathologist','Inactive','{}',$6,$7,$8)`,[tenant,branch,profile.employee_id,profile.first_name,profile.last_name,{status:"Inactive"},{role:"Pathologist",account_status:"Inactive"},{doctor_qualification:"MD",specialization:"Pathology",medical_registration_number:"",digital_signature:""}]);
      console.log(`Added: ${profile.first_name} ${profile.last_name}`);
    }
    await client.query("COMMIT");
    console.log(`Profiles saved in ${found.rows[0].name}. Complete registration and account details in Staff Management → Pathologist, then activate. Upload signatures when available.`);
  }catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();await pool.end();}
}
