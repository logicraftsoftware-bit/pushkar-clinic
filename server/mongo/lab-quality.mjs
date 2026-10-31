import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,assertBranch,requirePermission,writeAudit} from './access.mjs';
import {escapeSearch} from './search.mjs';
const router=Router(),uuid=z.string().uuid(),fail=(message,status=400)=>Object.assign(new Error(message),{status});
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
router.use('/lab',requirePermission('lab.order.view'));
router.get('/lab/workflow',async(request,response)=>{
  const filters=z.object({view:z.enum(['status','processing','worksheet','verification','reports']).default('status'),search:z.string().trim().max(150).default(''),from:z.string().date().or(z.literal('')).default(''),to:z.string().date().or(z.literal('')).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(request.query);
  if(filters.from&&filters.to&&filters.from>filters.to)throw fail('From Date must be on or before To Date.');
  const extra={workspace:'laboratory',kind:{$in:['orders','pos','sample collection','results','verification','reports']}};
  if(['processing','worksheet'].includes(filters.view))extra['data.collected_at']={$type:'string'};
  if(filters.view==='processing')extra['data.processing_status']={$nin:['Accepted','Rejected']};
  if(filters.view==='worksheet')extra.status={$ne:'Rejected'};
  if(filters.view==='verification')extra['data.result_status']={$in:['Completed','Partially Completed']};
  if(filters.view==='reports')extra['data.doctor_approval']={$type:'object'};
  if(filters.from||filters.to)extra.occurred_at={...(filters.from?{$gte:new Date(filters.from+'T00:00:00+05:30')}:{}),...(filters.to?{$lte:new Date(filters.to+'T23:59:59.999+05:30')}:{})};
  const scope=await scopeFor(response,extra);if(filters.search)scope.$and.push({$or:['title','data.customer_name','data.medical_record_number','data.bill_number','data.tests.name','data.barcodes.value'].map(field=>({[field]:{$regex:escapeSearch(filters.search),$options:'i'}}))});
  const rows=await db.collection('role_work_items').find(scope,{projection:{_id:0,id:1,title:1,status:1,kind:1,occurred_at:1,patient_id:1,'data.tests':1,'data.customer_name':1,'data.medical_record_number':1,'data.processing_status':1,'data.processing_note':1,'data.result_status':1,'data.completed_test_ids':1,'data.technician_approval':1,'data.doctor_approval':1}}).sort({occurred_at:-1,id:-1}).skip((filters.page-1)*50).limit(50).toArray();
  for(const row of rows){const patient=row.patient_id?await db.collection('patients').findOne({tenant_id:response.locals.account.tenant_id,id:row.patient_id},{projection:{first_name:1,last_name:1,medical_record_number:1}}):null;row.patient_name=patient?`${patient.first_name} ${patient.last_name}`:row.data.customer_name??'';row.medical_record_number=patient?.medical_record_number??row.data.medical_record_number??'';}
  response.json({rows,total:await db.collection('role_work_items').countDocuments(scope),page:filters.page});
});
router.get('/lab/summary',async(_request,response)=>{
  const group=async(collection,filter)=>db.collection(collection).aggregate([{$match:await scopeFor(response,filter)},{$group:{_id:'$status',count:{$sum:1}}},{$project:{_id:0,status:'$_id',count:1}},{$sort:{status:1}}]).toArray();
  response.json({orders:await group('role_work_items',{workspace:'laboratory'}),qc:await group('lab_qc_runs',{created_at:{$gte:new Date(Date.now()-30*86400000)}}),latest_import:null});
});
router.get('/lab/qc',async(_request,response)=>{
  const tenant_id=response.locals.account.tenant_id,controls=await db.collection('lab_qc_controls').find(await scopeFor(response),{projection:{_id:0}}).sort({created_at:-1}).toArray();
  const parameters=await db.collection('hospital_diagnostic_masters').find({tenant_id,domain:'pathology',kind:'parameter'},{projection:{_id:0,id:1,name:1}}).sort({name:1}).toArray();
  for(const control of controls)control.parameter_name=parameters.find(row=>row.id===control.parameter_id)?.name??'';
  const runs=await db.collection('lab_qc_runs').find(await scopeFor(response),{projection:{_id:0}}).sort({created_at:-1}).limit(500).toArray();
  for(const run of runs){const control=controls.find(row=>row.id===run.control_id);Object.assign(run,{control_name:control?.name??'',lot:control?.lot??'',level:control?.level??'',parameter_name:control?.parameter_name??''});}
  response.json({controls,runs,parameters});
});
router.post('/lab/qc/controls',requirePermission('lab.result.verify'),async(request,response)=>{
  const body=z.object({name:z.string().trim().min(1).max(200),parameter_id:uuid,lot:z.string().trim().min(1).max(100),level:z.string().trim().min(1).max(100),target:z.coerce.number().finite(),sd:z.coerce.number().finite().positive(),expires_on:z.string().date()}).parse(request.body);
  const row=await transaction(async session=>{const account=response.locals.account;await assertBranch(response,account.branch_id,session);if(!await db.collection('hospital_diagnostic_masters').findOne({tenant_id:account.tenant_id,id:body.parameter_id,domain:'pathology',kind:'parameter'},{session}))throw fail('Select a laboratory parameter.');const row={...body,id:randomUUID(),tenant_id:account.tenant_id,branch_id:account.branch_id,status:'Active',created_at:new Date()};await db.collection('lab_qc_controls').insertOne({...row},{session});await writeAudit(response,'lab_qc_control_created',row.id,session);return row;});response.status(201).json(row);
});
router.post('/lab/qc/runs',requirePermission('lab.result.create'),async(request,response)=>{
  const body=z.object({control_id:uuid,value:z.coerce.number().finite(),note:z.string().trim().max(2000).default('')}).parse(request.body);
  const result=await transaction(async session=>{const control=await db.collection('lab_qc_controls').findOne(await scopeFor(response,{id:body.control_id,status:'Active',expires_on:{$gte:day()}},session),{session});if(!control)throw fail('Select an active, unexpired QC control.');const score=(body.value-control.target)/control.sd;if(!Number.isFinite(score))throw fail('QC calculation exceeds the supported range.');const row={...body,id:randomUUID(),tenant_id:control.tenant_id,branch_id:control.branch_id,z_score:Number(score.toFixed(4)),status:Math.abs(score)>=3?'Out of Control':Math.abs(score)>=2?'Warning':'In Control',created_by:response.locals.account.id,created_at:new Date()};await db.collection('lab_qc_runs').insertOne({...row},{session});await writeAudit(response,'lab_qc_run_recorded',row.id,session);return row;});response.status(201).json(result);
});
router.get('/lab/masters/:kind',async(request,response)=>{const kind=z.enum(['specimen','container','method','approver','test','parameter']).parse(request.params.kind);response.json(await db.collection('hospital_diagnostic_masters').find({tenant_id:response.locals.account.tenant_id,domain:'pathology',kind},{projection:{_id:0,id:1,name:1,data:1}}).sort({name:1}).toArray());});
router.get('/lab/workflow-filter-options',async(_request,response)=>{
  const tenant_id=response.locals.account.tenant_id,rows=await db.collection('hospital_diagnostic_masters').find({tenant_id,domain:'pathology',kind:{$in:['test','category']}},{projection:{_id:0,id:1,name:1,kind:1,data:1}}).toArray();response.json(rows.filter(row=>row.kind==='test').map(row=>({id:row.id,name:row.name,data:{department:rows.find(category=>category.id===row.data?.category_id)?.name??row.data?.department??row.data?.department_name??''}})));
});
router.patch('/lab/masters/:id/accreditation',requirePermission('lab.result.verify'),async(request,response)=>{
  const id=uuid.parse(request.params.id),body=z.object({accredited:z.boolean(),scope:z.string().trim().max(500).default(''),valid_until:z.string().date().nullable()}).parse(request.body);if(body.accredited&&(!body.scope||!body.valid_until))throw fail('Enter accreditation scope and validity date.');
  await transaction(async session=>{const result=await db.collection('hospital_diagnostic_masters').updateOne({tenant_id:response.locals.account.tenant_id,id,domain:'pathology',kind:'test'},{$set:{'data.nabl_accredited':body.accredited,'data.nabl_scope':body.scope,'data.nabl_valid_until':body.valid_until,updated_at:new Date()}},{session});if(!result.matchedCount)throw fail('Laboratory test not found.',404);await writeAudit(response,'lab_accreditation_updated',id,session);});response.json({status:'Updated'});
});
export default router;
