import {consultationFee,departmentKey,doctorKey,doctorName,planDoctorFeeImport} from './doctor-fee-import-plan.js';

export type DoctorListRow={row:number;name:string;department:string;fee:string;qualification?:string;registration_fee?:number;maintenance_fee?:number};
export type ConflictPolicy='skip'|'first'|'last';
export type ExistingDoctor=Record<string,any>;
export function listDoctorName(name:string){
  return doctorName(name).replace(/\b(mrs|ms)\.?\s*/gi,' ')
    .replace(/\s+(?:MBBS|MD|SENIOR CONSULT).*$/i,'').replace(/[.]+$/,'').replace(/\s+/g,' ').trim();
}
export function listDepartmentKey(name:string){
  const key=departmentKey(name);
  return ({neuropsychiatry:'psychiatry',obstericsgynaecology:'gynecology',orthopaedicsurgery:'orthopedics',paediatrics:'pediatrics',
    gastroclinic:'gastroenterology',cardiacclinic:'cardiology',neuroclinic:'neurology',
    pulmonarymedicine:'pulmonology',respiratorymedicine:'pulmonology',consultantrheumatology:'rheumatology',
    plasticsurgeon:'plasticsurgery'} as Record<string,string>)[key]||key;
}
function nearName(a:string,b:string){
  if(a.length<7||b.length<7||Math.abs(a.length-b.length)>2)return false;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]!+1,prev[j]!+1,prev[j-1]!+(a[i-1]===b[j-1]?0:1));prev=next;}
  return prev[b.length]!<=2;
}
export function planDoctorList(rows:DoctorListRow[],staff:ExistingDoctor[],policy:ConflictPolicy){
  const excluded=rows.filter(row=>/^(ALLERGIC SKIN PRICK TEST|CONSULTANT HEMATOLOGIST|EAR CLEANING|ENDOSCOPY AND CLEANING|PRINCIPAL CONSULTANT)/i.test(row.name.trim())||/PROCEDURE CHARGE/i.test(row.name));
  const groups=new Map<string,DoctorListRow[]>();
  for(const row of rows){
    if(excluded.includes(row))continue;
    const key=doctorKey(listDoctorName(row.name))+(/\(gyne\)/i.test(row.name)?':gyne':'');
    if(!key)throw new Error(`Missing doctor name at row ${row.row}`);
    groups.set(key,[...(groups.get(key)||[]),row]);
  }
  const review:{key:string;reason:string;rows:DoctorListRow[];candidates?:string[]}[]=[];
  const ready:{key:string;source:DoctorListRow;rows:DoctorListRow[];matches:ExistingDoctor[]}[]=[];
  for(const [key,entries] of groups){
    const conflict=new Set(entries.map(row=>`${consultationFee(row.fee)}:${listDepartmentKey(row.department)}`)).size>1;
    if(conflict&&policy==='skip'){review.push({key,reason:'Conflicting Excel fees or departments',rows:entries});continue;}
    const source=(policy==='last'?entries.at(-1):entries[0])!;
    if(consultationFee(source.fee)===null||!source.department.trim()){review.push({key,reason:'Missing or invalid fee/department',rows:entries});continue;}
    const name=listDoctorName(source.name);
    const normalStaff=staff.map(row=>({...row,name:listDoctorName(row.name)}));
    const oldPlan=planDoctorFeeImport([{branch:'main',source:'Doctor List.xlsx',row:source.row,name,department:source.department,consultation_fee:source.fee,registration_fee:'',maintenance_fee:''}],normalStaff)[0]!;
    let matches=oldPlan.existingMatches;
    // Distinguish the two Jyotirmoy Das specialties even when punctuation differs.
    if(key.startsWith('jyotirmoydas'))matches=matches.filter(row=>listDepartmentKey(row.department||row.professional?.specialization||'')===listDepartmentKey(source.department));
    if(matches.some(row=>row.status!=='Active')){review.push({key,reason:'Existing inactive doctor requires review',rows:entries,candidates:matches.map(row=>row.id)});continue;}
    const specialties=new Set(matches.map(row=>listDepartmentKey(row.department||row.professional?.specialization||'' )).filter(Boolean));
    // This final roster explicitly combines N. J. Bora's existing Medicine and Diabetes entries.
    const combinedBora=key==='njbora'&&listDepartmentKey(source.department)==='physiciananddiabetesconsultant'&&[...specialties].every(specialty=>['medicine','diabetes','physiciananddiabetesconsultant'].includes(specialty));
    if(specialties.size>1&&!combinedBora){
      const candidates=matches.map(row=>`${row.name} [${row.id}]: ${row.department||row.professional?.specialization||'Unassigned'}`);
      matches=matches.filter(row=>listDepartmentKey(row.department||row.professional?.specialization||'')===listDepartmentKey(source.department));
      if(!matches.length){review.push({key,reason:'Multiple existing identities with different departments',rows:entries,candidates});continue;}
    }
    if(!matches.length){
      const candidates=normalStaff.filter(row=>nearName(doctorKey(name),doctorKey(row.name)));
      const sourceVariants=[...groups].filter(([otherKey])=>otherKey!==key&&!otherKey.startsWith('jyotirmoydas')).filter(([,other])=>nearName(doctorKey(name),doctorKey(listDoctorName(other[0]!.name))));
      if(candidates.length||sourceVariants.length){review.push({key,reason:'Possible spelling variant; no duplicate created',rows:entries,candidates:[...candidates.map(row=>row.name),...sourceVariants.map(([,other])=>other[0]!.name)]});continue;}
    }
    ready.push({key,source:{...source,name},rows:entries,matches});
  }
  // A single staff identity must not receive two competing source updates.
  const owners=new Map<string,string[]>();
  for(const item of ready)for(const match of item.matches)owners.set(match.id,[...(owners.get(match.id)||[]),item.key]);
  const safe=ready.filter(item=>{
    if(!item.matches.some(match=>(owners.get(match.id)||[]).length>1))return true;
    review.push({key:item.key,reason:'Multiple Excel identities match the same existing doctor',rows:item.rows});return false;
  });
  return {ready:safe,review,excluded};
}
