// View grants open their matching module without requiring a second menu grant.
const viewPermissions:Record<string,string>={billing:'billing.view',appointments:'appointment.view',queue:'appointment.view',patients:'patient.view',ipd:'ipd.view','lab-orders':'lab.order.view',staff:'staff.view',reports:'reports.view',inventory:'inventory.view',insurance:'insurance.view',hr:'hr.view',documents:'documents.view'};
export function hasMenuAccess(required:string|undefined,permissions:Set<string>){
  if(!required)return true;
  if(permissions.has(required))return true;
  const module=required.match(/^menu\.(.+)\.view$/)?.[1];
  return !!module&&!!viewPermissions[module]&&permissions.has(viewPermissions[module]);
}
