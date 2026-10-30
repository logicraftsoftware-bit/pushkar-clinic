import assert from "node:assert/strict";
import {test} from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import {once} from "node:events";
import type {AddressInfo} from "node:net";

process.env.DATABASE_URL="postgresql://test:test@localhost/test";
process.env.JWT_SECRET="lab-patient-search-test-secret-at-least-32-characters";
const {pool}=await import("../src/db.js");
const {default:router}=await import("../src/role-panels.js");
const tenant="00000000-0000-4000-8000-000000000001";
const branch="00000000-0000-4000-8000-000000000002";
const patient={id:"00000000-0000-4000-8000-000000000003",patient_name:"Ajites das",medical_record_number:"UHID-005494"};
const testId="00000000-0000-4000-8000-000000000004";
const originalQuery=pool.query,originalConnect=pool.connect;
let unavailable=false;
(pool as any).query=async(sql:string,args:unknown[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}]};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'lab.order.view'},{code:'lab.result.create'},{code:'billing.create'},{code:'billing.view'}]};
  if(sql.includes("FROM patients")){
    assert.doesNotMatch(sql,/branch_id/);
    assert.match(sql,/deleted_at IS NULL/);
    assert.match(sql,/tenant_id=\$/);
    assert.equal(args[sql.includes("WHERE id=")?1:0],tenant);
    return {rows:unavailable?[]:[patient]};
  }
  if(sql.includes("FROM hospital_diagnostic_masters"))return {rows:[{id:testId,name:"Glucose",data:{amount:100}}],rowCount:1};
  if(sql.includes("FROM branches"))return {rows:[{name:"Medicity Guwahati"}]};
  return {rows:[]};
};
(pool as any).connect=async()=>({release(){},async query(sql:string,args:unknown[]=[]){
  if(sql.includes("INSERT INTO role_work_items")){
    assert.equal(args[1],branch);
    assert.equal(args[2],patient.id);
    return {rows:[{id:"00000000-0000-4000-8000-000000000005"}]};
  }
  if(sql.includes("INSERT INTO finance_records")){
    assert.equal(args[3],branch);
    return {rows:[{id:"00000000-0000-4000-8000-000000000006"}]};
  }
  return {rows:[]};
}});
const app=express();app.use(express.json());app.use(router);
const server=app.listen(0,"127.0.0.1");await once(server,"listening");
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
function headers(role="hospital_admin"){
  const token=jwt.sign({sub:patient.id,tenantId:tenant,branchId:branch,role},process.env.JWT_SECRET!,{issuer:"careframe-api",audience:"careframe-portal"});
  return {authorization:`Bearer ${token}`,"content-type":"application/json"};
}
test("lab search finds hospital patients registered at another branch",async()=>{
  for(const role of ["hospital_admin","laboratory","receptionist"]){
    const response=await fetch(url+"/lab-patients?search=ajites",{headers:headers(role)});
    assert.equal(response.status,200);
    assert.equal((await response.json())[0].id,patient.id);
  }
});
test("existing hospital patient can be billed at the chosen lab centre",async()=>{
  const response=await fetch(url+"/lab-own-orders",{method:"POST",headers:headers(),body:JSON.stringify({patient_id:patient.id,test_ids:[testId],center_id:branch})});
  assert.equal(response.status,201);
  assert.equal((await response.json()).bill.medical_record_number,patient.medical_record_number);
});
test("unavailable patients are rejected and unauthorised users cannot search",async()=>{
  unavailable=true;
  const response=await fetch(url+"/lab-own-orders",{method:"POST",headers:headers(),body:JSON.stringify({patient_id:patient.id,test_ids:[testId]})});
  assert.equal(response.status,400);
  assert.equal((await fetch(url+"/lab-patients?search=ajites",{headers:headers("patient")})).status,403);
});
test.after(async()=>{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  pool.query=originalQuery;pool.connect=originalConnect;await pool.end();
});
