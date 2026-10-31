import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {permissionsFor,scopeFor,assertBranch,writeAudit} from './access.mjs';
const router=Router();
const fail=(message,status=403)=>Object.assign(new Error(message),{status});
const noteTypes={notifications:{workspace:'reception',permission:'menu.notifications.view'},'device integration':{workspace:'laboratory',permission:'lab.result.verify'},recruitment:{workspace:'hr',permission:'hr.manage'}};
async function noteAccess(response,kind,session){const rule=noteTypes[kind.toLowerCase()],permissions=await permissionsFor(response.locals.account,session);if(!rule||!permissions.includes('*')&&!permissions.includes(rule.permission))throw fail('Use the dedicated clinical, stock or billing workflow for this record.');return rule;}
router.post('/work-items',async(request,response)=>{
  const body=z.object({kind:z.string().trim().min(1).max(100),title:z.string().trim().min(1).max(200),patient_id:z.string().uuid().nullable().optional(),status:z.literal('Pending').prefault('Pending'),priority:z.enum(['Normal','High','Urgent']).prefault('Normal'),data:z.object({details:z.string().trim().max(10000).prefault('')}).prefault({details:''})}).parse(request.body);
  const result=await transaction(async session=>{const rule=await noteAccess(response,body.kind,session),account=response.locals.account;await assertBranch(response,account.branch_id,session);if(body.patient_id){const permissions=await permissionsFor(account,session);if(!permissions.includes('*')&&!permissions.includes('patient.view'))throw fail('Patient access required.');if(!await db.collection('patients').findOne(await scopeFor(response,{id:body.patient_id,deleted_at:null},session),{session}))throw fail('Patient unavailable.',404);}const now=new Date(),row={...body,id:randomUUID(),tenant_id:account.tenant_id,branch_id:account.branch_id,workspace:rule.workspace,created_by:account.id,occurred_at:now,created_at:now,updated_at:now};await db.collection('role_work_items').insertOne({...row},{session});await writeAudit(response,'workspace_note_created',row.id,session,{kind:row.kind});return row;});response.status(201).json(result);
});
router.patch('/work-items/:id',async(request,response)=>{
  const id=z.string().uuid().parse(request.params.id),body=z.object({status:z.enum(['Pending','Completed']),data:z.object({details:z.string().trim().max(10000)}).optional()}).parse(request.body);
  const row=await transaction(async session=>{const old=await db.collection('role_work_items').findOne(await scopeFor(response,{id},session),{session});if(!old)throw fail('Work item not found.',404);const rule=await noteAccess(response,old.kind,session);if(rule.workspace!==old.workspace)throw fail('Use the dedicated workflow for this record.',409);const permissions=await permissionsFor(response.locals.account,session);if(old.created_by!==response.locals.account.id&&!permissions.includes('*')&&!permissions.includes('hr.manage')&&!permissions.includes('lab.result.verify'))throw fail('Only the note owner can update this record.');const result=await db.collection('role_work_items').findOneAndUpdate({tenant_id:old.tenant_id,id},{$set:{status:body.status,data:{...old.data,...body.data},updated_at:new Date()}},{session,returnDocument:'after',projection:{_id:0}});await writeAudit(response,'workspace_note_updated',id,session);return result;});response.json(row);
});
router.get('/overview',async(_request,response)=>{
  const account=response.locals.account,permissions=await permissionsFor(account),can=code=>permissions.includes('*')||permissions.includes(code);
  const workspace=({receptionist:'reception',nurse:'nurse',laboratory:'laboratory',lab_manager:'laboratory',radiology:'laboratory',radiologist:'laboratory',pharmacist:'pharmacy',pharmacy_manager:'pharmacy',patient:'patient',hospital_admin:'all',accountant:'accounting',hr:'hr',hr_manager:'hr',branch_admin:'branch',inventory_manager:'inventory'})[response.locals.claims.portal]??account.role;
  const patientPortal=account.role==='patient';
  let patientId=null;
  if(patientPortal){
    // Contact information alone is not proof of access to a medical record.
    if(account.patient_id){const linked=await db.collection('patients').findOne(await scopeFor(response,{id:account.patient_id,deleted_at:null}),{projection:{id:1}});patientId=linked?.id??null;}
  }
  let clinicalFilter={};
  if(account.role==='nurse'){
    const nurse=await db.collection('staff_members').findOne({tenant_id:account.tenant_id,user_id:account.id,staff_type:'Nurse',status:'Active'});
    const assigned=await db.collection('ipd_admissions').find(await scopeFor(response,{active:true,ward_id:nurse?.professional?.ward_assignment??'unassigned'}),{projection:{patient_id:1}}).toArray();
    clinicalFilter={patient_id:{$in:assigned.map(row=>row.patient_id)}};
  }else if(account.role==='doctor'){
    const appointments=await db.collection('clinical_appointments').find(await scopeFor(response,{doctor_id:account.id}),{projection:{patient_id:1}}).toArray();
    const admissions=await db.collection('ipd_admissions').find(await scopeFor(response,{consultant_doctor_id:account.id}),{projection:{patient_id:1}}).toArray();
    clinicalFilter={patient_id:{$in:[...appointments,...admissions].map(row=>row.patient_id)}};
  }
  if(patientPortal)clinicalFilter={patient_id:patientId??'not-linked'};
  const rows=async(collection,enabled,filter,sort,limit=100)=>enabled?db.collection(collection).find(await scopeFor(response,filter),{projection:{_id:0}}).sort(sort).limit(limit).toArray():[];
  const patientFilter=patientPortal?{id:patientId??'not-linked'}:clinicalFilter.patient_id?{id:clinicalFilter.patient_id}:{};
  const patients=await rows('patients',can('patient.view')||patientPortal,{...patientFilter,deleted_at:null},{created_at:-1});
  const appointments=await rows('clinical_appointments',can('appointment.view')||patientPortal,clinicalFilter,{appointment_date:-1,appointment_time:-1});
  const admissions=await rows('ipd_admissions',can('ipd.view')||patientPortal,clinicalFilter,{admitted_at:-1});
  const finances=await rows('finance_records',can('billing.view')||patientPortal,{...clinicalFilter,...(patientPortal?{kind:{$in:['invoices','pharmacy-bill','payments','refunds']}}:{})},{created_at:-1});
  const inventory=await rows('inventory_records',can('inventory.view')&&!patientPortal,{}, {updated_at:-1});
  // Patient-facing clinical publication is handled by its dedicated record endpoints.
  // Do not include raw laboratory drafts or nursing handovers in this shared response.
  const workspaces=workspace==='all'?['reception','nurse','laboratory','pharmacy','accounting','hr','inventory']:workspace==='branch'?['reception','inventory']:['reception','laboratory','pharmacy','accounting','hr','inventory'].includes(workspace)?[workspace]:[];
  const permittedWorkspaces=workspaces.filter(value=>({reception:can('patient.view'),nurse:can('ipd.view'),laboratory:can('lab.order.view'),pharmacy:can('pharmacy.view'),accounting:can('billing.view'),hr:can('hr.view'),inventory:can('inventory.view')})[value]);
  const workItems=await rows('role_work_items',!patientPortal&&permittedWorkspaces.length>0,{...clinicalFilter,workspace:{$in:permittedWorkspaces}}, {occurred_at:-1},150);
  if(patientPortal&&patientId){
    const published=await rows('doctor_clinical_records',true,{patient_id:patientId,$or:[{record_type:'consultation','data.encounter_status':'Completed'},{record_type:'discharge_summary','data.document_status':'Finalized'}]},{created_at:-1});
    for(const record of published)workItems.push({...record,kind:record.record_type,title:record.record_type==='consultation'?'Completed Consultation':'Discharge Summary',status:'Published',occurred_at:record.created_at});
    const reports=await rows('role_work_items',true,{patient_id:patientId,workspace:'laboratory','data.doctor_approval':{$type:'object'},status:{$nin:['Cancelled','Rejected']}},{occurred_at:-1});
    for(const report of reports){
      const bill=await db.collection('finance_records').findOne({tenant_id:account.tenant_id,id:report.data.bill_id,kind:'invoices',status:'Paid',due:0});
      if(!bill||Number(bill.paid)<Number(bill.total))continue;
      const approved=new Set(report.data.doctor_approval?.test_ids??[]);if(!approved.size)continue;
      workItems.push({id:report.id,workspace:'laboratory',kind:'reports',title:report.title,status:'Published',patient_id:patientId,occurred_at:report.occurred_at,data:{tests:(report.data.tests??[]).filter(test=>approved.has(test.test_id)),lab_results:(report.data.lab_results??[]).filter(test=>approved.has(test.test_id)),result_status:report.data.result_status,doctor_approval:report.data.doctor_approval,bill_number:report.data.bill_number}});
    }
  }
  const patientById=new Map(patients.map(row=>[row.id,row]));
  for(const row of [...appointments,...admissions,...finances,...workItems]){
    const patient=patientById.get(row.patient_id);
    row.patient_name=patient?`${patient.first_name??''} ${patient.last_name??''}`.trim():row.data?.customer_name??'';
    row.medical_record_number=patient?.medical_record_number??row.data?.medical_record_number??'';
  }
  const publicPatients=patients.map(row=>({id:row.id,medical_record_number:row.medical_record_number,patient_name:`${row.first_name??''} ${row.last_name??''}`.trim(),phone:row.phone,blood_group:row.blood_group,status:row.status}));
  const today=new Date().toISOString().slice(0,10);
  response.json({workspace,patientLinked:!patientPortal||Boolean(patientId),patients:publicPatients,appointments,admissions,finances,inventory,workItems,metrics:{patients:patients.length,appointments:appointments.filter(row=>String(row.appointment_date).slice(0,10)===today).length,waiting:appointments.filter(row=>['waiting','booked','checked in'].includes(String(row.status).toLowerCase())).length,admissions:admissions.filter(row=>row.active===true).length,pending:workItems.filter(row=>!['completed','verified','dispensed'].includes(String(row.status).toLowerCase())).length}});
});
export default router;
