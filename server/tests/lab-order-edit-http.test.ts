import assert from "node:assert/strict";
import {test} from "node:test";
import express from "express";
import {once} from "node:events";
import type {AddressInfo} from "node:net";
process.env.DATABASE_URL="postgresql://test:test@localhost/test";
process.env.JWT_SECRET="lab-order-edit-test-secret-at-least-32-characters";
const {pool}=await import("../src/db.js");
const {editLabOrder}=await import("../src/lab-order-edit.js");
const tenant="00000000-0000-4000-8000-000000000001",branch="00000000-0000-4000-8000-000000000002",testId="00000000-0000-4000-8000-000000000003";
const original=pool.connect,stamp="2026-10-09T10:00:00.000Z";
let row:any,paid=50,invoiceUpdate:any[],orderUpdate:any[],committed=false,unavailableLookup=false;
(pool as any).connect=async()=>({release(){},async query(sql:string,args:any[]=[]){
  if(sql.includes(') referring WHERE')){assert.equal(args[0],tenant);return {rows:unavailableLookup?[]:[{name:'Dr Updated'}]};}
  if(sql.includes('FROM referral_partners')){assert.equal(args[1],tenant);return {rows:unavailableLookup?[]:[{name:'Updated Executive'}]};}
  if(sql.includes('FROM staff_members')){assert.equal(args[1],tenant);return {rows:unavailableLookup?[]:[{name:'Updated Collector'}]};}
  if(sql.includes('FROM hospital_refer_pharmacies')){assert.equal(args[1],tenant);return {rows:unavailableLookup?[]:[{id:args[0],name:'New Pharmacy',address:'Guwahati',discount_percentage:20}]};}
  if(sql.includes("FROM role_work_items")){assert.equal(args[1],tenant);assert.match(sql,/FOR UPDATE/);return {rows:[row]};}
  if(sql.includes("FROM hospital_diagnostic_masters")){assert.equal(args[0],tenant);return {rows:[{id:testId,name:"Glucose",data:{amount:100}}]};}
  if(sql.includes("FROM finance_records")){assert.equal(args[1],tenant);assert.match(sql,/FOR UPDATE/);return {rows:[{id:"bill",paid,data:{}}]};}
  if(sql.startsWith("UPDATE finance_records"))invoiceUpdate=args;
  if(sql.startsWith("UPDATE role_work_items")){orderUpdate=args;return {rows:[{...row,data:{...row.data,...JSON.parse(args[0])}}]};}
  if(sql==="COMMIT")committed=true;
  return {rows:[]};
}});
const app=express();app.use(express.json());app.patch("/orders/:id",(req,res)=>editLabOrder(Object.assign(req,{portalUser:{tenantId:tenant,branchId:branch,sub:"admin",role:"hospital_admin"}}),res));
const server=app.listen(0,"127.0.0.1");await once(server,"listening");
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/orders/order`;
function reset(){row={id:"order",kind:"pos",status:"Partially Paid",branch_id:branch,updated_at:stamp,data:{bill_id:"bill",tests:[]}};paid=50;invoiceUpdate=[];orderUpdate=[];committed=false;unavailableLookup=false;}
async function edit(overrides:any={}){return fetch(url,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({test_ids:[testId],discount:10,updated_at:stamp,...overrides})});}
test("editing a billed order synchronises totals, retains payments and records the previous order",async()=>{
  reset();const response=await edit();assert.equal(response.status,200);
  assert.deepEqual(invoiceUpdate.slice(0,4),[100,90,40,"Partially Paid"]);
  assert.equal(committed,true);
  const data=(await response.json()).data;
  assert.equal(data.paid_amount,50);assert.equal(data.due_amount,40);assert.equal(data.order_edit_history.length,1);
});
test("edits reject orders sent to sample collection and stale versions without changing bills",async()=>{
  reset();row.data.sample_requested_at=stamp;assert.equal((await edit()).status,409);assert.equal(invoiceUpdate.length,0);
  reset();assert.equal((await edit({updated_at:"2026-10-09T09:00:00Z"})).status,409);assert.equal(committed,false);
});
test("removing tests cannot reduce a bill below payments already collected",async()=>{
  reset();paid=110;assert.equal((await edit()).status,409);assert.equal(invoiceUpdate.length,0);assert.equal(committed,false);
});

test('order edits retain the pharmacy snapshot and recalculate its discount when tests change',async()=>{
  reset();paid=20;
  row.data={...row.data,refer_pharmacy_id:'pharmacy',refer_pharmacy_name:'Town Pharmacy',pharmacy_discount_percentage:50,pharmacy_discount_amount:50,manual_discount_amount:0};
  const response=await edit({discount:10});assert.equal(response.status,200);
  assert.deepEqual(invoiceUpdate.slice(0,4),[100,45,25,'Partially Paid']);
  const patch=JSON.parse(invoiceUpdate[4]);assert.equal(patch.discount_amount,55);assert.equal(patch.pharmacy_discount_amount,45);assert.equal(patch.manual_discount_amount,10);
  const data=(await response.json()).data;assert.equal(data.refer_pharmacy_name,'Town Pharmacy');assert.equal(data.pharmacy_discount_percentage,50);
});
const doctorId='00000000-0000-4000-8000-000000000011',partnerId='00000000-0000-4000-8000-000000000012',collectorId='00000000-0000-4000-8000-000000000013',pharmacyId='00000000-0000-4000-8000-000000000014';
test('shared form investigation edits synchronise invoice metadata without altering collected payments',async()=>{
 reset();paid=20;row.data.source='Self';
 const response=await edit({source:'Social Media',referred_by:doctorId,referral_partner_id:partnerId,collector_id:collectorId,refer_pharmacy_id:pharmacyId,pharmacy_discount_percentage:20,diagnosis:'Follow up',urgent:true});
 assert.equal(response.status,200);const data=(await response.json()).data;
 assert.equal(data.referred_by,'Dr Updated');assert.equal(data.executive,'Updated Executive');assert.equal(data.collector,'Updated Collector');assert.equal(data.refer_pharmacy_name,'New Pharmacy');assert.equal(data.source,'Social Media');assert.equal(data.paid_amount,20);assert.equal(data.tests[0].priority,'Urgent');
 const billPatch=JSON.parse(invoiceUpdate[4]);assert.equal(billPatch.source,'Laboratory');assert.equal(billPatch.investigation_source,'Social Media');assert.equal(billPatch.collector_id,collectorId);assert.equal(billPatch.refer_pharmacy_name,'New Pharmacy');
 assert.deepEqual(invoiceUpdate.slice(0,4),[100,72,52,'Partially Paid']);assert.equal(data.order_edit_history[0].source,'Self');
});
test('invalid referral, staff and pharmacy selections reject without touching the invoice',async()=>{
 for(const field of ['referred_by','referral_partner_id','collector_id','refer_pharmacy_id']){
  reset();unavailableLookup=true;assert.equal((await edit({[field]:doctorId})).status,409);assert.equal(invoiceUpdate.length,0);assert.equal(committed,false);
 }
});
test('retained tests use their saved amounts rather than new catalogue rates',async()=>{
 reset();row.data.tests=[{test_id:testId,name:'Glucose',amount:150}];
 assert.equal((await edit()).status,200);assert.deepEqual(invoiceUpdate.slice(0,4),[150,140,90,'Partially Paid']);
});
test('removing a pharmacy clears its snapshot and its discount',async()=>{
 reset();paid=20;row.data.refer_pharmacy_id=pharmacyId;row.data.pharmacy_discount_percentage=50;
 const response=await edit({refer_pharmacy_id:null,pharmacy_discount_percentage:50});assert.equal(response.status,200);const data=(await response.json()).data;assert.equal(data.refer_pharmacy_id,null);assert.equal(data.pharmacy_discount_percentage,0);assert.equal(data.refer_pharmacy_name,'Not Applicable');
});

test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.connect=original;await pool.end();});
