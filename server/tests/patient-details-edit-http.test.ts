import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='patient-details-edit-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/patient-management.js');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),patientId=id(2),branch=id(3);
const original=pool.query;
let allowed=true,writes=0;
let patient:any={id:patientId,medical_record_number:'UHID-EXISTING',branch_id:branch,first_name:'Original',last_name:'Patient',registration_fee:250,maintenance_fee:100,deposit_amount:500,discount:25,total_amount:325,registration_payment_status:'Paid',address:{district:'Kamrup'}};
(pool as any).query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}]};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:allowed?[{code:'patient.update'}]:[]};
  if(sql.startsWith('UPDATE patients SET branch_id')){
    assert.equal(args[18],tenant);assert.match(sql,/branch_id=ANY\(\$20\)/);assert.match(sql,/deleted_at IS NULL/);
    assert.doesNotMatch(sql,/registration_fee\s*=|maintenance_fee\s*=|deposit_amount\s*=|total_amount\s*=|medical_record_number\s*=/);
    if(args[17]!==patientId)return {rows:[]};
    writes++;patient={...patient,branch_id:args[0],first_name:args[1],last_name:args[2],phone:args[7],address:{...patient.address,...args[9]}};
    return {rows:[patient]};
  }
  return {rows:[]};
};
const app=express();app.use(express.json());app.use(router);app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status||400).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const token=jwt.sign({sub:id(4),tenantId:tenant,branchId:branch,role:'hospital_admin',portal:'hospital_admin'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});
const body={branch_id:branch,first_name:'Updated',last_name:'Patient',phone:'9876543210',address:{title:'Mr.',age_years:30,state:'Assam',city:'Guwahati'}};
const save=(changes:any={},target=patientId)=>fetch(`${url}/${target}/details`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...body,...changes})});

test('editing selected patient updates the existing record and preserves UHID, registration payments and extra address data',async()=>{
  const response=await save({registration_fee:0,deposit_amount:0,total_amount:0});
  assert.equal(response.status,200);
  const saved=await response.json();assert.equal(saved.id,patientId);assert.equal(saved.first_name,'Updated');assert.equal(saved.phone,'9876543210');
  assert.equal(saved.medical_record_number,'UHID-EXISTING');assert.equal(saved.address.district,'Kamrup');
  assert.equal(saved.registration_fee,250);assert.equal(saved.maintenance_fee,100);assert.equal(saved.deposit_amount,500);assert.equal(saved.total_amount,325);assert.equal(saved.registration_payment_status,'Paid');
});
test('patient editing keeps validation, immutable UHID and patient.update permission checks',async()=>{
  const before=writes;
  assert.equal((await save({medical_record_number:'CHANGED'})).status,400);
  assert.equal((await save({phone:'invalid'})).status,400);
  assert.equal((await save({},id(99))).status,404);
  allowed=false;
  try{assert.equal((await save()).status,403);}finally{allowed=true;}
  assert.equal(writes,before);
});
test.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=original;await pool.end();});
