import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {staffProvisionInput,provisionRoles,provisionUserMatches} from './staff-provision-input.js';

// Account data and the initial password arrive over stdin, never in source or logs.
const {values}=parseArgs({options:{mode:{type:'string',default:'preview'},env:{type:'string',default:'.env'}}});
if(!['preview','apply'].includes(values.mode!))throw Error('Invalid provisioning mode');
const input=staffProvisionInput.parse(JSON.parse(readFileSync(0,'utf8')));
if(values.mode==='apply'&&!input.password)throw Error('An initial password is required');
process.env.ENV_FILE=values.env;
const {pool}=await import('./db.js');
const client=await pool.connect();
try{
  await client.query('BEGIN');
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('provision-medicity-reception'))`);
  const branches=(await client.query(`SELECT b.id,b.name,b.tenant_id FROM branches b JOIN hospitals h ON h.id=b.tenant_id WHERE h.deleted_at IS NULL AND lower(h.name) LIKE '%medicity%' AND b.is_active AND lower(trim(b.name))=ANY($1::text[])`,[[...new Set(input.accounts.flatMap(row=>row.branches))]])).rows;
  const tenants=[...new Set(branches.map(row=>row.tenant_id))];
  if(tenants.length!==1)throw Error('Expected exactly one Medicity hospital for the requested branches');
  const tenant=tenants[0];
  const roles=(await client.query(`SELECT id,name,upper(code::text) code FROM rbac_roles WHERE tenant_id=$1 AND upper(code::text)=ANY($2::text[]) AND status='Active'`,[tenant,[...new Set(input.accounts.map(item=>provisionRoles[item.role].code))]])).rows;
  const results=[];
  for(const item of input.accounts){
    const assigned=item.branches.map(name=>{const matches=branches.filter(row=>row.name.trim().toLowerCase()===name);if(matches.length!==1)throw Error(`Branch unavailable or ambiguous: ${name}`);return matches[0];});
    const branch=assigned[0],branchIds=assigned.map(row=>row.id),roleInfo=provisionRoles[item.role];
    const roleMatches=roles.filter(row=>row.code===roleInfo.code);
    if(roleMatches.length!==1)throw Error(`Expected one active ${item.role} role`);
    const role=roleMatches[0];
    const users=(await client.query(`SELECT id,tenant_id,role,first_name,last_name FROM users WHERE lower(email::text)=$1 FOR UPDATE`,[item.email])).rows;
    if(users.length>1||users.some(row=>!provisionUserMatches(row,item,tenant)))throw Error(`Login email belongs to a different account: ${item.email}`);
    let userId=users[0]?.id;
    const staff=(await client.query(`SELECT id,user_id FROM staff_members WHERE tenant_id=$1 AND (user_id=$2::uuid OR lower(account->>'login_email')=$3 OR (branch_id=ANY($4::uuid[]) AND staff_type=$6 AND lower(trim(concat_ws(' ',first_name,middle_name,last_name)))=lower($5))) FOR UPDATE`,[tenant,userId||null,item.email,branchIds,item.name,item.role])).rows;
    if(staff.length>1||staff.some(row=>row.user_id&&row.user_id!==userId))throw Error(`Ambiguous staff record: ${item.email}`);
    if(values.mode==='apply'){
      if(userId){
        await client.query(`UPDATE users SET first_name=$1,last_name='',username=$2,email=$2,branch_id=$3,role=$7::user_role,is_active=true,force_password_change=false,password_hash=crypt($4,gen_salt('bf',12)),updated_at=now() WHERE id=$5 AND tenant_id=$6`,[item.name,item.email,branch.id,input.password,userId,tenant,roleInfo.portal]);
      }else{
        userId=(await client.query(`INSERT INTO users(tenant_id,branch_id,email,username,password_hash,first_name,last_name,role,is_active,force_password_change) VALUES($1,$2,$3,$3,crypt($4,gen_salt('bf',12)),$5,'',$6::user_role,true,false) RETURNING id`,[tenant,branch.id,item.email,input.password,item.name,roleInfo.portal])).rows[0].id;
      }
      // Replace memberships with exactly the branches requested by the user.
      await client.query(`DELETE FROM user_branch_access WHERE tenant_id=$1 AND user_id=$2`,[tenant,userId]);
      await client.query(`INSERT INTO user_branch_access(tenant_id,user_id,branch_id) SELECT $1,$2,unnest($3::uuid[])`,[tenant,userId,branchIds]);
      await client.query(`DELETE FROM rbac_user_roles WHERE tenant_id=$1 AND user_id=$2`,[tenant,userId]);
      await client.query(`INSERT INTO rbac_user_roles(tenant_id,user_id,role_id) VALUES($1,$2,$3)`,[tenant,userId,role.id]);
      const account={login_email:item.email,username:item.email,role:role.name,account_status:'Active',force_password_change:false};
      if(staff[0]){
        await client.query(`UPDATE staff_members SET user_id=$1,first_name=$2,middle_name='',last_name='',staff_type=$7,branch_id=$3,designation=$7,status='Active',employment=employment||'{"status":"Active"}'::jsonb,account=(account-'password')||$4::jsonb,updated_at=now() WHERE id=$5 AND tenant_id=$6`,[userId,item.name,branch.id,JSON.stringify(account),staff[0].id,tenant,item.role]);
      }else{
        const employeeId=`STAFF-${createHash('sha256').update(item.email).digest('hex').slice(0,12).toUpperCase()}`;
        await client.query(`INSERT INTO staff_members(tenant_id,user_id,employee_id,first_name,last_name,staff_type,branch_id,designation,status,employment,account) VALUES($1,$2,$3,$4,'',$7,$5,$7,'Active','{"status":"Active"}',$6)`,[tenant,userId,employeeId,item.name,branch.id,account,item.role]);
      }
      const verified=(await client.query(`SELECT u.is_active AND u.role=$8::user_role AND u.branch_id=$3 AND u.password_hash=crypt($4,u.password_hash) AND NOT u.force_password_change
        AND (SELECT count(*)=cardinality($6::uuid[]) AND bool_and(branch_id=ANY($6::uuid[])) FROM user_branch_access WHERE tenant_id=$1 AND user_id=u.id)
        AND (SELECT count(*)=1 AND bool_and(role_id=$5) FROM rbac_user_roles WHERE tenant_id=$1 AND user_id=u.id)
        AND (SELECT count(*)=1 AND bool_and(branch_id=$3 AND status='Active' AND staff_type=$7) FROM staff_members WHERE tenant_id=$1 AND user_id=u.id) verified
        FROM users u WHERE u.tenant_id=$1 AND u.id=$2`,[tenant,userId,branch.id,input.password,role.id,branchIds,item.role,roleInfo.portal])).rows[0]?.verified;
      if(!verified)throw Error(`Account verification failed: ${item.email}`);
    }
    results.push({name:item.name,email:item.email,branches:assigned.map(row=>row.name),role:item.role,...(users[0]&&users[0].role!==roleInfo.portal?{previous_portal:users[0].role}:{}),login:users.length?'updated':'created',staff:staff.length?'updated':'created',verified:values.mode==='apply'});
  }
  await client.query(values.mode==='apply'?'COMMIT':'ROLLBACK');
  console.log('RECEPTION_PROVISION_RESULT',JSON.stringify({mode:values.mode,accounts:results}));
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
