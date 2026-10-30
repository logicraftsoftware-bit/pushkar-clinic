import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {PGlite} from '@electric-sql/pglite';
import {ZodError} from 'zod';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='inventory-regression-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {default:router}=await import('../src/finance-inventory.js');
const db=new PGlite(),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),user=id(2),branch=id(3),other=id(4),item=id(5),supplier=id(6);
await db.exec(`CREATE TABLE branches(id uuid,tenant_id uuid,name text,is_active boolean DEFAULT true);
CREATE TABLE users(id uuid,tenant_id uuid,branch_id uuid);
CREATE TABLE user_branch_access(user_id uuid,tenant_id uuid,branch_id uuid);
CREATE TABLE hospital_settings(tenant_id uuid,section text,key text,value jsonb);
CREATE TABLE inventory_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,kind text,record_code text,branch_id uuid,supplier_id uuid,category_id uuid,item_id uuid,data jsonb DEFAULT '{}',quantity numeric DEFAULT 0,amount numeric DEFAULT 0,status text,record_date date DEFAULT current_date,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(tenant_id,record_code));`);
await db.query('INSERT INTO branches VALUES($1,$3,\'Main\'),($2,$3,\'Other\')',[branch,other,tenant]);
await db.query('INSERT INTO users VALUES($1,$2,$3)',[user,tenant,branch]);
await db.query(`INSERT INTO inventory_records(id,tenant_id,kind,record_code,branch_id,data,quantity) VALUES($1,$3,'items','ITM-1',$4,'{"name":"Gloves","unit":"Box"}',10),($2,$3,'suppliers','SUP-1',NULL,'{"name":"Supplier"}',0),($5,$3,'items','ITM-2',$6,'{"name":"Gloves","unit":"Box"}',20)`,[item,supplier,tenant,branch,id(7),other]);
const originalQuery=pool.query,originalConnect=pool.connect;
const query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT id,upper(code::text) code FROM rbac_roles'))return {rows:[{id:tenant,code:'HOSPITAL_ADMIN'},{id:user,code:'INVENTORY_MANAGER'}]};
  if(sql.includes('SELECT DISTINCT rp.permission_code'))return {rows:[{code:'inventory.view'},{code:'inventory.manage'}]};
  if(sql.includes('rbac_')||sql.includes('hospital_admin_records')||sql.includes('pg_advisory_xact_lock')||/^\s*(CREATE|ALTER)/.test(sql))return {rows:[],rowCount:0};
  return db.query(sql,args.map(value=>value&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value));
};
(pool as any).query=query;
(pool as any).connect=async()=>({query,release(){}});
const app=express();app.use(express.json());app.use(router);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status||(error instanceof ZodError?400:500)).json({error:error.message}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const headers={Authorization:'Bearer '+jwt.sign({sub:user,tenantId:tenant,branchId:branch,role:'inventory_manager',portal:'inventory_manager'},process.env.JWT_SECRET!,{issuer:'careframe-api',audience:'careframe-portal'}),'Content-Type':'application/json'};
async function request(path:string,body?:any,method='POST') {
  const response=await fetch(base+path,{headers,...(body?{method,body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
}
test('inventory-only role can load inventory lookups and branch-scoped stock',async()=>{
  const look=await request('/lookups?keys=items,suppliers,categories,branches');
  assert.equal(look.status,200,JSON.stringify(look.data));assert.equal(look.data.items.length,1);assert.equal(look.data.suppliers.length,1);
  const stock=await request('/inventory/stock');assert.equal(stock.status,200);assert.deepEqual(stock.data.map((row:any)=>row.id),[item]);
});
test('receipts update stock; posted receipts cannot be edited through another resource URL',async()=>{
  const receipt=await request('/inventory/purchases',{item_id:item,supplier_id:supplier,quantity:5});
  assert.equal(receipt.status,201,JSON.stringify(receipt.data));assert.equal(receipt.data.branch_id,branch);assert.equal(receipt.data.status,'Completed');
  assert.equal((await request('/inventory/stock')).data[0].quantity,'15');
  assert.equal((await request('/inventory/purchases/'+receipt.data.id,{quantity:1},'PUT')).status,400);
  assert.equal((await request('/inventory/items/'+receipt.data.id,{data:{name:'forged'},branch_id:branch},'PUT')).status,404);
});
test('invalid receipts roll back and categories remain editable without a branch',async()=>{
  assert.equal((await request('/inventory/purchases',{item_id:item,supplier_id:supplier,quantity:-2})).status,400);
  assert.equal((await request('/inventory/purchases',{item_id:id(7),supplier_id:supplier,quantity:2})).status,403);
  assert.equal((await request('/inventory/stock')).data[0].quantity,'15');
  const category=await request('/inventory/categories',{data:{name:'Consumables'}});assert.equal(category.status,201,JSON.stringify(category.data));
  const edited=await request('/inventory/categories/'+category.data.id,{data:{name:'Clinical supplies'}},'PUT');assert.equal(edited.status,200,JSON.stringify(edited.data));
});
test('branch transfers post both balances and reject overselling without creating records',async()=>{
  await db.query('INSERT INTO user_branch_access VALUES($1,$2,$3)',[user,tenant,other]);
  const movement={branch_id:branch,item_id:item,quantity:4,data:{to_branch:other,destination_item_id:id(7)}};
  const response=await request('/inventory/stock-transfers',movement);
  assert.equal(response.status,201,JSON.stringify(response.data));
  const stock=await request('/inventory/stock');
  assert.equal(stock.data.find((row:any)=>row.id===item).quantity,'11');
  assert.equal(stock.data.find((row:any)=>row.id===id(7)).quantity,'24');
  assert.equal((await request('/inventory/stock-transfers',{...movement,quantity:999})).status,400);
  const records=await request('/inventory/stock-transfers');
  assert.equal(records.data.length,1);assert.equal(records.data[0].destination_branch_name,'Other');
});
after(async()=>{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  pool.query=originalQuery;pool.connect=originalConnect;await pool.end();await db.close();
});
