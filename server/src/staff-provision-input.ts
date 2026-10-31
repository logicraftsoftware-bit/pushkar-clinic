import {z} from 'zod';

export const provisionRoles={
  Receptionist:{code:'RECEPTIONIST',portal:'receptionist'},
  'Lab Technician':{code:'LAB_TECHNICIAN',portal:'laboratory'},
  Accountant:{code:'ACCOUNTANT',portal:'accountant'},
  Pharmacist:{code:'PHARMACY_MANAGER',portal:'pharmacist'},
} as const;
const account=z.object({
  name:z.string().trim().min(1).max(100),
  email:z.string().trim().email().transform(value=>value.toLowerCase()),
  role:z.enum(['Receptionist','Lab Technician','Accountant','Pharmacist']).prefault('Receptionist'),
  replace_role:z.boolean().prefault(false),
  branch:z.string().trim().min(1).optional(),
  branches:z.array(z.string().trim().min(1)).min(1).optional(),
}).transform(value=>({...value,branches:[...new Set((value.branches??(value.branch?[value.branch]:[])).map(branch=>branch.toLowerCase()))]}))
  .refine(value=>value.branches.length>0,'At least one branch is required');
export const staffProvisionInput=z.object({accounts:z.array(account).min(1).max(50),password:z.string().min(8).max(128).optional()})
  .refine(value=>new Set(value.accounts.map(item=>item.email)).size===value.accounts.length,'Duplicate login emails in request');

export function provisionUserMatches(user:{tenant_id:string;role:string;first_name?:string;last_name?:string},item:{name:string;role:keyof typeof provisionRoles;replace_role:boolean},tenant:string){
  if(user.tenant_id!==tenant)return false;
  if(user.role===provisionRoles[item.role].portal)return true;
  const normalise=(name:string)=>name.trim().replace(/\s+/g,' ').toLowerCase();
  return item.replace_role&&normalise([user.first_name,user.last_name].filter(Boolean).join(' '))===normalise(item.name);
}
