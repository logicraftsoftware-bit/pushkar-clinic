import {Router} from 'express';
import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,assertBranch,allowedBranches,permissionsFor,requirePermission,writeAudit} from './access.mjs';
import {payrollAmount,claimAmounts,attendanceStatus} from './workforce-policy.mjs';
const router=Router(),uuid=z.string().uuid(),money=z.coerce.number().finite().nonnegative().max(99999999.99).multipleOf(0.01);
const nullable=z.union([uuid,z.literal(''),z.null()]).optional().transform(value=>value||null);
const date=z.union([z.string().date(),z.literal('')]).optional().transform(value=>value||null);
const metadata={request_id:uuid.optional(),updated_at:z.string().datetime().optional()};
const claim=z.object({patient_id:uuid,insurance_company:z.string().trim().min(1).max(200),tpa:z.string().max(200).default(''),policy_number:z.string().max(200).default(''),policy_validity:date,reference_type:z.string().max(100).default(''),reference_number:z.string().max(200).default(''),claimed_amount:money.default(0),approved_amount:money.default(0),settled_amount:money.default(0),submission_date:date,status:z.enum(['Draft','Submitted','Under Review','Approved','Partially Approved','Rejected','Settled']).default('Draft'),documents:z.union([z.string().max(5000),z.array(z.string().max(5000)).max(30)]).default('').transform(value=>Array.isArray(value)?value:value?[value]:[]),remarks:z.string().max(10000).default(''),...metadata});
const hrKind=z.enum(['attendance','shifts','duty-roster','leave','payroll','holidays']);
const hr=z.object({employee_id:nullable,branch_id:nullable,record_date:z.preprocess(value=>typeof value==='string'&&/^\d{4}-\d{2}$/.test(value)?value+'-01':value,date),status:z.string().trim().max(80).default('Active'),amount:money.default(0),data:z.record(z.string(),z.unknown()).default({}),...metadata});
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
async function grant(response,permission,session){const permissions=await permissionsFor(response.locals.account,session);if(!permissions.includes('*')&&!permissions.includes(permission))throw failure(`Permission required: ${permission}`,403);}
router.get('/lookups',async(_request,response)=>{
  const permissions=await permissionsFor(response.locals.account),can=code=>permissions.includes('*')||permissions.includes(code),insurance=can('insurance.view'),hr=can('hr.view');
  if(!insurance&&!hr)throw failure('HR or insurance access required.',403);
  const tenant_id=response.locals.account.tenant_id,ids=await allowedBranches(response.locals.account,response.locals.claims.portal);
  const branches=await db.collection('branches').find({tenant_id,is_active:true,...(ids===null?{}:{id:{$in:ids}})},{projection:{_id:0,id:1,name:1}}).toArray();
  const patients=insurance?(await db.collection('patients').find(await scopeFor(response,{deleted_at:null}),{projection:{_id:0,id:1,first_name:1,last_name:1,medical_record_number:1}}).toArray()).map(row=>({id:row.id,name:`${row.first_name} ${row.last_name}`.toUpperCase(),medical_record_number:row.medical_record_number})):[];
  const employees=hr?(await db.collection('staff_members').find(await scopeFor(response,{status:'Active'}),{projection:{_id:0,id:1,first_name:1,last_name:1,employee_id:1}}).toArray()).map(row=>({id:row.id,name:`${row.first_name} ${row.last_name}`,code:row.employee_id})):[];
  const users=hr?(await db.collection('users').find(await scopeFor(response,{is_active:true}),{projection:{_id:0,id:1,first_name:1,last_name:1}}).toArray()).map(row=>({id:row.id,name:`${row.first_name} ${row.last_name}`})):[];
  response.json({branches,patients,employees,users});
});
router.get('/insurance',requirePermission('insurance.view'),async(_request,response)=>{
  const rows=await db.collection('insurance_claims').find(await scopeFor(response),{projection:{_id:0,request_hash:0}}).sort({created_at:-1}).toArray();
  for(const row of rows){const patient=await db.collection('patients').findOne({tenant_id:row.tenant_id,id:row.patient_id});row.patient_name=patient?`${patient.first_name} ${patient.last_name}`.toUpperCase():'';row.medical_record_number=patient?.medical_record_number??'';}
  response.json(rows);
});
router.get('/hr/:kind',requirePermission('hr.view'),async(request,response)=>{
  const kind=hrKind.parse(request.params.kind),rows=await db.collection('hr_records').find(await scopeFor(response,{kind}),{projection:{_id:0,request_hash:0}}).sort({record_date:-1,created_at:-1}).toArray();
  for(const row of rows){const employee=row.employee_id?await db.collection('staff_members').findOne({tenant_id:row.tenant_id,id:row.employee_id}):null,branch=await db.collection('branches').findOne({tenant_id:row.tenant_id,id:row.branch_id});row.employee_name=employee?`${employee.first_name} ${employee.last_name}`:'';row.employee_code=employee?.employee_id??'';row.branch_name=branch?.name??'';}
  response.json(rows);
});
async function validateHr(response,body,kind,session){
  let employee=null;
  if(body.employee_id){employee=await db.collection('staff_members').findOne(await scopeFor(response,{id:body.employee_id,status:'Active'},session),{session});if(!employee)throw failure('Select an active employee in an authorized branch.');}
  if(['attendance','leave','duty-roster','payroll'].includes(kind)&&!employee)throw failure('Select an employee.');
  body.branch_id??=employee?.branch_id??response.locals.account.branch_id;
  await assertBranch(response,body.branch_id,session);
  if(employee&&!(employee.branch_ids??[employee.branch_id]).includes(body.branch_id))throw failure('Employee is not assigned to this branch.');
  if(['attendance','duty-roster','payroll','holidays'].includes(kind)&&!body.record_date)throw failure('Select a record date.');
  const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  for(const field of ['check_in','check_out','start_time','end_time'])if(body.data[field])body.data[field]=time.parse(body.data[field]);
  if(kind==='payroll'){for(const key of ['basic_salary','allowances','overtime','deductions','tax'])body.data[key]=money.parse(body.data[key]||0);body.amount=payrollAmount(body.data);}
  if(kind==='leave'){
    body.data.from_date=z.string().date().parse(body.data.from_date);body.data.to_date=z.string().date().parse(body.data.to_date);
    if(body.data.from_date>body.data.to_date)throw failure('Leave end date cannot be before its start.');
    if(body.status==='Approved'){body.data.approved_by=response.locals.account.id;body.data.approved_at=new Date().toISOString();}
    else {delete body.data.approved_by;delete body.data.approved_at;}
  }
  if(['shifts','holidays'].includes(kind))body.data.name=z.string().trim().min(1).max(200).parse(body.data.name);
  if(kind==='attendance'&&body.data.check_in){const setting=await db.collection('hospital_settings').findOne({tenant_id:response.locals.account.tenant_id,section:'AttendanceSetting',key:'roles'},{session});body.status=attendanceStatus(body.data.check_in,employee.staff_type,setting?.value,body.status);}
}
function save(insurance,editing){return async(request,response)=>{
  const kind=insurance?'insurance':hrKind.parse(request.params.kind),body=(insurance?claim:hr).parse(request.body),tenant_id=response.locals.account.tenant_id,collection=insurance?'insurance_claims':'hr_records',recordId=editing?uuid.parse(request.params.id):randomUUID();
  const hash=createHash('sha256').update(JSON.stringify({kind,body})).digest('hex');
  const result=await transaction(async session=>{
    await grant(response,insurance?'insurance.manage':'hr.manage',session);
    await db.collection('workflow_locks').updateOne({_id:`${tenant_id}:workforce`},{$inc:{version:1}},{session,upsert:true});
    const previous=editing?await db.collection(collection).findOne(await scopeFor(response,{id:recordId,...(insurance?{}:{kind})},session),{session}):null;
    if(editing&&!previous)throw failure('Record not found in an authorized branch.',404);
    if(editing&&(!body.updated_at||new Date(previous.updated_at).toISOString()!==body.updated_at))throw failure('Record changed. Refresh before editing.',409);
    if(!editing&&body.request_id){const prior=await db.collection(collection).findOne({tenant_id,request_id:body.request_id},{session,projection:{_id:0}});if(prior){if(prior.request_hash!==hash)throw failure('Request ID already used with different values.',409);delete prior.request_hash;return prior;}}
    if(insurance){
      claimAmounts(body);
      const patient=await db.collection('patients').findOne(await scopeFor(response,{id:body.patient_id,deleted_at:null},session),{session});if(!patient)throw failure('Select a patient in an authorized branch.');
      body.branch_id=patient.branch_id;
      if(previous&&previous.patient_id!==body.patient_id)throw failure('A claim cannot be moved to another patient.');
    }else await validateHr(response,body,kind,session);
    const counter=editing?null:await db.collection('counters').findOneAndUpdate({_id:`${tenant_id}:workforce:${kind}`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'});
    const now=new Date(Math.max(Date.now(),previous?new Date(previous.updated_at).getTime()+1:0)),row={...body,id:recordId,tenant_id,...(insurance?{claim_number:previous?.claim_number??`CLM-${String(counter.value).padStart(6,'0')}`}:{kind,record_number:previous?.record_number??`${kind.toUpperCase()}-${String(counter.value).padStart(6,'0')}`}),created_by:previous?.created_by??response.locals.account.id,created_at:previous?.created_at??now,updated_at:now,...(previous?.request_id?{request_id:previous.request_id,request_hash:previous.request_hash}:body.request_id?{request_hash:hash}:{})};
    if(editing)await db.collection(collection).replaceOne({tenant_id,id:recordId},row,{session});else await db.collection(collection).insertOne({...row},{session});
    await writeAudit(response,`${kind}_${editing?'updated':'created'}`,recordId,session,{previous_status:previous?.status??null,status:row.status});
    delete row.request_hash;return row;
  });response.status(editing?200:201).json(result);
};}
router.post('/insurance',save(true,false));router.put('/insurance/:id',save(true,true));
router.post('/hr/:kind',save(false,false));router.put('/hr/:kind/:id',save(false,true));
export default router;
