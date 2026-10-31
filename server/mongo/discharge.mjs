import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,requirePermission,writeAudit} from './access.mjs';
import {doctorAdmission,nursingAdmission} from './clinical-access.mjs';
import {consultationData,allergyConflicts} from './consultation-validation.mjs';
import {syncAdmissionInvoice} from './finance-ledger.mjs';
const uuid=z.string().uuid(),failure=(message,status=409)=>Object.assign(new Error(message),{status});
export const doctorDischarge=Router(),receptionDischarge=Router(),nursingTasks=Router();
doctorDischarge.post('/ipd/:id/discharge-request',requirePermission('opd.create'),async(request,response)=>{
  const identity=uuid.parse(request.params.id),data=consultationData.parse(request.body);
  const result=await transaction(async session=>{
    const admission=await doctorAdmission(response,identity,session),tenant_id=admission.tenant_id;
    await db.collection('ipd_admissions').updateOne({tenant_id,id:identity},{$inc:{clinical_version:1}},{session});
    if(await db.collection('role_work_items').findOne({tenant_id,workspace:'reception',kind:'ipd_discharge','data.admission_id':identity,status:'Pending'},{session}))throw failure('A discharge request is already awaiting reception approval.');
    const patient=await db.collection('patients').findOne({tenant_id,id:admission.patient_id,deleted_at:null},{session});if(!patient)throw failure('Patient unavailable.');
    const conflicts=allergyConflicts(patient.allergies,data.medicines??[]);if(conflicts.length)throw failure(conflicts.join(' '),422);
    const now=new Date(),finalized={...data,document_status:'Finalized',finalized_at:now.toISOString(),verification_number:`DS-${randomUUID().slice(0,12).toUpperCase()}`,signed_by:response.locals.account.id};
    const record={id:randomUUID(),tenant_id,branch_id:admission.branch_id,doctor_id:response.locals.account.id,patient_id:admission.patient_id,admission_id:identity,appointment_id:null,record_type:'discharge_summary',data:finalized,created_at:now,updated_at:now};
    await db.collection('doctor_clinical_records').insertOne({...record},{session});
    const common={tenant_id,branch_id:admission.branch_id,patient_id:admission.patient_id,created_by:response.locals.account.id,status:'Pending',priority:'High',occurred_at:now,created_at:now,updated_at:now};
    const context={admission_id:identity,ipd_number:admission.ipd_number,discharge_record_id:record.id};
    for(const [workspace,kind,title] of [['reception','ipd_discharge','IPD Discharge'],['nurse','discharge-clearance','Nursing discharge clearance']])await db.collection('role_work_items').insertOne({...common,id:randomUUID(),workspace,kind,title:`${title} - ${patient.first_name} ${patient.last_name}`,data:{...context,instructions:data.advice??data.comment??'',medicines:data.medicines??[]}},{session});
    if(data.medicines?.length)await db.collection('role_work_items').insertOne({...common,id:randomUUID(),workspace:'pharmacy',kind:'prescription',title:`Discharge Prescription - ${patient.first_name} ${patient.last_name}`,data:{...context,visit_id:record.id,visit_at:record.created_at,doctor_id:response.locals.account.id,discharge_prescription:true,medical_record_number:patient.medical_record_number,medicines:data.medicines,diagnosis:data.diagnosis??'',advice:data.advice??''}},{session});
    await db.collection('ipd_admissions').updateOne({tenant_id,id:identity},{$set:{status:'Discharge Requested',updated_at:now}},{session});
    await writeAudit(response,'discharge_requested',identity,session,{record_id:record.id});return record;
  });response.status(201).json(result);
});
doctorDischarge.delete('/ipd/:id/discharge-request',requirePermission('opd.update'),async(request,response)=>{
  const identity=uuid.parse(request.params.id);
  await transaction(async session=>{
    const admission=await doctorAdmission(response,identity,session),tenant_id=admission.tenant_id;
    await db.collection('ipd_admissions').updateOne({tenant_id,id:identity},{$inc:{clinical_version:1}},{session});
    const pending=await db.collection('role_work_items').findOne({tenant_id,workspace:'reception',kind:'ipd_discharge','data.admission_id':identity,status:'Pending'},{session});if(!pending)throw failure('No pending discharge request is available to withdraw.');
    if(await db.collection('role_work_items').findOne({tenant_id,workspace:'pharmacy','data.discharge_record_id':pending.data.discharge_record_id,status:{$nin:['Pending','Cancelled']}},{session}))throw failure('Discharge medicines are already being processed.');
    const now=new Date();await db.collection('role_work_items').updateMany({tenant_id,'data.discharge_record_id':pending.data.discharge_record_id,status:{$in:['Pending','Acknowledged','Completed']}},{$set:{status:'Cancelled','data.cancelled_by':response.locals.account.id,'data.cancelled_at':now,'data.cancel_reason':'Doctor withdrew discharge',updated_at:now}},{session});
    await db.collection('doctor_clinical_records').updateOne({tenant_id,id:pending.data.discharge_record_id},{$set:{'data.document_status':'Withdrawn','data.withdrawn_by':response.locals.account.id,'data.withdrawn_at':now,updated_at:now}},{session});
    await db.collection('ipd_admissions').updateOne({tenant_id,id:identity},{$set:{status:'Admitted',updated_at:now}},{session});
    await writeAudit(response,'discharge_withdrawn',identity,session);
  });response.status(204).end();
});
receptionDischarge.get('/discharge-requests',requirePermission('ipd.view'),async(_request,response)=>{
  const requests=await db.collection('role_work_items').find(await scopeFor(response,{workspace:'reception',kind:'ipd_discharge'}),{projection:{_id:0}}).sort({created_at:-1}).toArray(),rows=[];
  for(const request of requests){
    const admission=await db.collection('ipd_admissions').findOne(await scopeFor(response,{id:request.data.admission_id}),{projection:{_id:0}});if(!admission)continue;
    const patient=await db.collection('patients').findOne({tenant_id:admission.tenant_id,id:admission.patient_id}),clearance=await db.collection('role_work_items').findOne({tenant_id:admission.tenant_id,workspace:'nurse',kind:'discharge-clearance','data.discharge_record_id':request.data.discharge_record_id},{sort:{created_at:-1}}),doctor=await db.collection('users').findOne({tenant_id:admission.tenant_id,id:request.created_by});
    const bill=await transaction(async session=>syncAdmissionInvoice(await db.collection('ipd_admissions').findOne({tenant_id:admission.tenant_id,id:admission.id},{session}),session));
    const row={...admission,request_id:request.id,request_status:request.status,requested_at:request.created_at,request_data:request.data,patient_name:patient?`${patient.first_name} ${patient.last_name}`.toUpperCase():'',medical_record_number:patient?.medical_record_number??'',doctor_name:doctor?`${doctor.first_name} ${doctor.last_name}`:'',nursing_clearance:clearance?.status??'Pending',admission_due:bill.due,invoice_due:bill.due};
    for(const [collection,key,label,field] of [['wards','ward_id','ward_name','name'],['rooms','room_id','room_number','room_number'],['beds','bed_id','bed_number','bed_number']])row[label]=admission[key]?(await db.collection(collection).findOne({tenant_id:admission.tenant_id,id:admission[key]}))?.[field]??'':'';
    rows.push(row);
  }
  response.json(rows.sort((a,b)=>Number(b.request_status==='Pending')-Number(a.request_status==='Pending')));
});
receptionDischarge.post('/discharge-requests/:id/complete',requirePermission('ipd.update'),async(request,response)=>{
  const identity=uuid.parse(request.params.id);
  await transaction(async session=>{
    const item=await db.collection('role_work_items').findOne(await scopeFor(response,{id:identity,workspace:'reception',kind:'ipd_discharge'},session),{session});if(!item)throw failure('Discharge request not found.',404);
    if(item.status!=='Pending')throw failure('This discharge request is already processed.');
    const tenant_id=item.tenant_id,admission=await db.collection('ipd_admissions').findOne(await scopeFor(response,{id:item.data.admission_id,active:true,status:'Discharge Requested'},session),{session});if(!admission)throw failure('Active discharge-requested admission not found.');
    const clearance=await db.collection('role_work_items').findOne({tenant_id,workspace:'nurse',kind:'discharge-clearance','data.discharge_record_id':item.data.discharge_record_id},{session});if(clearance?.status!=='Completed')throw failure('Nursing clearance is pending.');
    if(await db.collection('ot_cases').findOne({tenant_id,admission_id:admission.id,status:{$nin:['Completed','Cancelled']}},{session}))throw failure('An OT case is still active. Complete or cancel it before discharge.');
    const food=await db.collection('dietary_orders').find({tenant_id,admission_id:admission.id},{session}).toArray();
    if(food.some(row=>!['Delivered','Cancelled'].includes(row.kitchen_status)))throw failure('Kitchen orders are pending. Deliver or cancel them before discharge.');
    if(food.some(row=>row.delivery_status==='Delivered'&&row.amount>0&&!row.ledger_posted))throw failure('Delivered food charges have not been posted to the ledger.');
    const now=new Date();await db.collection('ipd_bed_stays').updateMany({tenant_id,admission_id:admission.id,ended_at:null},{$set:{ended_at:now}},{session});
    const bill=await syncAdmissionInvoice(admission,session);if(bill.due>0)throw failure(`Bill clearance required. Outstanding amount is INR ${bill.due.toFixed(2)}.`);
    await db.collection('ipd_admissions').updateOne({tenant_id,id:admission.id},{$set:{status:'Discharged',active:false,discharged_at:now,updated_at:now}},{session});
    if(admission.bed_id)await db.collection('beds').updateOne({tenant_id,id:admission.bed_id},{$set:{status:'Cleaning',updated_at:now}},{session});
    await db.collection('role_work_items').updateOne({tenant_id,id:identity},{$set:{status:'Completed','data.accepted_by':response.locals.account.id,'data.accepted_at':now,updated_at:now}},{session});
    await writeAudit(response,'ipd_discharged',admission.id,session,{request_id:identity,invoice_id:bill.id});
  });response.status(204).end();
});
nursingTasks.patch('/nursing-station/tasks/:id',requirePermission('ipd.update'),async(request,response)=>{
  const identity=uuid.parse(request.params.id),body=z.object({status:z.enum(['Completed','Acknowledged','Discontinued']),note:z.string().max(4000).prefault('')}).parse(request.body);
  const row=await transaction(async session=>{
    const item=await db.collection('role_work_items').findOne(await scopeFor(response,{id:identity,workspace:'nurse'},session),{session});if(!item)throw failure('Nursing task not found.',404);
    const admission=await nursingAdmission(response,item.data.admission_id,item.patient_id,session);
    if(!['care-plan','shift-handover','discharge-clearance'].includes(item.kind))throw failure('Use the specific clinical action for this record.');
    if(!['Pending','Acknowledged'].includes(item.status))throw failure('This task is already completed or discontinued.');
    if(item.kind==='discharge-clearance'&&(admission.status!=='Discharge Requested'||body.status==='Discontinued'))throw failure('A pending discharge request is required for nursing clearance.');
    const now=new Date();await db.collection('ipd_admissions').updateOne({tenant_id:item.tenant_id,id:admission.id},{$inc:{clinical_version:1}},{session});
    const updated=await db.collection('role_work_items').findOneAndUpdate({tenant_id:item.tenant_id,id:identity},{$set:{status:body.status,'data.action_note':body.note,'data.action_by':response.locals.account.id,'data.action_at':now,updated_at:now}},{session,returnDocument:'after',projection:{_id:0}});
    await writeAudit(response,'nursing_task_updated',identity,session,{kind:item.kind,status:body.status});return updated;
  });response.json(row);
});
