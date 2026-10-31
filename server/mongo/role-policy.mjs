import { permissionTemplates } from './permission-templates.mjs';

export const baseRoles = Object.freeze({HOSPITAL_ADMIN:'hospital_admin',BRANCH_ADMIN:'hospital_admin',DOCTOR:'doctor',HR_MANAGER:'hr',INVENTORY_MANAGER:'receptionist',LAB_MANAGER:'laboratory',LAB_TECHNICIAN:'laboratory',PATHOLOGIST:'laboratory',NURSE:'nurse',PHARMACY_MANAGER:'pharmacist',RADIOLOGIST:'radiology',RECEPTIONIST:'receptionist',ACCOUNTANT:'accountant',PATIENT:'patient'});
export const customBaseRoles = Object.keys(baseRoles).filter(code=>code!=='HOSPITAL_ADMIN');
export const permissionCatalog = [...new Set([
  ...Object.values(permissionTemplates).flat().filter(code=>code!=='*'),
  'patient.delete','appointment.export','ipd.cancel','ipd.export','billing.refund',
  'audit.view','staff.delete','hospital.manage','users.manage','roles.manage','permissions.manage',
  'settings.view','settings.manage',
])].sort().map(code=>{
  const split=code.lastIndexOf('.'),module=code.slice(0,split),action=code.slice(split+1);
  return {code,module,action,label:`${module} ${action}`};
});
const knownPermissions=new Set(permissionCatalog.map(row=>row.code));
export function validateRoleGrant(granted,permissions) {
  if(permissions.some(code=>!knownPermissions.has(code)))throw Object.assign(new Error('Select permissions from the permission catalogue.'),{status:400});
  if(!granted.includes('*')&&permissions.some(code=>!granted.includes(code)))throw Object.assign(new Error('You cannot grant permissions beyond your own.'),{status:403});
}
export function rolePortalCode(role) {
  return role.is_system&&baseRoles[role.code]?role.code:customBaseRoles.includes(role.base_role)?role.base_role:null;
}
