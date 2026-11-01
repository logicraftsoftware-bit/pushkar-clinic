import { permissionCatalog } from './permission-catalog.mjs';
export { permissionCatalog };

export const baseRoles = Object.freeze({HOSPITAL_ADMIN:'hospital_admin',BRANCH_ADMIN:'hospital_admin',DOCTOR:'doctor',HR_MANAGER:'hr',INVENTORY_MANAGER:'receptionist',LAB_MANAGER:'laboratory',LAB_TECHNICIAN:'laboratory',PATHOLOGIST:'laboratory',NURSE:'nurse',PHARMACY_MANAGER:'pharmacist',RADIOLOGIST:'radiology',RECEPTIONIST:'receptionist',ACCOUNTANT:'accountant',PATIENT:'patient'});
export const customBaseRoles = Object.keys(baseRoles).filter(code=>code!=='HOSPITAL_ADMIN');
const knownPermissions=new Set(permissionCatalog.map(row=>row.code));
export function validateRoleGrant(granted,permissions) {
  if(permissions.some(code=>!knownPermissions.has(code)))throw Object.assign(new Error('Select permissions from the permission catalogue.'),{status:400});
  if(!granted.includes('*')&&permissions.some(code=>!granted.includes(code)))throw Object.assign(new Error('You cannot grant permissions beyond your own.'),{status:403});
}
export function rolePortalCode(role) {
  return role.is_system&&baseRoles[role.code]?role.code:customBaseRoles.includes(role.base_role)?role.base_role:null;
}

// Display legacy administrator names without changing stored role codes.
export const clinicRoleLabel = role => /^(hospital[ _]+admin)$/i.test(role.name ?? '') ? {...role, name:'Clinic Admin'} : role;
