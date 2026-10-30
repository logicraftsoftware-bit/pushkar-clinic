import {Router} from 'express';
import {z} from 'zod';
import {db,transaction} from './database.mjs';
import {requirePermission,scopeFor,writeAudit} from './access.mjs';
export async function operationalSettings(tenantId,session){
  const rows=await db.collection('hospital_settings').find({tenant_id:tenantId,section:{$in:['GeneralSetting','PaymentMethods','PrefixSetting']}},{session}).toArray();
  const section=name=>Object.fromEntries(rows.filter(row=>row.section===name).map(row=>[row.key,row.value]));
  const general=section('GeneralSetting'),payment=section('PaymentMethods'),prefix=section('PrefixSetting');
  const base=['Cash','Card','UPI','Bank Transfer','Cheque'],gateway=String(payment.selected_gateway??'None');
  return {general,prefix,payment_methods:gateway!=='None'?[...base,gateway]:base};
}
export async function configuredPrefix(tenant,key,fallback,session){
  const row=await db.collection('hospital_settings').findOne({tenant_id:tenant,section:'PrefixSetting',key},{session});
  return String(row?.value??fallback).trim().replace(/[^a-z0-9_-]/gi,'').slice(0,20)||fallback;
}
const router=Router();
router.get('/settings',requirePermission('settings.view'),async(_request,response)=>{
  const rows=await db.collection('hospital_settings').find({tenant_id:response.locals.account.tenant_id},{projection:{_id:0}}).toArray();
  const settings=Object.assign(Object.create(null),{General:Object.assign(Object.create(null),{currency:'INR',date_format:'DD/MM/YYYY',time_format:'12 Hour'}),Patient:Object.assign(Object.create(null),{registration_fee:0,registration_addons:[]}),Security:Object.assign(Object.create(null),{minimum_password_length:12})});
  for(const row of rows)(settings[row.section]??=Object.create(null))[row.key]=row.value;
  response.json(settings);
});
router.put('/settings/:section',requirePermission('settings.manage'),async(request,response)=>{
  if(response.locals.claims.portal!=='hospital_admin')return response.status(403).json({error:'Clinic-wide settings require Hospital Admin.'});
  const key=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/).refine(value=>!['constructor','prototype','__proto__'].includes(value),'Reserved setting key');
  const section=key.parse(request.params.section);
  const data=z.record(key,z.unknown()).parse(request.body);
  if(Object.keys(data).length>100||JSON.stringify(data).length>100000) return response.status(400).json({error:'Settings payload is too large.'});
  if(section==='PrefixSetting')for(const [key,value] of Object.entries(data))data[key]=z.string().regex(/^[A-Za-z0-9_-]{1,20}$/).parse(value);
  if(section==='Security'&&'minimum_password_length' in data)data.minimum_password_length=z.coerce.number().int().min(12).max(200).parse(data.minimum_password_length);
  await transaction(async session=>{
    for(const [key,value] of Object.entries(data))await db.collection('hospital_settings').updateOne({tenant_id:response.locals.account.tenant_id,section,key},{$set:{value,updated_by:response.locals.account.id,updated_at:new Date()}},{session,upsert:true});
    await writeAudit(response,'settings_updated',null,session,{section,keys:Object.keys(data)});
  });response.status(204).end();
});
router.get('/audit',requirePermission('audit.view'),async(_request,response)=>{
  response.json(await db.collection('audit_events').find(await scopeFor(response,{}),{projection:{_id:0}}).sort({created_at:-1}).limit(1000).toArray());
});
router.get('/login-activity',requirePermission('audit.view'),async(_request,response)=>{
  response.json(await db.collection('login_activity').find(await scopeFor(response,{}),{projection:{_id:0}}).sort({login_time:-1}).limit(1000).toArray());
});
export default router;
