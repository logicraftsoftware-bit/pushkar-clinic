import {z} from "zod";
export const patientAgeFields={age_years:z.coerce.number().int().min(0).max(150).optional(),age_months:z.coerce.number().int().min(0).max(11).optional(),age_days:z.coerce.number().int().min(0).max(30).optional(),age_recorded_at:z.string().datetime().optional()};
export function ageAddress(address                   ){return address.age_years===undefined?address:{...address,age_recorded_at:new Date().toISOString()};}
export function patientAgeDays(address                        ,at     )            {
  if(address?.age_years===undefined||address.age_years===null)return null;
  const base=Number(address.age_years)*365.25+Number(address.age_months||0)*30.4375+Number(address.age_days||0);
  const recorded=address.age_recorded_at?new Date(address.age_recorded_at):at;
  const days=Math.floor(base+(at.getTime()-recorded.getTime())/86400000);
  return Number.isFinite(days)&&days>=0?days:null;
}
