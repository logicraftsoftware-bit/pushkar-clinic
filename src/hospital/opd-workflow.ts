export function hospitalClock(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
export function recentRegistrationGroups<T extends {id:string;created_at?:string}>(patients:T[],limit=100){
 const sorted=patients.filter(p=>p.created_at&&!Number.isNaN(Date.parse(p.created_at))).sort((a,b)=>Date.parse(b.created_at!)-Date.parse(a.created_at!)||a.id.localeCompare(b.id)).slice(0,limit);
 const groups=new Map<string,T[]>();for(const patient of sorted){const date=hospitalClock(new Date(patient.created_at!)).date;groups.set(date,[...(groups.get(date)||[]),patient]);}return [...groups].map(([date,patients])=>({date,patients}));
}
export function currentAvailableSlot(slots:Array<{time:string}>,date:string,now=new Date()){
 const clock=hospitalClock(now);if(date<clock.date)return '';return [...slots].sort((a,b)=>a.time.localeCompare(b.time)).find(slot=>date>clock.date||slot.time.slice(0,5)>clock.time&&Number(slot.time.slice(3,5))%5===0)?.time||'';
}
