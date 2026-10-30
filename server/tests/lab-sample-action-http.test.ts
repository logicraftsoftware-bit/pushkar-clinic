import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='lab-sample-action-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js'),{default:router}=await import('../src/role-panels.js');
const tenant='00000000-0000-4000-8000-000000000001',order='00000000-0000-4000-8000-000000000002';
const originalQuery=pool.query,originalConnect=pool.connect;
let row:any,writes=0;
(pool as any).query=async(sql:string)=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'}]};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'lab.order.view'}]};
  return {rows:[]};
};
(pool as any).connect=async()=>({release(){},async query(sql:string,args:any[]=[]){
  if(sql.startsWith('SELECT * FROM role_work_items')){assert.equal(args[1],tenant);assert.match(sql,/FOR UPDATE/);return {rows:[row]};}
  if(sql.startsWith('UPDATE role_work_items')){
    writes++;row={...row,kind:sql.includes("kind='results'")?'results':'sample collection',status:sql.includes("status='Sample Collected'")?'Sample Collected':'Barcode Generated',data:{...row.data,...JSON.parse(args[0])}};
    return {rows:[row]};
  }
  return {rows:[]};
}});
const app=express();app.use(express.json());app.use(router);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/work-items/${order}/sample-action`;
const token=jwt.sign({sub:order,tenantId:tenant,branchId:order,role:'hospital_admin'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'});
async function action(action:string){return fetch(url,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action,collector:'Sample Collector'})});}
test('a newly billed paid order generates barcodes and is collected without a manual send-sample step',async()=>{
  row={id:order,tenant_id:tenant,workspace:'laboratory',kind:'pos',status:'Paid',data:{bill_id:order,tests:[{test_id:order,name:'Blood test'}]}};writes=0;
  assert.equal((await action('generate_barcodes')).status,200);
  assert.equal(row.kind,'sample collection');assert.equal(row.status,'Barcode Generated');assert.equal(row.data.barcodes.length,1);
  assert.equal((await action('generate_barcodes')).status,409);assert.equal(writes,1);
  assert.equal((await action('collected')).status,200);assert.equal(row.kind,'results');assert.ok(row.data.collected_at);
});
test('doctor orders can start collection before billing; cancelled orders cannot',async()=>{
  row={id:order,tenant_id:tenant,workspace:'laboratory',kind:'orders',status:'Pending',data:{tests:[{test_id:order,name:'Blood test'}]}};
  assert.equal((await action('generate_barcodes')).status,200);
  row.status='Cancelled';const before=writes;
  assert.equal((await action('generate_barcodes')).status,409);assert.equal(writes,before);
});
test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=originalQuery;pool.connect=originalConnect;await pool.end();});
