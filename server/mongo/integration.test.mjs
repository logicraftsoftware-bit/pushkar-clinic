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
  let department,doctor,appointment;
  const future=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  await t.test('clinic setup and staff creation do not store plaintext login passwords',async()=>{
    const dept=await request('/hospital-management/departments','POST',{name:'Synthetic Medicine',code:'TESTMED',branch_id:branch.id},staffLogin.data.token);
    assert.equal(dept.status,201,JSON.stringify(dept.data));department=dept.data;
    const saved=await request('/hospital-management/staff/save','POST',{first_name:'Synthetic',last_name:'Doctor',staff_type:'Doctor',branch_ids:[branch.id],department_id:department.id,
      personal:{mobile_number:'9999999996'},employment:{},account:{role:'DOCTOR',login_email:'doctor@example.invalid',username:'synthetic-doctor',password,mobile:'9999999996',account_status:'Active'},
      professional:{medical_registration_number:'SYNTHETIC-ONLY',registration_fee:0,maintenance_fee:0,appointment_schedule:[{appointment_date:future,from_time:'10:00',to_time:'11:00',max_slots:6,slot_mode:'capacity'}]}},staffLogin.data.token);
    assert.equal(saved.status,201,JSON.stringify(saved.data));doctor=saved.data;
    assert.equal(doctor.account.password,undefined);
    const stored=await db.collection('staff_members').findOne({id:doctor.id});assert.equal(stored.account.password,undefined);
    assert.equal((await db.collection('users').findOne({id:doctor.user_id})).password_hash.startsWith('scrypt-v1$'),true);
  });
  await t.test('concurrent booking reserves a doctor slot only once',async()=>{
    const input={branch_id:branch.id,department_id:department.id,doctor_id:doctor.user_id,patient_id:patient.id,appointment_date:future,appointment_time:'10:00',appointment_type:'OPD',visit_type:'New',consultation_fee:100,paid_amount:0,payment_mode:'Cash',charges:[]};
    const attempts=await Promise.all([request('/clinical/appointments','POST',input,staffLogin.data.token),request('/clinical/appointments','POST',input,staffLogin.data.token)]);
    assert.deepEqual(attempts.map(row=>row.status).sort(),[201,409],JSON.stringify(attempts));appointment=attempts.find(row=>row.status===201).data;
    assert.equal(await db.collection('clinical_appointments').countDocuments({tenant_id:hospital.data.id}),1);
    assert.equal(appointment.payment_status,'Unpaid');
  });
  await t.test('check-in cannot overcollect, skip payment, or post two receipts',async()=>{
    const path=`/clinical/appointments/${appointment.id}/check-in`;
    assert.equal((await request(path,'PATCH',{payment:{amount:101,method:'Cash'}},staffLogin.data.token)).status,400);
    assert.equal((await request(`/clinical/appointments/${appointment.id}/status`,'PATCH',{status:'Checked In'},staffLogin.data.token)).status,409);
    const attempts=await Promise.all([request(path,'PATCH',{payment:{amount:100,method:'Cash'}},staffLogin.data.token),request(path,'PATCH',{payment:{amount:100,method:'Cash'}},staffLogin.data.token)]);
    assert.deepEqual(attempts.map(row=>row.status).sort(),[200,409],JSON.stringify(attempts));
    assert.equal(await db.collection('finance_records').countDocuments({tenant_id:hospital.data.id,record_number:`OPD-CHECKIN-${appointment.id}`}),1);
    const stored=await db.collection('clinical_appointments').findOne({id:appointment.id});assert.equal(stored.paid_amount,100);assert.equal(stored.status,'Checked In');
  });
  await t.test('appointment pages retain filtered totals, queue dates and printable identity fields',async()=>{
    const result=await request(`/clinical/appointments?page=1&page_size=1&queue=1&date=${future}&search=Updated`,'GET',null,staffLogin.data.token);
    assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.total,1);assert.equal(result.data.rows.length,1);
    assert.equal(result.data.summary['Checked In'],1);assert.deepEqual(result.data.dates,[future]);
    assert.equal(result.data.rows[0].medical_record_number,patient.medical_record_number);
    assert.equal(result.data.rows[0]._doctor,undefined);assert.equal(result.data.rows[0].password_hash,undefined);
    const punctuation=await request('/clinical/appointments?page=1&search=%5B','GET',null,staffLogin.data.token);
    assert.equal(punctuation.status,200,JSON.stringify(punctuation.data));assert.equal(punctuation.data.total,0);
  });
  await t.test('doctor availability cannot be removed when an appointment exists',async()=>{
    const deleted=await request(`/hospital-management/staff/${doctor.id}/appointment-schedule/${future}`,'DELETE',null,staffLogin.data.token);
    assert.equal(deleted.status,409);
  });
  await t.test('foreign-tenant patients cannot be listed, read or updated',async()=>{
    const foreignId='00000000-0000-4000-8000-000000000098';
    await db.collection('patients').insertOne({id:foreignId,tenant_id:'other-tenant',branch_id:branch.id,medical_record_number:'FOREIGN-1',first_name:'Foreign',last_name:'Patient',deleted_at:null});
    const rows=await request('/patients?search=Foreign','GET',null,staffLogin.data.token);
    assert.equal(rows.status,200);assert.equal(rows.data.length,0);
    assert.equal((await request(`/patients/${foreignId}`,'GET',null,staffLogin.data.token)).status,404);
    assert.equal((await request(`/patients/${foreignId}/details`,'PUT',patientInput,staffLogin.data.token)).status,404);
    await db.collection('patients').deleteOne({id:foreignId});
  });
  let admission,secondBed;
  await t.test('IPD admission atomically reserves a bed, snapshots its price and records its deposit',async()=>{
    const ward=await request('/hospital-management/wards','POST',{name:'Synthetic Ward',code:'WARD1',branch_id:branch.id,department_id:department.id},staffLogin.data.token);
    assert.equal(ward.status,201,JSON.stringify(ward.data));
    const room=await request('/hospital-management/rooms','POST',{room_number:'TEST-ROOM',branch_id:branch.id,ward_id:ward.data.id,daily_charge:100},staffLogin.data.token);
    assert.equal(room.status,201,JSON.stringify(room.data));
    const bed=await request('/hospital-management/beds','POST',{bed_number:'TEST-BED-1',branch_id:branch.id,ward_id:ward.data.id,room_id:room.data.id,daily_charge:100},staffLogin.data.token);
    assert.equal(bed.status,201,JSON.stringify(bed.data));
    const other=await request('/hospital-management/beds','POST',{bed_number:'TEST-BED-2',branch_id:branch.id,ward_id:ward.data.id,room_id:room.data.id,daily_charge:200},staffLogin.data.token);
    assert.equal(other.status,201,JSON.stringify(other.data));secondBed=other.data;
    const body={branch_id:branch.id,patient_id:patient.id,admitted_at:new Date(Date.now()-1000).toISOString(),admission_type:'Planned',department_id:department.id,consultant_doctor_id:doctor.user_id,bed_id:bed.data.id,has_insurance:false,deposit_amount:50,payment_mode:'Cash',charges:[],discount:0};
    const result=await request('/clinical/ipd','POST',body,staffLogin.data.token);
    assert.equal(result.status,201,JSON.stringify(result.data));admission=result.data;
    assert.equal(admission.registration_amount,0);assert.equal(admission.total_amount,100);assert.equal(admission.ipd_number,'IPD-000001');
    assert.equal((await db.collection('beds').findOne({id:bed.data.id})).status,'Occupied');
    assert.equal(await db.collection('ipd_bed_stays').countDocuments({admission_id:admission.id}),1);
    assert.equal(await db.collection('finance_records').countDocuments({record_number:`IPD-DEPOSIT-${admission.id}`}),1);
    const duplicate=await request('/clinical/ipd','POST',{...body,bed_id:secondBed.id},staffLogin.data.token);
    assert.equal(duplicate.status,409,JSON.stringify(duplicate.data));assert.equal((await db.collection('beds').findOne({id:secondBed.id})).status,'Available');
  });
  await t.test('bed transfer closes the old price snapshot and allocates the new bed',async()=>{
    const result=await request(`/clinical/ipd/${admission.id}/transfer`,'PUT',{transfer_type:'Bed Transfer',bed_id:secondBed.id,notes:'Synthetic transfer'},staffLogin.data.token);
    assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.total_amount,300);
    assert.equal((await db.collection('beds').findOne({id:admission.bed_id})).status,'Cleaning');
    assert.equal((await db.collection('beds').findOne({id:secondBed.id})).status,'Occupied');
    const detail=await request(`/clinical/ipd/${admission.id}/details`,'GET',null,staffLogin.data.token);
    assert.equal(detail.status,200,JSON.stringify(detail.data));assert.equal(detail.data.bed_stays.length,2);assert.equal(detail.data.transfers.length,1);
    assert.equal((await request(`/clinical/ipd/${admission.id}/status`,'PUT',{status:'Discharged'},staffLogin.data.token)).status,501);
  });
  let laboratoryOrder;
  await t.test('laboratory billing snapshots branch prices and ignores forged pharmacy discounts',async()=>{
    const master=await request('/hospital-management/diagnostic-masters/pathology/test','POST',{name:'Synthetic Blood Test',data:{test_type:'Pathology',amount:100,branch_prices:{[branch.id]:120},available_branch_ids:[branch.id]}},staffLogin.data.token);
    assert.equal(master.status,201,JSON.stringify(master.data));
    const pharmacy=await request('/hospital-management/refer-pharmacies','POST',{name:'Synthetic Referral Pharmacy',address:'Example Road',discount_percentage:50},staffLogin.data.token);
    assert.equal(pharmacy.status,201,JSON.stringify(pharmacy.data));
    const ordered=await request('/workspaces/lab-own-orders','POST',{patient_id:patient.id,test_ids:[master.data.id],center_id:branch.id,refer_pharmacy_id:pharmacy.data.id,pharmacy_discount_percentage:100,paid:20,payment_mode:'Cash',discount:0},staffLogin.data.token);
    assert.equal(ordered.status,201,JSON.stringify(ordered.data));laboratoryOrder=ordered.data;
    assert.equal(laboratoryOrder.bill.amount,120);assert.equal(laboratoryOrder.bill.total,60);assert.equal(laboratoryOrder.bill.due,40);
    assert.equal(laboratoryOrder.data.pharmacy_discount_percentage,50);
  });
  await t.test('concurrent laboratory payment retries post one receipt for one request ID',async()=>{
    const path=`/workspaces/work-items/${laboratoryOrder.id}/lab-bill`,key='00000000-0000-4000-8000-000000000088';
    const invalid=await request(path,'PATCH',{payment_mode:'Cash',payment_amount:41,payment_request_id:key,discount:60},staffLogin.data.token);
    assert.equal(invalid.status,400);
    const input={payment_mode:'Cash',payment_amount:40,payment_request_id:key,discount:60};
    const results=await Promise.all([request(path,'PATCH',input,staffLogin.data.token),request(path,'PATCH',input,staffLogin.data.token)]);
    assert.deepEqual(results.map(row=>row.status),[200,200],JSON.stringify(results));
    assert.equal(await db.collection('finance_records').countDocuments({tenant_id:hospital.data.id,invoice_id:laboratoryOrder.bill.id,kind:'payments'}),2);
    assert.equal((await request(path,'GET',null,staffLogin.data.token)).data.due,0);
    assert.equal((await request(path,'PATCH',{...input,payment_amount:39},staffLogin.data.token)).status,409);
  });
  await t.test('laboratory samples require generated barcodes before collection',async()=>{
    const action=`/workspaces/work-items/${laboratoryOrder.id}`;
    assert.equal((await request(action+'/sample-action','PATCH',{action:'collected'},staffLogin.data.token)).status,409);
    assert.equal((await request(action+'/lab-action','PATCH',{action:'send_sample'},staffLogin.data.token)).status,200);
    const generated=await request(action+'/sample-action','PATCH',{action:'generate_barcodes',collector:'Synthetic Technician'},staffLogin.data.token);
    assert.equal(generated.status,200,JSON.stringify(generated.data));assert.equal(generated.data.data.barcodes.length,1);
    const repeated=await request(action+'/sample-action','PATCH',{action:'generate_barcodes',collector:'Synthetic Technician'},staffLogin.data.token);
    assert.equal(repeated.data.data.barcodes[0].value,generated.data.data.barcodes[0].value);
    assert.equal((await request(action+'/sample-action','PATCH',{action:'collected'},staffLogin.data.token)).status,200);
    assert.equal((await request(action+'/sample-action','PATCH',{action:'collected'},staffLogin.data.token)).status,409);
    const list=await request('/workspaces/lab-orders?page=1','GET',null,staffLogin.data.token);
    assert.equal(list.status,200,JSON.stringify(list.data));assert.equal(list.data.summary.total,1);assert.equal(list.data.summary.progress,1);assert.equal(list.data.summary.ready,0);
  });
  await t.test('operational prefixes apply only to new patients and receipts remain visible',async()=>{
    assert.equal((await request('/hospital-admin/settings/PrefixSetting','PUT',{uhid_prefix:'NEWUHID'},staffLogin.data.token)).status,204);
    const created=await request('/patients','POST',{...patientInput,first_name:'Another',last_name:'Synthetic',phone:'9999999991'},staffLogin.data.token);
    assert.equal(created.status,201,JSON.stringify(created.data));assert.match(created.data.medical_record_number,/^NEWUHID-/);
    assert.equal((await request(`/patients/${patient.id}`,'GET',null,staffLogin.data.token)).data.patient.medical_record_number,patient.medical_record_number);
    const receipts=await request('/operations/finance/payments','GET',null,staffLogin.data.token);
    assert.equal(receipts.status,200);assert.equal(receipts.data.reduce((sum,row)=>sum+row.amount,0),210);
    assert.equal((await request('/hospital-admin/settings/constructor','PUT',{value:'bad'},staffLogin.data.token)).status,400);
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
