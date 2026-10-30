import type {PoolClient} from 'pg';
type Row=Record<string,any>;
export const doctorFeeIncreaseKey='all-doctors-consultation-plus-100-2026-10-28';
function fee(value:unknown,fallback=0):number{
  if(value===null||value===undefined||String(value).trim()==='')return fallback;
  const number=Number(value);
  if(!Number.isFinite(number)||number<0)throw new Error('Invalid existing doctor consultation fee; no fees changed');
  return number;
}
export function increasedDoctorFees(professional:Row|null):Row{
  const original=professional||{},base=fee(original.consultation_fee);
  const result:Row={...original,consultation_fee:Math.round((base+100)*100)/100};
  if(original.branch_fees!==undefined){
    if(!original.branch_fees||typeof original.branch_fees!=='object'||Array.isArray(original.branch_fees))throw new Error('Invalid doctor branch fees');
    result.branch_fees=Object.fromEntries(Object.entries(original.branch_fees).map(([branch,entry])=>{
      if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('Invalid doctor branch fee');
      const data=entry as Row;
      return [branch,{...data,consultation_fee:Math.round((fee(data.consultation_fee,base)+100)*100)/100}];
    }));
  }
  return result;
}

export async function increaseAllDoctorFees(client:PoolClient){
  await client.query('BEGIN');
  try{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[doctorFeeIncreaseKey]);
    await client.query(`CREATE TABLE IF NOT EXISTS doctor_fee_adjustment_runs(operation_key text PRIMARY KEY,backup jsonb NOT NULL,summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
    const previous=(await client.query('SELECT summary FROM doctor_fee_adjustment_runs WHERE operation_key=$1',[doctorFeeIncreaseKey])).rows[0];
    if(previous){await client.query('COMMIT');return {...previous.summary,already_applied:true};}
    const doctors=(await client.query("SELECT id,tenant_id,professional FROM staff_members WHERE staff_type='Doctor' ORDER BY id FOR UPDATE")).rows;
    if(!doctors.length)throw new Error('No doctors found; fee increase was not applied');
    const plan=doctors.map(doctor=>({...doctor,updated:increasedDoctorFees(doctor.professional)}));
    for(const doctor of plan){
      const updated=await client.query('UPDATE staff_members SET professional=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING professional',[doctor.updated,doctor.id,doctor.tenant_id]);
      const actual=updated.rows[0]?.professional;
      if(!actual||Number(actual.consultation_fee)!==doctor.updated.consultation_fee||Object.entries(doctor.updated.branch_fees||{}).some(([branch,data])=>Number(actual.branch_fees?.[branch]?.consultation_fee)!==(data as Row).consultation_fee))throw new Error('Doctor fee update verification failed');
    }
    const summary={doctors_updated:plan.length,hospitals:new Set(plan.map(doctor=>doctor.tenant_id)).size,branch_fees_updated:plan.reduce((count,doctor)=>count+Object.keys(doctor.updated.branch_fees||{}).length,0),increase_rupees:100};
    await client.query('INSERT INTO doctor_fee_adjustment_runs(operation_key,backup,summary) VALUES($1,$2,$3)',[doctorFeeIncreaseKey,JSON.stringify(doctors),summary]);
    await client.query('COMMIT');return {...summary,already_applied:false};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
