import {randomUUID} from 'node:crypto';
import {db} from './database.mjs';
import {cents,paymentStatus} from './money.mjs';
import {inpatientTotal} from './inpatient-billing.mjs';
import {configuredPrefix} from './settings.mjs';
export const hospitalDay=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);

export async function syncAdmissionInvoice(admission,session) {
  const tenant_id=admission.tenant_id,now=new Date();
  const stays=await db.collection('ipd_bed_stays').find({tenant_id,admission_id:admission.id},{session}).toArray();
  const totals=inpatientTotal(stays,admission.charges??[],admission.discount??0,now);
  const paid=cents(admission.paid_amount)+cents(admission.deposit_amount),total=cents(totals.total_amount);
  const previous=await db.collection('finance_records').findOne({tenant_id,kind:'invoices','data.admission_id':admission.id},{session});
  const row={id:previous?.id??randomUUID(),tenant_id,branch_id:admission.branch_id,patient_id:admission.patient_id,kind:'invoices',record_number:previous?.record_number??`${await configuredPrefix(tenant_id,'invoice_prefix','INV',session)}-${admission.ipd_number}`,
    amount:totals.total_amount,total:totals.total_amount,paid:Math.min(paid,total)/100,due:Math.max(0,total-paid)/100,status:paymentStatus(total,paid),record_date:hospitalDay(new Date(admission.admitted_at)),created_at:previous?.created_at??now,updated_at:now,created_by:previous?.created_by??admission.created_by??null,
    data:{source:'IPD Admission',admission_id:admission.id,ipd_number:admission.ipd_number,care_type:'IPD',services:'IPD Admission',admitted_at:admission.admitted_at,bed_daily_charge:totals.bed_amount,admission_charges:admission.charges??[],admission_discount:admission.discount??0,admission_deposit:admission.deposit_amount??0,patient_credit:Math.max(0,paid-total)/100,payment_mode:admission.payment_mode??'',payment_reference:admission.payment_reference??''}};
  if(previous)await db.collection('finance_records').replaceOne({tenant_id,id:previous.id},row,{session});
  else await db.collection('finance_records').insertOne({...row},{session});
  await db.collection('finance_records').updateMany({tenant_id,kind:'payments','data.admission_id':admission.id},{$set:{invoice_id:row.id}},{session});
  await db.collection('ipd_admissions').updateOne({tenant_id,id:admission.id},{$set:{total_amount:totals.total_amount,bed_daily_charge:totals.bed_amount,admission_payment_status:paymentStatus(total,paid)==='Paid'?'Paid':'Unpaid'}},{session});
  return row;
}

export async function financialNumber(tenant,kind,session) {
  const counter=await db.collection('counters').findOneAndUpdate({_id:`${tenant}:finance:${kind}`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'});
  const prefix=await configuredPrefix(tenant,kind==='invoices'?'invoice_prefix':kind==='payments'?'receipt_prefix':'transaction_prefix',({invoices:'INV',payments:'REC',expenses:'EXP',refunds:'REF'})[kind],session);
  // Expense and refund numbering can share a configured prefix but not a number.
  const suffix=['expenses','refunds'].includes(kind)?`-${kind==='expenses'?'EXP':'REF'}`:'';
  return `${prefix}${suffix}-${String(counter.value).padStart(6,'0')}`;
}
