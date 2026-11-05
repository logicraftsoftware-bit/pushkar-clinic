import { z } from 'zod';

const phone = z.string().trim().regex(/^\d{10}$|^$/, 'Mobile number must contain exactly 10 digits');
const personal = z.object({
  mobile_number: phone.optional(),
  alternate_mobile: phone.optional(),
  emergency_contact_number: phone.optional(),
}).passthrough();
const account = z.object({
  mobile: phone.optional(),
  account_status: z.enum(['Active', 'Inactive']).prefault('Active'),
}).passthrough();

export const staffSaveBody = z.object({
  id: z.string().uuid().optional(), first_name: z.string().trim().min(1), middle_name: z.string().prefault(''),
  last_name: z.string().trim().min(1), profile_photo: z.string().prefault(''), staff_type: z.string().min(1),
  branch_id: z.string().uuid().nullable().optional(), branch_ids: z.array(z.string().uuid()).min(1), department_id: z.string().uuid().nullable().optional(),
  designation: z.string().prefault(''), employment_type: z.string().prefault(''),
  joining_date: z.string().nullable().optional(), status: z.enum(['Active', 'Inactive', 'On Leave']).prefault('Active'),
  personal, employment: z.record(z.string(), z.unknown()), account,
  professional: z.record(z.string(), z.unknown()),
}).superRefine((body, context) => {
  if(body.staff_type==='Doctor'){
    const average=body.professional.average_consultation_minutes;
    if(average!==undefined&&average!==null&&String(average).trim()!==''){
      const minutes=Number(average);
      if(!Number.isInteger(minutes)||minutes<1||minutes>120)context.addIssue({code:z.ZodIssueCode.custom,path:['professional','average_consultation_minutes'],message:'Enter a consultation duration from 1 to 120 minutes'});
      else body.professional.average_consultation_minutes=minutes;
    }
    const start=body.professional.opd_start_time;
    if(start&&!(typeof start==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(start)))context.addIssue({code:z.ZodIssueCode.custom,path:['professional','opd_start_time'],message:'Enter a valid OPD start time'});
    const branchFees=body.professional.branch_fees;
    if(branchFees!==undefined){
      if(!branchFees||typeof branchFees!=='object'||Array.isArray(branchFees))context.addIssue({code:z.ZodIssueCode.custom,path:['professional','branch_fees'],message:'Invalid branch fee settings'});
      else for(const [branch,raw] of Object.entries(branchFees)){
        if(!raw||typeof raw!=='object'||Array.isArray(raw)){context.addIssue({code:z.ZodIssueCode.custom,path:['professional','branch_fees',branch],message:'Invalid branch fee settings'});continue;}
        const entry=raw                          ;
        for(const key of ['consultation_fee','registration_fee','maintenance_fee']){
          const fee=entry[key];
          if(fee==null||(typeof fee==='string'&&fee.trim()==='')){delete entry[key];continue;}
          const amount=Number(fee);
          if(!['number','string'].includes(typeof fee)||!Number.isFinite(amount)||amount<0)context.addIssue({code:z.ZodIssueCode.custom,path:['professional','branch_fees',branch,key],message:'Enter a valid non-negative branch fee'});
          else entry[key]=Math.round(amount*100)/100;
        }
      }
    }
    for(const key of ['registration_fee','maintenance_fee']){
      const raw=body.professional[key];
      const value=raw==null||String(raw).trim()===''?100:Number(raw);
      if((typeof raw!=='string'&&typeof raw!=='number'&&raw!=null)||!Number.isFinite(value)||value<0)context.addIssue({code:z.ZodIssueCode.custom,path:['professional',key],message:'Enter a valid non-negative fee'});
      else body.professional[key]=Math.round(value*100)/100;
    }
  }
  if (['Doctor', 'Pathologist'].includes(body.staff_type)) {
    const registration = body.professional.medical_registration_number;
    if (typeof registration !== 'string' || !registration.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['professional', 'medical_registration_number'], message: 'Medical Registration Number is required for doctors and pathologists' });
    } else {
      body.professional.medical_registration_number = registration.trim();
    }
  }
});

export function staffAccountActive(status        , accountStatus        )          {
  // Employment visibility and login access are independent gates. Neither may
  // silently reactivate an account explicitly disabled by an administrator.
  return status !== 'Inactive' && accountStatus !== 'Inactive';
}
