import {z} from 'zod';
import {labSearchPatterns} from './lab-search.js';

export function listPagination(query:Record<string,unknown>){
  return {
    page:z.coerce.number().int().min(1).max(100000).prefault(1).parse(query.page),
    pageSize:z.coerce.number().int().min(1).max(100).prefault(25).parse(query.page_size),
    search:z.string().trim().max(150).prefault('').parse(query.search),
  };
}
export const listSearchPatterns=labSearchPatterns;

export const patientListSearchSql=`concat_ws(' ',p.medical_record_number,p.first_name,p.last_name,p.phone,p.email,
  regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')) ILIKE ALL($3::text[])`;
export const appointmentListSearchSql=`concat_ws(' ',a.appointment_number,a.token_number,a.status,a.appointment_date::text,
  p.first_name,p.last_name,p.medical_record_number,p.phone,p.email,
  regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),u.first_name,u.last_name,d.name) ILIKE ALL($3::text[])`;
