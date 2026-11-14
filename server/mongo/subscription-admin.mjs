import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {calendarMonthsEnd} from './subscription-date.mjs';
import {trialEnd,subscriptionSummary} from './subscription-policy.mjs';
import {currentSubscription} from './subscription-access.mjs';
const router=Router(),uuid=z.string().uuid();
const fail=message=>Object.assign(Error(message),{status:409});
async function event(account,tenant,action,details,session){await db.collection('platform_events').insertOne({id:randomUUID(),tenant_id:tenant,actor_id:account.id,source:'subscriptions',severity:'info',event_type:action,message:action.replaceAll('_',' '),details,created_at:new Date()},{session});}
router.get('/subscriptions',async(_request,response)=>{
  const rows=await db.collection('subscriptions').find({},{projection:{_id:0}}).sort({created_at:-1,_id:-1}).toArray(),seen=new Set(),result=[];
  for(const row of rows){const hospital=await db.collection('hospitals').findOne({id:row.tenant_id,deleted_at:null});if(!hospital)continue;const current=!seen.has(row.tenant_id);seen.add(row.tenant_id);result.push({...subscriptionSummary(row),is_current:current,hospital_name:hospital.name});}
  response.json(result);
});
router.post('/subscriptions',async(request,response)=>{
  const body=z.object({requestId:uuid.optional(),tenantId:uuid,planId:uuid,billingCycle:z.enum(['monthly','yearly','trial']),months:z.coerce.number().int().min(1).max(60).prefault(1),trialDays:z.coerce.number().int().min(1).max(365).prefault(14),amount:z.coerce.number().finite().nonnegative().max(99999999).multipleOf(.01),note:z.string().trim().min(3).max(1000),mode:z.enum(['renew','replace']).prefault('renew')}).parse(request.body);
  const row=await transaction(async session=>{
    await db.collection('workflow_locks').updateOne({_id:`${body.tenantId}:subscription`},{$inc:{version:1}},{session,upsert:true});
    if(body.requestId){const saved=await db.collection('subscriptions').findOne({tenant_id:body.tenantId,request_id:body.requestId},{session});if(saved)return subscriptionSummary(saved);}
    const hospital=await db.collection('hospitals').findOne({id:body.tenantId,deleted_at:null},{session}),plan=await db.collection('subscription_plans').findOne({id:body.planId,status:'active',archived:{$ne:true}},{session});
    if(!hospital||!plan)throw fail('Select an existing clinic and active plan.');
    const previous=await currentSubscription(hospital.id,session),now=new Date(),summary=subscriptionSummary(previous),live=['active','trial','scheduled'].includes(summary.status);
    if(body.mode==='renew'&&live&&previous.plan_id!==plan.id)throw fail('Use Replace now to change the current plan.');
    if(body.mode==='renew'&&live&&previous.billing_cycle!==body.billingCycle)throw fail('Use Replace now to change the billing cycle.');
    // Capacity decreases are rejected, rather than disabling existing users or deleting data.
    for(const [collection,limit,filter] of [['branches',plan.max_branches,{}],['users',plan.max_users,{}],['staff_members',plan.max_doctors,{staff_type:'Doctor'}]]){
      if(await db.collection(collection).countDocuments({tenant_id:hospital.id,deleted_at:null,...filter},{session})>limit)throw fail('This plan is below the clinicÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s existing branch, user or doctor count. Choose a larger plan.');
    }
    if(body.billingCycle==='trial'&&body.amount!==0)throw fail('Trial subscriptions must have a zero contract price.');
    const doctorUsers=await db.collection('users').find({tenant_id:hospital.id,deleted_at:null,role:'doctor'},{session,projection:{id:1}}).toArray(),doctorStaff=await db.collection('staff_members').find({tenant_id:hospital.id,deleted_at:null,staff_type:'Doctor'},{session,projection:{id:1,user_id:1}}).toArray();
    if(new Set([...doctorUsers.map(r=>r.id),...doctorStaff.map(r=>r.user_id??r.id)]).size>plan.max_doctors)throw fail('This plan is below the existing doctor count. Choose a larger plan.');
    const starts_at=body.mode==='renew'&&live?new Date(previous.starts_at):now;
    const base=body.mode==='renew'&&live?new Date(previous.expires_at):now;
    const expires_at=body.billingCycle==='trial'?trialEnd(base.toISOString().slice(0,10),body.trialDays):calendarMonthsEnd(base.toISOString().slice(0,10),body.months*(body.billingCycle==='yearly'?12:1));
    expires_at.setUTCHours(base.getUTCHours(),base.getUTCMinutes(),base.getUTCSeconds(),base.getUTCMilliseconds());
    await db.collection('subscriptions').updateMany({tenant_id:hospital.id,status:{$in:['active','trial']}},{$set:{status:'superseded',updated_at:now}},{session});
    const record={id:randomUUID(),tenant_id:hospital.id,plan_id:plan.id,plan_code:plan.code,status:body.billingCycle==='trial'?'trial':'active',starts_at,expires_at,billing_cycle:body.billingCycle,monthly_amount:body.amount,trial_days:body.billingCycle==='trial'?body.trialDays:0,manual_note:body.note,...(body.requestId?{request_id:body.requestId}:{}),previous_subscription_id:previous?.id??null,created_by:response.locals.account.id,created_at:now};
    await db.collection('subscriptions').insertOne({...record},{session});
    const modules=await db.collection('platform_modules').find({id:{$in:plan.module_ids??[]},is_active:true},{session}).toArray();
    await db.collection('hospitals').updateOne({id:hospital.id},{$set:{status:record.status,modules:modules.map(m=>m.code),updated_at:now}},{session});
    if(body.mode==='replace')await db.collection('sessions').deleteMany({tenant_id:hospital.id},{session});
    await event(response.locals.account,hospital.id,'subscription_manually_assigned',{subscription_id:record.id,mode:body.mode,note:body.note},session);
    return subscriptionSummary(record);
  });response.status(201).json(row);
});
router.post('/subscriptions/:id/cancel',async(request,response)=>{
  const id=uuid.parse(request.params.id),body=z.object({note:z.string().trim().min(3).max(1000)}).parse(request.body);
  await transaction(async session=>{const old=await db.collection('subscriptions').findOne({id},{session});if(!old)throw fail('Subscription not found.');await db.collection('workflow_locks').updateOne({_id:`${old.tenant_id}:subscription`},{$inc:{version:1}},{session,upsert:true});const current=await currentSubscription(old.tenant_id,session);if(current?.id!==id)throw fail('Only the current subscription can be cancelled.');await db.collection('subscriptions').updateOne({id},{$set:{status:'cancelled',cancelled_at:new Date(),cancellation_note:body.note}},{session});await db.collection('hospitals').updateOne({id:old.tenant_id},{$set:{status:'inactive'}},{session});await db.collection('sessions').deleteMany({tenant_id:old.tenant_id},{session});await event(response.locals.account,old.tenant_id,'subscription_cancelled',{note:body.note},session);});response.status(204).end();
});
export default router;
