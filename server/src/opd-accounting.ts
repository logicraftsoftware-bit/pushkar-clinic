import type {PoolClient} from 'pg';

// Reconcile recorded money only. A "Paid" label without an amount is not a receipt.
// Retain existing receipts (including check-in receipts) and add only the shortfall.
export const reconcileOpdPaymentsSql = `
WITH posted AS (
  SELECT coalesce(f.data->>'appointment_id',i.data->>'appointment_id') appointment_id,sum(f.amount) amount
  FROM finance_records f LEFT JOIN finance_records i ON i.id=f.invoice_id AND i.tenant_id=f.tenant_id
  WHERE f.tenant_id=$1 AND f.kind='payments' AND coalesce(i.kind,'')<>'pharmacy-bill'
    AND coalesce(f.data->>'lab_order_id',i.data->>'lab_order_id','')=''
    AND lower(coalesce(f.data->>'source','')||' '||coalesce(i.data->>'source','')) NOT SIMILAR TO '%(lab|radiolog|pharmacy)%'
  GROUP BY coalesce(f.data->>'appointment_id',i.data->>'appointment_id')
), amounts AS (
  SELECT a.*,coalesce(a.paid_amount,0)+coalesce(a.refund_amount,0) collected,coalesce(p.amount,0) posted
  FROM clinical_appointments a LEFT JOIN posted p ON p.appointment_id=a.id::text
  WHERE a.tenant_id=$1 AND ($2::uuid[] IS NULL OR a.branch_id=ANY($2)) AND ($3::uuid IS NULL OR a.id=$3)
)
INSERT INTO finance_records(tenant_id,kind,record_number,patient_id,branch_id,data,amount,total,paid,due,status,record_date,created_by)
SELECT a.tenant_id,'payments','OPD-REC-'||a.id::text||'-'||round(a.collected*100)::text,
  a.patient_id,a.branch_id,jsonb_build_object('source','OPD Appointment','appointment_id',a.id,
    'appointment_number',a.appointment_number,'payment_method',a.payment_mode,
    'transaction_reference',a.payment_reference,'legacy_receipt',$4::uuid IS NULL,
    'collected_by_name',CASE WHEN $4::uuid IS NULL THEN 'Unrecorded (legacy)' ELSE NULL END,
    'date_basis',CASE WHEN $4::uuid IS NULL THEN 'appointment_date' ELSE 'collection_date' END),
  a.collected-a.posted,a.collected-a.posted,a.collected-a.posted,0,'Paid',
  CASE WHEN $4::uuid IS NULL THEN a.appointment_date ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date END,$4::uuid
FROM amounts a WHERE a.collected>a.posted
ON CONFLICT(tenant_id,record_number) DO NOTHING`;

// Call inside a transaction. The lock makes refreshes from multiple desks idempotent.
export async function reconcileOpdPayments(client:Pick<PoolClient,'query'>,tenantId:string,branchIds:string[]|null,appointmentId:string|null=null,actorId:string|null=null){
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`opd-accounting:${tenantId}`]);
  await client.query(reconcileOpdPaymentsSql,[tenantId,branchIds,appointmentId,actorId]);
}
