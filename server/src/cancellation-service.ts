import {randomUUID} from 'node:crypto';
import {auditContext} from './audit-context.js';
import {CancellationError,cancellationBlockReason,cancellationBookedTests,moneyCents,refundBalance} from './cancellation-policy.js';

export type CancellationDb={query:(sql:string,args?:any[])=>Promise<{rows:any[];rowCount?:number|null}>};
export type CancellationActor={tenantId:string;sub:string;branches:string[]|null};
export const cancellationSchemaSql=`
CREATE TABLE IF NOT EXISTS cancellation_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id),branch_id uuid NOT NULL REFERENCES branches(id),
 bill_type text NOT NULL CHECK(bill_type IN('OPD','Lab')),target_id uuid NOT NULL,invoice_id uuid REFERENCES finance_records(id),patient_id uuid REFERENCES patients(id),
 request_number text NOT NULL,bill_number text NOT NULL,patient_name text NOT NULL DEFAULT '',reason text NOT NULL,
 bill_total numeric(14,2) NOT NULL,collected_amount numeric(14,2) NOT NULL,requested_amount numeric(14,2) NOT NULL CHECK(requested_amount>=0),
 approved_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(approved_amount>=0),refunded_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(refunded_amount>=0 AND refunded_amount<=approved_amount),
 status text NOT NULL DEFAULT 'Pending' CHECK(status IN('Pending','Approved','Rejected','Partially Refunded','Completed')),
 created_by uuid NOT NULL REFERENCES users(id),reviewed_by uuid REFERENCES users(id),review_note text NOT NULL DEFAULT '',credit_number text,
 created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,request_number));
CREATE UNIQUE INDEX IF NOT EXISTS cancellation_one_active_bill ON cancellation_requests(tenant_id,bill_type,target_id) WHERE status<>'Rejected';
ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS booked_tests jsonb NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS cancellation_branch_history ON cancellation_requests(tenant_id,branch_id,created_at DESC);
CREATE TABLE IF NOT EXISTS cancellation_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id),request_id uuid NOT NULL REFERENCES cancellation_requests(id),actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,amount numeric(14,2),method text,note text NOT NULL DEFAULT '',finance_id uuid REFERENCES finance_records(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS cancellation_event_history ON cancellation_events(tenant_id,request_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS cancellation_refund_payment_key ON finance_records(tenant_id,(data->>'refund_payment_key')) WHERE kind='refunds' AND data->>'refund_payment_key' IS NOT NULL;
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS cancellation_request_id uuid;
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS approved_refund_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS cancellation_retained_amount numeric(14,2);
`;
function scope(actor:CancellationActor,branch:string){if(actor.branches!==null&&!actor.branches.includes(branch))throw new CancellationError(403,'This bill is outside your branch access.');}
export async function cancellationBill(db:CancellationDb,actor:CancellationActor,type:'OPD'|'Lab',id:string,lock=false){
  if(type==='OPD'){
    const row=(await db.query(`SELECT a.*,concat_ws(' ',p.first_name,p.last_name) patient_name FROM clinical_appointments a JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 ${lock?'FOR UPDATE OF a':''}`,[id,actor.tenantId])).rows[0];
    if(!row)throw new CancellationError(404,'OPD bill not found.');scope(actor,row.branch_id);
    const invoice=(await db.query(`SELECT * FROM finance_records WHERE tenant_id=$1 AND kind='invoices' AND data->>'appointment_id'=$2 ORDER BY created_at DESC LIMIT 1 ${lock?'FOR UPDATE':''}`,[actor.tenantId,id])).rows[0];
    if(invoice)scope(actor,invoice.branch_id||row.branch_id);
    const total=invoice?Number(invoice.total):Math.max(0,Number(row.consultation_fee)+(row.charges||[]).reduce((sum:number,charge:any)=>sum+Number(charge.amount||0),0)-Number(row.discount||0));
    const paid=invoice?Number(invoice.paid):Number(row.paid_amount||0);
    return {type,target_id:id,branch_id:row.branch_id,patient_id:row.patient_id,patient_name:row.patient_name,bill_number:invoice?.record_number||row.appointment_number,total,paid,invoice_id:invoice?.id||null,booked_tests:[],records:[row],block_reason:invoice&&['Cancelled','Refunded'].includes(invoice.status)?'This bill is already cancelled or refunded.':cancellationBlockReason(type,[row]),source:row};
  }
  // Lock every order sharing this invoice before the invoice, matching lab payment locks.
  const orders=(await db.query(`SELECT * FROM role_work_items WHERE tenant_id=$1 AND workspace='laboratory' AND data->>'bill_id'=$2 ORDER BY id ${lock?'FOR UPDATE':''}`,[actor.tenantId,id])).rows;
  const invoice=(await db.query(`SELECT * FROM finance_records WHERE id=$1 AND tenant_id=$2 AND kind='invoices' ${lock?'FOR UPDATE':''}`,[id,actor.tenantId])).rows[0];
  if(!invoice||!orders.length)throw new CancellationError(404,'Lab bill not found.');scope(actor,invoice.branch_id);
  for(const order of orders)scope(actor,order.branch_id);
  const patient=(await db.query(`SELECT concat_ws(' ',first_name,last_name) name FROM patients WHERE id=$1 AND tenant_id=$2`,[invoice.patient_id,actor.tenantId])).rows[0];
  return {type,target_id:id,branch_id:invoice.branch_id,patient_id:invoice.patient_id,patient_name:patient?.name||orders[0].data?.customer_name||'',bill_number:invoice.record_number,total:Number(invoice.total),paid:Number(invoice.paid),invoice_id:id,booked_tests:cancellationBookedTests(invoice,orders),records:orders,block_reason:['Cancelled','Refunded'].includes(invoice.status)?'This bill is already cancelled or refunded.':cancellationBlockReason(type,orders),source:invoice};
}
export async function findCancellationBills(db:CancellationDb,actor:CancellationActor,number:string){
  const [appointments,invoices]=await Promise.all([
    db.query(`SELECT id FROM clinical_appointments WHERE tenant_id=$1 AND lower(appointment_number)=lower($2) AND ($3::uuid[] IS NULL OR branch_id=ANY($3))`,[actor.tenantId,number,actor.branches]),
    db.query(`SELECT id,data FROM finance_records WHERE tenant_id=$1 AND kind='invoices' AND lower(record_number)=lower($2) AND ($3::uuid[] IS NULL OR branch_id=ANY($3))`,[actor.tenantId,number,actor.branches]),
  ]);
  const targets=appointments.rows.map(row=>({type:'OPD' as const,id:row.id}));
  for(const row of invoices.rows)targets.push({type:row.data?.appointment_id?'OPD':'Lab',id:row.data?.appointment_id||row.id} as any);
  const unique=[...new Map(targets.map(row=>[row.type+row.id,row])).values()],bills=[];
  for(const target of unique){try{const bill=await cancellationBill(db,actor,target.type,target.id);const pending=(await db.query(`SELECT request_number,status FROM cancellation_requests WHERE tenant_id=$1 AND bill_type=$2 AND target_id=$3 AND status<>'Rejected'`,[actor.tenantId,target.type,target.id])).rows[0];bills.push({...bill,records:undefined,source:undefined,block_reason:pending?`Cancellation request ${pending.request_number} is already ${pending.status}.`:bill.block_reason,default_amount:bill.paid});}catch(error){if(!(error instanceof CancellationError)||error.status!==404)throw error;}}
  return bills;
}
async function event(db:CancellationDb,actor:CancellationActor,id:string,action:string,amount:number|null,note:string,method:string|null=null,financeId:string|null=null){
  const context=auditContext.getStore();
  await db.query(`INSERT INTO cancellation_events(tenant_id,request_id,actor_id,action,amount,note,method,finance_id,actor_name,actor_role,ip_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[actor.tenantId,id,actor.sub,action,amount,note,method,financeId,context?.actor_name||null,context?.actor_role||null,context?.ip_address||null]);
}
async function transaction<T>(db:CancellationDb,fn:()=>Promise<T>){await db.query('BEGIN');try{const result=await fn();await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}}
export async function submitCancellation(db:CancellationDb,actor:CancellationActor,input:{type:'OPD'|'Lab';target_id:string;reason:string;amount:number}){
  return transaction(db,async()=>{
    const bill=await cancellationBill(db,actor,input.type,input.target_id,true);
    if(bill.block_reason)throw new CancellationError(409,bill.block_reason);
    if(moneyCents(input.amount)>moneyCents(bill.paid))throw new CancellationError(400,'Requested refund cannot exceed the amount collected.');
    const active=(await db.query(`SELECT id FROM cancellation_requests WHERE tenant_id=$1 AND bill_type=$2 AND target_id=$3 AND status<>'Rejected'`,[actor.tenantId,input.type,input.target_id])).rows[0];
    if(active)throw new CancellationError(409,'A cancellation request already exists for this bill.');
    const number=`CAN-${randomUUID().slice(0,8).toUpperCase()}`;
    const row=(await db.query(`INSERT INTO cancellation_requests(tenant_id,branch_id,bill_type,target_id,invoice_id,patient_id,request_number,bill_number,patient_name,reason,bill_total,collected_amount,requested_amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[actor.tenantId,bill.branch_id,input.type,input.target_id,bill.invoice_id,bill.patient_id,number,bill.bill_number,bill.patient_name,input.reason,bill.total,bill.paid,input.amount,actor.sub])).rows[0];
    if(input.type==='Lab'){row.booked_tests=bill.booked_tests||[];await db.query('UPDATE cancellation_requests SET booked_tests=$1::jsonb WHERE id=$2',[JSON.stringify(row.booked_tests),row.id]);}
    await event(db,actor,row.id,'Requested',input.amount,input.reason);return row;
  });
}
async function lockedRequest(db:CancellationDb,actor:CancellationActor,id:string){const row=(await db.query(`SELECT * FROM cancellation_requests WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,[id,actor.tenantId])).rows[0];if(!row)throw new CancellationError(404,'Cancellation request not found.');scope(actor,row.branch_id);return row;}
export async function reviewCancellation(db:CancellationDb,actor:CancellationActor,id:string,input:{decision:'approve'|'reject';amount:number;note:string}){
  return transaction(db,async()=>{
    const request=await lockedRequest(db,actor,id);if(request.status!=='Pending')throw new CancellationError(409,'This request has already been reviewed.');
    if(input.decision==='reject'){
      const row=(await db.query(`UPDATE cancellation_requests SET status='Rejected',reviewed_by=$1,reviewed_at=now(),review_note=$2,updated_at=now() WHERE id=$3 RETURNING *`,[actor.sub,input.note,id])).rows[0];await event(db,actor,id,'Rejected',null,input.note);return row;
    }
    const bill=await cancellationBill(db,actor,request.bill_type,request.target_id,true);
    if(bill.block_reason)throw new CancellationError(409,bill.block_reason);
    if(moneyCents(input.amount)>moneyCents(bill.paid))throw new CancellationError(400,'Approved refund cannot exceed the current collected amount.');
    const retained=(moneyCents(bill.paid)-moneyCents(input.amount))/100,credit=Math.max(0,(moneyCents(bill.total)-moneyCents(retained))/100),creditNumber=`CN-${randomUUID().slice(0,8).toUpperCase()}`;
    const metadata={source:request.bill_type==='Lab'?'Laboratory Cancellation':'OPD Cancellation',cancellation_request_id:id,bill_number:request.bill_number,appointment_id:request.bill_type==='OPD'?request.target_id:undefined,original_total:bill.total,original_paid:bill.paid,approved_refund:input.amount,retained_amount:retained,reason:request.reason};
    const ledger=(await db.query(`INSERT INTO finance_records(tenant_id,branch_id,patient_id,invoice_id,kind,record_number,data,amount,total,paid,due,status,record_date,created_by) VALUES($1,$2,$3,$4,'credit notes',$5,$6,$7,$7,0,0,'Approved',current_date,$8) RETURNING id`,[actor.tenantId,bill.branch_id,bill.patient_id,bill.invoice_id,creditNumber,metadata,credit,actor.sub])).rows[0];
    if(bill.invoice_id)await db.query(`UPDATE finance_records SET total=$1,due=0,status='Cancelled',data=data||$2::jsonb,updated_at=now() WHERE id=$3 AND tenant_id=$4`,[retained,JSON.stringify(metadata),bill.invoice_id,actor.tenantId]);
    if(request.bill_type==='OPD')await db.query(`UPDATE clinical_appointments SET status='Cancelled',cancellation_reason=$1,cancelled_at=now(),cancellation_request_id=$2,approved_refund_amount=$3,cancellation_retained_amount=$4,payment_status=$5,paid_amount=$8,updated_at=now() WHERE id=$6 AND tenant_id=$7`,[request.reason,id,input.amount,retained,input.amount>0?'Refund Pending':'Cancelled',request.target_id,actor.tenantId,bill.paid]);
    else await db.query(`UPDATE role_work_items SET status='Cancelled',data=data||jsonb_build_object('cancellation_request_id',$1::text,'cancelled_by',$2::text,'cancelled_at',now(),'approved_refund_amount',$3::numeric),updated_at=now() WHERE tenant_id=$4 AND workspace='laboratory' AND data->>'bill_id'=$5`,[id,actor.sub,input.amount,actor.tenantId,bill.invoice_id]);
    const row=(await db.query(`UPDATE cancellation_requests SET approved_amount=$1,status=$2,reviewed_by=$3,reviewed_at=now(),review_note=$4,credit_number=$5,updated_at=now() WHERE id=$6 RETURNING *`,[input.amount,input.amount>0?'Approved':'Completed',actor.sub,input.note,creditNumber,id])).rows[0];
    await event(db,actor,id,'Approved',input.amount,input.note,null,ledger.id);return row;
  });
}
export async function payCancellationRefund(db:CancellationDb,actor:CancellationActor,id:string,input:{amount:number;method:string;reference:string;payment_key:string}){
  return transaction(db,async()=>{
    const request=await lockedRequest(db,actor,id);
    const prior=(await db.query(`SELECT * FROM finance_records WHERE tenant_id=$1 AND kind='refunds' AND data->>'refund_payment_key'=$2`,[actor.tenantId,input.payment_key])).rows[0];
    if(prior){if(prior.data?.cancellation_request_id!==id||moneyCents(prior.amount)!==moneyCents(input.amount)||prior.data?.payment_method!==input.method||String(prior.data?.transaction_reference||'')!==input.reference)throw new CancellationError(409,'This refund payment reference has already been used.');return {request,refund:prior,replayed:true};}
    if(!['Approved','Partially Refunded'].includes(request.status))throw new CancellationError(409,'Only accountant-approved requests can be refunded.');
    const balance=refundBalance(request.approved_amount,request.refunded_amount,input.amount),bill=await cancellationBill(db,actor,request.bill_type,request.target_id,true);
    if(moneyCents(input.amount)>moneyCents(bill.paid))throw new CancellationError(409,'The current collected amount is lower than this refund. Refresh the bill.');
    const sourceRequest=request.bill_type==='OPD'?bill.source.cancellation_request_id:bill.source.data?.cancellation_request_id;
    if(sourceRequest!==id)throw new CancellationError(409,'This bill is not linked to the approved cancellation.');
    const number=`REF-${randomUUID().slice(0,8).toUpperCase()}`,data={source:request.bill_type==='Lab'?'Laboratory Refund':'OPD Refund',cancellation_request_id:id,bill_number:request.bill_number,appointment_id:request.bill_type==='OPD'?request.target_id:undefined,refund_payment_key:input.payment_key,payment_method:input.method,transaction_reference:input.reference,reason:request.reason};
    const refund=(await db.query(`INSERT INTO finance_records(tenant_id,branch_id,patient_id,invoice_id,kind,record_number,data,amount,total,paid,due,status,record_date,created_by) VALUES($1,$2,$3,$4,'refunds',$5,$6,$7,$7,$7,0,'Completed',current_date,$8) RETURNING *`,[actor.tenantId,bill.branch_id,bill.patient_id,bill.invoice_id,number,data,input.amount,actor.sub])).rows[0];
    if(bill.invoice_id)await db.query(`UPDATE finance_records SET paid=greatest(0,paid-$1),due=0,data=data||jsonb_build_object('refunded_amount',$2::numeric,'refund_status',$3::text),updated_at=now() WHERE id=$4 AND tenant_id=$5`,[input.amount,balance.refunded,balance.status,bill.invoice_id,actor.tenantId]);
    if(request.bill_type==='OPD')await db.query(`UPDATE clinical_appointments SET paid_amount=greatest(0,paid_amount-$1),refund_amount=$2,payment_status=$3,updated_at=now() WHERE id=$4 AND tenant_id=$5`,[input.amount,balance.refunded,balance.status==='Completed'?'Refunded':'Refund Pending',request.target_id,actor.tenantId]);
    const row=(await db.query(`UPDATE cancellation_requests SET refunded_amount=$1,status=$2,updated_at=now() WHERE id=$3 RETURNING *`,[balance.refunded,balance.status,id])).rows[0];
    await event(db,actor,id,'Refund Paid',input.amount,input.reference,input.method,refund.id);return {request:row,refund,replayed:false};
  });
}
