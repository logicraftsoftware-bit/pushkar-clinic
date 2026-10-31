// GitHub runner only: never permit this suite to reset a real clinic database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
// Generate a valid RGBA PNG, including CRCs, instead of relying on a copied image.
function syntheticSignature() {
  function chunk(type, data) {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, payload, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,0,0,0,255,0,0,0,255]))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}
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
  const plan=await request('/admin/plans','POST',{name:'Synthetic Plan',code:'synthetic',description:'Test only',monthlyPrice:100,yearlyPrice:1000,trialDays:14,maxBranches:2,maxUsers:10,maxDoctors:5,storageLimitGb:1,aiUsageLimit:0,moduleIds:modules.data.map(row=>row.id),status:'active'},token);
  assert.equal(plan.status,201,JSON.stringify(plan.data));
  const input={name:'Synthetic Clinic',code:'SYNTHETIC',hospitalType:'Clinic',registrationNumber:'TEST-ONLY',email:'clinic@example.invalid',phone:'9999999999',emergencyPhone:'9999999999',address:'Synthetic Road',city:'Test City',state:'Test State',pinCode:'100001',country:'India',branchName:'Main',planId:plan.data.id,subscriptionStartDate:'2026-10-31',billingCycle:'monthly',trialDays:14,status:'active',adminName:'Synthetic Admin',adminEmail:'admin@example.invalid',adminPhone:'9999999998',password};
  const hospital=await request('/admin/hospitals','POST',input,token);
  assert.equal(hospital.status,201,JSON.stringify(hospital.data));
  await t.test('Super Admin lists and dashboards match the existing frontend response shapes',async()=>{
    const list=await request('/admin/hospitals?search=SYNTHETIC&page=1&limit=1','GET',null,token);
    assert.equal(list.status,200,JSON.stringify(list.data));assert.equal(list.data.total,1);assert.equal(list.data.data.length,1);assert.equal(list.data.data[0].branches,1);
    const detail=await request(`/admin/hospitals/${hospital.data.id}`,'GET',null,token);
    assert.equal(detail.status,200);assert.equal(detail.data.admin_email,input.adminEmail);assert.equal(detail.data.password_hash,undefined);
    const dashboard=await request('/admin/dashboard','GET',null,token);assert.equal(dashboard.status,200,JSON.stringify(dashboard.data));assert.equal(dashboard.data.hospitals.active,1);
    assert.equal((await request('/admin/subscriptions','GET',null,token)).data.length,1);
    assert.equal((await request('/admin/reports','GET',null,token)).status,200);
    assert.equal((await request('/admin/monitoring','GET',null,token)).status,200);
  });
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
  await t.test('appointment editing detects stale forms and serializes competing slot moves',async()=>{
    const path=`/clinical/appointments/${appointment.id}`;
    const moved=await request(path,'PUT',{...appointment,appointment_time:'10:10',notes:'Synthetic edited notes'},staffLogin.data.token);
    assert.equal(moved.status,200,JSON.stringify(moved.data));assert.equal(moved.data.appointment_number,appointment.appointment_number);assert.equal(moved.data.appointment_time,'10:10');
    assert.equal((await request(path,'PUT',{...appointment,notes:'Stale form'},staffLogin.data.token)).status,409);
    appointment=moved.data;
    const other=await request('/clinical/appointments','POST',{...appointment,appointment_time:'10:20',paid_amount:0},staffLogin.data.token);assert.equal(other.status,201,JSON.stringify(other.data));
    assert.equal((await request(path,'PUT',{...appointment,appointment_time:'10:20'},staffLogin.data.token)).status,409);
    assert.equal((await db.collection('clinical_appointments').findOne({id:appointment.id})).appointment_time,'10:10');
    // Keep the later queue assertions focused on the first appointment.
    await db.collection('clinical_appointments').deleteOne({id:other.data.id});
  });
  await t.test('check-in cannot overcollect, skip payment, or post two receipts',async()=>{
    const path=`/clinical/appointments/${appointment.id}/check-in`;
    assert.equal((await request(path,'PATCH',{payment:{amount:101,method:'Cash'}},staffLogin.data.token)).status,400);
    assert.equal((await request(`/clinical/appointments/${appointment.id}/status`,'PATCH',{status:'Checked In'},staffLogin.data.token)).status,409);
    const attempts=await Promise.all([request(path,'PATCH',{payment:{amount:100,method:'Cash'}},staffLogin.data.token),request(path,'PATCH',{payment:{amount:100,method:'Cash'}},staffLogin.data.token)]);
    assert.deepEqual(attempts.map(row=>row.status).sort(),[200,409],JSON.stringify(attempts));
    assert.equal(await db.collection('finance_records').countDocuments({tenant_id:hospital.data.id,record_number:`OPD-CHECKIN-${appointment.id}`}),1);
    const stored=await db.collection('clinical_appointments').findOne({id:appointment.id});assert.equal(stored.paid_amount,100);assert.equal(stored.status,'Checked In');
    const edit={...stored,updated_at:stored.updated_at.toISOString()};
    assert.equal((await request(`/clinical/appointments/${appointment.id}`,'PUT',{...edit,paid_amount:0},staffLogin.data.token)).status,409);
    assert.equal((await request(`/clinical/appointments/${appointment.id}`,'PUT',{...edit,appointment_time:'10:30'},staffLogin.data.token)).status,409);
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
  let resultRecord,parameter,signatory,reportSharePath;
  const signature=syntheticSignature();
  await t.test('lab editors reject stale parameter definitions and retain reviewed reference snapshots',async()=>{
    const unit=await request('/hospital-management/diagnostic-masters/pathology/unit','POST',{name:'Synthetic Unit',data:{}},staffLogin.data.token);assert.equal(unit.status,201);
    const configured=await request('/hospital-management/diagnostic-masters/pathology/parameter','POST',{name:'Synthetic Measurement',data:{unit_id:unit.data.id,result_type_id:'1',reference_from:'1',reference_to:'99'}},staffLogin.data.token);assert.equal(configured.status,201);parameter=configured.data;
    const testId=laboratoryOrder.data.tests[0].test_id;
    assert.equal((await request(`/hospital-management/diagnostic-masters/pathology/test/${testId}`,'PUT',{name:'Synthetic Blood Test',data:{test_type:'Pathology',amount:120,parameter_ids:[parameter.id]}},staffLogin.data.token)).status,200);
    const path=`/workspaces/work-items/${laboratoryOrder.id}/lab-results`;
    const initial=await request(path+'?mode=entry','GET',null,staffLogin.data.token);assert.equal(initial.status,200,JSON.stringify(initial.data));assert.equal(initial.data.tests[0].parameters[0].value,'');
    const body={updated_at:initial.data.updated_at,definition_revision:initial.data.definition_revision,results:[{test_id:testId,parameters:[{parameter_id:parameter.id,value:'12.34',remarks:''}]}]};
    assert.equal((await request(`/hospital-management/diagnostic-masters/pathology/parameter/${parameter.id}`,'PUT',{name:parameter.name,data:{...parameter.data,reference_to:'88'}},staffLogin.data.token)).status,200);
    assert.equal((await request(path,'PATCH',body,staffLogin.data.token)).status,409);
    const refreshed=await request(path+'?mode=entry','GET',null,staffLogin.data.token);
    const invalid=await request(path,'PATCH',{...body,definition_revision:refreshed.data.definition_revision,results:[{test_id:testId,parameters:[{parameter_id:parameter.id,value:'invalid',remarks:''}]}]},staffLogin.data.token);assert.equal(invalid.status,400);
    const saved=await request(path,'PATCH',{...body,definition_revision:refreshed.data.definition_revision},staffLogin.data.token);assert.equal(saved.status,200,JSON.stringify(saved.data));resultRecord=saved.data;
    assert.equal(resultRecord.data.result_status,'Completed');assert.equal(resultRecord.tests[0].parameters[0].reference_to,'88');
    assert.equal((await request(path,'PATCH',{...body,definition_revision:refreshed.data.definition_revision},staffLogin.data.token)).status,409);
    assert.equal((await request(`/hospital-management/diagnostic-masters/pathology/parameter/${parameter.id}`,'PUT',{name:parameter.name,data:{...parameter.data,reference_to:'77'}},staffLogin.data.token)).status,200);
    const frozen=await request(path,'GET',null,staffLogin.data.token);assert.equal(frozen.data.tests[0].parameters[0].reference_to,'88');
  });
  await t.test('pathologist approval requires a signed clinic profile and locks the selected clinical values',async()=>{
    const profile={first_name:'Synthetic',last_name:'Pathologist',staff_type:'Pathologist',branch_ids:[branch.id],department_id:department.id,personal:{},employment:{},account:{account_status:'Active'},professional:{medical_registration_number:'SYNTHETIC-REG',digital_signature:signature}};
    const signed=await request('/hospital-management/staff/save','POST',profile,staffLogin.data.token);assert.equal(signed.status,201,JSON.stringify(signed.data));signatory=signed.data;
    const unsigned=await request('/hospital-management/staff/save','POST',{...profile,first_name:'Unsigned',professional:{medical_registration_number:'SYNTHETIC-UNSIGNED'}},staffLogin.data.token);assert.equal(unsigned.status,201);
    const path=`/workspaces/lab/orders/${laboratoryOrder.id}/approve`,body={stage:'doctor',updated_at:resultRecord.updated_at,test_ids:[laboratoryOrder.data.tests[0].test_id],pathologist_ids:[signatory.id]};
    assert.equal((await request(path,'PATCH',{...body,pathologist_ids:[unsigned.data.id]},staffLogin.data.token)).status,409);
    assert.equal((await request(path,'PATCH',body,staffLogin.data.token)).status,200);
    const resultsPath=`/workspaces/work-items/${laboratoryOrder.id}/lab-results`,reviewed=await request(resultsPath,'GET',null,staffLogin.data.token);resultRecord=reviewed.data;
    assert.equal(resultRecord.data.doctor_approval.test_ids.length,1);assert.equal(resultRecord.report_signatories.find(row=>row.id===signatory.id).signature,signature);
    const tampered=await request(resultsPath,'PATCH',{updated_at:resultRecord.updated_at,definition_revision:resultRecord.definition_revision,results:[{test_id:laboratoryOrder.data.tests[0].test_id,parameters:[{parameter_id:parameter.id,value:'13',remarks:''}]}]},staffLogin.data.token);assert.equal(tampered.status,409);
    await db.collection('staff_members').updateOne({id:signatory.id},{$set:{'professional.digital_signature':'updated-profile-signature'}});
    assert.equal((await request(resultsPath,'GET',null,staffLogin.data.token)).data.report_signatories.find(row=>row.id===signatory.id).signature,signature);
    assert.equal((await request(`/workspaces/lab/orders/${laboratoryOrder.id}/process`,'PATCH',{action:'reject',note:'Synthetic rejection'},staffLogin.data.token)).status,409);
  });
  await t.test('print confirmations are retry-safe and public shares contain server-generated reviewed PDFs',async()=>{
    const basePath=`/workspaces/work-items/${laboratoryOrder.id}`;
    const print={test_ids:[laboratoryOrder.data.tests[0].test_id],revision:resultRecord.report_revision,request_id:'00000000-0000-4000-8000-000000000087'};
    const printed=await Promise.all([request(basePath+'/lab-report-print','POST',print,staffLogin.data.token),request(basePath+'/lab-report-print','POST',print,staffLogin.data.token)]);
    assert.deepEqual(printed.map(row=>row.status),[200,200],JSON.stringify(printed));assert.equal(printed[0].data.events.length,1);
    assert.equal((await request(basePath+'/lab-report-print','POST',{...print,revision:'0'.repeat(64)},staffLogin.data.token)).status,409);
    const body={pdf:Buffer.from('%PDF-1.4\nFORGED_REPORT').toString('base64'),filename:'Synthetic-Report.pdf',updated_at:resultRecord.updated_at};
    const shared=await request(basePath+'/lab-report-share','POST',body,staffLogin.data.token);assert.equal(shared.status,201,JSON.stringify(shared.data));
    const report=await fetch(new URL(shared.data.path,base));assert.equal(report.status,200);assert.match(report.headers.get('content-type'),/application\/pdf/);
    const bytes=Buffer.from(await report.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(bytes.includes(Buffer.from('FORGED_REPORT')),false);
    await db.collection('report_shares').updateMany({order_id:laboratoryOrder.id},{$set:{expires_at:new Date(Date.now()-1000)}});
    assert.equal((await fetch(new URL(shared.data.path,base))).status,404);
    const current=await request(basePath+'/lab-report-share','POST',body,staffLogin.data.token);assert.equal(current.status,201,JSON.stringify(current.data));reportSharePath=current.data.path;
    const reports=await request('/workspaces/lab-orders?stage=Reports','GET',null,staffLogin.data.token);assert.equal(reports.status,200);assert.equal(reports.data.total,1);assert.equal(reports.data.rows[0].report_available,true);
  });
  await t.test('disapproval preserves the reviewed result and reopens it with audit history',async()=>{
    const response=await request(`/workspaces/lab/orders/${laboratoryOrder.id}/approve`,'PATCH',{stage:'disapprove',updated_at:resultRecord.updated_at,test_ids:[laboratoryOrder.data.tests[0].test_id]},staffLogin.data.token);assert.equal(response.status,200,JSON.stringify(response.data));
    const opened=await request(`/workspaces/work-items/${laboratoryOrder.id}/lab-results`,'GET',null,staffLogin.data.token);
    assert.equal(opened.data.data.doctor_approval,null);assert.equal(opened.data.tests[0].parameters[0].value,'12.34');assert.ok(opened.data.data.approval_history.at(-1).previous_approval);
    if(reportSharePath)assert.equal((await fetch(new URL(reportSharePath,base))).status,404);
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
  await t.test('custom role changes revoke sessions and cannot alter system administrators or foreign accounts',async()=>{
    const roleBody={name:'Synthetic Readonly Desk',code:'SYNTHETIC_READONLY',base_role:'RECEPTIONIST',status:'Active',role_level:20,permissions:['patient.view','menu.patients.view']};
    const created=await request('/access-control/roles','POST',roleBody,staffLogin.data.token);assert.equal(created.status,201,JSON.stringify(created.data));
    const list=await request('/access-control/roles','GET',null,staffLogin.data.token);assert.equal(list.status,200);
    const primary=list.data.find(row=>row.code==='HOSPITAL_ADMIN');
    assert.equal((await request('/access-control/roles','POST',{...roleBody,id:primary.id},staffLogin.data.token)).status,409);
    assert.equal((await request('/access-control/roles','POST',{...roleBody,code:'UNKNOWN_PERMISSION',permissions:['not.a.permission']},staffLogin.data.token)).status,400);
    const userId='00000000-0000-4000-8000-000000000094';
    await db.collection('users').insertOne({id:userId,tenant_id:hospital.data.id,branch_id:branch.id,first_name:'Readonly',last_name:'Synthetic',username:'synthetic-readonly',email:'readonly@example.invalid',is_active:true,role:'receptionist',role_codes:['SYNTHETIC_READONLY'],portal_code:'RECEPTIONIST',password_hash:await hashPassword(password),session_version:0,force_password_change:false,created_at:new Date()});
    const login=await request('/auth/login','POST',{identifier:'readonly@example.invalid',password,portal:'staff'});assert.equal(login.status,200,JSON.stringify(login.data));
    assert.equal((await request('/patients','GET',null,login.data.token)).status,200);
    assert.equal((await request('/patients','POST',patientInput,login.data.token)).status,403);
    assert.equal((await request('/access-control/users','GET',null,login.data.token)).status,403);
    const self=await db.collection('users').findOne({email:input.adminEmail});
    assert.equal((await request(`/access-control/users/${self.id}`,'PUT',{is_active:false},staffLogin.data.token)).status,409);
    assert.equal((await request('/access-control/users/00000000-0000-4000-8000-000000000099','PUT',{is_active:false},staffLogin.data.token)).status,404);
    assert.equal((await request('/access-control/roles','POST',{...roleBody,id:created.data.id,code:'SYNTHETIC_RENAMED'},staffLogin.data.token)).status,200);
    assert.equal((await request('/patients','GET',null,login.data.token)).status,401);
    const renamed=await db.collection('users').findOne({id:userId});assert.deepEqual(renamed.role_codes,['SYNTHETIC_RENAMED']);
    const relogin=await request('/auth/login','POST',{identifier:'readonly@example.invalid',password,portal:'staff'});assert.equal(relogin.status,200);
    assert.equal((await request(`/access-control/users/${userId}`,'PUT',{is_active:false},staffLogin.data.token)).status,204);
    assert.equal((await request('/patients','GET',null,relogin.data.token)).status,401);
    const users=await request('/access-control/users','GET',null,staffLogin.data.token);assert.equal(users.status,200);assert.equal(users.data.find(row=>row.id===userId).password_hash,undefined);
    assert.equal(await db.collection('audit_events').countDocuments({tenant_id:hospital.data.id,action:'account_access_updated',record_id:userId}),1);
  });
  await t.test('inventory transfer retries move stock once and overdraw rolls back every write',async()=>{
    const supplier=await request('/operations/inventory/suppliers','POST',{data:{name:'Synthetic Supplier'}},staffLogin.data.token);assert.equal(supplier.status,201,JSON.stringify(supplier.data));
    const otherBranch=await request('/hospital-management/branches','POST',{name:'Synthetic Stock Branch',code:'STOCKBR'},staffLogin.data.token);assert.equal(otherBranch.status,201,JSON.stringify(otherBranch.data));
    const source=await request('/operations/inventory/items','POST',{branch_id:branch.id,data:{name:'Synthetic Gauze',unit:'box',reorder_level:3},quantity:10},staffLogin.data.token);
    const destination=await request('/operations/inventory/items','POST',{branch_id:otherBranch.data.id,data:{name:'Synthetic Gauze',unit:'box'},quantity:0},staffLogin.data.token);
    assert.equal(source.status,201,JSON.stringify(source.data));assert.equal(destination.status,201,JSON.stringify(destination.data));
    const body={branch_id:branch.id,item_id:source.data.id,quantity:6,data:{to_branch:otherBranch.data.id,destination_item_id:destination.data.id},request_id:'00000000-0000-4000-8000-000000000091'};
    const results=await Promise.all([request('/operations/inventory/stock-transfers','POST',body,staffLogin.data.token),request('/operations/inventory/stock-transfers','POST',body,staffLogin.data.token)]);
    assert.deepEqual(results.map(row=>row.status),[201,201],JSON.stringify(results));assert.equal(results[0].data.id,results[1].data.id);
    assert.equal((await db.collection('inventory_records').findOne({id:source.data.id})).quantity,4);assert.equal((await db.collection('inventory_records').findOne({id:destination.data.id})).quantity,6);
    assert.equal((await request('/operations/inventory/stock-transfers','POST',{...body,quantity:7,request_id:'00000000-0000-4000-8000-000000000092'},staffLogin.data.token)).status,409);
    assert.equal(await db.collection('inventory_records').countDocuments({tenant_id:hospital.data.id,kind:'stock-transfers'}),1);
    assert.equal((await request('/operations/inventory/stock-transfers','POST',{...body,quantity:1},staffLogin.data.token)).status,409);
    const purchased=await request('/operations/inventory/purchases','POST',{branch_id:branch.id,item_id:source.data.id,supplier_id:supplier.data.id,quantity:2.125,amount:10,data:{}},staffLogin.data.token);assert.equal(purchased.status,201,JSON.stringify(purchased.data));
    assert.equal((await db.collection('inventory_records').findOne({id:source.data.id})).quantity,6.125);
    assert.equal((await request(`/operations/inventory/purchases/${purchased.data.id}`,'PUT',{quantity:999,data:{}},staffLogin.data.token)).status,409);
    assert.equal((await request(`/operations/inventory/items/${source.data.id}`,'PUT',{...source.data,quantity:100},staffLogin.data.token)).status,409);
    const lookup=await request('/operations/lookups?keys=items,suppliers,branches','GET',null,staffLogin.data.token);assert.equal(lookup.status,200);assert.equal(lookup.data.items.find(row=>row.id===source.data.id).stock,6.125);
    const low=await request('/operations/inventory/low-stock','GET',null,staffLogin.data.token);assert.equal(low.status,200);assert.equal(low.data.some(row=>row.id===source.data.id),false);
    const events=await fetch(`${base}/session/events`,{headers:{Authorization:`Bearer ${staffLogin.data.token}`}});assert.equal(events.status,200);assert.match(events.headers.get('content-type'),/text\/event-stream/);const reader=events.body.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/data: refresh/);await reader.cancel();
  });
  await t.test('general invoices post initial receipts and concurrent payment retries cannot overcollect',async()=>{
    const invoice=await request('/operations/finance/invoices','POST',{patient_id:patient.id,total:120,paid:20,data:{services:'Synthetic Service',payment_method:'Cash'},request_id:'00000000-0000-4000-8000-000000000081'},staffLogin.data.token);
    assert.equal(invoice.status,201,JSON.stringify(invoice.data));assert.equal(invoice.data.due,100);assert.equal(invoice.data.status,'Partially Paid');
    const initial=await db.collection('finance_records').find({invoice_id:invoice.data.id,kind:'payments'}).toArray();assert.equal(initial.length,1);assert.equal(initial[0].amount,20);
    const body={invoice_id:invoice.data.id,patient_id:patient.id,amount:100,data:{payment_method:'Cash'},request_id:'00000000-0000-4000-8000-000000000082'};
    const payments=await Promise.all([request('/operations/finance/payments','POST',body,staffLogin.data.token),request('/operations/finance/payments','POST',body,staffLogin.data.token)]);
    assert.deepEqual(payments.map(row=>row.status),[201,201],JSON.stringify(payments));assert.equal(payments[0].data.id,payments[1].data.id);
    const paid=await db.collection('finance_records').findOne({id:invoice.data.id});assert.equal(paid.paid,120);assert.equal(paid.due,0);
    assert.equal((await request('/operations/finance/payments','POST',{...body,request_id:'00000000-0000-4000-8000-000000000083'},staffLogin.data.token)).status,409);
    assert.equal((await request('/operations/finance/payments','POST',{...body,amount:1},staffLogin.data.token)).status,409);
    assert.equal((await request('/operations/finance/refunds','POST',{invoice_id:invoice.data.id,amount:121,data:{payment_method:'Cash',reason:'Synthetic correction'}},staffLogin.data.token)).status,409);
    const refund=await request('/operations/finance/refunds','POST',{invoice_id:invoice.data.id,amount:40,data:{payment_method:'Cash',reason:'Synthetic correction'}},staffLogin.data.token);assert.equal(refund.status,201,JSON.stringify(refund.data));
    const expense=await request('/operations/finance/expenses','POST',{amount:10,data:{payee:'Synthetic Vendor',payment_method:'Cash'}},staffLogin.data.token);assert.equal(expense.status,201,JSON.stringify(expense.data));
    assert.equal((await request(`/operations/finance/payments/${payments[0].data.id}`,'PUT',{amount:1},staffLogin.data.token)).status,409);
    const reports=await request('/operations/finance/reports','GET',null,staffLogin.data.token);assert.equal(reports.status,200,JSON.stringify(reports.data));assert.equal(reports.data[0].refunds,40);assert.equal(reports.data[0].expenses,10);
    const all=await request('/operations/finance/all','GET',null,staffLogin.data.token);assert.equal(all.status,200);assert.ok(all.data.some(row=>row.data?.admission_id));assert.ok(all.data.every(row=>row.request_hash===undefined));
    const admissionInvoice=all.data.find(row=>row.kind==='invoices'&&row.data.admission_id);
    const admissionRow=await db.collection('ipd_admissions').findOne({id:admissionInvoice.data.admission_id});assert.equal(admissionInvoice.paid,Math.min(admissionRow.total_amount,admissionRow.paid_amount+admissionRow.deposit_amount));
    const labDownload=await request(`/operations/finance/lab-invoices/${laboratoryOrder.data.bill_id}`,'GET',null,staffLogin.data.token);assert.equal(labDownload.status,200,JSON.stringify(labDownload.data));assert.ok(labDownload.data.payments.length);
  });
  await t.test('HR payroll computes net pay and insurance rejects foreign patients and excessive settlement',async()=>{
    const payrollBody={employee_id:doctor.id,record_date:'2026-11',amount:999999,data:{basic_salary:100.10,allowances:20.20,overtime:5,deductions:10,tax:5},status:'Pending',request_id:'00000000-0000-4000-8000-000000000071'};
    const payroll=await request('/workforce/hr/payroll','POST',payrollBody,staffLogin.data.token);assert.equal(payroll.status,201,JSON.stringify(payroll.data));assert.equal(payroll.data.amount,110.30);assert.equal(payroll.data.record_date,'2026-11-01');
    const retried=await request('/workforce/hr/payroll','POST',payrollBody,staffLogin.data.token);assert.equal(retried.status,201);assert.equal(retried.data.id,payroll.data.id);
    const edited=await request(`/workforce/hr/payroll/${payroll.data.id}`,'PUT',{...payroll.data,data:{...payroll.data.data,deductions:20}},staffLogin.data.token);assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.amount,100.30);
    assert.equal((await request(`/workforce/hr/payroll/${payroll.data.id}`,'PUT',payroll.data,staffLogin.data.token)).status,409);
    const claimBody={patient_id:patient.id,insurance_company:'Synthetic Insurer',claimed_amount:100,approved_amount:80,settled_amount:0,status:'Approved',documents:''};
    const claim=await request('/workforce/insurance','POST',claimBody,staffLogin.data.token);assert.equal(claim.status,201,JSON.stringify(claim.data));assert.equal(claim.data.branch_id,branch.id);
    assert.equal((await request('/workforce/insurance','POST',{...claimBody,settled_amount:81},staffLogin.data.token)).status,400);
    assert.equal((await request('/workforce/insurance','POST',{...claimBody,patient_id:'00000000-0000-4000-8000-000000000099'},staffLogin.data.token)).status,400);
    const claims=await request('/workforce/insurance','GET',null,staffLogin.data.token);assert.equal(claims.status,200);assert.equal(claims.data.length,1);assert.equal(claims.data[0].request_hash,undefined);
    const lookups=await request('/workforce/lookups','GET',null,staffLogin.data.token);assert.equal(lookups.status,200);assert.ok(lookups.data.employees.some(row=>row.id===doctor.id));
  });
  await t.test('approved OPD cancellation retains the agreed amount and refund retries post once',async()=>{
    const booked=await request('/clinical/appointments','POST',{branch_id:branch.id,department_id:department.id,doctor_id:doctor.user_id,patient_id:patient.id,appointment_date:future,appointment_time:'10:40',appointment_type:'OPD',visit_type:'New',consultation_fee:100,paid_amount:50,payment_mode:'Cash'},staffLogin.data.token);assert.equal(booked.status,201,JSON.stringify(booked.data));
    const body={type:'OPD',target_id:booked.data.id,reason:'Synthetic patient request',amount:30};
    const submitted=await request('/cancellations','POST',body,staffLogin.data.token);assert.equal(submitted.status,201,JSON.stringify(submitted.data));
    assert.equal((await request('/cancellations','POST',body,staffLogin.data.token)).status,409);
    assert.equal((await request(`/cancellations/${submitted.data.id}/refund`,'POST',{amount:30,method:'Cash',payment_key:'00000000-0000-4000-8000-000000000061'},staffLogin.data.token)).status,409);
    assert.equal((await request(`/cancellations/${submitted.data.id}/review`,'POST',{decision:'approve',amount:31,note:'Synthetic approval'},staffLogin.data.token)).status,400);
    const approved=await request(`/cancellations/${submitted.data.id}/review`,'POST',{decision:'approve',amount:30,note:'Synthetic approval'},staffLogin.data.token);assert.equal(approved.status,200,JSON.stringify(approved.data));
    const cancelled=await db.collection('clinical_appointments').findOne({id:booked.data.id});assert.equal(cancelled.status,'Cancelled');assert.equal(cancelled.cancellation_retained_amount,20);
    const refund={amount:30,method:'Cash',payment_key:'00000000-0000-4000-8000-000000000061'};
    const retries=await Promise.all([request(`/cancellations/${submitted.data.id}/refund`,'POST',refund,staffLogin.data.token),request(`/cancellations/${submitted.data.id}/refund`,'POST',refund,staffLogin.data.token)]);
    assert.deepEqual(retries.map(row=>row.status),[200,200],JSON.stringify(retries));assert.equal(retries[0].data.refund.id,retries[1].data.refund.id);
    assert.equal(retries[0].data.request.status,'Completed');assert.equal((await db.collection('clinical_appointments').findOne({id:booked.data.id})).paid_amount,20);
    assert.equal((await request(`/cancellations/${submitted.data.id}/refund`,'POST',{...refund,amount:1},staffLogin.data.token)).status,409);
    assert.equal((await request('/cancellations','POST',{type:'OPD',target_id:appointment.id,reason:'Already checked in',amount:10},staffLogin.data.token)).status,409);
    assert.equal((await request('/cancellations','POST',{type:'Lab',target_id:laboratoryOrder.data.bill_id,reason:'Already collected',amount:10},staffLogin.data.token)).status,409);
    const events=await request(`/cancellations/${submitted.data.id}/events`,'GET',null,staffLogin.data.token);assert.equal(events.status,200);assert.deepEqual(events.data.map(row=>row.action),['Requested','Approved','Refund Paid']);
    const list=await request('/cancellations?stage=refunds','GET',null,staffLogin.data.token);assert.equal(list.status,200);assert.equal(list.data.rows[0].status,'Completed');assert.equal(list.data.pending_refund,0);
  });
  await t.test('doctor consultations preserve one completed record and one receiving-department order',async()=>{
    await db.collection('users').updateOne({id:doctor.user_id},{$set:{force_password_change:false}});
    const login=await request('/auth/login','POST',{identifier:'doctor@example.invalid',password,portal:'doctor'});assert.equal(login.status,200,JSON.stringify(login.data));
    const overview=await request('/doctor/overview','GET',null,login.data.token);assert.equal(overview.status,200,JSON.stringify(overview.data));assert.ok(overview.data.appointments.some(row=>row.id===appointment.id));
    const record={patient_id:patient.id,appointment_id:appointment.id,record_type:'consultation',data:{encounter_status:'Completed',diagnosis:'Synthetic clinical test record',lab_tests:[{test_id:laboratoryOrder.data.tests[0].test_id,name:'Forged test name',amount:9999}]}};
    const completed=await request('/doctor/records','POST',record,login.data.token);assert.equal(completed.status,201,JSON.stringify(completed.data));
    const repeated=await request('/doctor/records','POST',record,login.data.token);assert.equal(repeated.status,201,JSON.stringify(repeated.data));assert.equal(completed.data.id,repeated.data.id);
    assert.equal((await request('/doctor/records','POST',{...record,data:{...record.data,diagnosis:'Changed after completion'}},login.data.token)).status,409);
    assert.equal((await db.collection('clinical_appointments').findOne({id:appointment.id})).status,'Completed');
    const orders=await db.collection('role_work_items').find({tenant_id:hospital.data.id,workspace:'laboratory','data.consultation_record_id':completed.data.id}).toArray();assert.equal(orders.length,1);assert.equal(orders[0].data.tests[0].name,'Synthetic Blood Test');assert.equal(orders[0].data.tests[0].amount,120);
    const history=await request(`/doctor/patients/${patient.id}`,'GET',null,login.data.token);assert.equal(history.status,200);assert.ok(history.data.records.some(row=>row.id===completed.data.id));
    assert.equal((await request('/doctor/soap','POST',{appointment_id:appointment.id,transcript:'Synthetic test transcript'},login.data.token)).status,503);
  });
  await t.test('pharmacy purchases create priced batches and used stock cannot be removed by purchase editing',async()=>{
    const supplier=await request('/operations/pharmacy/suppliers','POST',{name:'Synthetic Medicine Supplier'},staffLogin.data.token);assert.equal(supplier.status,201,JSON.stringify(supplier.data));
    const medicine=await request('/operations/pharmacy/medicines','POST',{name:'Synthetic Medicine Master',tax:10},staffLogin.data.token);assert.equal(medicine.status,201,JSON.stringify(medicine.data));
    const body={supplier_id:supplier.data.id,branch_id:branch.id,invoice_number:'SYNTHETIC-PURCHASE-1',purchase_date:new Date().toISOString().slice(0,10),payment_status:'Unpaid',request_id:'00000000-0000-4000-8000-000000000041',items:[{medicine_id:medicine.data.id,batch_number:'TEST-BATCH',expiry_date:'2030-12',quantity:10,free_quantity:2,purchase_rate:5,mrp:8,gst_percent:10,discount_percent:10}]};
    const created=await request('/operations/pharmacy/purchases','POST',body,staffLogin.data.token);assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.amount,49.50);
    const retried=await request('/operations/pharmacy/purchases','POST',body,staffLogin.data.token);assert.equal(retried.status,201);assert.equal(retried.data.id,created.data.id);
    const details=await request(`/operations/pharmacy/purchases/${created.data.id}`,'GET',null,staffLogin.data.token);assert.equal(details.status,200);assert.equal(details.data.items[0].current_quantity,12);assert.equal(details.data.items[0].expiry_date,'2030-12-31');
    const batchId=details.data.items[0].id,adjustment={quantity:3,reason:'Synthetic stock correction',type:'Remove',request_id:'00000000-0000-4000-8000-000000000042'};
    const updates=await Promise.all([request(`/operations/pharmacy/batches/${batchId}/adjust`,'POST',adjustment,staffLogin.data.token),request(`/operations/pharmacy/batches/${batchId}/adjust`,'POST',adjustment,staffLogin.data.token)]);assert.deepEqual(updates.map(row=>row.status),[200,200],JSON.stringify(updates));assert.equal((await db.collection('inventory_records').findOne({id:batchId})).quantity,9);
    assert.equal((await request(`/operations/pharmacy/batches/${batchId}/adjust`,'POST',{...adjustment,quantity:10,request_id:'00000000-0000-4000-8000-000000000043'},staffLogin.data.token)).status,409);
    assert.equal((await request(`/operations/pharmacy/purchases/${created.data.id}`,'PUT',body,staffLogin.data.token)).status,409);
    assert.equal((await request(`/operations/pharmacy/purchases/${created.data.id}`,'DELETE',null,staffLogin.data.token)).status,409);
    assert.equal((await request(`/operations/pharmacy/suppliers/${supplier.data.id}`,'DELETE',null,staffLogin.data.token)).status,409);
    const summary=await request('/operations/pharmacy/summary','GET',null,staffLogin.data.token);assert.equal(summary.status,200);assert.equal(summary.data.units,9);
  });
  await t.test('nursing charts are ward-scoped and concurrent medication recording creates one outcome',async()=>{
    const admission=await db.collection('ipd_admissions').findOne({tenant_id:hospital.data.id,patient_id:patient.id,active:true});
    const nurse=await request('/hospital-management/staff/save','POST',{first_name:'Synthetic',last_name:'Nurse',staff_type:'Nurse',branch_ids:[branch.id],department_id:department.id,personal:{},employment:{},professional:{ward_assignment:admission.ward_id},account:{role:'NURSE',login_email:'nurse@example.invalid',username:'synthetic-nurse',password,account_status:'Active'}},staffLogin.data.token);assert.equal(nurse.status,201,JSON.stringify(nurse.data));
    await db.collection('users').updateOne({id:nurse.data.user_id},{$set:{force_password_change:false}});
    const login=await request('/auth/login','POST',{identifier:'nurse@example.invalid',password,portal:'nurse'});assert.equal(login.status,200,JSON.stringify(login.data));
    const station=await request('/workspaces/nursing-station','GET',null,login.data.token);assert.equal(station.status,200);assert.ok(station.data.patients.some(row=>row.admission_id===admission.id));
    const clinical={patient_id:patient.id,admission_id:admission.id,type:'vitals',data:{temperature:37,pulse:75,systolic:120,diastolic:80,spo2:98,respiratory_rate:16,pain_score:0}};
    assert.equal((await request('/workspaces/nursing-station/clinical','POST',{...clinical,data:{...clinical.data,administered_at:'2000-01-01'}},login.data.token)).status,400);
    const chart=await request('/workspaces/nursing-station/clinical','POST',clinical,login.data.token);assert.equal(chart.status,201,JSON.stringify(chart.data));assert.deepEqual(chart.data.data.alerts,[]);
    assert.equal((await request('/workspaces/nursing-station/notes','POST',{patient_id:'00000000-0000-4000-8000-000000000099',admission_id:admission.id,text:'Foreign patient'},login.data.token)).status,404);
    const plan=await request('/workspaces/nursing-station/medications','POST',{patient_id:patient.id,admission_id:admission.id,name:'Synthetic medicine',dose:'Synthetic dose',schedule:'Once',first_due_at:new Date(Date.now()+60000).toISOString(),end_date:''},login.data.token);assert.equal(plan.status,201,JSON.stringify(plan.data));
    const body={outcome:'Given',notes:'Synthetic administration',scheduled_at:plan.data.occurred_at};
    const entries=await Promise.all([request(`/workspaces/nursing-station/medications/${plan.data.id}/administer`,'POST',body,login.data.token),request(`/workspaces/nursing-station/medications/${plan.data.id}/administer`,'POST',body,login.data.token)]);
    assert.deepEqual(entries.map(row=>row.status),[201,201],JSON.stringify(entries));assert.equal(entries[0].data.id,entries[1].data.id);
    assert.equal((await request(`/workspaces/nursing-station/medications/${plan.data.id}/administer`,'POST',{...body,outcome:'Missed'},login.data.token)).status,409);
    assert.equal((await db.collection('role_work_items').findOne({id:plan.data.id})).status,'Completed');
  });
  await t.test('admission edits preserve bed snapshots and discharge requires both nursing and bill clearance',async()=>{
    let stored=await db.collection('ipd_admissions').findOne({tenant_id:hospital.data.id,patient_id:patient.id,active:true});
    const body={...stored,admitted_at:stored.admitted_at.toISOString(),updated_at:stored.updated_at.toISOString(),reason_diagnosis:'Synthetic updated admission'};
    const edited=await request(`/clinical/ipd/${stored.id}`,'PUT',body,staffLogin.data.token);assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.bed_id,stored.bed_id);
    assert.equal((await request(`/clinical/ipd/${stored.id}`,'PUT',body,staffLogin.data.token)).status,409);
    const recommendation=await request(`/doctor/ipd/${stored.id}/discharge-request`,'POST',{diagnosis:'Synthetic final diagnosis',advice:'Synthetic test instructions'},staffLogin.data.token);assert.equal(recommendation.status,201,JSON.stringify(recommendation.data));
    assert.equal((await request(`/doctor/ipd/${stored.id}/discharge-request`,'POST',{diagnosis:'Duplicate'},staffLogin.data.token)).status,409);
    const requests=await request('/clinical/discharge-requests','GET',null,staffLogin.data.token);assert.equal(requests.status,200,JSON.stringify(requests.data));const item=requests.data.find(row=>row.id===stored.id&&row.request_status==='Pending');assert.ok(item);
    assert.equal((await request(`/clinical/discharge-requests/${item.request_id}/complete`,'POST',{},staffLogin.data.token)).status,409);
    const clearance=await db.collection('role_work_items').findOne({tenant_id:hospital.data.id,workspace:'nurse',kind:'discharge-clearance','data.discharge_record_id':recommendation.data.id});
    const cleared=await request(`/workspaces/nursing-station/tasks/${clearance.id}`,'PATCH',{status:'Completed',note:'Synthetic nursing clearance'},staffLogin.data.token);assert.equal(cleared.status,200,JSON.stringify(cleared.data));
    assert.equal((await request(`/clinical/discharge-requests/${item.request_id}/complete`,'POST',{},staffLogin.data.token)).status,409);
    const invoice=await db.collection('finance_records').findOne({tenant_id:hospital.data.id,kind:'invoices','data.admission_id':stored.id});assert.ok(invoice.due>0);
    const payment=await request('/operations/finance/payments','POST',{invoice_id:invoice.id,amount:invoice.due,data:{payment_method:'Cash'},request_id:'00000000-0000-4000-8000-000000000051'},staffLogin.data.token);assert.equal(payment.status,201,JSON.stringify(payment.data));
    const completed=await request(`/clinical/discharge-requests/${item.request_id}/complete`,'POST',{},staffLogin.data.token);assert.equal(completed.status,204,JSON.stringify(completed.data));
    stored=await db.collection('ipd_admissions').findOne({id:stored.id});assert.equal(stored.active,false);assert.equal(stored.status,'Discharged');assert.equal((await db.collection('beds').findOne({id:stored.bed_id})).status,'Cleaning');
    assert.equal(await db.collection('ipd_bed_stays').countDocuments({admission_id:stored.id,ended_at:null}),0);
    assert.equal((await request(`/clinical/discharge-requests/${item.request_id}/complete`,'POST',{},staffLogin.data.token)).status,409);
  });
  await t.test('platform maintenance blocks staff access while preserving owner administration',async()=>{
    assert.equal((await request('/admin/settings/maintenance_mode','PUT',{value:true},token)).status,200);
    assert.equal((await request('/patients','GET',null,staffLogin.data.token)).status,503);
    assert.equal((await request('/admin/dashboard','GET',null,token)).status,200);
    assert.equal((await request('/admin/settings/maintenance_mode','PUT',{value:false},token)).status,200);
    assert.equal((await request('/patients','GET',null,staffLogin.data.token)).status,200);
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
