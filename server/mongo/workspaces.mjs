import {Router} from 'express';
import {db} from './database.mjs';
import {permissionsFor,scopeFor} from './access.mjs';
const router=Router();
router.get('/overview',async(_request,response)=>{
  const account=response.locals.account,permissions=await permissionsFor(account),can=code=>permissions.includes('*')||permissions.includes(code);
  const workspace=({receptionist:'reception',nurse:'nurse',laboratory:'laboratory',radiology:'laboratory',pharmacist:'pharmacy',patient:'patient',hospital_admin:'all',accountant:'accounting',hr:'hr',hr_manager:'hr',branch_admin:'branch',inventory_manager:'inventory'})[response.locals.claims.portal]??account.role;
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
  const finances=await rows('finance_records',can('billing.view')||patientPortal,clinicalFilter,{created_at:-1});
  const inventory=await rows('inventory_records',can('inventory.view')&&!patientPortal,{}, {updated_at:-1});
  // Patient-facing clinical publication is handled by its dedicated record endpoints.
  // Do not include raw laboratory drafts or nursing handovers in this shared response.
  const workspaces=workspace==='all'?['reception','nurse','laboratory','pharmacy','accounting','hr','inventory']:workspace==='branch'?['reception','inventory']:['reception','laboratory','pharmacy','accounting','hr','inventory'].includes(workspace)?[workspace]:[];
  const permittedWorkspaces=workspaces.filter(value=>({reception:can('patient.view'),nurse:can('ipd.view'),laboratory:can('lab.order.view'),pharmacy:can('pharmacy.view'),accounting:can('billing.view'),hr:can('hr.view'),inventory:can('inventory.view')})[value]);
  const workItems=await rows('role_work_items',!patientPortal&&permittedWorkspaces.length>0,{...clinicalFilter,workspace:{$in:permittedWorkspaces}}, {occurred_at:-1},150);
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
