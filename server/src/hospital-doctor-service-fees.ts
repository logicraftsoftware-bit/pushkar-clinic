import type {PoolClient} from 'pg';
export async function setHospitalDoctorServiceFees(client:Pick<PoolClient,'query'>){
 const key='medicity-guwahati-hospital-doctor-service-fees-200-100-2026-10-29';
 await client.query('BEGIN');
 try{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
  await client.query('CREATE TABLE IF NOT EXISTS doctor_service_fee_initialisations(operation_key text PRIMARY KEY,backup jsonb NOT NULL,summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())');
  const previous=(await client.query('SELECT summary FROM doctor_service_fee_initialisations WHERE operation_key=$1',[key])).rows[0];
  if(previous){await client.query('COMMIT');return {...previous.summary,already_applied:true};}
  const branches=(await client.query(`SELECT b.id,b.tenant_id,b.name FROM branches b JOIN hospitals h ON h.id=b.tenant_id WHERE h.deleted_at IS NULL AND b.is_active=true AND lower(trim(b.name))='medicity guwahati hospital' AND lower(trim(h.name)) IN ('medicity guwahati','medicity guwahati hospital')`)).rows;
  if(branches.length!==1)throw Error('Expected exactly one active MEDICITY GUWAHATI HOSPITAL branch');
  const branch=branches[0];
  const doctors=(await client.query(`SELECT s.id,s.tenant_id,s.professional FROM staff_members s WHERE s.tenant_id=$1 AND s.staff_type='Doctor' AND (s.branch_id=$2 OR EXISTS(SELECT 1 FROM user_branch_access uba WHERE uba.tenant_id=s.tenant_id AND uba.user_id=s.user_id AND uba.branch_id=$2) OR EXISTS(SELECT 1 FROM users u WHERE u.id=s.user_id AND u.tenant_id=s.tenant_id AND u.branch_id=$2)) FOR UPDATE OF s`,[branch.tenant_id,branch.id])).rows;
  if(!doctors.length)throw Error('No doctors are assigned to MEDICITY GUWAHATI HOSPITAL');
  for(const doctor of doctors){
   const professional={...doctor.professional,branch_fees:{...doctor.professional?.branch_fees,[branch.id]:{...doctor.professional?.branch_fees?.[branch.id],registration_fee:200,maintenance_fee:100}}};
   const updated=(await client.query('UPDATE staff_members SET professional=$1::jsonb,updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING professional',[JSON.stringify(professional),doctor.id,doctor.tenant_id])).rows[0]?.professional;
   if(Number(updated?.branch_fees?.[branch.id]?.registration_fee)!==200||Number(updated?.branch_fees?.[branch.id]?.maintenance_fee)!==100)throw Error('Hospital doctor fee verification failed');
  }
  const summary={branch:branch.name,doctors_updated:doctors.length,registration_fee:200,maintenance_fee:100};
  await client.query('INSERT INTO doctor_service_fee_initialisations(operation_key,backup,summary) VALUES($1,$2::jsonb,$3::jsonb)',[key,JSON.stringify({branch,doctors}),JSON.stringify(summary)]);
  await client.query('COMMIT');return {...summary,already_applied:false};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
