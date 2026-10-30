import type {PoolClient} from 'pg';
type Row=Record<string,any>;
export const DEFAULT_DOCTOR_SERVICE_FEE=100;
export function doctorServiceFees(professional:Row={}){
 const fee=(key:string)=>{const value=professional[key];const amount=value==null||String(value).trim()===''?DEFAULT_DOCTOR_SERVICE_FEE:Number(value);if(!Number.isFinite(amount)||amount<0)throw Error('Doctor registration and maintenance fees must be valid non-negative amounts');return Math.round(amount*100)/100;};
 return {registration_fee:fee('registration_fee'),maintenance_fee:fee('maintenance_fee')};
}
export function doctorAppointmentCharges(charges:Row[],doctor:Row,selected:{registration_fee:boolean;maintenance_fee:boolean}={registration_fee:true,maintenance_fee:true}){
 const fees=doctorServiceFees(doctor);
 return [...charges.filter(row=>!row.doctor_fee),...(selected.registration_fee?[{label:'Registration Fee',amount:fees.registration_fee,doctor_fee:'registration_fee',fee_snapshot_version:2}]:[]),...(selected.maintenance_fee?[{label:'Maintenance Fee',amount:fees.maintenance_fee,doctor_fee:'maintenance_fee',fee_snapshot_version:2}]:[])];
}
export async function initialiseDoctorServiceFees(client:Pick<PoolClient,'query'>){
 const key='medicity-doctor-service-fees-100-2026-10-29';
 await client.query('BEGIN');
 try{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
  await client.query('CREATE TABLE IF NOT EXISTS doctor_service_fee_initialisations(operation_key text PRIMARY KEY,backup jsonb NOT NULL,summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())');
  const previous=(await client.query('SELECT summary FROM doctor_service_fee_initialisations WHERE operation_key=$1',[key])).rows[0];
  if(previous){await client.query('COMMIT');return {...previous.summary,already_applied:true};}
  const doctors=(await client.query(`SELECT s.id,s.tenant_id,s.professional FROM staff_members s JOIN hospitals h ON h.id=s.tenant_id WHERE h.deleted_at IS NULL AND lower(trim(h.name)) IN ('medicity guwahati','medicity guwahati hospital') AND s.staff_type='Doctor' FOR UPDATE OF s`)).rows;
  for(const doctor of doctors){const professional={...doctor.professional,registration_fee:100,maintenance_fee:100};await client.query('UPDATE staff_members SET professional=$1::jsonb,updated_at=now() WHERE id=$2 AND tenant_id=$3',[JSON.stringify(professional),doctor.id,doctor.tenant_id]);}
  const summary={doctors_initialised:doctors.length,registration_fee:100,maintenance_fee:100};
  await client.query('INSERT INTO doctor_service_fee_initialisations(operation_key,backup,summary) VALUES($1,$2::jsonb,$3::jsonb)',[key,JSON.stringify(doctors),JSON.stringify(summary)]);
  await client.query('COMMIT');return {...summary,already_applied:false};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
