import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { postInventoryMovement } from '../src/inventory-movement.js';

const db = new PGlite();
const tenant='00000000-0000-4000-8000-000000000001';
const source='00000000-0000-4000-8000-000000000002';
const destination='00000000-0000-4000-8000-000000000003';
const first='00000000-0000-4000-8000-000000000004';
const second='00000000-0000-4000-8000-000000000005';
await db.exec(`CREATE TABLE inventory_records(id uuid,tenant_id uuid,kind text,branch_id uuid,data jsonb,quantity numeric,updated_at timestamptz DEFAULT now());`);
await db.query(`INSERT INTO inventory_records VALUES($1,$3,'items',$4,'{"name":"Gloves","unit":"Box"}',10,now()),($2,$3,'items',$5,'{"name":"Gloves","unit":"Box"}',2,now())`, [source,destination,tenant,first,second]);
const client = { query: (sql:string, values:unknown[]) => db.query(sql, values) } as any;
const transfer = (quantity=3) => ({item_id:source,branch_id:first,quantity,data:{to_branch:second,destination_item_id:destination}});
const balances = async () => (await db.query<{quantity:string}>('SELECT quantity FROM inventory_records ORDER BY id')).rows.map(row=>Number(row.quantity));
async function post(kind:string, body:any, branches:string[]|null=[first,second], failAfter=false) {
  await db.exec('BEGIN');
  try {
    await postInventoryMovement(client,tenant,kind,body,branches);
    if (failAfter) throw new Error('record insert failed');
    await db.exec('COMMIT');
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
test('purchase orders do not change stock; receipts and transfers conserve expected balances',async()=>{
  await post('purchase-orders', transfer());assert.deepEqual(await balances(),[10,2]);
  await post('purchases', transfer(5));assert.deepEqual(await balances(),[15,2]);
  await post('stock-transfers', transfer(4));assert.deepEqual(await balances(),[11,6]);
});
test('invalid movements and branch violations leave stock unchanged',async()=>{
  const before=await balances();
  for (const quantity of [-1,0,NaN,Infinity,999]) await assert.rejects(post('stock-transfers',transfer(quantity)));
  await assert.rejects(post('stock-transfers',transfer(),[first]), /access/);
  await assert.rejects(post('stock-transfers',{...transfer(),branch_id:second}),/source branch/);
  await assert.rejects(post('stock-transfers',{...transfer(),data:{to_branch:first,destination_item_id:source}}),/different branch/);
  await assert.rejects(post('stock-transfers',{...transfer(),item_id:tenant}),/existing inventory item/);
  assert.deepEqual(await balances(),before);
});
test('failure to save movement rolls back both stock updates',async()=>{
  const before=await balances();
  await assert.rejects(post('stock-transfers',transfer(),null,true),/record insert failed/);
  assert.deepEqual(await balances(),before);
});
test('unrelated destination items cannot receive a transfer',async()=>{
  await db.query(`UPDATE inventory_records SET data='{"name":"Syringe","unit":"Box"}' WHERE id=$1`,[destination]);
  await assert.rejects(post('stock-transfers',transfer()),/same name and unit/);
});
after(async()=>{await db.close();});
