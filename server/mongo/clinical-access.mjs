import {db} from './database.mjs';
import {scopeFor} from './access.mjs';
const failure=(message,status=403)=>Object.assign(new Error(message),{status});
export async function nursingAdmission(response,admissionId,patientId,session){
  const account=response.locals.account;
  if(!['nurse','hospital_admin'].includes(account.role))throw failure('Nursing workspace access required.');
  const admission=await db.collection('ipd_admissions').findOne(await scopeFor(response,{id:admissionId,active:true,...(patientId?{patient_id:patientId}:{})},session),{session});
  if(!admission)throw failure('Active admission not found in an authorized branch.',404);
  if(account.role!=='hospital_admin'){
    const staff=await db.collection('staff_members').findOne({tenant_id:account.tenant_id,user_id:account.id,staff_type:'Nurse',status:'Active'},{session});
    if(!staff||!admission.ward_id||staff.professional?.ward_assignment!==admission.ward_id)throw failure('Patient is not in your assigned ward.');
  }
  return admission;
}
export async function doctorAdmission(response,identity,session){
  const account=response.locals.account;
  if(!['doctor','hospital_admin'].includes(account.role))throw failure('Doctor workspace access required.');
  const row=await db.collection('ipd_admissions').findOne(await scopeFor(response,{id:identity,active:true,...(account.role==='doctor'?{consultant_doctor_id:account.id}:{})},session),{session});
  if(!row)throw failure('Active admission not found in your clinical assignments.',404);
  return row;
}
