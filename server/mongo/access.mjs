import { db } from './database.mjs';
import { permissionTemplates } from './permission-templates.mjs';
import { randomUUID } from 'node:crypto';

export async function initializeRoles(tenantId,session) {
  for(const [code,permissions] of Object.entries(permissionTemplates)) {
    await db.collection('rbac_roles').updateOne({tenant_id:tenantId,code},{$setOnInsert:{id:randomUUID(),tenant_id:tenantId,code,name:code==='HOSPITAL_ADMIN'?'Clinic Admin':code.split('_').join(' '),permissions,is_system:true,status:'Active',created_at:new Date()}},{session,upsert:true});
  }
}
export async function permissionsFor(account,session) {
  const roles=await db.collection('rbac_roles').find({tenant_id:account.tenant_id,code:{$in:account.role_codes??[]},status:'Active'},{session}).toArray();
  return [...new Set(roles.flatMap(role=>role.permissions??[]))];
}
export async function hasActiveRole(account,session) {
  if(!account||(account.role_codes??[]).length===0)return false;
  return Boolean(await db.collection('rbac_roles').findOne({tenant_id:account.tenant_id,code:{$in:account.role_codes},status:'Active'},{session,projection:{_id:1}}));
}
export function requirePermission(code) {
  return async (_request,response,next)=>{
    const permissions=await permissionsFor(response.locals.account);
    if(!permissions.includes('*')&&!permissions.includes(code))return response.status(403).json({error:`Permission required: ${code}`});
    next();
  };
}
export async function allowedBranches(account,portal,session) {
  if(portal==='hospital_admin'&&(account.role_codes??[]).includes('HOSPITAL_ADMIN'))return null;
  const assigned=await db.collection('user_branch_access').find({tenant_id:account.tenant_id,user_id:account.id},{session}).toArray();
  return [...new Set([account.branch_id,...assigned.map(row=>row.branch_id)].filter(Boolean))];
}
export async function scopeFor(response,extra={},session) {
  const account=response.locals.account,ids=await allowedBranches(account,response.locals.claims.portal,session);
  return {$and:[{tenant_id:account.tenant_id},...(ids===null?[]:[{branch_id:{$in:ids}}]),extra]};
}
export async function assertBranch(response,branchId,session) {
  const account=response.locals.account,ids=await allowedBranches(account,response.locals.claims.portal,session);
  const branch=await db.collection('branches').findOne({tenant_id:account.tenant_id,id:branchId,is_active:true},{session});
  if(!branch||(ids!==null&&!ids.includes(branchId)))throw Object.assign(new Error('Select an authorized active branch.'),{status:403});
  return branch;
}
export async function writeAudit(response,action,recordId,session,metadata={}) {
  const account=response.locals.account;
  await db.collection('audit_events').insertOne({id:randomUUID(),tenant_id:account.tenant_id,actor_id:account.id,branch_id:account.branch_id,action,record_id:recordId,metadata,created_at:new Date()},{session});
}
