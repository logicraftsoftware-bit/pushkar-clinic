import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {assertBranch,scopeFor,requirePermission,permissionsFor,writeAudit,allowedBranches} from './access.mjs';
import {hashPassword,publicRecord} from './security.mjs';
import {staffSaveBody,staffAccountActive} from './staff-validation.mjs';
import {doctorSlots} from './doctor-availability.mjs';
import {baseRoles,rolePortalCode} from './role-policy.mjs';
const router=Router();
const id=z.string().uuid();
const optionalId=z.union([id,z.literal(''),z.null()]).optional().transform(value=>value||null);
const text=z.string().trim().min(1).max(200);
const amount=z.coerce.number().finite().nonnegative().max(99999999.99).multipleOf(0.01);
const phone=z.string().regex(/^\d{10}$|^$/);
const schemas={
  branches:z.object({name:text,code:text,branch_type:z.string().default(''),manager_name:z.string().default(''),email:z.union([z.string().email(),z.literal('')]).default(''),phone:phone.default(''),emergency_phone:phone.default(''),address_line:z.string().max(1000).default(''),city:z.string().default(''),state:z.string().default(''),pin_code:z.string().default(''),bed_capacity:z.coerce.number().int().nonnegative().default(0),is_active:z.boolean().default(true)}),
  departments:z.object({name:text,code:text,branch_id:id,hod_name:z.string().default(''),location:z.string().default(''),phone_extension:z.string().regex(/^\d{0,10}$/).default(''),description:z.string().max(2000).default(''),is_active:z.boolean().default(true)}),
  wards:z.object({name:text,code:text,branch_id:id,department_id:optionalId,ward_type:z.string().default(''),floor:z.string().default(''),capacity:z.coerce.number().int().nonnegative().default(0),is_active:z.boolean().default(true)}),
  rooms:z.object({room_number:text,branch_id:id,ward_id:id,room_type:z.string().default(''),floor:z.string().default(''),daily_charge:amount.default(0),is_active:z.boolean().default(true)}),
  beds:z.object({bed_number:text,branch_id:id,ward_id:id,room_id:id,bed_type:z.string().default(''),bed_type_id:optionalId,bed_group_id:optionalId,daily_charge:amount.default(0),status:z.enum(['Available','Occupied','Reserved','Cleaning','Maintenance']).default('Available')}),
  'refer-pharmacies':z.object({name:text,address:z.string().trim().min(1).max(2000),discount_percentage:z.coerce.number().min(0).max(100).multipleOf(0.01)}),
};
const resource=z.enum(Object.keys(schemas));
const table=name=>name==='refer-pharmacies'?'hospital_refer_pharmacies':name;
function failure(message,status=400){return Object.assign(new Error(message),{status});}
async function masterScope(response,name,extra={},session){
  const tenant_id=response.locals.account.tenant_id;
  if(name==='branches'){
    const ids=await allowedBranches(response.locals.account,response.locals.claims.portal,session);
    return {$and:[{tenant_id},...(ids===null?[]:[{id:{$in:ids}}]),extra]};
  }
  return ['departments','wards','rooms','beds'].includes(name)?scopeFor(response,extra,session):{$and:[{tenant_id},extra]};
}
async function references(response,name,body,session){
  if(body.branch_id)await assertBranch(response,body.branch_id,session);
  for(const [field,collection] of [['department_id','departments'],['ward_id','wards'],['room_id','rooms']]){
    if(!body[field])continue;
    const record=await db.collection(collection).findOne({tenant_id:response.locals.account.tenant_id,id:body[field]},{session});
    if(!record||(body.branch_id&&record.branch_id!==body.branch_id))throw failure(`Invalid ${field} selection for this branch.`);
    if(field==='room_id'&&body.ward_id&&record.ward_id!==body.ward_id)throw failure('Room does not belong to this ward.');
  }
  for(const [field,kind] of [['bed_type_id','type'],['bed_group_id','group']])if(body[field]&&!await db.collection('bed_masters').findOne({tenant_id:response.locals.account.tenant_id,id:body[field],kind},{session}))throw failure('Invalid bed master selection.');
  if(name==='beds'&&body.status==='Occupied')throw failure('Beds become occupied through an admission, not manual setup.');
}
router.get('/profile',requirePermission('hospital.manage'),async(_request,response)=>{
  response.json(publicRecord(await db.collection('hospitals').findOne({id:response.locals.account.tenant_id,deleted_at:null})));
});
router.get('/staff/list',requirePermission('staff.view'),async(request,response)=>{
  const extra=request.query.type?{staff_type:z.string().max(100).parse(request.query.type)}:{};
  const rows=await db.collection('staff_members').find(await scopeFor(response,extra),{projection:{_id:0}}).sort({created_at:-1}).toArray();
  for(const row of rows){
    const user=row.user_id?await db.collection('users').findOne({tenant_id:row.tenant_id,id:row.user_id}):null;
    const branches=await db.collection('branches').find({tenant_id:row.tenant_id,id:{$in:row.branch_ids??[row.branch_id]}}).toArray();
    row.branch_names=branches.map(branch=>branch.name);row.branch_name=branches.find(branch=>branch.id===row.branch_id)?.name??'';
    row.login_email=user?.email??'';row.username=user?.username??'';row.account_active=user?.is_active??false;row.account_force_password_change=user?.force_password_change??false;
    if(row.account){delete row.account.password;delete row.account.password_hash;}
  }
  response.json(rows);
});
router.get('/staff/roles',requirePermission('staff.view'),async(_request,response)=>{
  response.json(await db.collection('rbac_roles').find({tenant_id:response.locals.account.tenant_id,status:'Active'},{projection:{_id:0}}).sort({name:1}).toArray());
});
router.post('/staff/save',async(request,response)=>{
  const input=staffSaveBody.parse(request.body);
  const granted=await permissionsFor(response.locals.account),needed=input.id?'staff.update':'staff.create';
  if(!granted.includes('*')&&!granted.includes(needed))throw failure(`Permission required: ${needed}`,403);
  const account={...input.account},loginEmail=String(account.login_email??'').trim().toLowerCase(),username=String(account.username??'').trim().toLowerCase();
  if(Boolean(loginEmail)!==Boolean(username))throw failure('Provide both login email and username, or leave both blank.');
  if(loginEmail)z.string().email().parse(loginEmail);
  const password=String(account.password??'');if(password)z.string().min(12).max(200).parse(password);
  const password_hash=password?await hashPassword(password):null;
  delete account.password;delete account.password_hash;
  const staffId=input.id??randomUUID(),newUserId=randomUUID(),tenant_id=response.locals.account.tenant_id;
  const result=await transaction(async session=>{
    const existing=input.id?await db.collection('staff_members').findOne(await scopeFor(response,{id:input.id},session),{session}):null;
    if(input.id&&!existing)throw failure('Staff record not found',404);
    for(const branch of new Set(input.branch_ids))await assertBranch(response,branch,session);
    if(input.department_id){
      const department=await db.collection('departments').findOne({tenant_id,id:input.department_id,branch_id:{$in:input.branch_ids},is_active:true},{session});
      if(!department)throw failure('Department must belong to an assigned active branch.');
    }
    if(input.staff_type==='Nurse'&&input.professional.ward_assignment){
      const ward=await db.collection('wards').findOne({tenant_id,id:String(input.professional.ward_assignment),branch_id:{$in:input.branch_ids}},{session});
      if(!ward)throw failure('Ward must belong to an assigned branch.');
    }
    let userId=existing?.user_id??null;
    if(loginEmail){
      const selected=String(account.role??input.staff_type).trim();
      const role=await db.collection('rbac_roles').findOne({tenant_id,status:'Active',$or:[{code:selected.toUpperCase()},{name:{$regex:`^${selected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,$options:'i'}}]},{session});
      const portalCode=role&&rolePortalCode(role);
      if(!portalCode)throw failure('Select an active role with a valid staff workspace.');
      if(!granted.includes('*')&&(role.permissions??[]).some(permission=>!granted.includes(permission)))throw failure('You cannot assign a role with permissions beyond your own.',403);
      const active=staffAccountActive(input.status,account.account_status);
      if(userId){
        const current=await db.collection('users').findOne({tenant_id,id:userId},{session});
        if(!current)throw failure('Staff login record not found.',404);
        await db.collection('users').updateOne({tenant_id,id:userId},{$set:{username,email:loginEmail,phone:String(account.mobile??input.personal.mobile_number??''),first_name:input.first_name,last_name:input.last_name,role:baseRoles[portalCode],portal_code:portalCode,role_codes:[role.code],branch_id:input.branch_ids[0],department_id:input.department_id,is_active:active,...(password_hash?{password_hash,force_password_change:true}:{}),updated_at:new Date()},$inc:{session_version:1}},{session});
        await db.collection('sessions').deleteMany({user_id:userId},{session});
      }else{
        if(!password_hash)throw failure('Provide a password of at least 12 characters for the new login.');
        userId=newUserId;
        await db.collection('users').insertOne({id:userId,tenant_id,username,email:loginEmail,phone:String(account.mobile??input.personal.mobile_number??''),first_name:input.first_name,last_name:input.last_name,role:baseRoles[portalCode],portal_code:portalCode,role_codes:[role.code],branch_id:input.branch_ids[0],department_id:input.department_id,is_active:active,password_hash,force_password_change:true,session_version:0,created_at:new Date()},{session});
      }
      await db.collection('user_branch_access').deleteMany({tenant_id,user_id:userId},{session});
      for(const branch_id of new Set(input.branch_ids))await db.collection('user_branch_access').insertOne({tenant_id,user_id:userId,branch_id},{session});
    }else if(userId)throw failure('An existing login cannot be removed by clearing its email. Disable the account explicitly.');
    const now=new Date(),row={...input,id:staffId,tenant_id,user_id:userId,branch_id:input.branch_ids[0],branch_ids:[...new Set(input.branch_ids)],account,employment:{...input.employment,status:input.status},updated_at:now};
    if(existing)await db.collection('staff_members').replaceOne({tenant_id,id:staffId},{...row,created_at:existing.created_at},{session});
    else await db.collection('staff_members').insertOne({...row,created_at:now},{session});
    await writeAudit(response,existing?'staff_updated':'staff_created',staffId,session);
    return row;
  });
  response.status(input.id?200:201).json(result);
});
router.delete('/staff/record/:id',requirePermission('staff.delete'),async(request,response)=>{
  const staffId=id.parse(request.params.id);
  await transaction(async session=>{
    const row=await db.collection('staff_members').findOne(await scopeFor(response,{id:staffId},session),{session});
    if(!row)throw failure('Staff record not found',404);
    await db.collection('staff_members').updateOne({tenant_id:row.tenant_id,id:staffId},{$set:{status:'Inactive',updated_at:new Date()}},{session});
    if(row.user_id){
      await db.collection('users').updateOne({tenant_id:row.tenant_id,id:row.user_id},{$set:{is_active:false},$inc:{session_version:1}},{session});
      await db.collection('sessions').deleteMany({user_id:row.user_id},{session});
    }
    await writeAudit(response,'staff_disabled',staffId,session);
  });response.status(204).end();
});
router.get('/staff/:id/appointment-schedule',requirePermission('staff.view'),async(request,response)=>{
  const staff=await db.collection('staff_members').findOne(await scopeFor(response,{id:id.parse(request.params.id),staff_type:'Doctor'}));
  if(!staff)throw failure('Doctor not found',404);
  const professional=staff.professional??{},bookings=await db.collection('clinical_appointments').find({tenant_id:staff.tenant_id,doctor_id:staff.user_id,status:{$nin:['Cancelled','No Show']}}).toArray();
  const counts={};for(const row of bookings)counts[row.appointment_date]=(counts[row.appointment_date]??0)+1;
  response.json({default_schedule:professional.appointment_default_schedule??null,unavailable_dates:professional.appointment_unavailable_dates??[],schedule:(professional.appointment_schedule??[]).map(row=>({...row,booked:counts[row.appointment_date]??0}))});
});
router.put('/staff/:id/appointment-schedule',requirePermission('staff.update'),async(request,response)=>{
  const body=z.object({appointment_date:z.string().date(),from_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),to_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),max_slots:z.coerce.number().int().min(1).max(1000),slot_mode:z.enum(['capacity','duration']).default('capacity')}).parse(request.body);
  if(body.to_time<=body.from_time)throw failure('End time must be after start time.');
  const saved=await transaction(async session=>{
    const filter=await scopeFor(response,{id:id.parse(request.params.id),staff_type:'Doctor'},session),staff=await db.collection('staff_members').findOne(filter,{session});
    if(!staff)throw failure('Doctor not found',404);
    const professional=staff.professional??{},bookings=await db.collection('clinical_appointments').find({tenant_id:staff.tenant_id,doctor_id:staff.user_id,appointment_date:body.appointment_date,status:{$nin:['Cancelled','No Show']}},{session}).toArray();
    const available=doctorSlots(body,Number(professional.slot_duration)||20,body.max_slots);
    if(bookings.length>body.max_slots||bookings.some(booking=>!available.some(slot=>slot.time===booking.appointment_time.slice(0,5))))throw failure('The new schedule conflicts with existing bookings.',409);
    const updated={...professional,appointment_schedule:[...(professional.appointment_schedule??[]).filter(row=>row.appointment_date!==body.appointment_date),body],appointment_unavailable_dates:(professional.appointment_unavailable_dates??[]).filter(day=>day!==body.appointment_date)};
    await db.collection('staff_members').updateOne(filter,{$set:{professional:updated,updated_at:new Date()}},{session});
    await writeAudit(response,'doctor_schedule_updated',staff.id,session,{date:body.appointment_date});return body;
  });response.json(saved);
});
router.delete('/staff/:id/appointment-schedule/:date',requirePermission('staff.update'),async(request,response)=>{
  const day=z.string().date().parse(request.params.date);
  await transaction(async session=>{
    const filter=await scopeFor(response,{id:id.parse(request.params.id),staff_type:'Doctor'},session),staff=await db.collection('staff_members').findOne(filter,{session});
    if(!staff)throw failure('Doctor not found',404);
    if(await db.collection('clinical_appointments').findOne({tenant_id:staff.tenant_id,doctor_id:staff.user_id,appointment_date:day,status:{$nin:['Cancelled','No Show']}},{session}))throw failure('Existing appointments prevent removing this date.',409);
    const professional=staff.professional??{};
    await db.collection('staff_members').updateOne(filter,{$set:{professional:{...professional,appointment_schedule:(professional.appointment_schedule??[]).filter(row=>row.appointment_date!==day),appointment_unavailable_dates:[...new Set([...(professional.appointment_unavailable_dates??[]),day])]},updated_at:new Date()}},{session});
    await writeAudit(response,'doctor_schedule_removed',staff.id,session,{date:day});
  });response.status(204).end();
});
router.get('/:resource',requirePermission('hospital.manage'),async(request,response)=>{
  const name=resource.parse(request.params.resource);
  const extra=['branches','departments'].includes(name)&&request.query.include_inactive!=='true'?{is_active:true}:{};
  response.json(await db.collection(table(name)).find(await masterScope(response,name,extra),{projection:{_id:0}}).sort({created_at:-1}).toArray());
});
async function saveMaster(request,response){
  const name=resource.parse(request.params.resource),body=schemas[name].parse(request.body),recordId=request.params.id?id.parse(request.params.id):randomUUID();
  const tenant_id=response.locals.account.tenant_id;
  if(name==='branches'&&response.locals.claims.portal!=='hospital_admin')throw failure('Only Hospital Admin can change branch setup.',403);
  const row=await transaction(async session=>{
    await references(response,name,body,session);
    const existing=request.params.id?await db.collection(table(name)).findOne(await masterScope(response,name,{id:recordId},session),{session}):null;
    if(request.params.id&&!existing)throw failure('Record not found',404);
    if(name==='beds'&&existing?.status==='Occupied')throw failure('Occupied beds must be managed through admission or transfer.',409);
    const now=new Date(),record={...body,id:recordId,tenant_id,created_at:existing?.created_at??now,updated_at:now};
    if(existing)await db.collection(table(name)).replaceOne({tenant_id,id:recordId},{...record},{session});
    else await db.collection(table(name)).insertOne({...record},{session});
    await writeAudit(response,`${name}_${existing?'updated':'created'}`,recordId,session);
    return record;
  });response.status(request.params.id?200:201).json(row);
}
router.post('/:resource',requirePermission('hospital.manage'),saveMaster);
router.put('/:resource/:id',requirePermission('hospital.manage'),saveMaster);
export default router;
