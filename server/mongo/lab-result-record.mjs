import {createHash} from 'node:crypto';
import {db} from './database.mjs';
import {laboratoryReference} from './lab-clinical.mjs';
import {patientAgeDays} from './patient-age.mjs';
import {normalizeLabResultFormats} from './lab-result-format.mjs';
import {approvedLabTestIds,labTestHasResults} from './lab-result-completion.mjs';
import {reportSignatories} from './lab-signatories.mjs';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const nextTimestamp=previous=>new Date(Math.max(Date.now(),new Date(previous).getTime()+1));
export function reportRevision(data){return digest({tests:data.tests,results:data.lab_results,approval:data.doctor_approval,technician:data.technician_approval,entry:data.result_entry,signatories:data.approved_signatories});}
export async function resultRecord(row,session){
  const tenant_id=row.tenant_id,ordered=row.data.tests??[],saved=row.data.lab_results??[],approved=new Set(approvedLabTestIds(row.data));
  const patient=await db.collection('patients').findOne({tenant_id,id:row.patient_id},{session});
  const masters=await db.collection('hospital_diagnostic_masters').find({tenant_id,domain:'pathology',kind:'test',id:{$in:ordered.map(test=>test.test_id)}},{session}).toArray();
  const parameterIds=[...new Set([...masters.flatMap(master=>master.data.parameter_ids??[]),...saved.flatMap(test=>(test.parameters??[]).map(parameter=>parameter.parameter_id).filter(Boolean))])];
  const parameters=await db.collection('hospital_diagnostic_masters').find({tenant_id,domain:'pathology',kind:'parameter',id:{$in:parameterIds}},{session}).toArray();
  const definitions=await db.collection('hospital_diagnostic_masters').find({tenant_id,domain:'pathology',kind:{$in:['unit','specimen']}},{session,projection:{id:1,name:1,kind:1}}).toArray();
  const collection=new Date(row.data.collected_at??row.occurred_at),birth=patient?.date_of_birth?new Date(patient.date_of_birth):null;
  const age=patientAgeDays(patient?.address,collection)??(birth&&Number.isFinite(birth.getTime())?Math.floor((collection.getTime()-birth.getTime())/86400000):null);
  const tests=ordered.map(orderedTest=>{
    const old=saved.find(test=>test.test_id===orderedTest.test_id),master=masters.find(test=>test.id===orderedTest.test_id);
    // Signed values, units and reference intervals remain the reviewed snapshot.
    if(old&&(approved.has(orderedTest.test_id)||labTestHasResults(old)))return structuredClone(old);
    const ids=[...new Set([...(master?.data.parameter_ids??[]),...(old?.parameters??[]).map(parameter=>parameter.parameter_id).filter(Boolean)])];
    const resultParameters=ids.map(parameterId=>{
      const definition=parameters.find(item=>item.id===parameterId),prior=old?.parameters?.find(item=>item.parameter_id===parameterId),data=definition?.data??{};
      if(!definition&&prior)return structuredClone(prior);
      const reference=laboratoryReference(data.normal_ranges??[],patient?.sex??row.data.gender??'',age);
      return {parameter_id:parameterId,name:definition?.name??prior?.name??'Parameter',...reference,reference_from:reference.reference_from||data.reference_from||'',reference_to:reference.reference_to||data.reference_to||'',
        unit:definitions.find(item=>item.id===data.unit_id)?.name??'',specimen:definitions.find(item=>item.id===data.specimen_id)?.name??'',method:data.method??'',description:data.description??'',
        result_type_id:String(data.result_type_id??'3'),choices:data.choices??[],formula:data.formula??'',legacy_id:data.legacy_id,decimals:data.decimals,value:String(prior?.value??''),remarks:String(prior?.remarks??'')};
    });
    if(!resultParameters.length)resultParameters.push({parameter_id:null,name:orderedTest.test_type==='Radiology'?'Findings / Impression':'Overall Result',result_type_id:orderedTest.test_type==='Radiology'?'27':'3',reference_from:'',reference_to:'',unit:'',description:'',value:String(old?.parameters?.[0]?.value??''),remarks:String(old?.parameters?.[0]?.remarks??'')});
    const specimenIds=master?.data.specimen_ids??(master?.data.specimen_id?[master.data.specimen_id]:[]);
    return {test_id:orderedTest.test_id,name:orderedTest.name,specimen_names:specimenIds.map(id=>definitions.find(item=>item.id===id)?.name).filter(Boolean),parameters:resultParameters,notes:master?.data.notes??'',summaries:master?.data.summaries??[]};
  });
  const normalized=normalizeLabResultFormats(tests);
  const definition_revision=digest(normalized.map(test=>({...test,parameters:test.parameters.map(({value,remarks,...definition})=>definition)})));
  const profiles=await db.collection('staff_members').find({tenant_id,staff_type:{$in:['Pathologist','Radiologist']},status:'Active'},{session}).toArray();
  const signerIds=new Set([...approved].flatMap(id=>row.data.doctor_approval?.tests?.[id]?.pathologist_ids??row.data.doctor_approval?.pathologist_ids??[]));
  let signatories=reportSignatories(row.data.doctor_approval?{...row.data.doctor_approval,pathologist_ids:[...signerIds]}:null,profiles,[]);
  signatories=signatories.map(profile=>profile.approved&&row.data.approved_signatories?.[profile.id]?{...row.data.approved_signatories[profile.id],approved:true}:profile);
  for(const id of signerIds)if(!signatories.some(profile=>profile.id===id)&&row.data.approved_signatories?.[id])signatories.push({...row.data.approved_signatories[id],approved:true});
  const bill=row.data.bill_id?await db.collection('finance_records').findOne({tenant_id,id:row.data.bill_id},{session,projection:{_id:0}}):null;
  const hospital=await db.collection('hospitals').findOne({id:tenant_id},{session}),branch=await db.collection('branches').findOne({tenant_id,id:row.branch_id},{session});
  const template=await db.collection('hospital_print_templates').findOne({tenant_id,document_type:'pathology'},{session});
  const prints=await db.collection('report_print_events').find({tenant_id,order_id:row.id,revision:reportRevision(row.data)},{session,projection:{_id:0}}).sort({created_at:-1}).toArray();
  const {_id,...safe}=row;
  return {...safe,definition_revision,report_revision:reportRevision(row.data),tests:normalized,patient_name:patient?`${patient.first_name} ${patient.last_name}`:row.data.customer_name,
    medical_record_number:patient?.medical_record_number??row.data.medical_record_number,patient_gender:patient?.sex??row.data.gender??'',patient_date_of_birth:patient?.date_of_birth??null,patient_address:patient?.address??{},patient_phone:patient?.phone??row.data.phone??'',
    hospital_name:hospital?.name??'',hospital_logo:hospital?.logo_url??'',branch_name:branch?.name??'',hospital_address:hospital?.address_line??'',hospital_city:hospital?.city??'',hospital_state:hospital?.state??'',hospital_pin_code:hospital?.pin_code??'',hospital_phone:hospital?.phone??'',hospital_email:hospital?.email??'',
    pathology_header_image:template?.header_image??'',pathology_footer_content:template?.footer_content??'',report_bill:bill,bill_number:bill?.record_number??'',report_signatories:signatories,report_prints:prints};
}
