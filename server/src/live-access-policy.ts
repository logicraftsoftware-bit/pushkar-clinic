export type LiveAccount = { force_password_change?: boolean; role: string; is_active: boolean; hospital_status: string; deleted_at: unknown; account_expires_at: string | Date | null; role_codes: string[]; assigned_roles: number };
const portalCodes: Record<string, string[]> = {
  hospital_admin:['HOSPITAL_ADMIN'], branch_admin:['BRANCH_ADMIN'], receptionist:['RECEPTIONIST'], accountant:['ACCOUNTANT'], doctor:['DOCTOR'], nurse:['NURSE'], lab_manager:['LAB_MANAGER','LAB_TECHNICIAN','PATHOLOGIST'], radiologist:['RADIOLOGIST'], pharmacy_manager:['PHARMACY_MANAGER'], hr_manager:['HR_MANAGER'], inventory_manager:['INVENTORY_MANAGER'], patient:['PATIENT'],
};
export function accountAccessProblem(account: LiveAccount | undefined, claims: {role:string;portal?:string}, now=Date.now()) {
  if (!account || !account.is_active) return 'Your account has been disabled. Contact your hospital administrator.';
  if (account.deleted_at || !['active','trial'].includes(account.hospital_status)) return 'Your hospital account is currently unavailable. Contact your hospital administrator.';
  if (account.account_expires_at && new Date(account.account_expires_at).getTime() <= now) return 'Your account access has expired. Contact your hospital administrator.';
  if (account.role !== claims.role) return 'Your staff role has changed. Sign in again to open your current workspace.';
  if (account.assigned_roles > 0 && !account.role_codes.length) return 'Your assigned roles are inactive. Contact your hospital administrator.';
  const portal=claims.portal;
  if (portal && account.assigned_roles > 0 && !account.role_codes.some(code => code === 'CUSTOM' || portalCodes[portal]?.includes(code))) return 'Your workspace access has changed. Sign in again using your current staff role.';
  return null;
}
