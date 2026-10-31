import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db,transaction } from './database.mjs';
import { patientInput } from './patient-schema.mjs';
import { requirePermission,scopeFor,assertBranch,writeAudit,allowedBranches } from './access.mjs';
import { publicRecord } from './security.mjs';
import {configuredPrefix,operationalSettings} from './settings.mjs';

const router=Router();
const uuid=z.string().uuid();
const cents=value=>{
  const number=Number(value);
  if(!Number.isFinite(number)||number<0||number>99999999.99||Math.abs(number*100-Math.round(number*100))>0.00001)throw Object.assign(new Error('Enter a valid amount with at most two decimal places.'),{status:400});
  return Math.round(number*100);
};
function normalize(input){
  const data={...input};
  delete data.duplicate_override;delete data.duplicate_override_reason;
  data.registration_fee=0;
  if(cents(data.discount)>cents(data.maintenance_fee))throw Object.assign(new Error('Discount cannot exceed registration charges.'),{status:400});
  data.total_amount=(cents(data.maintenance_fee)-cents(data.discount))/100;
  data.address={...data.address,...(data.address.age_years===undefined?{}:{age_recorded_at:new Date().toISOString()})};
  data.normalized_name=`${data.first_name} ${data.last_name}`.toLowerCase().replace(/\s+/g,' ').trim();
  for(const charge of data.registration_addons)cents(charge.price);
  return data;
}
async function validateReferral(response,data,session){
  if(!data.referral_partner_id)return;
  const partner=await db.collection('referral_partners').findOne({id:data.referral_partner_id,tenant_id:response.locals.account.tenant_id,status:'Active'},{session});
  if(!partner)throw Object.assign(new Error('Select an active referral partner for this clinic.'),{status:400});
}
router.use((request,response,next)=>requirePermission(`patient.${request.method==='GET'?'view':request.method==='DELETE'?'delete':request.method==='PUT'?'update':'create'}`)(request,response,next));
router.get('/',async(request,response)=>{
  const search=z.string().max(150).default('').parse(request.query.search);
  const filter=await scopeFor(response,{deleted_at:null});
  if(search.trim())filter.$and.push(...search.trim().split(/\s+/).map(term=>({$or:['medical_record_number','first_name','last_name','phone','email'].map(key=>({[key]:{$regex:term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'}}))})));
  const paged=request.query.page!==undefined;
  const page=z.coerce.number().int().min(1).max(100000).default(1).parse(request.query.page);
  const pageSize=z.coerce.number().int().min(1).max(100).default(25).parse(request.query.page_size);
  const cursor=db.collection('patients').find(filter,{projection:{_id:0,normalized_name:0}}).sort({created_at:-1,id:-1});
  const rows=await (paged?cursor.skip((page-1)*pageSize).limit(pageSize):cursor).toArray();
  const branches=await db.collection('branches').find({tenant_id:response.locals.account.tenant_id},{projection:{id:1,name:1}}).toArray();
  for(const row of rows)row.branch_name=branches.find(branch=>branch.id===row.branch_id)?.name??'';
  response.json(paged?{rows,total:await db.collection('patients').countDocuments(filter),page,page_size:pageSize}:rows);
});
router.get('/branches',async(_request,response)=>{
  const ids=await allowedBranches(response.locals.account,response.locals.claims.portal);
  response.json(await db.collection('branches').find({tenant_id:response.locals.account.tenant_id,is_active:true,...(ids===null?{}:{id:{$in:ids}})},{projection:{_id:0,id:1,name:1}}).sort({name:1}).toArray());
});
router.get('/registration-settings',async(_request,response)=>{
  const tenant_id=response.locals.account.tenant_id;
  const settings=await db.collection('hospital_settings').find({tenant_id}).toArray();
  const value=key=>settings.find(row=>row.key===key)?.value;
  const runtime=await operationalSettings(tenant_id);
  const charges=await db.collection('hospital_charge_masters').find({tenant_id,kind:'charge'},{projection:{_id:0,id:1,name:1,data:1}}).sort({name:1}).toArray();
  const partners=await db.collection('referral_partners').find({tenant_id,status:'Active'},{projection:{_id:0,id:1,partner_code:1,name:1,phone:1}}).sort({name:1}).toArray();
  const medicines=await db.collection('hospital_pharmacy_masters').find({tenant_id,kind:'medicine'},{projection:{name:1}}).limit(1000).toArray();
  response.json({registration_fee:Number(value('registration_fee')??0),registration_charges:charges.map(row=>({id:row.id,name:row.name,price:Number(row.data?.standard_charge??0)})),
    referral_partners:partners,medicines:medicines.map(row=>row.name),can_override_duplicates:response.locals.claims.portal==='hospital_admin',
    payment_methods:runtime.payment_methods,currency_symbol:runtime.general.currency_symbol??'₹',date_format:runtime.general.date_format??'dd-mm-yyyy',time_format:runtime.general.time_format??'12 Hour'});
});
router.get('/:id',async(request,response)=>{
  const id=uuid.parse(request.params.id),filter=await scopeFor(response,{id,deleted_at:null});
  const patient=await db.collection('patients').findOne(filter,{projection:{_id:0,normalized_name:0}});
  if(!patient)return response.status(404).json({error:'Patient not found'});
  const common=await scopeFor(response,{patient_id:id});
  const appointments=await db.collection('clinical_appointments').find(common,{projection:{_id:0}}).sort({appointment_date:-1}).toArray();
  const ipd=await db.collection('ipd_admissions').find(common,{projection:{_id:0}}).sort({admitted_at:-1}).toArray();
  const payments=await db.collection('payments').find(common,{projection:{_id:0}}).sort({created_at:-1}).toArray();
  response.json({patient,appointments,ipd,payments});
});
export async function registerPatient(request,response,{requireTitle=true}={}){
  const input=patientInput.parse(request.body),data=normalize(input),tenant=response.locals.account.tenant_id;
  if(requireTitle&&!input.address.title)return response.status(400).json({field:'Title',error:'Select a patient title'});
  const canOverride=response.locals.claims.portal==='hospital_admin';
  if(input.duplicate_override&&!canOverride)return response.status(403).json({error:'Hospital Admin approval is required to override a possible duplicate.'});
  const id=randomUUID();
  const result=await transaction(async session=>{
    await assertBranch(response,data.branch_id,session);
    await validateReferral(response,data,session);
    // Every registration writes the tenant counter first. Concurrent duplicate
    // checks conflict on this document and retry against a fresh snapshot.
    const counter=await db.collection('counters').findOneAndUpdate({_id:`${tenant}:patient`},{$inc:{value:1}},{upsert:true,returnDocument:'after',session});
    const alternatives=[];
    if(data.phone)alternatives.push({phone:data.phone});
    if(data.date_of_birth)alternatives.push({date_of_birth:data.date_of_birth});
    const duplicates=alternatives.length?await db.collection('patients').find({tenant_id:tenant,deleted_at:null,normalized_name:data.normalized_name,$or:alternatives},{session,projection:{_id:0,id:1,medical_record_number:1,first_name:1,last_name:1,date_of_birth:1,phone:1,branch_id:1}}).limit(10).toArray():[];
    if(duplicates.length&&!input.duplicate_override){
      const ids=await allowedBranches(response.locals.account,response.locals.claims.portal,session);
      throw Object.assign(new Error('A possible duplicate patient already exists. Review the matching UHID.'),{status:409,code:'POSSIBLE_DUPLICATE_PATIENT',details:{can_override:canOverride,matches:duplicates.map(row=>ids===null||ids.includes(row.branch_id)?row:{restricted:true,medical_record_number:'Existing patient in another authorized workflow'})}});
    }
    const prefix=await configuredPrefix(tenant,'uhid_prefix','UHID',session);
    const now=new Date(),record={...data,id,tenant_id:tenant,medical_record_number:`${prefix}-${String(counter.value).padStart(6,'0')}`,created_at:now,updated_at:now,deleted_at:null};
    if(data.referral_partner_id)record.referral_tagged_at=now;
    await db.collection('patients').insertOne({...record},{session});
    await writeAudit(response,input.duplicate_override?'patient_duplicate_override':'patient_registered',id,session,input.duplicate_override?{reason:input.duplicate_override_reason,matched_patient_ids:duplicates.map(row=>row.id)}:{});
    delete record.normalized_name;
    return record;
  });
  response.status(201).json({...result,patient_name:`${result.first_name} ${result.last_name}`});
}
router.post('/',registerPatient);
async function update(request,response,detailsOnly){
  if(Object.hasOwn(request.body??{},'medical_record_number'))return response.status(400).json({code:'IMMUTABLE_UHID',error:'UHID is system-generated and cannot be changed.'});
  const input=patientInput.parse(request.body),data=normalize(input),id=uuid.parse(request.params.id);
  const result=await transaction(async session=>{
    const filter=await scopeFor(response,{id,deleted_at:null},session);
    const existing=await db.collection('patients').findOne(filter,{session});
    if(!existing)throw Object.assign(new Error('Patient not found'),{status:404});
    await assertBranch(response,data.branch_id,session);await validateReferral(response,data,session);
    if(detailsOnly)for(const field of ['registration_fee','maintenance_fee','registration_addons','payment_mode','payment_reference','discount','discount_remarks','registration_payment_status','payment_status_remarks','total_amount'])delete data[field];
    if(!data.date_of_birth)data.date_of_birth=existing.date_of_birth??null;
    data.address={...existing.address,...data.address};
    if(data.referral_partner_id)data.referral_tagged_at=existing.referral_tagged_at??new Date();
    const saved=await db.collection('patients').findOneAndUpdate(filter,{$set:{...data,updated_at:new Date()}},{session,returnDocument:'after',projection:{_id:0,normalized_name:0}});
    await writeAudit(response,'patient_updated',id,session);
    return saved;
  });
  response.json(result);
}
router.put('/:id/details',(request,response)=>update(request,response,true));
router.put('/:id',(request,response)=>update(request,response,false));
router.delete('/:id',async(request,response)=>{
  const id=uuid.parse(request.params.id);
  await transaction(async session=>{
    const result=await db.collection('patients').updateOne(await scopeFor(response,{id,deleted_at:null},session),{$set:{deleted_at:new Date(),status:'Inactive',updated_at:new Date()}},{session});
    if(!result.matchedCount)throw Object.assign(new Error('Patient not found'),{status:404});
    await writeAudit(response,'patient_deleted',id,session);
  });
  response.status(204).end();
});
export default router;
