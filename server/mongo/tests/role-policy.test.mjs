import {test} from 'node:test';
import assert from 'node:assert/strict';
import {permissionCatalog,rolePortalCode,validateRoleGrant} from '../role-policy.mjs';
import {authorizedPortal} from '../security.mjs';
test('custom roles select a workspace without inheriting its system permissions',()=>{
  const role={code:'FRONT_DESK_READ_ONLY',is_system:false,base_role:'RECEPTIONIST',permissions:['patient.view']};
  assert.equal(rolePortalCode(role),'RECEPTIONIST');
  assert.equal(authorizedPortal({role:'receptionist',role_codes:[role.code],portal_code:rolePortalCode(role)},'staff'),'receptionist');
  assert.equal(authorizedPortal({role:'receptionist',role_codes:[role.code],portal_code:'RECEPTIONIST'},'hospital_admin'),null);
  assert.equal(rolePortalCode({...role,base_role:'HOSPITAL_ADMIN'}),null);
  assert.equal(rolePortalCode({code:'HOSPITAL_ADMIN',is_system:true}),'HOSPITAL_ADMIN');
  assert.deepEqual(role.permissions,['patient.view']);
});
test('role grants reject unknown capabilities, wildcard and delegated escalation',()=>{
  assert.throws(()=>validateRoleGrant(['*'],['*']),{status:400});
  assert.throws(()=>validateRoleGrant(['*'],['made.up']),{status:400});
  assert.throws(()=>validateRoleGrant(['patient.view'],['patient.create']),{status:403});
  assert.doesNotThrow(()=>validateRoleGrant(['patient.view'],['patient.view']));
  assert.doesNotThrow(()=>validateRoleGrant(['*'],permissionCatalog.map(row=>row.code)));
});
