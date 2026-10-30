import {pool} from './db.js';

export function loginServiceFailure(error:unknown){
  const code=(error as {code?:string})?.code;
  if(code==='57014'||code==='ETIMEDOUT')return {code:'LOGIN_DATABASE_TIMEOUT',error:'The login database did not respond in time. Account registration and password could not be checked. Please try again.'};
  if(code==='55P03')return {code:'LOGIN_DATABASE_BUSY',error:'The login database is busy. Please try again shortly.'};
  if(['ECONNREFUSED','ENOTFOUND','57P03','08006','08001'].includes(code||''))return {code:'LOGIN_DATABASE_UNAVAILABLE',error:'The login service cannot connect to the database. Contact your hospital administrator.'};
  if(code==='42P01'||code==='42703')return {code:'LOGIN_SETUP_INCOMPLETE',error:'Login database setup is incomplete. Contact your hospital administrator.'};
  return null;
}

export async function staffLoginFailure(identifier:string,password:string,doctorOnly=false){
  const result=await pool.query(`WITH login_candidates AS MATERIALIZED (
      SELECT * FROM users WHERE lower(email::text)=lower($1) OR phone=$1
    ) SELECT u.role,u.is_active,
      (u.password_hash=crypt($2,u.password_hash)) password_valid,
      (u.account_expires_at IS NOT NULL AND u.account_expires_at<=now()) expired,
      h.status hospital_status,h.deleted_at,
      EXISTS(SELECT 1 FROM branches b WHERE b.id=u.branch_id AND b.tenant_id=u.tenant_id) branch_available,
      (SELECT count(*) FROM rbac_user_roles ur WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id) assigned_roles,
      (SELECT count(*) FROM rbac_user_roles ur JOIN rbac_roles r ON r.id=ur.role_id WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id AND r.status='Active') active_roles
    FROM login_candidates u LEFT JOIN hospitals h ON h.id=u.tenant_id LIMIT 1`,[identifier.trim(),password]);
  const account=result.rows[0];
  if(!account){
    const staff=await pool.query(`SELECT staff_type FROM staff_members
      WHERE lower(account->>'login_email')=lower($1) OR lower(personal->>'email')=lower($1)
        OR account->>'mobile'=$1 OR personal->>'mobile_number'=$1 LIMIT 1`,[identifier.trim()]);
    if(staff.rows[0])return {code:'LOGIN_NOT_PROVISIONED',error:`${staff.rows[0].staff_type==='Doctor'?'Doctor':'Staff member'} is registered, but no login account exists for this email or phone number. Ask the hospital administrator to create or link the login account.`};
    return {code:doctorOnly?'DOCTOR_NOT_REGISTERED':'STAFF_NOT_REGISTERED',error:doctorOnly?'Doctor is not registered with this email or phone number. Contact your hospital administrator.':'Doctor or staff account is not registered with this email or phone number. Contact your hospital administrator.'};
  }
  if(!account.password_valid)return {code:'INCORRECT_PASSWORD',error:'Incorrect password. Please try again or reset your password.'};
  if(!account.is_active)return {code:'ACCOUNT_INACTIVE',error:'Your login account is inactive. Contact your hospital administrator.'};
  if(account.expired)return {code:'ACCOUNT_EXPIRED',error:'Your login account has expired. Contact your hospital administrator.'};
  if(account.deleted_at||!['active','trial'].includes(account.hospital_status))return {code:'HOSPITAL_ACCESS_INACTIVE',error:'Hospital access is inactive. Contact your hospital administrator.'};
  if(!account.branch_available)return {code:'BRANCH_NOT_ASSIGNED',error:'No valid hospital branch is assigned to your account. Contact your hospital administrator.'};
  if(Number(account.assigned_roles)>0&&Number(account.active_roles)===0)return {code:'STAFF_ROLE_INACTIVE',error:'Your staff role is inactive. Contact your hospital administrator.'};
  return {code:'STAFF_ROLE_MISMATCH',error:doctorOnly?'This account does not have Doctor access. Use Staff Login or contact your hospital administrator.':'Your account does not have a matching staff login role. Contact your hospital administrator.'};
}
