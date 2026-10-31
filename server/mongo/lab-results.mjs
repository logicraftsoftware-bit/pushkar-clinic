import {Router} from 'express';
import {z} from 'zod';
import {db,transaction} from './database.mjs';
import {scopeFor,requirePermission,permissionsFor,writeAudit} from './access.mjs';
import {resultRecord,nextTimestamp} from './lab-result-record.mjs';
import {prepareLabResults,attributeLabResults,labResultChanges} from './lab-result-entry.mjs';
import {labResultProgress,approvedLabTestIds,labTestHasResults} from './lab-result-completion.mjs';
import {verifyLabTests,disapproveLabTests} from './lab-test-verification.mjs';
import {verificationPathologists} from './lab-doctor-verification.mjs';
const router=Router(),uuid=z.string().uuid();
const failure=(message,status=409)=>Object.assign(new Error(message),{status});
async function found(response,id,session){
  const row=await db.collection('role_work_items').findOne(await scopeFor(response,{id,workspace:'laboratory'},session),{session});
  if(!row)throw failure('Laboratory order not found',404);
  return row;
}
router.get('/work-items/:id/lab-results',async(request,response)=>{
  const granted=await permissionsFor(response.locals.account),permission=response.locals.account.role==='receptionist'?'billing.view':'lab.order.view';
  if(!granted.includes('*')&&!granted.includes(permission))throw failure(`Permission required: ${permission}`,403);
  const row=await found(response,uuid.parse(request.params.id));
  if(!row.data.collected_at)throw failure('Collect the laboratory sample before opening results.');
  if(request.query.mode==='entry'){
    const permissions=await permissionsFor(response.locals.account);
    if(!permissions.includes('*')&&!permissions.includes('lab.result.create'))throw failure('Result entry permission required.',403);
  }
  const record=await resultRecord(row);
  if(response.locals.account.role==='receptionist'){
    const approved=new Set(approvedLabTestIds(row.data)),bill=record.report_bill;
    if(!approved.size||!bill||bill.status!=='Paid'||Number(bill.due)!==0||Number(bill.paid)<Number(bill.total))throw failure('Report available only after full payment and doctor approval.',403);
    record.tests=record.tests.filter(test=>approved.has(test.test_id));
    record.data={...record.data,lab_results:(record.data.lab_results??[]).filter(test=>approved.has(test.test_id))};delete record.data.result_history;delete record.data.approval_history;delete record.data.approved_signatories;
  }
  response.json(record);
});
const resultsInput=z.object({updated_at:z.string().datetime(),definition_revision:z.string().regex(/^[a-f0-9]{64}$/).optional(),results:z.array(z.object({test_id:uuid,parameters:z.array(z.object({parameter_id:uuid.nullable().optional(),value:z.string().trim().max(20000),remarks:z.string().trim().max(1000).default('')})).max(1000)})).min(1).max(200)});
router.patch('/work-items/:id/lab-results',requirePermission('lab.result.create'),async(request,response)=>{
  const body=resultsInput.parse(request.body),id=uuid.parse(request.params.id);
  const saved=await transaction(async session=>{
    const row=await found(response,id,session);
    if(!row.data.collected_at||row.status==='Cancelled'||row.status==='Rejected'||row.data.processing_status==='Rejected')throw failure('Collected, non-rejected samples are required for result entry.');
    if(Date.parse(body.updated_at)!==new Date(row.updated_at).getTime())throw failure('Results changed. Reopen the current results before editing.');
    const record=await resultRecord(row,session);
    if(body.definition_revision!==record.definition_revision)throw failure('Parameter definitions changed. Reopen results and review the current definitions.');
    const testIds=body.results.map(test=>test.test_id);
    if(testIds.length!==new Set(testIds).size)throw failure('Each test may be submitted only once.',400);
    for(const input of body.results){
      const test=record.tests.find(test=>test.test_id===input.test_id);if(!test)throw failure('One or more submitted tests were not ordered.',400);
      const ids=input.parameters.map(parameter=>parameter.parameter_id??null);
      if(ids.length!==test.parameters.length||ids.length!==new Set(ids).size||ids.some(id=>!test.parameters.some(parameter=>(parameter.parameter_id??null)===id)))throw failure('Reload all configured parameters. A parameter is missing, duplicated or invalid.',400);
    }
    let results;try{results=prepareLabResults(record.tests,body.results,row.data).map(test=>({...record.tests.find(original=>original.test_id===test.test_id),...test}));}catch(error){throw failure(error.message,/read only/i.test(error.message)?409:400);}
    const actor={by:response.locals.account.id,name:`${response.locals.account.first_name} ${response.locals.account.last_name}`,at:new Date().toISOString()};
    const progress=labResultProgress(results),entry=attributeLabResults(row.data,record.tests,results,body.results,actor);
    const data={...row.data,lab_results:results,result_entry:entry,result_status:progress.status,completed_test_ids:progress.completed.map(test=>test.test_id),result_completed_at:progress.completed.length?actor.at:null,result_completed_by:actor.by,
      result_history:[...(row.data.result_history??[]),{at:actor.at,by:actor.by,results:row.data.lab_results??[],technician_approval:row.data.technician_approval??null,changes:labResultChanges(record.tests,results)}]};
    const updated_at=nextTimestamp(row.updated_at);
    await db.collection('role_work_items').updateOne({id,tenant_id:row.tenant_id},{$set:{data,updated_at}},{session});
    await writeAudit(response,'lab_results_saved',id,session,{test_ids:testIds});
    const result=await resultRecord({...row,data,updated_at},session);return result;
  });response.json(saved);
});
router.get('/lab/pathologists',requirePermission('lab.result.verify'),async(_request,response)=>{
  const tenant_id=response.locals.account.tenant_id,profiles=await db.collection('staff_members').find({tenant_id,staff_type:{$in:['Pathologist','Radiologist']},status:'Active'}).toArray();
  const own=profiles.find(row=>row.user_id===response.locals.account.id);
  response.json({rows:profiles.map(row=>({id:row.id,name:[row.first_name,row.middle_name,row.last_name].filter(Boolean).join(' '),has_signature:Boolean(row.professional?.digital_signature)})),self_pathologist_id:own?.id??null});
});
router.patch('/lab/orders/:id/process',requirePermission('lab.result.create'),async(request,response)=>{
  const body=z.object({action:z.enum(['receive','accept','reject']),note:z.string().trim().max(2000).default('')}).parse(request.body),id=uuid.parse(request.params.id);
  if(body.action==='reject'&&!body.note)throw failure('Enter the sample rejection reason.',400);
  const state={receive:'Received',accept:'Accepted',reject:'Rejected'}[body.action];
  await transaction(async session=>{
    const row=await found(response,id,session);
    if(!row.data.collected_at||row.data.doctor_approval||row.status==='Cancelled'||row.data.processing_status==='Rejected')throw failure('Sample is unavailable, rejected or already doctor approved.');
    const data={...row.data,processing_status:state,processing_note:body.note,processing_at:new Date().toISOString(),processing_by:response.locals.account.id};
    await db.collection('role_work_items').updateOne({id,tenant_id:row.tenant_id},{$set:{data,...(state==='Rejected'?{status:'Rejected'}:{}),updated_at:nextTimestamp(row.updated_at)}},{session});
    await writeAudit(response,'lab_sample_processed',id,session,{action:body.action,note:body.note});
  });response.json({status:state});
});
const approvalInput=z.object({stage:z.enum(['doctor','technician','return','disapprove']),updated_at:z.string().datetime().optional(),test_ids:z.array(uuid).max(300).default([]),pathologist_ids:z.array(uuid).max(6).default([]),test_pathologists:z.record(uuid,uuid).optional(),note:z.string().trim().max(2000).default('')});
router.patch('/lab/orders/:id/approve',async(request,response)=>{
  const body=approvalInput.parse(request.body),id=uuid.parse(request.params.id),granted=await permissionsFor(response.locals.account),permission=body.stage==='return'?'lab.result.create':'lab.result.verify';
  if(!granted.includes('*')&&!granted.includes(permission))throw failure(`Permission required: ${permission}`,403);
  if(body.stage==='return'&&!body.note)throw failure('Enter a reason for returning results.',400);
  const updated=await transaction(async session=>{
    const row=await found(response,id,session);
    if(!row.data.collected_at||!['Completed','Partially Completed'].includes(row.data.result_status)||row.status==='Cancelled'||row.status==='Rejected'||row.data.processing_status==='Rejected')throw failure('Saved results from a non-rejected sample are required.');
    if((body.stage!=='return'||body.updated_at!==undefined)&&Date.parse(body.updated_at??'')!==new Date(row.updated_at).getTime())throw failure('Results changed. Reopen verification and review current results.');
    const eligible=(row.data.lab_results??[]).filter(labTestHasResults);
    if(!eligible.length)throw failure('Save results for at least one test before approval.');
    if(body.test_ids.length!==new Set(body.test_ids).size)throw failure('Select each test only once.',400);
    const account=response.locals.account,staff=await db.collection('staff_members').findOne({tenant_id:row.tenant_id,user_id:account.id,status:'Active'},{session});
    const profiles=body.stage==='doctor'?await db.collection('staff_members').find({tenant_id:row.tenant_id,staff_type:{$in:['Pathologist','Radiologist']},status:'Active'},{session}).toArray():[];
    for(const profile of profiles)profile.name=[profile.first_name,profile.middle_name,profile.last_name].filter(Boolean).join(' ');
    const actor={name:`${account.first_name} ${account.last_name}`,staff_id:staff?.id,staff_type:staff?.staff_type??'',registration_number:staff?.professional?.medical_registration_number??''};
    let selected=[],perTest={};
    if(body.stage==='doctor'){
      try{
        if(body.test_pathologists){
          for(const testId of body.test_ids){const doctors=verificationPathologists(actor,body.test_pathologists[testId]?[body.test_pathologists[testId]]:[],profiles);selected.push(...doctors);perTest[testId]={pathologist_ids:doctors.map(row=>row.id),pathologist_names:doctors.map(row=>row.name)};}
        }else selected=verificationPathologists(actor,body.pathologist_ids,profiles);
      }catch(error){throw failure(error.message);}
      for(const profile of selected){
        if(typeof profile.professional?.medical_registration_number!=='string'||!profile.professional.medical_registration_number.trim())throw failure('A medical registration number is required for each report signatory.');
        if(!z.string().max(4000000).regex(/^(?:data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+|https:\/\/\S+)$/).safeParse(profile.professional.digital_signature).success)throw failure('Upload a valid report signature image before approval.');
      }
    }
    const now=new Date().toISOString(),metadata={test_ids:body.test_ids,pathologist_ids:[...new Set(selected.map(row=>row.id))],pathologist_names:[...new Set(selected.map(row=>row.name))],by:account.id,...actor,at:now,note:body.note};
    let patch;
    try{patch=body.stage==='disapprove'?disapproveLabTests(row.data,body.test_ids):body.stage==='return'?{result_status:'Returned',technician_approval:null,doctor_approval:null,return_reason:body.note}:verifyLabTests(row.data,body.stage,body.test_ids,metadata,Object.fromEntries(Object.entries(perTest).map(([id,profile])=>[id,{...metadata,...profile,test_ids:[id]}])));}catch(error){throw failure(error.message);}
    const signatures={...row.data.approved_signatories};
    for(const profile of selected)signatures[profile.id]={id:profile.id,name:profile.name,qualification:profile.professional?.doctor_qualification??'',designation:profile.designation||profile.staff_type,registration_number:profile.professional?.medical_registration_number??'',signature:profile.professional.digital_signature,approved:true};
    const data={...row.data,...patch,approved_signatories:signatures,approval_history:[...(row.data.approval_history??[]),{stage:body.stage,...metadata,test_pathologists:perTest,previous_approval:row.data.doctor_approval??null,...(['disapprove','return'].includes(body.stage)?{results:row.data.lab_results??[]}: {})}]};
    const updated_at=nextTimestamp(row.updated_at),status=body.stage==='doctor'?'Doctor Approved':body.stage==='technician'?'Technician Approved':'Results Returned';
    await db.collection('role_work_items').updateOne({id,tenant_id:row.tenant_id},{$set:{data,status,updated_at}},{session});
    await writeAudit(response,`lab_results_${body.stage}`,id,session,{test_ids:body.test_ids,note:body.note});return updated_at;
  });response.json({status:'Updated',updated_at:updated});
});
export default router;
