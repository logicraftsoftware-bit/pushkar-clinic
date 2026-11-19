import {db} from './database.mjs';
import {subscriptionSummary} from './subscription-policy.mjs';
export async function currentSubscription(tenant,session) {
  // Most recent assignment is authoritative; older renewals must never restore access.
  return db.collection('subscriptions').findOne({tenant_id:tenant},{session,sort:{created_at:-1,_id:-1}});
}
export async function currentSubscriptions(){
  const clinics=await db.collection('hospitals').find({deleted_at:null},{projection:{id:1}}).toArray(),rows=[];
  for(const clinic of clinics){const row=await currentSubscription(clinic.id);if(row)rows.push(subscriptionSummary(row));}
  return rows;
}
export async function subscriptionAccess(tenant,{session,revoke=true}={}) {
  const summary=subscriptionSummary(await currentSubscription(tenant,session));
  if (!['active','trial'].includes(summary.status)) {
    if(revoke)await db.collection('sessions').deleteMany({tenant_id:tenant},{session});
    throw Object.assign(Error(summary.status==='scheduled'?'Your clinic subscription has not started. Contact your administrator.':'Your clinic subscription has expired or is inactive. Contact your administrator to renew.'),{status:401,code:'SUBSCRIPTION_INACTIVE'});
  }
  return summary;
}
export async function subscriptionPlan(tenant,session) {
  const row=await subscriptionAccess(tenant,{session,revoke:!session});
  const plan=await db.collection('subscription_plans').findOne({id:row.plan_id},{session});
  if(!plan)throw Object.assign(Error('Subscription plan is unavailable. Contact the platform administrator.'),{status:403});
  return plan;
}
export async function enforceCount(tenant,kind,session,exclude) {
  const plan=await subscriptionPlan(tenant,session);
  // Serialize capacity-changing writes across processes to prevent concurrent bypasses.
  await db.collection('workflow_locks').updateOne({_id:`${tenant}:subscription-capacity`},{$inc:{version:1}},{session,upsert:true});
  const definitions={branches:['branches','max_branches',{}],users:['users','max_users',{}],doctors:['staff_members','max_doctors',{staff_type:'Doctor'}]};
  const [collection,field,filter]=definitions[kind];
  let count=await db.collection(collection).countDocuments({tenant_id:tenant,deleted_at:null,...filter,...(exclude?{id:{$ne:exclude}}:{})},{session});
  if(kind==='doctors'){
    const staff=await db.collection('staff_members').find({tenant_id:tenant,deleted_at:null,staff_type:'Doctor'},{session,projection:{id:1,user_id:1}}).toArray();
    const users=await db.collection('users').find({tenant_id:tenant,deleted_at:null,role:'doctor'},{session,projection:{id:1}}).toArray();
    count=new Set([...staff.map(row=>row.user_id??row.id),...users.map(row=>row.id)].filter(id=>id!==exclude)).size;
  }
  if(count>=plan[field])throw Object.assign(Error(`Your plan allows ${plan[field]} ${kind}. Upgrade the subscription before adding more.`),{status:403,code:'PLAN_LIMIT_REACHED'});
}
export async function entitledModules(tenant,session) {
  const plan=await subscriptionPlan(tenant,session);
  const hospital=await db.collection('hospitals').findOne({id:tenant,deleted_at:null},{session});
  if(!hospital)return [];
  // The current plan is authoritative; modules is only a legacy provisioning snapshot.
  return db.collection('platform_modules').find({id:{$in:plan.module_ids??[]},code:{$nin:hospital.disabled_modules??[]},is_active:true},{session,projection:{id:1,code:1}}).toArray();
}
export async function requireModule(tenant,code) {
  if(!(await entitledModules(tenant)).some(module=>module.code===code))throw Object.assign(Error(`The ${code} module is not included in your clinic subscription.`),{status:403,code:'MODULE_NOT_INCLUDED'});
}
export async function revokeExpiredSubscriptions(){
  for(const row of await currentSubscriptions())if(!['active','trial'].includes(row.status))await db.collection('sessions').deleteMany({tenant_id:row.tenant_id});
}
export function moduleForPermission(code){
  if(code.startsWith('menu.'))return {appointments:'opd',queue:'opd',consultation:'opd',diagnosis:'opd',prescriptions:'opd','voice-documentation':'opd',ipd:'ipd','lab-orders':'laboratory',samples:'laboratory',results:'laboratory',verification:'laboratory',devices:'laboratory',pos:'pharmacy',batches:'pharmacy',forecasting:'pharmacy',billing:'billing',hr:'hr'}[code.split('.')[1]];
  const prefix=code.split('.')[0];
  return {appointment:'opd',opd:'opd',prescription:'opd',ipd:'ipd',lab:'laboratory',radiology:'radiology',pharmacy:'pharmacy',billing:'billing',insurance:'billing',hr:'hr'}[prefix];
}
export function moduleForRoute(path){
  if(/\/ai-assistant|\/doctor\/(soap|handwriting)/.test(path))return 'ai';
  if(/\/queue\//.test(path)||/\/clinical\/(appointments|opd)/.test(path))return 'opd';
  if(/\/clinical\/(ipd|admissions)|\/ot\/|\/dietary\//.test(path))return 'ipd';
  if(/\/operations\/pharmacy/.test(path))return 'pharmacy';
  if(/\/operations\/(finance|billing)|\/workforce\/insurance/.test(path))return 'billing';
  if(/\/workforce\/hr/.test(path))return 'hr';
  if(/\/workspaces\/(lab|samples|results|verification)/.test(path))return 'laboratory';
  if(/\/workspaces\/radiology/.test(path))return 'radiology';
  return null;
}
export async function enforceStorage(tenant,session,additionalBytes=0){
  const plan=await subscriptionPlan(tenant,session);
  await db.collection('workflow_locks').updateOne({_id:`${tenant}:subscription-capacity`},{$inc:{version:1}},{session,upsert:true});
  let bytes=0;
  // Measure stored BSON for this clinic, including embedded images and documents.
  for(const {name} of await db.listCollections({},{nameOnly:true}).toArray()){
    if(name.startsWith('system.'))continue;
    const [usage]=await db.collection(name).aggregate([{$match:{tenant_id:tenant}},{$group:{_id:null,bytes:{$sum:{$bsonSize:'$$ROOT'}}}}],{session}).toArray();
    bytes+=Number(usage?.bytes??0);
  }
  if(bytes+additionalBytes>plan.storage_limit_gb*1024**3)throw Object.assign(Error('Your clinic storage allowance has been reached. Contact the administrator to upgrade.'),{status:403,code:'PLAN_LIMIT_REACHED'});
}
