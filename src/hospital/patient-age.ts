type Patient=Record<string,any>;
export function patientAgeParts(patient:Patient){
  const recorded=patient.address||patient.patient_address||{};
  if(recorded.age_years!==undefined&&recorded.age_years!==null&&recorded.age_years!=="")return {years:Number(recorded.age_years),months:Number(recorded.age_months||0),days:Number(recorded.age_days||0)};
  const birth=new Date(String(patient.date_of_birth||patient.patient_date_of_birth||"")),now=new Date();
  if(!Number.isNaN(birth.getTime())&&birth<=now){let years=now.getFullYear()-birth.getFullYear(),months=now.getMonth()-birth.getMonth(),days=now.getDate()-birth.getDate();if(days<0){months--;days+=new Date(now.getFullYear(),now.getMonth(),0).getDate();}if(months<0){years--;months+=12;}return {years,months,days:Math.max(0,days)};}
  return null;
}
export function patientAgeLabel(patient:Patient){
  const age=patientAgeParts(patient);
  if(age)return [age.years||!age.months&&!age.days?`${age.years} years`:"",age.months?`${age.months} months`:"",age.days?`${age.days} days`:""].filter(Boolean).join(" ");
  return String(patient.age||patient.data?.age||"Not recorded");
}
