import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {hashPassword,publicRecord} from './security.mjs';
import {hospitalInput} from './provisioning-schema.mjs';
import {subscriptionEnd,calendarMonthsEnd} from './subscription-date.mjs';
const router=Router(),uuid=z.string().uuid();
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
async function audit(response,action,tenant,session){
  await db.collection('platform_events').insertOne({id:randomUUID(),tenant_id:tenant??null,severity:'info',source:'administration',event_type:action,message:action.split('_').join(' '),actor_id:response.locals.account.id,created_at:new Date()},{session});
}
router.get('/dashboard',async(_request,response)=>{
  const hospitals=await db.collection('hospitals').find({deleted_at:null},{projection:{status:1}}).toArray();
  const subscriptions=await db.collection('subscriptions').find({}).toArray(),now=Date.now();
  const counts={total:hospitals.length,active:0,trial:0,suspended:0};for(const row of hospitals)if(row.status in counts)counts[row.status]++;
  const growth=await db.collection('hospitals').aggregate([{$match:{deleted_at:null,created_at:{$gte:new Date(now-183*86400000)}}},{$group:{_id:{$dateToString:{date:'$created_at',format:'%Y-%m',timezone:'Asia/Kolkata'}},total:{$sum:1}}},{$sort:{_id:1}},{$project:{_id:0,month:'$_id',total:1}}]).toArray();
  const plans=await db.collection('subscriptions').aggregate([{$group:{_id:'$plan_code',value:{$sum:1}}},{$project:{_id:0,name:'$_id',value:1}}]).toArray();
  response.json({hospitals:counts,subscriptions:{active:subscriptions.filter(row=>row.status==='active').length,expiring:subscriptions.filter(row=>new Date(row.expires_at).getTime()>=now&&new Date(row.expires_at).getTime()<=now+30*86400000).length,monthly_revenue:subscriptions.filter(row=>row.status==='active').reduce((sum,row)=>sum+Number(row.monthly_amount??0),0)},
    users:{total:await db.collection('users').countDocuments({})},modules:{active:await db.collection('platform_modules').countDocuments({is_active:true})},growth,planDistribution:plans,activity:await db.collection('platform_events').find({},{projection:{_id:0}}).sort({created_at:-1}).limit(8).toArray(),generatedAt:new Date().toISOString()});
});
router.get('/subscriptions',async(_request,response)=>{
  const rows=await db.collection('subscriptions').find({},{projection:{_id:0}}).sort({expires_at:1}).toArray();
  for(const row of rows)row.hospital_name=(await db.collection('hospitals').findOne({id:row.tenant_id}))?.name??'';
  response.json(rows);
});
router.post('/subscriptions',async(request,response)=>{
  const body=z.object({tenantId:uuid,planCode:z.string().min(2).max(40),monthlyAmount:z.coerce.number().finite().nonnegative().max(99999999.99).multipleOf(0.01),months:z.coerce.number().int().min(1).max(60)}).parse(request.body);
  const row=await transaction(async session=>{
    const hospital=await db.collection('hospitals').findOne({id:body.tenantId,deleted_at:null},{session}),plan=await db.collection('subscription_plans').findOne({code:body.planCode.toLowerCase(),status:'active'},{session});
    if(!hospital||!plan)throw failure('Select an existing clinic and active plan.');
    const starts_at=new Date(),expires_at=calendarMonthsEnd(starts_at.toISOString().slice(0,10),body.months);
    expires_at.setUTCHours(starts_at.getUTCHours(),starts_at.getUTCMinutes(),starts_at.getUTCSeconds(),starts_at.getUTCMilliseconds());
    const record={id:randomUUID(),tenant_id:hospital.id,plan_id:plan.id,plan_code:plan.code,status:'active',starts_at,expires_at,monthly_amount:body.monthlyAmount,billing_cycle:'monthly',created_at:starts_at};
    await db.collection('subscriptions').insertOne({...record},{session});
    const modules=await db.collection('platform_modules').find({id:{$in:plan.module_ids??[]},is_active:true},{session}).toArray();
    await db.collection('hospitals').updateOne({id:hospital.id},{$set:{status:'active',modules:modules.map(row=>row.code),updated_at:new Date()}},{session});
    await audit(response,'subscription_created',hospital.id,session);return record;
  });response.status(201).json(row);
});
router.put('/hospitals/:id',async(request,response)=>{
  const body=hospitalInput.parse(request.body),tenant=uuid.parse(request.params.id);
  if(body.password)z.string().min(12).max(200).parse(body.password);
  const password_hash=body.password?await hashPassword(body.password):null;
  const result=await transaction(async session=>{
    const hospital=await db.collection('hospitals').findOne({id:tenant,deleted_at:null},{session}),plan=await db.collection('subscription_plans').findOne({id:body.planId},{session});
    if(!hospital)throw failure('Hospital not found',404);if(!plan)throw failure('Subscription plan not found.');
    const now=new Date(),profile={name:body.name,code:body.code.toUpperCase(),status:body.status,logo_url:body.logoUrl??null,hospital_type:body.hospitalType,registration_number:body.registrationNumber,email:body.email.toLowerCase(),phone:body.phone,emergency_phone:body.emergencyPhone,address_line:body.address,city:body.city,state:body.state,pin_code:body.pinCode,country:body.country,gstin:body.gstin,updated_at:now};
    await db.collection('hospitals').updateOne({id:tenant},{$set:profile},{session});
    const branch=await db.collection('branches').findOne({tenant_id:tenant,code:'MAIN'},{session});
    if(branch)await db.collection('branches').updateOne({tenant_id:tenant,id:branch.id},{$set:{name:body.branchName,phone:body.phone,address:{line:body.address,city:body.city,state:body.state,pinCode:body.pinCode,country:body.country},updated_at:now}},{session});
    const administrator=await db.collection('users').findOne({tenant_id:tenant,role_codes:'HOSPITAL_ADMIN'},{session});
    if(administrator){
      const names=body.adminName.trim().split(/\s+/);
      await db.collection('users').updateOne({tenant_id:tenant,id:administrator.id},{$set:{first_name:names.shift(),last_name:names.join(' '),email:body.adminEmail.toLowerCase(),phone:body.adminPhone,...(password_hash?{password_hash,force_password_change:true}:{}),updated_at:now},$inc:{session_version:1}},{session});
      await db.collection('sessions').deleteMany({user_id:administrator.id},{session});
    }
    const subscription=await db.collection('subscriptions').findOne({tenant_id:tenant},{session,sort:{created_at:-1}});
    if(subscription)await db.collection('subscriptions').updateOne({id:subscription.id,tenant_id:tenant},{$set:{plan_id:plan.id,plan_code:plan.code,starts_at:new Date(body.subscriptionStartDate+'T00:00:00Z'),expires_at:subscriptionEnd(body.subscriptionStartDate,body.billingCycle),monthly_amount:body.billingCycle==='monthly'?plan.monthly_price:plan.yearly_price,billing_cycle:body.billingCycle,trial_days:body.trialDays,updated_at:now}},{session});
    if(!['active','trial'].includes(body.status))await db.collection('sessions').deleteMany({tenant_id:tenant},{session});
    await audit(response,'hospital_updated',tenant,session);return {id:tenant};
  });response.json(result);
});
router.delete('/hospitals/:id',async(request,response)=>{
  const id=uuid.parse(request.params.id);
  await transaction(async session=>{
    const result=await db.collection('hospitals').updateOne({id,deleted_at:null},{$set:{deleted_at:new Date(),status:'inactive'}},{session});
    if(!result.matchedCount)throw failure('Hospital not found',404);
    await db.collection('sessions').deleteMany({tenant_id:id},{session});await audit(response,'hospital_archived',id,session);
  });response.status(204).end();
});
router.post('/modules',async(request,response)=>{
  const body=z.object({code:z.string().regex(/^[A-Za-z0-9_-]{2,40}$/),name:z.string().min(2).max(100),description:z.string().max(500).default('')}).parse(request.body);
  const row={...body,code:body.code.toLowerCase(),id:randomUUID(),is_active:true,created_at:new Date()};await db.collection('platform_modules').insertOne({...row});response.status(201).json(row);
});
router.patch('/modules/:id',async(request,response)=>{
  const id=uuid.parse(request.params.id),body=z.object({isActive:z.boolean().optional(),name:z.string().min(2).max(100).optional(),description:z.string().max(500).optional(),code:z.string().regex(/^[A-Za-z0-9_-]{2,40}$/).optional()}).parse(request.body);
  if(!Object.keys(body).length)throw failure('At least one field is required.');
  const row=await transaction(async session=>{
    const previous=await db.collection('platform_modules').findOne({id},{session});if(!previous)throw failure('Module not found',404);
    const changes={...(body.name?{name:body.name}:{}),...(body.description!==undefined?{description:body.description}:{}),...(body.isActive!==undefined?{is_active:body.isActive}:{}),...(body.code?{code:body.code.toLowerCase()}:{}),updated_at:new Date()};
    if(changes.code&&changes.code!==previous.code)await db.collection('hospitals').updateMany({modules:previous.code},[{$set:{modules:{$map:{input:'$modules',as:'code',in:{$cond:[{$eq:['$$code',previous.code]},changes.code,'$$code']}}}}}],{session});
    const saved=await db.collection('platform_modules').findOneAndUpdate({id},{$set:changes},{session,returnDocument:'after',projection:{_id:0}});await audit(response,'module_updated',null,session);return saved;
  });response.json(row);
});
router.put('/hospitals/:id/modules',async(request,response)=>{
  const id=uuid.parse(request.params.id),body=z.object({moduleId:uuid,enabled:z.boolean()}).parse(request.body);
  await transaction(async session=>{
    const module=await db.collection('platform_modules').findOne({id:body.moduleId},{session});if(!module)throw failure('Module not found',404);
    const result=await db.collection('hospitals').updateOne({id,deleted_at:null},body.enabled?{$addToSet:{modules:module.code}}:{$pull:{modules:module.code}},{session});
    if(!result.matchedCount)throw failure('Hospital not found',404);await audit(response,'hospital_modules_updated',id,session);
  });response.status(204).end();
});
router.get('/settings',async(_request,response)=>response.json(await db.collection('platform_settings').find({},{projection:{_id:0}}).sort({category:1,key:1}).toArray()));
router.put('/settings/:key',async(request,response)=>{
  const key=z.enum(['platform_name','platform_logo','support_email','trial_days','maintenance_mode','session_timeout_minutes']).parse(request.params.key),body=z.object({value:z.unknown()}).parse(request.body);
  const schemas={platform_name:z.string().trim().min(2).max(160),platform_logo:z.string().max(900000),support_email:z.string().email(),trial_days:z.coerce.number().int().min(0).max(365),maintenance_mode:z.boolean(),session_timeout_minutes:z.coerce.number().int().min(5).max(1440)};
  const value=schemas[key].parse(body.value),is_public=['platform_name','platform_logo','maintenance_mode'].includes(key);
  const row=await db.collection('platform_settings').findOneAndUpdate({key},{$set:{value,is_public,category:key.startsWith('platform_')?'branding':'general',updated_by:response.locals.account.id,updated_at:new Date()}},{upsert:true,returnDocument:'after',projection:{_id:0}});response.json(row);
});
router.get('/monitoring',async(_request,response)=>{
  const stats=await db.command({dbStats:1});
  response.json({health:{database:db.databaseName,database_bytes:stats.storageSize,connections:null,uptime_seconds:Math.floor(process.uptime())},events:await db.collection('platform_events').find({},{projection:{_id:0}}).sort({created_at:-1}).limit(50).toArray()});
});
router.get('/reports',async(_request,response)=>{
  const registrations=await db.collection('hospitals').aggregate([{$group:{_id:{$dateToString:{date:'$created_at',format:'%Y-%m',timezone:'Asia/Kolkata'}},hospitals:{$sum:1}}},{$sort:{_id:1}},{$project:{_id:0,period:'$_id',hospitals:1}}]).toArray();
  const revenue=await db.collection('subscriptions').aggregate([{$group:{_id:{$dateToString:{date:'$starts_at',format:'%Y-%m',timezone:'Asia/Kolkata'}},revenue:{$sum:'$monthly_amount'}}},{$sort:{_id:1}},{$project:{_id:0,period:'$_id',revenue:1}}]).toArray();
  const statuses=await db.collection('hospitals').aggregate([{$match:{deleted_at:null}},{$group:{_id:'$status',total:{$sum:1}}},{$project:{_id:0,status:'$_id',total:1}}]).toArray();
  const expiring=await db.collection('subscriptions').find({expires_at:{$gte:new Date(),$lte:new Date(Date.now()+60*86400000)}},{projection:{_id:0}}).toArray();
  for(const row of expiring){row.hospital=(await db.collection('hospitals').findOne({id:row.tenant_id}))?.name??'';row.days_remaining=Math.floor((new Date(row.expires_at).getTime()-Date.now())/86400000);}
  response.json({registrations,revenue,statuses,expiring});
});
export default router;
