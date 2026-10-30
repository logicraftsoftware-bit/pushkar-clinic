import {test,after} from 'node:test';import assert from 'node:assert/strict';import express from 'express';import jwt from 'jsonwebtoken';import {once} from 'node:events';import type {AddressInfo} from 'node:net';import {PGlite} from '@electric-sql/pglite';import {ZodError} from 'zod';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';process.env.JWT_SECRET='consultation-regression-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');const {default:router}=await import('../src/doctor-panel.js');
const db=new PGlite();const tenant='00000000-0000-4000-8000-000000000001',doctor='00000000-0000-4000-8000-000000000002',patient='00000000-0000-4000-8000-000000000003',appointment='00000000-0000-4000-8000-000000000004',other='00000000-0000-4000-8000-000000000005';
await db.exec(`CREATE TABLE users(id uuid,tenant_id uuid,role text,is_active boolean);CREATE TABLE staff_members(user_id uuid,tenant_id uuid,status text);CREATE TABLE patients(id uuid,tenant_id uuid,first_name text,last_name text,medical_record_number text,allergies text,deleted_at timestamptz);CREATE TABLE clinical_appointments(id uuid,tenant_id uuid,patient_id uuid,doctor_id uuid,branch_id uuid,status text,appointment_date date,updated_at timestamptz);CREATE TABLE ipd_admissions(id uuid,tenant_id uuid,patient_id uuid,consultant_doctor_id uuid,status text,branch_id uuid);CREATE TABLE doctor_clinical_records(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,doctor_id uuid,patient_id uuid,appointment_id uuid,admission_id uuid,record_type text,data jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());CREATE TABLE role_work_items(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,branch_id uuid,patient_id uuid,created_by uuid,workspace text,kind text,title text,status text,priority text,data jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
await db.query('INSERT INTO users VALUES($1,$2,\'doctor\',true)',[doctor,tenant]);await db.query('INSERT INTO patients VALUES($1,$2,\'Test\',\'Patient\',\'UHID-1\',\'Penicillin\',null)',[patient,tenant]);await db.query('INSERT INTO clinical_appointments VALUES($1,$2,$3,$4,$2,\'Open\',current_date,now())',[appointment,tenant,patient,doctor]);
const originalQuery=pool.query,originalConnect=pool.connect;
const query=async(sql:string,args:any[]=[])=>{if(sql.includes('CREATE TABLE IF NOT EXISTS doctor_clinical_records'))return {rows:[],rowCount:0};const result=await db.query(sql,args.map(v=>v&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v));return {...result,rowCount:result.rows.length||result.affectedRows||0};};
let tail=Promise.resolve();(pool as any).query=query;(pool as any).connect=async()=>{let release!:()=>void;const before=tail;tail=new Promise<void>(r=>release=r);await before;return {query,release};};
const app=express();app.use(express.json());app.use(router);app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status||(error instanceof ZodError?400:500)).json({error:error.message}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const token=(sub=doctor)=>jwt.sign({sub,tenantId:tenant,branchId:tenant,role:'doctor'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});const headers={Authorization:`Bearer ${token()}`,'Content-Type':'application/json'};
const medicine={name:'Paracetamol',dose:'1 tablet',quantity:'6'};
const data={symptoms:'Sore throat',history:'Reviewed',diagnosis:'Acute Pharyngitis',advice:'Review',follow_up:'2026-10-22',medicines:[medicine],lab_tests:[{name:'CBC',priority:'Routine'}],radiology_tests:[{name:'Chest X-Ray',priority:'Routine'}]};
const save=(value:any,extra:any={})=>fetch(base+'/records',{method:'POST',headers,body:JSON.stringify({patient_id:patient,appointment_id:appointment,record_type:'consultation',data:value,...extra})});
const count=async(table:string)=>(await db.query<{n:number}>(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
test('OPD draft persists and reopens with all fields; repeated saves and priority changes reuse record and orders',async()=>{
 const first=await save(data);assert.equal(first.status,201,await first.clone().text());const record=await first.json();
 const repeated=await save(data);assert.equal(repeated.status,201);assert.equal((await repeated.json()).id,record.id);
 const urgent={...data,radiology_tests:[{name:'Chest X-Ray',priority:'Urgent'}]};assert.equal((await save(urgent)).status,201);
 assert.equal(await count('doctor_clinical_records'),1);assert.equal(await count('role_work_items'),2);
 const order=(await db.query<any>("SELECT * FROM role_work_items WHERE workspace='laboratory'")).rows[0];assert.equal(order.priority,'High');assert.equal(order.data.tests.length,2);assert.equal(order.data.tests.find((test:any)=>test.test_type==='Radiology').priority,'Urgent');assert.equal(order.data.doctor_id,doctor);assert.equal(order.data.appointment_id,appointment);assert.equal(order.patient_id,patient);
 const reopened=await fetch(base+'/patients/'+patient,{headers});assert.equal(reopened.status,200);const saved=(await reopened.json()).records[0].data;for(const key of ['symptoms','diagnosis','follow_up','history'])assert.equal(saved[key],(data as any)[key]);assert.deepEqual(saved.medicines,[medicine]);
});
test('adding test type metadata does not block unchanged processed legacy diagnostic orders',async()=>{
 await db.exec("UPDATE role_work_items SET status='Processing',data=jsonb_set(data,'{tests}',(SELECT jsonb_agg(test-'test_type') FROM jsonb_array_elements(data->'tests') test)) WHERE workspace='laboratory'");
 const response=await save({...data,radiology_tests:[{name:'Chest X-Ray',priority:'Urgent'}]});assert.equal(response.status,201,await response.clone().text());
 await db.exec("UPDATE role_work_items SET status='Pending' WHERE workspace='laboratory'");
});

test('blank medicine, dosage, negative/zero/huge quantity and blank test rows fail without changing records or orders',async()=>{
 const before=await db.query<any>('SELECT data FROM doctor_clinical_records');
 for(const patch of [{medicines:[{...medicine,name:''}]},{medicines:[{...medicine,dose:''}]},{medicines:[{...medicine,quantity:'-8'}]},{medicines:[{...medicine,quantity:0}]},{medicines:[{...medicine,quantity:9999}]},{medicines:[{...medicine,dose:'9999 tablets'}]},{lab_tests:[{name:''}]},{radiology_tests:[{name:''}]}]){const response=await save({...data,...patch});assert.equal(response.status,400,await response.text());}
 assert.deepEqual((await db.query('SELECT data FROM doctor_clinical_records')).rows,before.rows);assert.equal(await count('role_work_items'),2);
});
test('Penicillin allergy blocks Amoxicillin and its combination; negative control remains valid',async()=>{
 for(const name of ['Amoxicillin','amoxicillin / clavulanic acid','AMOXYCILLIN 500mg']){const response=await save({...data,medicines:[{...medicine,name}]});assert.equal(response.status,422);assert.equal((await response.json()).code,'DRUG_ALLERGY_CONFLICT');}
 assert.equal(await count('role_work_items'),2);
});
test('unauthorized encounter is rejected even when patient exists',async()=>{
 const response=await save(data,{appointment_id:other});assert.equal(response.status,403);assert.equal(await count('doctor_clinical_records'),1);
});
test('partial note saves preserve prescriptions, tests and other existing clinical fields',async()=>{
 const response=await save({notes:'Additional clinical note'});assert.equal(response.status,201);
 const saved=(await response.json()).data;assert.deepEqual(saved.medicines,[medicine]);assert.equal(saved.lab_tests[0].name,'CBC');assert.equal(saved.history,data.history);assert.equal(await count('role_work_items'),2);
});
test('a second active doctor cannot read or save another doctors encounter',async()=>{
 await db.query("INSERT INTO users VALUES($1,$2,'doctor',true)",[other,tenant]);
 const foreignHeaders={...headers,Authorization:'Bearer '+token(other)};
 const read=await fetch(base+'/patients/'+patient,{headers:foreignHeaders});assert.equal(read.status,404);
 const write=await fetch(base+'/records',{method:'POST',headers:foreignHeaders,body:JSON.stringify({patient_id:patient,appointment_id:appointment,record_type:'consultation',data})});assert.equal(write.status,403);
});
test('removing unsent orders cancels them, and re-adding updates the same order',async()=>{
 assert.equal((await save({...data,lab_tests:[],radiology_tests:[]})).status,201);
 assert.equal((await db.query<any>("SELECT status FROM role_work_items WHERE workspace='laboratory'")).rows[0].status,'Cancelled');
 assert.equal((await save(data)).status,201);assert.equal(await count('role_work_items'),2);
 assert.equal((await db.query<any>("SELECT status FROM role_work_items WHERE workspace='laboratory'")).rows[0].status,'Pending');
});
test('simultaneous saves reuse a single consultation and downstream orders',async()=>{
 const responses=await Promise.all([save(data),save(data),save(data)]);for(const response of responses)assert.equal(response.status,201);
 assert.equal(await count('doctor_clinical_records'),1);assert.equal(await count('role_work_items'),2);
});
test('a downstream processed-order conflict rolls back the entire save',async()=>{
 await db.exec("UPDATE role_work_items SET status='Study In Progress' WHERE workspace='laboratory'");
 const records=(await db.query('SELECT data FROM doctor_clinical_records')).rows;
 const orders=(await db.query('SELECT id,data FROM role_work_items ORDER BY id')).rows;
 const response=await save({...data,diagnosis:'Must roll back',lab_tests:[{name:'Changed test'}],radiology_tests:[{name:'Different study'}]});assert.equal(response.status,409);
 assert.deepEqual((await db.query('SELECT data FROM doctor_clinical_records')).rows,records);assert.deepEqual((await db.query('SELECT id,data FROM role_work_items ORDER BY id')).rows,orders);
 await db.exec("UPDATE role_work_items SET status='Pending' WHERE workspace='laboratory'");
});
test('doctors cannot send branch-scoped radiology tests to an excluded encounter branch',async()=>{
 const scopedTest='00000000-0000-4000-8000-000000000100';
 await db.exec('CREATE TABLE IF NOT EXISTS hospital_diagnostic_masters(id uuid,tenant_id uuid,domain text,kind text,data jsonb)');
 await db.query("INSERT INTO hospital_diagnostic_masters VALUES($1,$2,'pathology','test',$3)",[scopedTest,tenant,JSON.stringify({test_type:'Radiology',amount:2000,available_branch_ids:[other]})]);
 const before=await db.query('SELECT data FROM doctor_clinical_records');
 const response=await save({...data,radiology_tests:[{test_id:scopedTest,name:'CT Chest',amount:2000}]});
 assert.equal(response.status,400,await response.clone().text());assert.match((await response.json()).error,/not available/);
 assert.deepEqual((await db.query('SELECT data FROM doctor_clinical_records')).rows,before.rows);
});

test('completion updates encounter atomically and prevents silent later edits',async()=>{
 const response=await save({...data,encounter_status:'Completed'});assert.equal(response.status,201,await response.clone().text());const record=await response.json();assert.equal(record.data.encounter_status,'Completed');assert.equal(record.data.completed_by,doctor);
 assert.equal((await db.query<any>('SELECT status FROM clinical_appointments')).rows[0].status,'Completed');
 const changed=await save({...data,diagnosis:'Silent overwrite'});assert.equal(changed.status,409);assert.equal((await db.query<any>('SELECT data FROM doctor_clinical_records')).rows[0].data.diagnosis,data.diagnosis);assert.equal(await count('role_work_items'),2);
 const retry=await save({...data,encounter_status:'Completed'});assert.equal(retry.status,200);assert.equal(await count('role_work_items'),2);
});
test('IPD prescription persists, reopens and updates the same visit and pharmacy order',async()=>{
 await db.query("INSERT INTO ipd_admissions VALUES($1,$2,$3,$4,'Admitted',$2)",[other,tenant,patient,doctor]);
 const write=(value:any,record_id?:string,admission_id=other)=>fetch(base+'/records',{method:'POST',headers,body:JSON.stringify({patient_id:patient,admission_id,record_id,record_type:'consultation',data:value})});
 const response=await write(data);assert.equal(response.status,201,await response.clone().text());const record=await response.json();
 assert.equal(record.admission_id,other);assert.equal(record.appointment_id,null);assert.deepEqual(record.data.medicines,[medicine]);
 const reopened=await fetch(base+'/patients/'+patient,{headers});assert.equal(reopened.status,200);assert.deepEqual((await reopened.json()).records.find((r:any)=>r.id===record.id).data.medicines,[medicine]);
 const repeated=await write({...data,diagnosis:'Updated IPD diagnosis'},record.id);assert.equal(repeated.status,201,await repeated.clone().text());assert.equal((await repeated.json()).id,record.id);
 assert.equal((await db.query<any>('SELECT count(*)::int n FROM doctor_clinical_records WHERE admission_id=$1',[other])).rows[0].n,1);
 const orders=await db.query<any>("SELECT * FROM role_work_items WHERE data->>'admission_id'=$1",[other]);assert.equal(orders.rows.length,2);
 assert.deepEqual(orders.rows.find((r:any)=>r.workspace==='pharmacy').data.medicines,[medicine]);
 assert.equal((await write({medicines:[{...medicine,quantity:-8}]},record.id)).status,400);
 assert.equal((await write(data,appointment)).status,404);
 await db.exec("UPDATE role_work_items SET status='Dispensed' WHERE workspace='pharmacy' AND data->>'admission_id'='"+other+"'");
 assert.equal((await write({...data,medicines:[{...medicine,quantity:'8'}]},record.id)).status,409);
 assert.equal((await db.query<any>('SELECT data FROM doctor_clinical_records WHERE id=$1',[record.id])).rows[0].data.diagnosis,'Updated IPD diagnosis');
 const next=await write({...data,diagnosis:'New visit'});assert.equal(next.status,201);assert.notEqual((await next.json()).id,record.id);
 await db.query("UPDATE ipd_admissions SET status='Discharged' WHERE id=$1",[other]);assert.equal((await write(data,record.id)).status,403);
});

after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=originalQuery;pool.connect=originalConnect;await db.close();await pool.end();});
