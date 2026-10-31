import {Router} from 'express';
import {z} from 'zod';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {config} from './config.mjs';
import {hashPassword,activeAccount} from './security.mjs';
import {payloadSchema} from './crm-schema.mjs';
import {doctorFor,slotsFor} from './clinical.mjs';
import {configuredPrefix} from './settings.mjs';
import {cents,paymentStatus,appointmentTotal} from './money.mjs';
export const crmAdmin=Router();
const router=Router(),failure=(message,status=400)=>Object.assign(new Error(message),{status}),hash=value=>createHash('sha256').update(value).digest('hex');
function enabled(_request,_response,next){if(config.CRM_INTEGRATION_ENABLED!=='true')throw failure('CRM synchronization is disabled. Enable it in private server settings after connecting this clinic.',503);next();}
crmAdmin.get('/crm-connections',async(_request,response)=>{
  const hospitals=await db.collection('hospitals').find({deleted_at:null},{projection:{id:1,name:1,code:1}}).sort({name:1}).toArray(),rows=[];
  for(const hospital of hospitals){const connection=await db.collection('call_centre_crm_connections').findOne({tenant_id:hospital.id},{projection:{_id:0,api_key_hash:0}});rows.push({tenant_id:hospital.id,hospital_name:hospital.name,hospital_code:hospital.code,...connection,integration_enabled:config.CRM_INTEGRATION_ENABLED==='true',is_active:config.CRM_INTEGRATION_ENABLED==='true'&&Boolean(connection?.is_active)});}response.json(rows);
});
crmAdmin.get('/crm-clinics',enabled,async(_request,response)=>{
  if(!config.CRM_API_BASE_URL)throw failure('Configure CRM_API_BASE_URL privately on the server.',503);
  let payload;try{const result=await fetch(config.CRM_API_BASE_URL.replace(/\/$/,'')+'/patient/clinics',{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000),redirect:'error'});if(!result.ok)throw new Error();payload=await result.json();}catch{throw failure('CRM clinic directory is unavailable.',502);}
  const parsed=z.array(z.object({id:z.string().max(200),name:z.string().max(200),slug:z.string().optional(),city:z.string().optional(),state:z.string().optional(),address:z.string().optional()})).max(10000).safeParse(payload?.data);if(!parsed.success)throw failure('CRM returned an invalid clinic directory.',502);
  const connections=await db.collection('call_centre_crm_connections').find({},{projection:{tenant_id:1,clinic_external_id:1}}).toArray(),rows=[];
  for(const clinic of parsed.data){const connection=connections.find(row=>row.clinic_external_id===clinic.id),hospital=connection?await db.collection('hospitals').findOne({id:connection.tenant_id},{projection:{name:1}}):null;rows.push({...clinic,connectedTenantId:connection?.tenant_id??null,connectedHospitalName:hospital?.name??null});}response.json(rows);
});
crmAdmin.post('/crm-connections',enabled,async(request,response)=>{
  const body=z.object({tenantId:z.string().uuid(),clinicExternalId:z.string().trim().min(1).max(200),clinicName:z.string().trim().max(200).prefault('')}).parse(request.body),key='cfc_'+randomBytes(32).toString('base64url');
  const row=await transaction(async session=>{
    const hospital=await db.collection('hospitals').findOne({id:body.tenantId,deleted_at:null},{session});if(!hospital)throw failure('Clinic not found.',404);
    const old=await db.collection('call_centre_crm_connections').findOne({tenant_id:body.tenantId},{session});
    if(old&&old.clinic_external_id!==body.clinicExternalId)throw failure('Use a separate clinic account for a different CRM clinic. Existing mappings must not be reassigned.',409);
    const now=new Date(),row={id:old?.id??randomUUID(),tenant_id:body.tenantId,clinic_external_id:body.clinicExternalId,clinic_name:body.clinicName,api_key_prefix:key.slice(0,12),api_key_hash:hash(key),is_active:true,created_at:old?.created_at??now,updated_at:now};
    await db.collection('call_centre_crm_connections').updateOne({tenant_id:row.tenant_id},{$set:row},{session,upsert:true});await db.collection('platform_events').insertOne({id:randomUUID(),tenant_id:row.tenant_id,source:'Call Centre CRM',severity:'info',event_type:'crm_connected',message:'CRM connection key created or rotated.',created_at:now},{session});delete row.api_key_hash;return row;
  });response.status(201).json({...row,apiKey:key});
});
crmAdmin.patch('/crm-connections/:id/status',enabled,async(request,response)=>{
  const id=z.string().uuid().parse(request.params.id),body=z.object({isActive:z.boolean()}).parse(request.body),result=await db.collection('call_centre_crm_connections').findOneAndUpdate({id},{$set:{is_active:body.isActive,updated_at:new Date()}},{returnDocument:'after',projection:{_id:0,id:1,is_active:1}});if(!result)throw failure('CRM connection not found.',404);response.json(result);
});
router.post('/bootstrap',enabled,async(request,response)=>{
  const key=request.get('x-api-key')??request.get('authorization')?.replace(/^Bearer\s+/i,'');if(!key||key.length>300)throw failure('CRM API key required.',401);
  const api_key_hash=hash(key),connection=await db.collection('call_centre_crm_connections').findOne({api_key_hash,is_active:true});if(!connection)throw failure('CRM connection is invalid or inactive.',401);
  const body=payloadSchema.parse(request.body);if(Object.values(body).reduce((sum,rows)=>sum+rows.length,0)>1000)throw failure('Synchronize at most 1000 records per request.');
  // Random passwords are computed before the retryable transaction and never returned.
  const doctorPasswords=new Map();for(const item of body.doctors)doctorPasswords.set(item.externalId,await hashPassword(randomBytes(32).toString('base64url')));
  try{
    const summary=await transaction(async session=>{
      const current=await db.collection('call_centre_crm_connections').findOneAndUpdate({id:connection.id,api_key_hash,is_active:true},{$inc:{sync_version:1}},{session,returnDocument:'after'});if(!current)throw failure('CRM connection changed. Authenticate again.',401);
      const tenant_id=current.tenant_id,hospital=await db.collection('hospitals').findOne({id:tenant_id},{session});if(!activeAccount({is_active:true},hospital))throw failure('Clinic account is inactive.',403);
      const totals={branches:0,departments:0,doctors:0,patients:0,appointments:0},now=new Date();
      const mapped=async(type,external)=>db.collection('call_centre_crm_mappings').findOne({tenant_id,connection_id:current.id,entity_type:type,external_id:external},{session});
      const required=async(type,external)=>{const mapping=external?await mapped(type,external):null;if(!mapping)throw failure(`CRM ${type} mapping is missing.`);return mapping.erp_id;};
      const saveMap=async(type,item,erp_id)=>db.collection('call_centre_crm_mappings').updateOne({tenant_id,connection_id:current.id,entity_type:type,external_id:item.externalId},{$set:{erp_id,source_hash:hash(JSON.stringify(item)),source_updated_at:item.updatedAt?new Date(item.updatedAt):null,last_synced_at:now}},{session,upsert:true});
      const unchanged=(old,item)=>old&&(old.source_hash===hash(JSON.stringify(item))||item.updatedAt&&old.source_updated_at&&new Date(item.updatedAt)<=new Date(old.source_updated_at));
      for(const item of body.branches){
        const old=await mapped('branch',item.externalId);if(unchanged(old,item)){totals.branches++;continue;}
        const existing=old?await db.collection('branches').findOne({tenant_id,id:old.erp_id},{session}):null;if(old&&!existing)throw failure('Mapped branch no longer exists.',409);
        const id=existing?.id??randomUUID(),row={...existing,id,tenant_id,name:item.name,code:item.code,phone:item.phone??existing?.phone??'',address:item.address??existing?.address??{},is_active:item.active??true,created_at:existing?.created_at??now,updated_at:now};await db.collection('branches').replaceOne({tenant_id,id},row,{session,upsert:true});await saveMap('branch',item,id);totals.branches++;
      }
      for(const item of body.departments){
        const old=await mapped('department',item.externalId);if(unchanged(old,item)){totals.departments++;continue;}
        const branch_id=await required('branch',item.branchExternalId),id=old?.erp_id??randomUUID(),existing=old?await db.collection('departments').findOne({tenant_id,id},{session}):null;if(old&&!existing)throw failure('Mapped department no longer exists.',409);
        await db.collection('departments').replaceOne({tenant_id,id},{...existing,id,tenant_id,branch_id,name:item.name,code:item.code,is_active:item.active??true,created_at:existing?.created_at??now,updated_at:now},{session,upsert:true});await saveMap('department',item,id);totals.departments++;
      }
      for(const item of body.doctors){
        const old=await mapped('doctor',item.externalId);if(unchanged(old,item)){totals.doctors++;continue;}
        const branch_id=await required('branch',item.branchExternalId),department_id=await required('department',item.departmentExternalId),id=old?.erp_id??randomUUID(),existing=old?await db.collection('users').findOne({tenant_id,id,role:'doctor'},{session}):null;if(old&&!existing)throw failure('Mapped doctor no longer exists.',409);
        if(!await db.collection('departments').findOne({tenant_id,id:department_id,branch_id,is_active:true},{session}))throw failure('Doctor department must belong to the mapped branch.');
        const [first_name,...last]=item.name.trim().split(/\s+/),last_name=last.join(' ')||'Doctor',email=existing?.email??`crm-${id}@integration.invalid`;
        await db.collection('users').replaceOne({tenant_id,id},{...existing,id,tenant_id,branch_id,department_id,email,first_name,last_name,role:'doctor',role_codes:existing?.role_codes??['DOCTOR'],portal_code:existing?.portal_code??'DOCTOR',password_hash:existing?.password_hash??doctorPasswords.get(item.externalId),force_password_change:existing?.force_password_change??true,session_version:(existing?.session_version??0)+1,is_active:item.active??true,created_at:existing?.created_at??now,updated_at:now},{session,upsert:true});await db.collection('sessions').deleteMany({user_id:id},{session});
        const staff=await db.collection('staff_members').findOne({tenant_id,user_id:id},{session}),professional={...staff?.professional,qualification:item.qualification??staff?.professional?.qualification??'',specialization:item.specialization??staff?.professional?.specialization??'',registration_number:item.registrationNumber??staff?.professional?.registration_number??'',consultation_fee:item.consultationFee??staff?.professional?.consultation_fee??0};
        if(item.schedules)professional.appointment_schedule=item.schedules.map(schedule=>{const from=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).parse(schedule.from),to=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).parse(schedule.to);if(from>=to)throw failure('CRM doctor schedule end must follow its start.');return {appointment_date:schedule.date,from_time:from,to_time:to,max_slots:schedule.maxSlots??20};});
        await db.collection('staff_members').replaceOne({tenant_id,user_id:id},{...staff,id:staff?.id??randomUUID(),tenant_id,user_id:id,employee_id:staff?.employee_id??`CRM-${id}`,first_name,last_name,staff_type:'Doctor',branch_id,department_id,status:item.active===false?'Inactive':'Active',personal:{...staff?.personal,phone:item.mobile??staff?.personal?.phone??''},professional,created_at:staff?.created_at??now,updated_at:now},{session,upsert:true});await db.collection('user_branch_access').updateOne({tenant_id,user_id:id,branch_id},{$setOnInsert:{tenant_id,user_id:id,branch_id}},{session,upsert:true});await saveMap('doctor',item,id);totals.doctors++;
      }
      for(const item of body.patients){
        const old=await mapped('patient',item.externalId);if(unchanged(old,item)){totals.patients++;continue;}
        const branch_id=await required('branch',item.branchExternalId),id=old?.erp_id??randomUUID(),existing=old?await db.collection('patients').findOne({tenant_id,id,deleted_at:null},{session}):null;if(old&&!existing)throw failure('Mapped patient is unavailable.',409);
        if(existing&&existing.branch_id!==branch_id)throw failure('Move an existing patient branch through clinic administration.',409);
        const [first_name,...last]=item.name.trim().split(/\s+/),last_name=last.join(' ')||'Patient',counter=existing?null:await db.collection('counters').findOneAndUpdate({_id:`${tenant_id}:patient`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'}),medical_record_number=existing?.medical_record_number??`${await configuredPrefix(tenant_id,'uhid_prefix','UHID',session)}-${String(counter.value).padStart(6,'0')}`;
        await db.collection('patients').replaceOne({tenant_id,id},{...existing,id,tenant_id,branch_id,medical_record_number,crm_medical_record_number:item.medicalRecordNumber??existing?.crm_medical_record_number??'',first_name,last_name,normalized_name:`${first_name} ${last_name}`.toLowerCase().replace(/\s+/g,' ').trim(),date_of_birth:item.dateOfBirth??existing?.date_of_birth??null,sex:item.gender??existing?.sex??'unknown',phone:item.mobile??existing?.phone??'',email:item.email??existing?.email??'',blood_group:item.bloodGroup??existing?.blood_group??'',address:item.address??existing?.address??{},status:item.active===false?'Inactive':'Active',deleted_at:null,created_at:existing?.created_at??now,updated_at:now},{session,upsert:true});await saveMap('patient',item,id);totals.patients++;
      }
      for(const item of body.appointments){
        const old=await mapped('appointment',item.externalId);if(unchanged(old,item)){totals.appointments++;continue;}
        const branch_id=await required('branch',item.branchExternalId),patient_id=await required('patient',item.patientExternalId),department_id=await required('department',item.departmentExternalId),doctor_id=await required('doctor',item.doctorExternalId),id=old?.erp_id??randomUUID(),existing=old?await db.collection('clinical_appointments').findOne({tenant_id,id},{session}):null;
        if(old&&!existing)throw failure('Mapped appointment is unavailable.',409);if(existing&&(!['Booked','Confirmed'].includes(existing.status)||cents(existing.paid_amount??0)>0))throw failure('Checked-in, paid or completed encounters must be changed by clinic staff.',409);
        const status=z.enum(['Booked','Confirmed','Cancelled','No Show']).parse(item.status??existing?.status??'Booked'),appointment_date=item.startsAt.slice(0,10),appointment_time=item.startsAt.slice(11,16);
        if(existing&&(existing.patient_id!==patient_id||existing.branch_id!==branch_id))throw failure('CRM cannot reassign an existing encounter to another patient or branch.',409);
        await db.collection('workflow_locks').updateOne({_id:`${tenant_id}:doctor:${doctor_id}:${appointment_date}`},{$inc:{version:1}},{session,upsert:true});
        if(!await db.collection('branches').findOne({tenant_id,id:branch_id,is_active:true},{session})||!await db.collection('patients').findOne({tenant_id,id:patient_id,deleted_at:null,status:{$ne:'Inactive'}},{session}))throw failure('Select an active CRM patient and branch.');
        const context={locals:{account:{tenant_id,branch_id,id:current.id},claims:{portal:'crm'}}},doctor=await doctorFor(context,branch_id,department_id,doctor_id,session),slots=await slotsFor(doctor,appointment_date,undefined,existing?.id,session),slot=slots.find(row=>row.time===appointment_time);
        await db.collection('staff_members').updateOne({tenant_id,id:doctor.staff.id},{$inc:{workflow_version:1}},{session});await db.collection('users').updateOne({tenant_id,id:doctor.user.id},{$inc:{booking_version:1}},{session});
        if(!['Cancelled','No Show'].includes(status)&&!slot)throw failure('CRM appointment is outside available doctor slots.',409);
        const fee=existing?.consultation_fee??Number(doctor.professional.consultation_fee??0);cents(fee);
        const row={...existing,id,tenant_id,branch_id,patient_id,doctor_id,department_id,appointment_number:existing?.appointment_number??item.appointmentNumber,appointment_date,appointment_time,appointment_type:'OPD',visit_type:item.visitType??existing?.visit_type??'New',reason:item.reason??existing?.reason??'',source:'Call Centre CRM',slot_serial:slot?.serial??existing?.slot_serial??null,token_number:existing?.token_number??null,status,consultation_fee:fee,charges:existing?.charges??[],discount:existing?.discount??0,paid_amount:0,payment_mode:'',payment_status:paymentStatus(cents(fee),0),created_at:existing?.created_at??now,updated_at:now};
        row.payment_status=paymentStatus(appointmentTotal(row),0);
        await db.collection('clinical_appointments').replaceOne({tenant_id,id},row,{session,upsert:true});await saveMap('appointment',item,id);totals.appointments++;
      }
      await db.collection('call_centre_crm_connections').updateOne({id:current.id},{$set:{last_sync_at:now,last_sync_status:'Success',last_sync_summary:totals,updated_at:now}},{session});await db.collection('audit_events').insertOne({id:randomUUID(),tenant_id,actor_id:null,action:'crm_synchronized',record_id:current.id,metadata:{summary:totals},created_at:now},{session});return totals;
    });response.json({success:true,tenantId:connection.tenant_id,summary});
  }catch(error){await db.collection('call_centre_crm_connections').updateOne({id:connection.id},{$set:{last_sync_at:new Date(),last_sync_status:'Failed'}});throw error;}
});
export default router;
