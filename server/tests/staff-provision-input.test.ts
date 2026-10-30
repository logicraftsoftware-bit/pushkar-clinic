import {test} from 'node:test';
import assert from 'node:assert/strict';
import {staffProvisionInput,provisionRoles} from '../src/staff-provision-input.js';

test('lab and accountant accounts resolve to their own portal and both requested branches',()=>{
  const value=staffProvisionInput.parse({accounts:[{name:'Example',email:'EXAMPLE@example.com',role:'Lab Technician',branches:['Medicity Guwahati','Medicity Hatigaon','medicity guwahati']}]});
  assert.deepEqual(value.accounts[0].branches,['medicity guwahati','medicity hatigaon']);
  assert.equal(value.accounts[0].email,'example@example.com');
  assert.deepEqual(provisionRoles[value.accounts[0].role],{code:'LAB_TECHNICIAN',portal:'laboratory'});
  assert.deepEqual(provisionRoles.Accountant,{code:'ACCOUNTANT',portal:'accountant'});
});
test('existing single-branch reception provisioning stays compatible',()=>{
  const value=staffProvisionInput.parse({accounts:[{name:'Example',email:'example@example.com',branch:'Medicity Hatigaon'}]});
  assert.equal(value.accounts[0].role,'Receptionist');assert.deepEqual(value.accounts[0].branches,['medicity hatigaon']);
});
test('missing branches, unknown roles and duplicate emails fail before database writes',()=>{
  const row={name:'Example',email:'example@example.com',branch:'Medicity Hatigaon'};
  assert.equal(staffProvisionInput.safeParse({accounts:[{...row,branch:undefined}]}).success,false);
  assert.equal(staffProvisionInput.safeParse({accounts:[{...row,role:'Admin'}]}).success,false);
  assert.equal(staffProvisionInput.safeParse({accounts:[row,{...row,email:'EXAMPLE@example.com'}]}).success,false);
});

test('pharmacy staff get the pharmacy portal and only their requested branch',()=>{
 const value=staffProvisionInput.parse({accounts:[{name:'Example Pharmacy Staff',email:'pharmacy@example.com',role:'Pharmacist',branch:'Medicity Guwahati Hospital'}]});
 assert.equal(value.accounts[0].role,'Pharmacist');
 assert.deepEqual(value.accounts[0].branches,['medicity guwahati hospital']);
 assert.deepEqual(provisionRoles[value.accounts[0].role],{code:'PHARMACY_MANAGER',portal:'pharmacist'});
});

import {provisionUserMatches} from '../src/staff-provision-input.js';
test('explicit pharmacy role reassignment requires matching identity and hospital',()=>{
 const item={name:'Binod',role:'Pharmacist' as const,replace_role:true};
 const existing={tenant_id:'medicity',role:'accountant',first_name:'Binod',last_name:''};
 assert.equal(provisionUserMatches(existing,item,'medicity'),true);
 assert.equal(provisionUserMatches(existing,{...item,replace_role:false},'medicity'),false);
 assert.equal(provisionUserMatches({...existing,first_name:'Someone Else'},item,'medicity'),false);
 assert.equal(provisionUserMatches({...existing,tenant_id:'other'},item,'medicity'),false);
 assert.equal(provisionUserMatches({...existing,role:'pharmacist'},{...item,replace_role:false},'medicity'),true);
});
