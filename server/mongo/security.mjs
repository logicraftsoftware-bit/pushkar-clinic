import { randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(deriveKey);
const options = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 512) {
    throw new Error('Use a password of at least 12 characters and at most 512 bytes.');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, options);
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 512 || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const actual = await scrypt(password, parts[1], 64, options);
  return timingSafeEqual(actual, Buffer.from(parts[2], 'hex'));
}

// Never accept caller-controlled tenant, operator, or identity fields as a filter.
export function tenantFilter(tenantId, filter = {}) {
  if (typeof tenantId !== 'string' || !/^[a-f0-9-]{36}$/i.test(tenantId)) throw new Error('A valid tenant identity is required.');
  if (!filter || Object.getPrototypeOf(filter) !== Object.prototype || 'tenant_id' in filter) throw new Error('Tenant scope cannot be overridden.');
  return { $and: [{ tenant_id: tenantId }, filter] };
}
export function publicRecord(record) {
  if (!record) return null;
  const { _id, password_hash, session_version, ...safe } = record;
  return safe;
}
export function activeAccount(account, hospital, now = Date.now()) {
  return Boolean(account?.is_active && !account.deleted_at && hospital && !hospital.deleted_at &&
    ['active', 'trial'].includes(hospital.status) &&
    (!account.account_expires_at || new Date(account.account_expires_at).getTime() > now));
}
const portalRoles = {
  hospital_admin:'hospital_admin',accountant:'accountant',doctor:'doctor',nurse:'nurse',patient:'patient',
  hr_manager:'hr',inventory_manager:'receptionist',lab_manager:'laboratory',pharmacy_manager:'pharmacist',
  radiologist:'radiology',receptionist:'receptionist',branch_admin:'hospital_admin',
};
const defaults = {hospital_admin:'hospital_admin',accountant:'accountant',doctor:'doctor',nurse:'nurse',patient:'patient',hr:'hr_manager',laboratory:'lab_manager',pharmacist:'pharmacy_manager',radiology:'radiologist',receptionist:'receptionist'};
export function authorizedPortal(account, requested) {
  if(!account)return null;
  const assigned=account.role_codes ?? [];
  const staff=assigned.includes('BRANCH_ADMIN')&&!assigned.includes('HOSPITAL_ADMIN')?'branch_admin':
    assigned.includes('INVENTORY_MANAGER')&&!assigned.includes('RECEPTIONIST')?'inventory_manager':defaults[account.role];
  const portal=requested==='staff'?staff:requested;
  if(!portal || portalRoles[portal]!==account.role)return null;
  if(assigned.length && !assigned.includes(portal.toUpperCase()) && !(portal==='lab_manager'&&assigned.some(code=>['LAB_TECHNICIAN','PATHOLOGIST'].includes(code))))return null;
  if(!assigned.length && ['branch_admin','inventory_manager'].includes(portal))return null;
  return portal;
}
