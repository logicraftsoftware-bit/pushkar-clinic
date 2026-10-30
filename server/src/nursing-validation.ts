import {z} from 'zod';

// Broad data-entry limits, not normal ranges or clinical decision thresholds.
// Units follow https://hl7.org/fhir/observation-vitalsigns.html.
export const vitalLimits = {
  temperature: {min:25,max:45,label:'Temperature °C'},
  pulse: {min:1,max:350,label:'Pulse /min'},
  systolic: {min:20,max:350,label:'Systolic BP mmHg'},
  diastolic: {min:10,max:250,label:'Diastolic BP mmHg'},
  spo2: {min:1,max:100,label:'SpO₂ %'},
  respiratory_rate: {min:1,max:100,label:'Respirations /min'},
  pain_score: {min:0,max:10,label:'Pain score'},
} as const;

const vitalNumber=(key:keyof typeof vitalLimits)=>{
  const {min,max,label}=vitalLimits[key];
  return z.union([z.number(),z.string().trim().min(1)])
    .transform(Number).pipe(z.number().finite().min(min,`${label} must be at least ${min}`).max(max,`${label} must be at most ${max}`));
};
export const nursingVitals=z.object({
  temperature:vitalNumber('temperature'),pulse:vitalNumber('pulse'),
  systolic:vitalNumber('systolic'),diastolic:vitalNumber('diastolic'),
  spo2:vitalNumber('spo2'),respiratory_rate:vitalNumber('respiratory_rate'),pain_score:vitalNumber('pain_score'),
}).superRefine((data,ctx)=>{
  if(data.diastolic>=data.systolic)ctx.addIssue({code:'custom',path:['diastolic'],message:'Diastolic BP must be below systolic BP'});
});

export function hospitalDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function medicationScheduleError(body:{first_due_at:string;start_date?:string;end_date?:string},now=new Date()){
  // Accept an explicit offset only: datetime-local values must be converted by the client.
  const due=z.string().datetime({offset:true}).safeParse(body.first_due_at);
  if(!due.success)return 'First due time must be a valid date/time with a timezone.';
  // Minute precision matches the form; this is not a backdating allowance.
  if(new Date(body.first_due_at).getTime()<Math.floor(now.getTime()/60000)*60000)return 'Past medication due times are not allowed. Choose the current minute or a future time.';
  for(const date of [body.start_date,body.end_date]){
    if(date&&!z.string().date().safeParse(date).success)return 'Enter a valid medication date.';
    if(date&&date<hospitalDate(now))return 'Past medication dates are not allowed.';
  }
  if(body.start_date&&body.end_date&&body.end_date<body.start_date)return 'End date cannot be before start date.';
  return null;
}

export const hasClinicalTimestamp=(body:Record<string,unknown>)=>
  ['occurred_at','recorded_at','administered_at','created_at','updated_at','date','time','timestamp','entry_date','entry_time'].some(key=>Object.hasOwn(body,key));
