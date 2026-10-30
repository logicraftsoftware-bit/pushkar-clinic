import {test} from 'node:test';import assert from 'node:assert/strict';
import express from 'express';import jwt from 'jsonwebtoken';import {once} from 'node:events';import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';process.env.JWT_SECRET='doctor-availability-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js'),{default:router}=await import('../src/clinical-operations.js');
const tenant='00000000-0000-4000-8000-000000000001',doctor='00000000-0000-4000-8000-000000000002',patient='00000000-0000-4000-8000-000000000003';
const recurring={from_time:'07:00',to_time:'22:00',max_slots:200,slot_mode:'capacity',start_date:'2026-10-09'};
let bookings:any[]=[],writes=0,dayLocked=false,selectionAllowed=true,savedCharges:any[]=[];
const originalQuery=pool.query,originalConnect=pool.connect;
const query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}]};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'appointment.view'},{code:'appointment.create'},{code:'appointment.update'},{code:'ipd.view'}]};
  if(sql.startsWith('SELECT doctor.id'))return {rows:selectionAllowed?[{id:doctor,registration_fee:200,maintenance_fee:100}]:[]};
  if(sql.includes('FROM patients'))return {rows:[{id:patient}]};
  if(sql.includes('FROM users u')&&sql.includes('recurring'))return {rows:[{doctor_name:'Test Doctor',department_name:'General',schedule:[],recurring,unavailable:[],duration:20,maximum:200}]};
  if(sql.includes('SELECT appointment_time,slot_serial'))return {rows:bookings};
  if(sql.includes('SELECT appointment_number')&&sql.includes('appointment_time=$4'))return {rows:bookings.filter(row=>row.appointment_time===args[3])};
  if(sql.includes('pg_advisory_xact_lock')&&String(args[0]).startsWith('appointment-day:'))dayLocked=true;
  if(sql.startsWith('INSERT INTO clinical_appointments')){assert.ok(dayLocked);savedCharges=JSON.parse(args[18]);writes++;const row={appointment_time:args[7],slot_serial:args[22],token_number:args[14]};bookings.push(row);return{rows:[row]};}
  return {rows:[],rowCount:0};
};
(pool as any).query=query;(pool as any).connect=async()=>({query,release(){}});
const app=express();app.use(express.json());app.use(router);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const token=jwt.sign({sub:doctor,tenantId:tenant,branchId:tenant,role:'hospital_admin',portal:'hospital_admin'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'}),headers={authorization:`Bearer ${token}`,'Content-Type':'application/json'};
test('slot lookup and appointment writes reject doctors outside the chosen branch and department',async()=>{
  selectionAllowed=false;
  try {
    const slots=await fetch(base+`/appointment-slots?branch_id=${tenant}&department_id=${tenant}&doctor_id=${doctor}&date=2030-01-01`,{headers});assert.equal(slots.status,400);
    const body={branch_id:tenant,department_id:tenant,doctor_id:doctor,patient_id:patient,appointment_date:'2030-01-01',appointment_time:'09:00',status:'Booked',appointment_type:'OPD',visit_type:'New',payment_status:'Unpaid',source:'Reception'};
    for(const [method,path] of [['POST','/appointments'],['PUT','/appointments/'+patient]]){
      const response=await fetch(base+path,{method,headers,body:JSON.stringify(body)});assert.equal(response.status,400);assert.match((await response.json()).error,/department/);
    }
    assert.equal(writes,0);
  } finally {selectionAllowed=true;}
});
test('same-day slots API hides elapsed times for both regular appointments and five-minute tokens',async context=>{
  context.mock.timers.enable({apis:['Date'],now:new Date('2030-01-01T12:02:30Z')});
  bookings=[];
  for(const suffix of ['', '&slot_interval=5']){
    const response=await fetch(base+`/appointment-slots?branch_id=${tenant}&department_id=${tenant}&doctor_id=${doctor}&date=2030-01-01${suffix}`,{headers});
    assert.equal(response.status,200);
    const slots=await response.json();assert.ok(slots.length>0);assert.ok(slots.every((slot:any)=>slot.time>'17:32'));
  }
});
test('daily doctor slots API returns 200 bookable times and booking the final slot produces serial 200',async()=>{
  const response=await fetch(base+`/appointment-slots?branch_id=${tenant}&department_id=${tenant}&doctor_id=${doctor}&date=2030-01-01`,{headers});assert.equal(response.status,200);
  const slots=await response.json();assert.equal(slots.length,200);assert.equal(slots.at(-1).time,'21:55');
  const body={branch_id:tenant,department_id:tenant,doctor_id:doctor,patient_id:patient,appointment_date:'2030-01-01',appointment_time:'21:55',appointment_type:'OPD',visit_type:'New',payment_status:'Unpaid',source:'Reception',status:'Booked'};
  const saved=await fetch(base+'/appointments',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(saved.status,201);const data=await saved.json();assert.equal(data.slot_serial,200);assert.match(data.token_number,/\/200$/);
  const duplicate=await fetch(base+'/appointments',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(duplicate.status,409);assert.equal(writes,1);
  const remaining=await(await fetch(base+`/appointment-slots?branch_id=${tenant}&department_id=${tenant}&doctor_id=${doctor}&date=2030-01-01`,{headers})).json();assert.equal(remaining.length,199);assert.ok(!remaining.some((slot:any)=>slot.serial===200));
});
test('an already-full day blocks additional bookings even when legacy times do not match new slots',async()=>{
  bookings=Array.from({length:200},()=>({appointment_time:'08:20',slot_serial:null}));const before=writes;
  const response=await fetch(base+'/appointments',{method:'POST',headers,body:JSON.stringify({branch_id:tenant,department_id:tenant,doctor_id:doctor,patient_id:patient,appointment_date:'2030-01-01',appointment_time:'07:00',appointment_type:'OPD',visit_type:'New',payment_status:'Unpaid',source:'Reception',status:'Booked'})});
  assert.equal(response.status,409);assert.equal(writes,before);
});
test('queue tokens use five-minute times and reject duplicate or full-day bookings',async()=>{
 bookings=[];const response=await fetch(base+'/appointment-slots?branch_id='+tenant+'&department_id='+tenant+'&doctor_id='+doctor+'&date=2030-01-01&slot_interval=5',{headers});assert.equal(response.status,200);const slots=await response.json();assert.equal(slots[0].time,'07:00');assert.equal(slots[1].time,'07:05');assert.ok(slots.some((slot:any)=>slot.time==='09:05'));
 const body={branch_id:tenant,department_id:tenant,doctor_id:doctor,patient_id:patient,appointment_date:'2030-01-01',appointment_time:'09:05',appointment_type:'OPD',visit_type:'New',payment_status:'Unpaid',source:'Reception',status:'Booked',slot_interval:5};
 const first=await fetch(base+'/appointments',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(first.status,201);assert.equal((await first.json()).slot_serial,1);
 const before=writes;assert.equal((await fetch(base+'/appointments',{method:'POST',headers,body:JSON.stringify(body)})).status,409);assert.equal(writes,before);
 const next=await fetch(base+'/appointments',{method:'POST',headers,body:JSON.stringify({...body,appointment_time:'09:10'})});assert.equal(next.status,201);assert.equal((await next.json()).slot_serial,2);
 bookings=Array.from({length:200},()=>({appointment_time:'07:00',slot_serial:null}));assert.equal((await fetch(base+'/appointment-slots?branch_id='+tenant+'&department_id='+tenant+'&doctor_id='+doctor+'&date=2030-01-01&slot_interval=5',{headers}).then(r=>r.json())).length,0);
 assert.equal((await fetch(base+'/appointments',{method:'POST',headers,body:JSON.stringify({...body,appointment_time:'09:15'})})).status,409);
});
test('new OPD checkbox selections use server branch rates and omit unchecked fees',async()=>{
 const baseBody={branch_id:tenant,department_id:tenant,doctor_id:doctor,patient_id:patient,appointment_date:'2030-01-01',appointment_time:'09:00',slot_interval:5,appointment_type:'OPD',visit_type:'New',payment_status:'Unpaid',source:'Reception',status:'Booked',charges:[{label:'Registration Fee',amount:9999,doctor_fee:'registration_fee'}]};
 for(const selected of [{registration_fee:false,maintenance_fee:false},{registration_fee:true,maintenance_fee:false},{registration_fee:false,maintenance_fee:true},{registration_fee:true,maintenance_fee:true}]){
  bookings=[];const response=await fetch(base+'/appointments',{method:'POST',headers,body:JSON.stringify({...baseBody,doctor_fee_selection:JSON.stringify(selected)})});assert.equal(response.status,201);
  assert.deepEqual(savedCharges.map(row=>row.amount),[...(selected.registration_fee?[200]:[]),...(selected.maintenance_fee?[100]:[])]);
 }
});

test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=originalQuery;pool.connect=originalConnect;await pool.end();});
