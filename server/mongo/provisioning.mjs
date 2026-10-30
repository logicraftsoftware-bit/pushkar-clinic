import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, transaction } from './database.mjs';
import { hashPassword, publicRecord } from './security.mjs';
import { planInput, hospitalInput } from './provisioning-schema.mjs';
import { subscriptionEnd } from './subscription-date.mjs';
import { initializeRoles } from './access.mjs';
import {escapeSearch} from './search.mjs';

const router = Router();
const planFields = {
  name:'name',code:'code',description:'description',monthlyPrice:'monthly_price',yearlyPrice:'yearly_price',
  trialDays:'trial_days',maxBranches:'max_branches',maxUsers:'max_users',maxDoctors:'max_doctors',
  storageLimitGb:'storage_limit_gb',aiUsageLimit:'ai_usage_limit',status:'status',moduleIds:'module_ids',
};
async function planDocument(input, session) {
  const modules = await db.collection('platform_modules').find({ id: { $in: input.moduleIds }, is_active: true }, { session }).toArray();
  if (modules.length !== new Set(input.moduleIds).size) throw Object.assign(new Error('Select active modules.'), { status: 400 });
  return Object.fromEntries(Object.entries(planFields).map(([from,to]) => [to, from === 'code' ? input[from].toLowerCase() : input[from]]));
}
router.get('/modules', async (_request,response) => {
  const rows=await db.collection('platform_modules').find({}, { projection: { _id:0 } }).sort({ name:1 }).toArray();
  for(const row of rows)row.enabled_hospitals=await db.collection('hospitals').countDocuments({deleted_at:null,modules:row.code});
  response.json(rows);
});
router.get('/plans', async (_request,response) => {
  const plans = await db.collection('subscription_plans').find({}, { projection:{_id:0} }).sort({created_at:-1}).toArray();
  for (const plan of plans) {
    plan.modules = await db.collection('platform_modules').find({id:{$in:plan.module_ids ?? []}}, {projection:{_id:0}}).toArray();
    plan.hospital_count = await db.collection('subscriptions').countDocuments({plan_id:plan.id,status:{$in:['active','trial']}});
  }
  response.json(plans);
});
router.get('/plans/:id', async (request,response) => {
  const row=await db.collection('subscription_plans').findOne({id:z.string().uuid().parse(request.params.id)});
  if(!row)return response.status(404).json({error:'Plan not found'});
  response.json(publicRecord(row));
});
router.post('/plans', async (request,response) => {
  const input=planInput.parse(request.body),id=randomUUID(),now=new Date();
  const row=await transaction(async session=>{
    const record={...await planDocument(input,session),id,created_at:now,updated_at:now};
    await db.collection('subscription_plans').insertOne({...record},{session});
    return record;
  });
  response.status(201).json(row);
});
router.put('/plans/:id', async (request,response) => {
  const input=planInput.parse(request.body),id=z.string().uuid().parse(request.params.id);
  const row=await transaction(async session=>db.collection('subscription_plans').findOneAndUpdate({id},{$set:{...await planDocument(input,session),updated_at:new Date()}},{session,returnDocument:'after',projection:{_id:0}}));
  if(!row)return response.status(404).json({error:'Plan not found'});
  response.json(row);
});
router.get('/hospitals', async (request,response) => {
  const search=z.string().max(150).default('').parse(request.query.search);
  const filter={deleted_at:null};
  if(search){const pattern=escapeSearch(search);filter.$or=[{name:{$regex:pattern,$options:'i'}},{code:{$regex:pattern,$options:'i'}}];}
  if(request.query.status)filter.status=z.enum(['active','trial','suspended','inactive']).parse(request.query.status);
  const page=z.coerce.number().int().min(1).max(100000).default(1).parse(request.query.page),limit=z.coerce.number().int().min(1).max(100).default(10).parse(request.query.limit);
  const rows=await db.collection('hospitals').find(filter,{projection:{_id:0}}).sort({created_at:-1}).skip((page-1)*limit).limit(limit).toArray();
  for(const row of rows){
    row.branch_count=await db.collection('branches').countDocuments({tenant_id:row.id});
    row.user_count=await db.collection('users').countDocuments({tenant_id:row.id});
    row.branches=row.branch_count;row.users=row.user_count;
    const subscription=await db.collection('subscriptions').findOne({tenant_id:row.id},{sort:{created_at:-1}});
    row.plan_code=subscription?.plan_code??null;row.subscription_status=subscription?.status??null;row.expires_at=subscription?.expires_at??null;
  }
  response.json({data:rows,page,limit,total:await db.collection('hospitals').countDocuments(filter)});
});
router.get('/hospitals/:id', async (request,response) => {
  const id=z.string().uuid().parse(request.params.id);
  const row=await db.collection('hospitals').findOne({id,deleted_at:null},{projection:{_id:0}});
  if(!row)return response.status(404).json({error:'Hospital not found'});
  const branches=await db.collection('branches').find({tenant_id:id},{projection:{_id:0}}).sort({created_at:1}).toArray();
  const subscription=await db.collection('subscriptions').findOne({tenant_id:id},{sort:{created_at:-1}}),administrator=await db.collection('users').findOne({tenant_id:id,role_codes:'HOSPITAL_ADMIN'});
  response.json({...row,branches,branch_id:branches[0]?.id??null,branch_name:branches[0]?.name??'',subscription_id:subscription?.id??null,plan_id:subscription?.plan_id??null,subscription_start_date:subscription?.starts_at??null,billing_cycle:subscription?.billing_cycle??'monthly',trial_days:subscription?.trial_days??0,subscription_status:subscription?.status??null,admin_id:administrator?.id??null,admin_name:administrator?`${administrator.first_name} ${administrator.last_name}`:'',admin_email:administrator?.email??'',admin_phone:administrator?.phone??''});
});
router.post('/hospitals', async (request,response) => {
  const body=hospitalInput.extend({password:z.string().min(12).max(200)}).parse(request.body);
  const password_hash=await hashPassword(body.password);
  const id=randomUUID(),branchId=randomUUID(),userId=randomUUID(),now=new Date();
  const hospital=await transaction(async session=>{
    const plan=await db.collection('subscription_plans').findOne({id:body.planId,status:'active'},{session});
    if(!plan)throw Object.assign(new Error('Select an active subscription plan.'),{status:400});
    const moduleRows=await db.collection('platform_modules').find({id:{$in:plan.module_ids??[]},is_active:true},{session}).toArray();
    const record={id,name:body.name,code:body.code.toUpperCase(),status:body.status,logo_url:body.logoUrl??null,
      hospital_type:body.hospitalType,registration_number:body.registrationNumber,email:body.email.toLowerCase(),phone:body.phone,
      emergency_phone:body.emergencyPhone,address_line:body.address,city:body.city,state:body.state,pin_code:body.pinCode,
      country:body.country,gstin:body.gstin,modules:moduleRows.map(row=>row.code),created_at:now,updated_at:now,deleted_at:null};
    await db.collection('hospitals').insertOne({...record},{session});
    await initializeRoles(id,session);
    await db.collection('branches').insertOne({id:branchId,tenant_id:id,name:body.branchName,code:'MAIN',phone:body.phone,
      address:{line:body.address,city:body.city,state:body.state,pinCode:body.pinCode,country:body.country},is_active:true,created_at:now,updated_at:now},{session});
    const names=body.adminName.trim().split(/\s+/);
    await db.collection('users').insertOne({id:userId,tenant_id:id,branch_id:branchId,email:body.adminEmail.toLowerCase(),phone:body.adminPhone,
      password_hash,first_name:names.shift(),last_name:names.join(' '),role:'hospital_admin',role_codes:['HOSPITAL_ADMIN'],
      is_active:true,session_version:0,force_password_change:true,created_at:now,updated_at:now},{session});
    const starts=new Date(`${body.subscriptionStartDate}T00:00:00Z`),expires=subscriptionEnd(body.subscriptionStartDate,body.billingCycle);
    await db.collection('subscriptions').insertOne({id:randomUUID(),tenant_id:id,plan_id:plan.id,plan_code:plan.code,
      status:body.status==='trial'?'trial':'active',starts_at:starts,expires_at:expires,monthly_amount:body.billingCycle==='monthly'?plan.monthly_price:plan.yearly_price,
      billing_cycle:body.billingCycle,trial_days:body.trialDays,created_at:now},{session});
    await db.collection('audit_events').insertOne({id:randomUUID(),tenant_id:id,actor_id:response.locals.account.id,action:'hospital_created',created_at:now},{session});
    return record;
  });
  response.status(201).json(hospital);
});
router.patch('/hospitals/:id/status', async (request,response) => {
  const id=z.string().uuid().parse(request.params.id),body=z.object({status:z.enum(['active','trial','suspended','inactive'])}).parse(request.body);
  const row=await transaction(async session=>{
    const updated=await db.collection('hospitals').findOneAndUpdate({id,deleted_at:null},{$set:{status:body.status,updated_at:new Date()}},{session,returnDocument:'after',projection:{_id:0}});
    if(!updated)throw Object.assign(new Error('Hospital not found'),{status:404});
    if(!['active','trial'].includes(body.status))await db.collection('sessions').deleteMany({tenant_id:id},{session});
    await db.collection('audit_events').insertOne({id:randomUUID(),tenant_id:id,actor_id:response.locals.account.id,action:'hospital_status_changed',status:body.status,created_at:new Date()},{session});
    return updated;
  });
  response.json(row);
});
export default router;
