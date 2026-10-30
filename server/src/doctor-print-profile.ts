import {pool} from './db.js';
import {addPrintDoctorDetails} from './doctor-print-display.js';
type Row=Record<string,any>;
export async function withPrintDoctorDetails<T extends Row>(rows:T[],tenant:string):Promise<T[]> {
 if(!rows.length)return rows;
 const doctors=(await pool.query(`SELECT s.id,s.user_id,s.department_id,s.professional,concat_ws(' ',s.first_name,s.middle_name,s.last_name) name,concat_ws(' ',u.first_name,u.last_name) user_name FROM staff_members s LEFT JOIN users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.staff_type IN ('Doctor','Pathologist','Radiologist')`,[tenant])).rows;
 return rows.map(row=>addPrintDoctorDetails(row,doctors) as T);
}
