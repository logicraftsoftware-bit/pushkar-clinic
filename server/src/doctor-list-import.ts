import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {consultationFee} from './doctor-fee-import-plan.js';
import {listDepartmentKey,planDoctorList,type ConflictPolicy,type DoctorListRow} from './doctor-list-plan.js';

export const doctorListStaffSql=`SELECT s.*,concat_ws(' ',s.first_name,s.middle_name,s.last_name) name,d.name department
  FROM staff_members s LEFT JOIN departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id
  WHERE s.tenant_id=$1 AND s.staff_type='Doctor'`;
export type ImportBranch={id:string;name:string};
export async function importDoctorList(client:PoolClient,tenant:string,branches:ImportBranch[],rows:DoctorListRow[],policy:ConflictPolicy,options:{source?:string;preserveDefaultFees?:boolean;requireComplete?:boolean}={}){
  const hash=createHash('sha256').update(JSON.stringify({version:1,tenant,branches,rows,policy,...(Object.keys(options).length?{options}:{})})).digest('hex');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${tenant}:doctor-fee-import`]);
    await client.query(`CREATE TABLE IF NOT EXISTS doctor_list_import_runs(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id),
      source_hash text NOT NULL,backup jsonb NOT NULL,summary jsonb NOT NULL,created_at timestamptz DEFAULT now(),UNIQUE(tenant_id,source_hash))`);
    const prior=await client.query('SELECT summary FROM doctor_list_import_runs WHERE tenant_id=$1 AND source_hash=$2',[tenant,hash]);
    if(prior.rows[0]){await client.query('COMMIT');return {...prior.rows[0].summary,already_applied:true};}
    const staff=(await client.query(doctorListStaffSql+' FOR UPDATE OF s',[tenant])).rows;
    const plan=planDoctorList(rows,staff,policy);
    if(options.requireComplete&&(plan.review.length||plan.excluded.length||plan.ready.length!==rows.length))throw Error('Doctor roster requires identity review: '+JSON.stringify(plan.review));
    const departments=(await client.query('SELECT * FROM departments WHERE tenant_id=$1',[tenant])).rows;
    const users=(await client.query('SELECT * FROM users WHERE tenant_id=$1 AND id IN (SELECT user_id FROM staff_members WHERE tenant_id=$1 AND staff_type=\'Doctor\')',[tenant])).rows;
    const memberships=(await client.query('SELECT * FROM user_branch_access WHERE tenant_id=$1',[tenant])).rows;
    const backup={staff,departments:structuredClone(departments),users,memberships,new_staff_ids:[] as string[],new_user_ids:[] as string[],new_department_ids:[] as string[]};
    const summary={added:0,updated:0,accounts_added:0,departments_added:0,departments_reactivated:0,review:plan.review,excluded:plan.excluded,doctors:[] as any[]};
    const departmentIds=new Map<string,string>();
    // All named departments are provided in each target branch, including those awaiting doctor review.
    for(const source of rows.filter(row=>!plan.excluded.includes(row))){
      const key=listDepartmentKey(source.department);
      if(!key)continue;
      for(const branch of branches){
        const mapKey=branch.id+':'+key;
        if(departmentIds.has(mapKey))continue;
        let department=departments.find(row=>row.branch_id===branch.id&&listDepartmentKey(row.name)===key&&row.is_active)
          ||departments.find(row=>row.branch_id===branch.id&&listDepartmentKey(row.name)===key);
        if(!department){
          const code='DOC-LIST-'+createHash('sha256').update(key).digest('hex').slice(0,16);
          department=(await client.query(`INSERT INTO departments(tenant_id,branch_id,name,code,is_active) VALUES($1,$2,$3,$4,true) RETURNING *`,[tenant,branch.id,source.department.trim(),code])).rows[0];
          departments.push(department);backup.new_department_ids.push(department.id);summary.departments_added++;
        }else if(!department.is_active){
          await client.query('UPDATE departments SET is_active=true,updated_at=now() WHERE id=$1 AND tenant_id=$2',[department.id,tenant]);
          department.is_active=true;summary.departments_reactivated++;
        }
        departmentIds.set(mapKey,department.id);
      }
    }
    for(const item of plan.ready){
      const fee=consultationFee(item.source.fee)!;
      const primary=branches[0]!;
      const records=item.matches.length?item.matches:[{id:randomUUID(),branch_id:primary.id,professional:{}}];
      for(const record of records){
        const isNew=!item.matches.length;
        const primaryBranch=branches.find(branch=>branch.id===record.branch_id);
        const departmentId=departmentIds.get((primaryBranch?.id||primary.id)+':'+listDepartmentKey(item.source.department))!;
        const professional={...record.professional,branch_fees:{...record.professional?.branch_fees},doctor_list_import:{source:options.source||'Doctor List.xlsx',rows:item.rows.map(row=>row.row),hash}};
        if(item.source.qualification&&!/^not specified$/i.test(item.source.qualification.trim()))professional.doctor_qualification=item.source.qualification;
        for(const branch of branches)professional.branch_fees[branch.id]={...professional.branch_fees[branch.id],consultation_fee:fee,...(item.source.registration_fee!==undefined?{registration_fee:item.source.registration_fee}:{}),...(item.source.maintenance_fee!==undefined?{maintenance_fee:item.source.maintenance_fee}:{}),
          department_id:departmentIds.get(branch.id+':'+listDepartmentKey(item.source.department)),source:options.source||'Doctor List.xlsx',row:item.source.row};
        if(isNew||(!options.preserveDefaultFees&&primaryBranch))professional.consultation_fee=fee;
        if(isNew||primaryBranch)professional.specialization=item.source.department;
        const nameParts=item.source.name.split(' '),lastName=nameParts.length>1?nameParts.pop()!:'';
        const firstName='Dr. '+nameParts.join(' ');
        let userId=record.user_id;
        if(!userId){
          userId=randomUUID();
          await client.query(`INSERT INTO users(id,tenant_id,branch_id,department_id,email,password_hash,first_name,last_name,role,is_active,force_password_change)
            VALUES($1,$2,$3,$4,$5,crypt($6,gen_salt('bf',12)),$7,$8,'doctor',true,true)`,
          [userId,tenant,record.branch_id||primary.id,isNew||primaryBranch?departmentId:record.department_id,`doctor-${userId}@staff.invalid`,randomUUID()+randomUUID(),isNew?firstName:record.first_name,isNew?lastName:record.last_name]);
          backup.new_user_ids.push(userId);summary.accounts_added++;
        }
        if(isNew){
          await client.query(`INSERT INTO staff_members(id,tenant_id,user_id,employee_id,first_name,last_name,staff_type,branch_id,department_id,designation,status,employment,account,professional)
            VALUES($1,$2,$3,$4,$5,$6,'Doctor',$7,$8,'Consultant Doctor','Active',$9,$10,$11)`,
          [record.id,tenant,userId,'DOC-LIST-'+createHash('sha256').update(item.key).digest('hex').slice(0,16),firstName,lastName,primary.id,departmentId,{status:'Active'},{role:'Doctor',account_status:'Active'},professional]);
          backup.new_staff_ids.push(record.id);summary.added++;
        }else{
          await client.query('UPDATE staff_members SET user_id=$1,department_id=$2,professional=$3,updated_at=now() WHERE id=$4 AND tenant_id=$5',
            [userId,primaryBranch?departmentId:record.department_id,professional,record.id,tenant]);
          if(primaryBranch)await client.query('UPDATE users SET department_id=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3',[departmentId,userId,tenant]);
          summary.updated++;
        }
        for(const branch of branches)await client.query('INSERT INTO user_branch_access(tenant_id,user_id,branch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenant,userId,branch.id]);
        summary.doctors.push({id:record.id,user_id:userId,name:item.source.name,fee,department:item.source.department,action:isNew?'added':'updated'});
      }
    }
    await client.query('INSERT INTO doctor_list_import_runs(tenant_id,source_hash,backup,summary) VALUES($1,$2,$3,$4)',[tenant,hash,backup,summary]);
    await client.query('COMMIT');return summary;
  } catch(error){await client.query('ROLLBACK');throw error;}
}
