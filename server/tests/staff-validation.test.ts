import assert from 'node:assert/strict';
import { test } from 'node:test';
import { staffSaveBody, staffAccountActive } from '../src/staff-validation.js';

const staff = () => ({
  first_name: 'Test', last_name: 'Doctor', staff_type: 'Doctor',
  branch_ids: ['11111111-1111-4111-8111-111111111111'],
  personal: {}, employment: {}, account: {},
  professional: { medical_registration_number: ' REG-123 ' },
});

test('doctor registration is mandatory on both create and edit', () => {
  for (const id of [undefined, '22222222-2222-4222-8222-222222222222']) {
    for (const registration of [undefined, '', '   ', 123]) {
      const result = staffSaveBody.safeParse({ ...staff(), id, professional: { medical_registration_number: registration } });
      assert.equal(result.success, false);
      if (!result.success) assert.deepEqual(result.error.issues[0].path, ['professional', 'medical_registration_number']);
    }
  }
  assert.equal(staffSaveBody.parse(staff()).professional.medical_registration_number, 'REG-123');
  assert.equal(staffSaveBody.safeParse({ ...staff(), staff_type: 'Nurse', professional: {} }).success, true);
});

test('all staff contact numbers reject invalid digits and lengths', () => {
  for (const [section, key] of [['personal', 'mobile_number'], ['personal', 'alternate_mobile'], ['personal', 'emergency_contact_number'], ['account', 'mobile']]) {
    for (const value of ['3555', '888888', '12345678901', 'abcdefghij', '12345+7890', 1234567890]) {
      assert.equal(staffSaveBody.safeParse({ ...staff(), [section!]: { [key!]: value } }).success, false);
    }
    for (const value of ['', '0123456789', ' 9876543210 ']) {
      assert.equal(staffSaveBody.safeParse({ ...staff(), [section!]: { [key!]: value } }).success, true);
    }
  }
});

test('at least one branch must be assigned', () => {
  assert.equal(staffSaveBody.safeParse({ ...staff(), branch_ids: [] }).success, false);
});

test('employment and account status independently prevent login', () => {
  assert.equal(staffAccountActive('Active', 'Active'), true);
  assert.equal(staffAccountActive('Inactive', 'Active'), false);
  assert.equal(staffAccountActive('Active', 'Inactive'), false);
  assert.equal(staffAccountActive('Inactive', 'Inactive'), false);
  assert.equal(staffAccountActive('On Leave', 'Active'), true);
});

test('doctor registration and maintenance fees default independently to 100 and reject invalid amounts',()=>{
 const defaults=staffSaveBody.parse(staff()).professional;
 assert.equal(defaults.registration_fee,100);assert.equal(defaults.maintenance_fee,100);
 const changed=staffSaveBody.parse({...staff(),professional:{medical_registration_number:'REG',registration_fee:'125.50',maintenance_fee:0}}).professional;
 assert.equal(changed.registration_fee,125.5);assert.equal(changed.maintenance_fee,0);
 for(const key of ['registration_fee','maintenance_fee'])for(const value of [-1,'bad',true,{}])assert.equal(staffSaveBody.safeParse({...staff(),professional:{medical_registration_number:'REG',[key]:value}}).success,false);
});

test('branch consultation fees accept independent rates, preserve metadata and allow default fallback',()=>{
 const branch='11111111-1111-4111-8111-111111111111';
 const professional={medical_registration_number:'REG',consultation_fee:1100,branch_fees:{[branch]:{consultation_fee:'1250.50',department_id:'keep'},other:{consultation_fee:0},fallback:{consultation_fee:'',department_id:'retain'}}};
 const result=staffSaveBody.parse({...staff(),professional}).professional;
 assert.equal((result.branch_fees as any)[branch].consultation_fee,1250.5);assert.equal((result.branch_fees as any)[branch].department_id,'keep');assert.equal((result.branch_fees as any).other.consultation_fee,0);
 assert.deepEqual((result.branch_fees as any).fallback,{department_id:'retain'});assert.equal(result.consultation_fee,1100);
 for(const value of [-100,'invalid',true,{},Infinity])assert.equal(staffSaveBody.safeParse({...staff(),professional:{medical_registration_number:'REG',branch_fees:{[branch]:{consultation_fee:value}}}}).success,false);
 for(const value of [[],null,'invalid'])assert.equal(staffSaveBody.safeParse({...staff(),professional:{medical_registration_number:'REG',branch_fees:value}}).success,false);
});

test('branch registration and maintenance fees validate independently and blank fields inherit defaults',()=>{
 const branch=staff().branch_ids[0];
 const professional={medical_registration_number:'REG',registration_fee:100,maintenance_fee:100,branch_fees:{[branch]:{registration_fee:'75.50',maintenance_fee:0,department_id:'retained'},other:{registration_fee:' ',maintenance_fee:'50'}}};
 const result=staffSaveBody.parse({...staff(),professional}).professional;
 assert.deepEqual((result.branch_fees as any)[branch],{registration_fee:75.5,maintenance_fee:0,department_id:'retained'});assert.deepEqual((result.branch_fees as any).other,{maintenance_fee:50});
 for(const key of ['registration_fee','maintenance_fee'])for(const value of [-1,'invalid',true,{},Infinity])assert.equal(staffSaveBody.safeParse({...staff(),professional:{medical_registration_number:'REG',branch_fees:{[branch]:{[key]:value}}}}).success,false);
});
