import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db,transaction } from './database.mjs';
import { permissionsFor,requirePermission,scopeFor,writeAudit } from './access.mjs';
import { hashPassword } from './security.mjs';
import { baseRoles,customBaseRoles,permissionCatalog,rolePortalCode,validateRoleGrant } from './role-policy.mjs';
const router=Router(),id=z.string().uuid();
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
async function lockActor(response,permission,session) {
  const account=response.locals.account;
  const actor=await db.collection('users').findOneAndUpdate({tenant_id:account.tenant_id,id:account.id,is_active:true,session_version:account.session_version??0},{$inc:{access_control_version:1}},{session,returnDocument:'after'});
  if(!actor)throw failure('Account changed. Sign in again.',401);
  const granted=await permissionsFor(actor,session);
  if(!granted.includes('*')&&!granted.includes(permission))throw failure(`Permission required: ${permission}`,403);
  return granted;
}
router.get('/me',async(_request,response)=>{
  if(response.locals.account.role==='broker')return response.json({permissions:['menu.dashboard.view','menu.reports.view','menu.billing.view'],roles:[],managed_roles:[]});
  const account=response.locals.account,permissions=await permissionsFor(account);
  const roles=await db.collection('rbac_roles').find({tenant_id:account.tenant_id,code:{$in:account.role_codes??[]},status:'Active'},{projection:{_id:0}}).toArray();
  const managed_roles=permissions.some(code=>['*','roles.manage','staff.view'].includes(code))?await db.collection('rbac_roles').find({tenant_id:account.tenant_id,is_system:false},{projection:{_id:0,id:1,name:1,code:1,is_system:1}}).sort({name:1}).toArray():[];
  response.json({permissions:permissions.includes('*')?permissionCatalog.map(row=>row.code):permissions,roles,managed_roles});
});
router.get('/permissions',requirePermission('roles.manage'),(_request,response)=>response.json(permissionCatalog));
router.get('/roles',requirePermission('roles.manage'),async(_request,response)=>{
  const rows=await db.collection('rbac_roles').find({tenant_id:response.locals.account.tenant_id},{projection:{_id:0}}).sort({role_level:-1,name:1}).toArray();
  response.json(rows.map(row=>({...row,description:row.description??'',role_level:row.role_level??(row.code==='HOSPITAL_ADMIN'?100:50),permissions:row.permissions?.includes('*')?permissionCatalog.map(item=>item.code):row.permissions??[]})));
});
const roleInput=z.object({id:id.optional(),name:z.string().trim().min(2).max(120),code:z.string().trim().min(2).max(80).transform(value=>value.toUpperCase().replace(/\s+/g,'_')).pipe(z.string().regex(/^[A-Z][A-Z0-9_]+$/)),description:z.string().max(2000).default(''),role_level:z.coerce.number().int().min(1).max(99).default(50),status:z.enum(['Active','Inactive']).default('Active'),base_role:z.enum(customBaseRoles).default('RECEPTIONIST'),permissions:z.array(z.string()).max(200).transform(values=>[...new Set(values)])});
router.post('/roles',requirePermission('roles.manage'),async(request,response)=>{
  const input=roleInput.parse(request.body),tenant_id=response.locals.account.tenant_id,roleId=input.id??randomUUID();
  await transaction(async session=>{
    const granted=await lockActor(response,'roles.manage',session);
    validateRoleGrant(granted,input.permissions);
    const previous=input.id?await db.collection('rbac_roles').findOne({tenant_id,id:input.id},{session}):null;
    if(input.id&&!previous)throw failure('Role not found in this clinic.',404);
    if(previous?.is_system||baseRoles[input.code])throw failure('System roles are protected. Create a custom role to change its permissions.',409);
    if(previous&&!granted.includes('*')&&(previous.permissions??[]).some(code=>!granted.includes(code)))throw failure('You cannot change a role with permissions beyond your own.',403);
    const assigned=previous?await db.collection('users').find({tenant_id,role_codes:previous.code},{session,projection:{id:1}}).toArray():[];
    for(const user of assigned)if(!await db.collection('users').findOne(await scopeFor(response,{id:user.id},session),{session}))throw failure('This role is assigned outside your authorized branches.',403);
    const now=new Date(),row={...input,id:roleId,tenant_id,is_system:false,updated_at:now,created_at:previous?.created_at??now};
    if(previous)await db.collection('rbac_roles').replaceOne({tenant_id,id:roleId},row,{session});
    else await db.collection('rbac_roles').insertOne({...row},{session});
    if(previous){
      const affected=assigned.map(user=>user.id);
      // Native accounts have one selected role; changing its code retains assignments.
      await db.collection('users').updateMany({tenant_id,id:{$in:affected}},{$set:{role_codes:[input.code],portal_code:input.base_role,role:baseRoles[input.base_role],updated_at:now},$inc:{session_version:1}},{session});
      await db.collection('sessions').deleteMany({user_id:{$in:affected}},{session});
    }
    await writeAudit(response,previous?'role_updated':'role_created',roleId,session,{code:input.code});
  });
  response.status(input.id?200:201).json({id:roleId});
});
router.get('/users',requirePermission('users.manage'),async(_request,response)=>{
  const rows=await db.collection('users').find(await scopeFor(response),{projection:{_id:0,id:1,tenant_id:1,first_name:1,last_name:1,username:1,email:1,phone:1,is_active:1,last_login_at:1,created_at:1,account_expires_at:1,role_codes:1,branch_id:1,department_id:1}}).sort({created_at:-1}).toArray();
  const tenant_id=response.locals.account.tenant_id;
  for(const row of rows){
    const [staff,branch,department,role]=await Promise.all([
      db.collection('staff_members').findOne({tenant_id,user_id:row.id}),db.collection('branches').findOne({tenant_id,id:row.branch_id}),
      row.department_id?db.collection('departments').findOne({tenant_id,id:row.department_id}):null,
      db.collection('rbac_roles').findOne({tenant_id,code:{$in:row.role_codes??[]}}),
    ]);
    Object.assign(row,{staff:`${row.first_name??''} ${row.last_name??''}`.trim(),employee_id:staff?.employee_id??'',branch_name:branch?.name??'',department_name:department?.name??'',role_id:role?.id??null,role_name:role?.name??''});
  }
  response.json(rows);
});
router.put('/users/:id',requirePermission('users.manage'),async(request,response)=>{
  const userId=id.parse(request.params.id),input=z.object({role_id:id.optional(),is_active:z.boolean().optional(),reset_password:z.string().min(12).max(200).optional()}).strict().refine(value=>Object.keys(value).length>0).parse(request.body);
  const password_hash=input.reset_password?await hashPassword(input.reset_password):null,tenant_id=response.locals.account.tenant_id;
  await transaction(async session=>{
    const granted=await lockActor(response,'users.manage',session),filter=await scopeFor(response,{id:userId},session);
    const user=await db.collection('users').findOne(filter,{session});
    if(!user)throw failure('Account not found in your authorized branches.',404);
    if(userId===response.locals.account.id)throw failure('Use your password settings to change your own account. Ask another administrator to change your role or status.',409);
    if((user.role_codes??[]).includes('HOSPITAL_ADMIN'))throw failure('The primary clinic administrator is protected.',409);
    const currentRoles=await db.collection('rbac_roles').find({tenant_id,code:{$in:user.role_codes??[]}},{session}).toArray();
    if(!granted.includes('*')&&currentRoles.flatMap(role=>role.permissions??[]).some(code=>!granted.includes(code)))throw failure('You cannot administer an account with permissions beyond your own.',403);
    const changes={updated_at:new Date(),...(input.is_active!==undefined?{is_active:input.is_active}:{}),...(password_hash?{password_hash,force_password_change:true}:{})};
    if(input.role_id){
      const role=await db.collection('rbac_roles').findOne({tenant_id,id:input.role_id,status:'Active'},{session});
      const portal=role&&rolePortalCode(role);
      if(!portal||portal==='HOSPITAL_ADMIN')throw failure('Select an active staff role in this clinic.');
      validateRoleGrant(granted,role.permissions??[]);
      Object.assign(changes,{role_codes:[role.code],portal_code:portal,role:baseRoles[portal]});
    }
    await db.collection('users').updateOne(filter,{$set:changes,$inc:{session_version:1}},{session});
    await db.collection('sessions').deleteMany({user_id:userId},{session});
    const staffChanges={updated_at:new Date(),...(input.is_active!==undefined?{status:input.is_active?'Active':'Inactive','employment.status':input.is_active?'Active':'Inactive','account.account_status':input.is_active?'Active':'Inactive'}:{})};
    if(input.role_id)staffChanges['account.role']=changes.role_codes[0];
    await db.collection('staff_members').updateMany({tenant_id,user_id:userId},{$set:staffChanges},{session});
    await writeAudit(response,'account_access_updated',userId,session,{role_changed:Boolean(input.role_id),password_reset:Boolean(password_hash),...(input.is_active!==undefined?{is_active:input.is_active}:{})});
  });
  response.status(204).end();
});
export default router;
