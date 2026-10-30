export type DoctorFeeSource={branch:"hatigaon"|"main";source:string;row:number;name:string;consultation_fee:string;registration_fee:string;maintenance_fee:string;department:string};
type Row=Record<string,any>;
export function doctorName(name:string){
  return name.split(",")[0]!.replace(/\((?!gyne\b)[^)]*\)/gi," ").replace(/\b(prof|professor|dr)\b\.?/gi," ").replace(/\(gyne\)/gi," ").replace(/\s+/g," ").trim();
}
export function doctorKey(name:string){return doctorName(name).toLowerCase().replace(/[^a-z0-9]/g,"");}
export function departmentKey(name:string){
  const key=name.replace(/\\u0026/g,"&").toLowerCase().replace(/[^a-z]/g,"");
  return ({orthopaedics:"orthopedics",gynaecology:"gynecology",gynaecologist:"gynecology",obstetricsgynaecology:"gynecology",obstetricsgynecology:"gynecology",internalmedicine:"medicine",generalmedicine:"medicine",psychaitry:"psychiatry",rheaumatology:"rheumatology",dermatalogy:"dermatology",gastrology:"gastroenterology",pulmonary:"pulmonology",pediatric:"pediatrics",neurosurgeon:"neurosurgery",generalsurgeon:"surgery"} as Record<string,string>)[key]||key;
}
export function consultationFee(raw:string):number|null{
  const clean=raw.replace(/,/g,"").trim();
  return /^\d+(\.\d{1,2})?$/.test(clean)?Number(clean):null;
}
export function planDoctorFeeImport(sources:DoctorFeeSource[],staff:Row[]){
  // Explicit spelling/initial variants found in this hospital's existing roster.
  const aliases:Record<string,string[]>={
    amitabhsarmah:["amitabhsharma"],deepanavajyotidas:["deepanavajdas"],dhrubajyotisarma:["dhrubajyotisharma"],
    mkmazumdar:["mkmazumder"],nayanasarma:["nayanasharma"],yubarajabhuyan:["yubrajabhuyan"],
    amlanjyotideb:["amlanjdeb"],anjanjyotitalukdar:["anjanjtalukdar"],khurshidahmed:["khursidahmed"],
    moitreyeekalita:["moitryeekalita"],njbora:["njborah"],neelavsarma:["neelavsharma"],ppbarua:["ppbaruah"],
    reeshavkankansarmah:["reeshavkangkansharma"],ronidharkakoti:["ronidharkakoty"],
  };
  const groups=new Map<string,DoctorFeeSource[]>();
  for(const source of sources){
    if(!["hatigaon","main"].includes(source.branch)||!doctorKey(source.name))throw new Error("Invalid doctor source row");
    const key=doctorKey(source.name)+(/\(gyne\)/i.test(source.name)?":gyne":"");
    groups.set(key,[...(groups.get(key)||[]),source]);
  }
  return [...groups].map(([key,entries])=>{
    const base=doctorKey(entries[0]!.name),hasVariants=[...groups.keys()].some(other=>other!==key&&other.split(":")[0]===base);
    let candidates=staff.filter(doctor=>doctorKey(doctor.name)===base);
    if(!candidates.length)candidates=staff.filter(doctor=>(aliases[base]||[]).includes(doctorKey(doctor.name)));
    if(hasVariants)candidates=candidates.filter(doctor=>entries.some(entry=>entry.department&&departmentKey(entry.department)===departmentKey(doctor.department||doctor.professional?.specialization||"")));
    return {key,entries,existing:candidates[0]||null,existingMatches:candidates,action:candidates.length?"update":"add",reason:""};
  });
}
