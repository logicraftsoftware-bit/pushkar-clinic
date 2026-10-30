                            
export function upcomingDoctorSlots                         (slots    ,date       ,now=new Date())    {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(part=>[part.type,part.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`,time=`${parts.hour}:${parts.minute}`;
  if(date<today)return [];
  return date>today?slots:slots.filter(slot=>slot.time.slice(0,5)>time);
}
export function scheduleDate(value        ){const raw=String(value??'');if(/^\d{2}-\d{2}-\d{4}$/.test(raw)){const [day,month,year]=raw.split('-');return `${year}-${month}-${day}`;}return raw.slice(0,10);}
export function doctorDay(schedule      ,recurring                   ,date       ,unavailable          =[])              {
  const selected=scheduleDate(date);
  if(unavailable.some(value=>scheduleDate(value)===selected))return undefined;
  const dated=schedule.find(item=>scheduleDate(item.appointment_date)===selected);
  if(dated)return dated;
  if(recurring&&(!recurring.start_date||selected>=scheduleDate(recurring.start_date))&&(!recurring.end_date||selected<=scheduleDate(recurring.end_date)))return {...recurring,appointment_date:selected};
  return undefined;
}
const minutes=(value       )=>{const [hour=0,minute=0]=String(value).slice(0,5).split(':').map(Number);return hour*60+minute;};
export function doctorSlots(day    ,duration=20,maximum=0)                                   {
  const start=minutes(day.from_time),end=minutes(day.to_time),limit=Math.max(1,Number(day.max_slots||maximum)||9999),result=[];
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return [];
  const count=day.slot_mode==='capacity'?Math.min(limit,end-start):Math.min(limit,Math.ceil((end-start)/Math.max(1,duration)));
  for(let index=0;index<count;index++){const point=day.slot_mode==='capacity'?start+Math.floor(index*(end-start)/count):start+index*Math.max(1,duration);if(point>=end)break;result.push({time:`${String(Math.floor(point/60)).padStart(2,'0')}:${String(point%60).padStart(2,'0')}`,serial:index+1});}
  return result;
}
export function availableDoctorSlots(slots                                   ,bookings                                                          ){
  const times=new Set(bookings.map(row=>String(row.appointment_time).slice(0,5))),serials=new Set(bookings.map(row=>Number(row.slot_serial)).filter(value=>value>0));
  return slots.filter(slot=>!times.has(slot.time)&&!serials.has(slot.serial)).slice(0,Math.max(0,slots.length-bookings.length));
}

export function fiveMinuteDoctorSlots(day    )                                   {
 const result=[];for(let point=Math.ceil(minutes(day.from_time)/5)*5;point<minutes(day.to_time);point+=5)result.push({time:String(Math.floor(point/60)).padStart(2,'0')+':'+String(point%60).padStart(2,'0'),serial:result.length+1});return result;
}
