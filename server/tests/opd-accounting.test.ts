import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {reconcileOpdPaymentsSql} from '../src/opd-accounting.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('OPD accounting recovers eight paid appointments once, excludes other branches and hospitals, and preserves collector provenance',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE TABLE clinical_appointments(id uuid,tenant_id uuid,branch_id uuid,patient_id uuid,appointment_number text,appointment_date date,paid_amount numeric,refund_amount numeric DEFAULT 0,payment_mode text,payment_reference text);
      CREATE TABLE finance_records(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,kind text,record_number text,patient_id uuid,branch_id uuid,invoice_id uuid,data jsonb,amount numeric,total numeric,paid numeric,due numeric,status text,record_date date,created_by uuid,UNIQUE(tenant_id,record_number));`);
    for(let n=10;n<20;n++)await db.query(`INSERT INTO clinical_appointments VALUES($1,$2,$3,$4,$5,'2026-10-27',500,0,'Cash','')`,[id(n),n===19?id(2):id(1),n===18?id(4):id(3),id(5),`APT-${n}`]);
    const sync=()=>db.query(reconcileOpdPaymentsSql,[id(1),[id(3)],null,null]);
    await sync();await sync();
    const rows=await db.query<any>(`SELECT * FROM finance_records`);
    assert.equal(rows.rows.length,8);
    assert.equal(rows.rows.reduce((sum,row)=>sum+Number(row.amount),0),4000);
    assert.ok(rows.rows.every(row=>row.created_by===null&&row.data.legacy_receipt===true));
    assert.ok(rows.rows.every(row=>new Date(row.record_date).toISOString().startsWith('2026-10-27')));
    // A further collection posts only its increment, attributed to the actual collector.
    await db.query('UPDATE clinical_appointments SET paid_amount=700 WHERE id=$1',[id(10)]);
    await db.query(reconcileOpdPaymentsSql,[id(1),[id(3)],id(10),id(6)]);
    const next=await db.query<any>('SELECT * FROM finance_records WHERE created_by=$1',[id(6)]);
    assert.equal(next.rows.length,1);assert.equal(Number(next.rows[0].amount),200);
    // A refund reduces the appointment balance but must not create another receipt.
    await db.query('UPDATE clinical_appointments SET paid_amount=600,refund_amount=100 WHERE id=$1',[id(10)]);
    await sync();assert.equal((await db.query('SELECT * FROM finance_records')).rows.length,9);
    // Existing check-in receipts count; a linked laboratory receipt does not.
    await db.query(`DELETE FROM finance_records WHERE data->>'appointment_id'=$1`,[id(11)]);
    for(const [amount,source] of [[200,'OPD Check-in'],[900,'Laboratory']] as const)
      await db.query(`INSERT INTO finance_records(tenant_id,kind,record_number,data,amount,created_by) VALUES($1,'payments',$2,$3,$4,$5)`,[id(1),source,JSON.stringify({appointment_id:id(11),source}),amount,id(6)]);
    await sync();
    const recovered=await db.query<any>(`SELECT amount FROM finance_records WHERE data->>'appointment_id'=$1 AND data->>'legacy_receipt'='true'`,[id(11)]);
    assert.equal(Number(recovered.rows[0].amount),300);
    // A zero amount (even if a UI calls it paid) must never invent revenue.
    await db.query('UPDATE clinical_appointments SET paid_amount=0 WHERE id=$1',[id(12)]);
    await db.query(`DELETE FROM finance_records WHERE data->>'appointment_id'=$1`,[id(12)]);
    await sync();
    assert.equal((await db.query(`SELECT * FROM finance_records WHERE data->>'appointment_id'=$1`,[id(12)])).rows.length,0);
  }finally{await db.close();}
});
