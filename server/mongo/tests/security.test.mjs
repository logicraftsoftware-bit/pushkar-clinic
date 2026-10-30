import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, tenantFilter, publicRecord, activeAccount, authorizedPortal } from '../security.mjs';

test('passwords use random salts and verify without PostgreSQL', async () => {
  const password = 'Synthetic-test-password-123';
  const one = await hashPassword(password), two = await hashPassword(password);
  assert.notEqual(one, two);
  assert.equal(await verifyPassword(password, one), true);
  assert.equal(await verifyPassword('wrong password', one), false);
  for (const malformed of ['', null, '$2b$legacy', 'scrypt-v1$bad$bad']) assert.equal(await verifyPassword(password, malformed), false);
  await assert.rejects(hashPassword('short'));
});
test('tenant context cannot be replaced by a supplied query', () => {
  const tenant = '00000000-0000-4000-8000-000000000001';
  assert.deepEqual(tenantFilter(tenant, { $or: [{ tenant_id: 'other' }, { id: 'example' }] }), {
    $and: [{ tenant_id: tenant }, { $or: [{ tenant_id: 'other' }, { id: 'example' }] }],
  });
  assert.throws(() => tenantFilter(tenant, { tenant_id: 'other' }));
  assert.throws(() => tenantFilter(undefined));
});
test('API serialization excludes database identity and credential fields', () => {
  assert.deepEqual(publicRecord({ _id: 'private', id: 'public', password_hash: 'secret', session_version: 4, name: 'Example' }), { id: 'public', name: 'Example' });
});
test('revoked, expired and inactive tenant accounts cannot authenticate', () => {
  const account = { is_active: true };
  assert.equal(activeAccount(account, { status: 'active' }), true);
  assert.equal(activeAccount({ ...account, is_active: false }, { status: 'active' }), false);
  assert.equal(activeAccount(account, { status: 'suspended' }), false);
  assert.equal(activeAccount(account, { status: 'active', deleted_at: new Date() }), false);
  assert.equal(activeAccount({ ...account, account_expires_at: 'invalid' }, { status: 'active' }), false);
  assert.equal(activeAccount({ ...account, account_expires_at: '2000-01-01' }, { status: 'active' }), false);
});
test('branch and inventory roles cannot escalate to another workspace',()=>{
  const branch={role:'hospital_admin',role_codes:['BRANCH_ADMIN']};
  assert.equal(authorizedPortal(branch,'staff'),'branch_admin');
  assert.equal(authorizedPortal(branch,'hospital_admin'),null);
  assert.equal(authorizedPortal({role:'receptionist',role_codes:['RECEPTIONIST']},'inventory_manager'),null);
  assert.equal(authorizedPortal({role:'doctor',role_codes:['DOCTOR']},'hospital_admin'),null);
  assert.equal(authorizedPortal({role:'doctor',role_codes:['DOCTOR']},'staff'),'doctor');
  assert.equal(authorizedPortal({role:'doctor',role_codes:['REVOKED']},'doctor'),null);
});
