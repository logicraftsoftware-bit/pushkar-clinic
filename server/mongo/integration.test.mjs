// GitHub runner only: never permit this suite to reset a real clinic database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
if (process.env.MONGODB_INTEGRATION_TEST !== 'true' || !/^pushkar_test_[a-z0-9_]+$/.test(process.env.MONGODB_DB ?? '')) {
  throw new Error('Use an explicitly enabled, disposable pushkar_test_* database.');
}
const { client, db, initializeMongo } = await import('./database.mjs');
const { hashPassword } = await import('./security.mjs');
const { default: app } = await import('./app.mjs');
await initializeMongo();
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1`;
const password = 'Synthetic-integration-password-123';
const adminId = '00000000-0000-4000-8000-000000000001';
await db.collection('super_admin_users').insertOne({ id: adminId, username: 'test-owner', display_name: 'Synthetic Owner', password_hash: await hashPassword(password), is_active: true, session_version: 0 });
async function request(path, method = 'GET', body, token) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
  return { status:response.status, data:response.status === 204 ? null : await response.json() };
}
after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  await db.dropDatabase();
  await client.close();
});
test('native MongoDB authentication and atomic clinic provisioning', async t => {
  const login=await request('/admin/auth/login','POST',{username:'test-owner',password});
  assert.equal(login.status,200);const token=login.data.token;
  await t.test('session audiences cannot be interchanged',async()=>{
    assert.equal((await request('/auth/change-password','POST',{currentPassword:password,newPassword:'Different-synthetic-password-123'},token)).status,401);
    assert.equal((await request('/admin/me')).status,401);
  });
  const modules=await request('/admin/modules','GET',null,token);
  assert.equal(modules.status,200);assert.equal(modules.data.length,8);
  const plan=await request('/admin/plans','POST',{name:'Synthetic Plan',code:'synthetic',description:'Test only',monthlyPrice:100,yearlyPrice:1000,trialDays:14,maxBranches:2,maxUsers:10,maxDoctors:5,storageLimitGb:1,aiUsageLimit:0,moduleIds:[modules.data[0].id],status:'active'},token);
  assert.equal(plan.status,201,JSON.stringify(plan.data));
  const input={name:'Synthetic Clinic',code:'SYNTHETIC',hospitalType:'Clinic',registrationNumber:'TEST-ONLY',email:'clinic@example.invalid',phone:'9999999999',emergencyPhone:'9999999999',address:'Synthetic Road',city:'Test City',state:'Test State',pinCode:'100001',country:'India',branchName:'Main',planId:plan.data.id,subscriptionStartDate:'2026-10-31',billingCycle:'monthly',trialDays:14,status:'active',adminName:'Synthetic Admin',adminEmail:'admin@example.invalid',adminPhone:'9999999998',password};
  const hospital=await request('/admin/hospitals','POST',input,token);
  assert.equal(hospital.status,201,JSON.stringify(hospital.data));
  await t.test('provisioning creates one tenant, branch, user and subscription without leaking credentials',async()=>{
    assert.equal(hospital.data.password,undefined);assert.equal(hospital.data.password_hash,undefined);
    for(const collection of ['branches','users','subscriptions'])assert.equal(await db.collection(collection).countDocuments({tenant_id:hospital.data.id}),1);
  });
  await t.test('duplicate provisioning rolls back all writes',async()=>{
    assert.equal((await request('/admin/hospitals','POST',{...input,code:'ANOTHER'},token)).status,409);
    assert.equal(await db.collection('hospitals').countDocuments({}),1);
    assert.equal(await db.collection('branches').countDocuments({}),1);
  });
  const staffLogin=await request('/auth/login','POST',{identifier:input.adminEmail,password,portal:'hospital_admin'});
  assert.equal(staffLogin.status,200,JSON.stringify(staffLogin.data));
  await t.test('temporary-password accounts cannot access patient data',async()=>{
    assert.equal((await request('/patients','GET',null,staffLogin.data.token)).status,403);
  });
  // Fixture-only setup: patient workflows are independently exercised before
  // the password revocation test below. Never use this setup against Atlas.
  await db.collection('users').updateOne({email:input.adminEmail},{$set:{force_password_change:false}});
  const branch=await db.collection('branches').findOne({tenant_id:hospital.data.id});
  const patientInput={branch_id:branch.id,first_name:'Synthetic',last_name:'Patient',phone:'9999999997',address:{title:'Mr.',line:'Example Road',city:'Example City',state:'Example State',pin:'100001'},maintenance_fee:100,discount:20,registration_payment_status:'Unpaid'};
  let patient;
  await t.test('patient registration uses server totals and immutable sequential UHIDs',async()=>{
    const result=await request('/patients','POST',{...patientInput,total_amount:99999,tenant_id:'untrusted'},staffLogin.data.token);
    assert.equal(result.status,201,JSON.stringify(result.data));patient=result.data;
    assert.equal(patient.tenant_id,hospital.data.id);assert.equal(patient.total_amount,80);
    assert.equal(patient.medical_record_number,'UHID-000001');
    const immutable=await request(`/patients/${patient.id}`,'PUT',{...patientInput,medical_record_number:'OTHER'},staffLogin.data.token);
    assert.equal(immutable.status,400);assert.equal(immutable.data.code,'IMMUTABLE_UHID');
  });
  await t.test('duplicate registration rolls back its counter and needs an audited override',async()=>{
    const duplicate=await request('/patients','POST',patientInput,staffLogin.data.token);
    assert.equal(duplicate.status,409);assert.equal(duplicate.data.code,'POSSIBLE_DUPLICATE_PATIENT');
    assert.equal(await db.collection('patients').countDocuments({tenant_id:hospital.data.id}),1);
    assert.equal((await db.collection('counters').findOne({_id:`${hospital.data.id}:patient`})).value,1);
    const override=await request('/patients','POST',{...patientInput,duplicate_override:true,duplicate_override_reason:'Synthetic administrator approval'},staffLogin.data.token);
    assert.equal(override.status,201,JSON.stringify(override.data));assert.equal(override.data.medical_record_number,'UHID-000002');
    assert.equal(await db.collection('audit_events').countDocuments({tenant_id:hospital.data.id,action:'patient_duplicate_override'}),1);
  });
  await t.test('patient search and detail updates preserve financial values',async()=>{
    const page=await request('/patients?page=1&page_size=1&search=Synthetic','GET',null,staffLogin.data.token);
    assert.equal(page.status,200);assert.equal(page.data.total,2);assert.equal(page.data.rows.length,1);
    const update=await request(`/patients/${patient.id}/details`,'PUT',{...patientInput,first_name:'Updated',maintenance_fee:900,discount:0},staffLogin.data.token);
    assert.equal(update.status,200,JSON.stringify(update.data));assert.equal(update.data.maintenance_fee,100);assert.equal(update.data.total_amount,80);
  });
  await t.test('another tenant and an inactive branch cannot receive a patient',async()=>{
    const foreignId='00000000-0000-4000-8000-000000000099';
    await db.collection('branches').insertOne({id:foreignId,tenant_id:'other-tenant',code:'OTHER',is_active:true});
    assert.equal((await request('/patients','POST',{...patientInput,branch_id:foreignId},staffLogin.data.token)).status,403);
    assert.equal((await request(`/patients/${foreignId}`,'GET',null,staffLogin.data.token)).status,404);
    await db.collection('branches').deleteOne({id:foreignId});
  });
  await t.test('staff tokens cannot access platform administration',async()=>{
    assert.equal((await request('/admin/hospitals','GET',null,staffLogin.data.token)).status,401);
  });
  await t.test('password changes revoke old sessions',async()=>{
    const changed=await request('/auth/change-password','POST',{currentPassword:password,newPassword:'New-synthetic-password-123'},staffLogin.data.token);
    assert.equal(changed.status,204,JSON.stringify(changed.data));
    assert.equal((await request('/auth/logout','POST',{},staffLogin.data.token)).status,401);
    assert.equal((await request('/auth/login','POST',{identifier:input.adminEmail,password,portal:'hospital_admin'})).status,401);
  });
  await t.test('suspended hospitals cannot sign in',async()=>{
    assert.equal((await request(`/admin/hospitals/${hospital.data.id}/status`,'PATCH',{status:'suspended'},token)).status,200);
    assert.equal((await request('/auth/login','POST',{identifier:input.adminEmail,password:'New-synthetic-password-123',portal:'hospital_admin'})).status,401);
  });
  await t.test('unconverted workflows never return synthetic success',async()=>{
    const result=await request('/pharmacy/not-converted');assert.equal(result.status,501);assert.equal(result.data.code,'MONGODB_WORKFLOW_PENDING');
  });
});
