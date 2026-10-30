import {doctorKey} from './doctor-fee-import-plan.js';
type Row=Record<string,any>;
export function doctorWithQualification(name:unknown,qualification:unknown):string {
 const doctor=String(name??'').trim(),degree=String(qualification??'').trim();
 if(!doctor||/^(self|unassigned|not applicable|-|\u2014)$/i.test(doctor)||!degree||/^(not specified|not available|n\/?a|-|\u2014)$/i.test(degree))return doctor;
 if(doctor.toLowerCase().endsWith(`(${degree.toLowerCase()})`))return doctor;
 return `${doctor} (${degree})`;
}

export function resolvePrintDoctor(row:Row,doctors:Row[],referral=false):Row {
 const data={...row.invoice_data,...row.data,...row.accounting_lab_data};
 const name=referral?(row.referred_by_name||data.referred_by_name||data.referring_doctor_name||data.referred_by||data.doctor_name):(row.doctor_name||row.accounting_doctor_name||data.doctor_name);
 if(/^(self|unassigned|not applicable)$/i.test(String(name||'').trim()))return {};
 const id=referral?(row.referred_by_id||data.referred_by_id):(row.doctor_id||row.consultant_doctor_id||row.accounting_doctor_id||data.doctor_id);
 let matches=id?doctors.filter(doctor=>doctor.id===id||doctor.user_id===id):[];
 if(!matches.length&&name)matches=doctors.filter(doctor=>[doctor.name,doctor.user_name].some(value=>doctorKey(String(value||''))===doctorKey(String(name))));
 if(matches.length>1&&row.department_id){const scoped=matches.filter(doctor=>(doctor.professional?.branch_fees?.[row.branch_id]?.department_id||doctor.department_id)===row.department_id);if(scoped.length)matches=scoped;}
 const degrees=[...new Set(matches.map(doctor=>String(doctor.professional?.doctor_qualification||'').trim()).filter(Boolean))];
 return {name:name||matches[0]?.name||'',qualification:degrees.length===1?degrees[0]:''};
}
export function addPrintDoctorDetails(row:Row,doctors:Row[]):Row {
 const doctor=resolvePrintDoctor(row,doctors),referral=resolvePrintDoctor(row,doctors,true);
 return {...row,referred_by_name:row.referred_by_name||referral.name,doctor_name:row.doctor_name||doctor.name,doctor_qualification:doctor.qualification||row.doctor_qualification||row.data?.doctor_qualification||'',referred_by_qualification:referral.qualification||row.referred_by_qualification||row.data?.referred_by_qualification||''};
}
