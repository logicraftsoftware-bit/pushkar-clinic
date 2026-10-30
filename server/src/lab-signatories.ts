type Row=Record<string,any>;
const nameKey=(name:string)=>name.toLowerCase().replace(/^dr[.\s]*/,"").replace(/[^a-z]/g,"").replace(/md$/,"");
export function reportSignatories(approval:Row|null,staff:Row[],legacy:Row[]){
  const approvedIds=new Set((approval?.staff_ids||[]).map(String));
  const old=legacy.filter(row=>approvedIds.has(String(row.data?.legacy_id||row.data?.legacy?.id)));
  const approvedNames=new Set(old.map(row=>nameKey(row.name)));
  const selectedIds=approval?.pathologist_ids?.length?approval.pathologist_ids:approval?.pathologist_id?[approval.pathologist_id]:null;
  const matches=(row:Row)=>Boolean(approval&&(selectedIds?selectedIds.includes(row.id):((approval.by&&row.user_id&&approval.by===row.user_id)||approvedNames.has(nameKey([row.first_name,row.middle_name,row.last_name].filter(Boolean).join(" "))))));
  const result:Row[]=staff.map(row=>({id:row.id,name:[row.first_name,row.middle_name,row.last_name].filter(Boolean).join(" "),qualification:row.professional?.doctor_qualification||"",designation:row.designation||(row.staff_type==="Radiologist"?"Consultant Radiologist":"Consultant Pathologist"),registration_number:row.professional?.medical_registration_number||"",signature:matches(row)?row.professional?.digital_signature||"":"",approved:matches(row)}));
  for(const row of old)if(!result.some(item=>nameKey(item.name)===nameKey(row.name)))result.push({name:row.name,qualification:row.data?.qualification||"",designation:row.data?.designation||"Consultant Pathologist",registration_number:row.data?.registration_number||"",signature:"",approved:true});
  if(approval?.name&&!result.some(row=>row.approved))result.unshift({name:approval.name,qualification:"",designation:approval.staff_type||"Authorised laboratory signatory",registration_number:approval.registration_number||"",signature:"",approved:true});
  return result.sort((a,b)=>Number(b.approved)-Number(a.approved));
}

export function testReportSignatories(approval:Row|undefined,testId:unknown,signatories:Row[]):Row[]{
  const verified=signatories.filter(doctor=>doctor.approved);
  const test=approval?.tests?.[String(testId)];
  if(!test)return verified;
  if(test.pathologist_ids?.length)return verified.filter(doctor=>test.pathologist_ids.includes(doctor.id));
  return verified.filter(doctor=>test.pathologist_names?.includes(doctor.name));
}
