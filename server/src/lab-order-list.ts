import {awaitingLabSampleSql} from "./lab-sample-queue.js";
export const labOrderTypes=['orders','pos','sample collection','results','verification','reports'] as const;
export const labOrderStatuses=['Pending','Awaiting Payment','Partially Paid','Paid','Awaiting Sample','Barcode Generated','Sample Collected','Processing','Cancelled','Rejected'] as const;
export const labBillingStatuses=['Paid','Partially Paid','Unpaid','Cancelled','Refunded'] as const;
export const labPaymentStatusSql=`CASE WHEN f.status IN ('Cancelled','Refunded') THEN f.status WHEN f.due<=0 THEN 'Paid' WHEN f.paid>0 THEN 'Partially Paid' ELSE 'Unpaid' END`;
export const labSampleStatusSql=`CASE WHEN w.status='Cancelled' THEN 'Cancelled' WHEN w.status='Rejected' OR w.data->>'processing_status'='Rejected' THEN 'Rejected'
  WHEN w.data->>'collected_at' IS NOT NULL THEN CASE WHEN w.data->>'result_status' IN ('Completed','Partially Completed') THEN 'Sample Collected' WHEN w.data->>'result_status'='In Progress' OR w.data->>'processing_status'='Accepted' THEN 'Processing' ELSE 'Sample Collected' END
  WHEN w.status='Barcode Generated' THEN 'Barcode Generated' WHEN ${awaitingLabSampleSql} OR lower(w.kind)='sample collection' OR w.data->>'sample_requested_at' IS NOT NULL THEN 'Awaiting Sample'
  ELSE w.status END`;
export const labOrderMetrics:Record<string,string>={
  total:'true',
  awaiting:`w.status NOT IN ('Cancelled','Rejected') AND w.data->>'collected_at' IS NULL`,
  progress:`w.status NOT IN ('Cancelled','Rejected') AND w.data->>'collected_at' IS NOT NULL AND coalesce(w.data->>'result_status','') NOT IN ('Completed','Partially Completed')`,
  ready:`w.status NOT IN ('Cancelled','Rejected') AND w.data->>'result_status' IN ('Completed','Partially Completed') AND w.data->'doctor_approval' IS NOT NULL AND w.data->'doctor_approval'<>'null'::jsonb`,
  unpaid:`w.status NOT IN ('Cancelled','Rejected') AND f.due>0`,
};
export function labOrderFilterSql(filters:{from:string;to:string;status:string;orderType:string},billing=false){
  return {sql:`AND ($5::date IS NULL OR (w.occurred_at AT TIME ZONE 'Asia/Kolkata')::date >= $5::date)
    AND ($6::date IS NULL OR (w.occurred_at AT TIME ZONE 'Asia/Kolkata')::date <= $6::date)
    AND ($7::text='' OR (${billing?labPaymentStatusSql:labSampleStatusSql})=$7)
    AND ($8::text='' OR lower(w.kind)=$8)`,values:[filters.from||null,filters.to||null,filters.status,filters.orderType]};
}
// Apply after DISTINCT ON(invoice id), so shared invoices never inflate counts or revenue.
export function labBillingSummarySql(){
  const month=`date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata')`,occurred=`(occurred_at AT TIME ZONE 'Asia/Kolkata')`;
  return Object.entries({total:'true',paid:`payment_status='Paid'`,partial:`payment_status='Partially Paid'`,unpaid:`payment_status='Unpaid'`,revenue:'true'}).flatMap(([key,condition])=>{
    const aggregate=(period='')=>key==='revenue'?`coalesce(sum(bill_paid) FILTER(WHERE (${condition}) ${period}),0)`:`count(*) FILTER(WHERE (${condition}) ${period})::int`;
    return [`${aggregate()} ${key}`,`${aggregate(`AND ${occurred}>=${month} AND ${occurred}<${month}+interval '1 month'`)} ${key}_current`,`${aggregate(`AND ${occurred}>=${month}-interval '1 month' AND ${occurred}<${month}`)} ${key}_previous`];
  }).join(',');
}
export function labOrderSummarySql(){
  const month=`date_trunc('month',now() AT TIME ZONE 'Asia/Kolkata')`,occurred=`(w.occurred_at AT TIME ZONE 'Asia/Kolkata')`;
  return Object.entries(labOrderMetrics).flatMap(([key,condition])=>[
    `count(*) FILTER(WHERE ${condition})::int ${key}`,
    `count(*) FILTER(WHERE (${condition}) AND ${occurred}>=${month} AND ${occurred}<${month}+interval '1 month')::int ${key}_current`,
    `count(*) FILTER(WHERE (${condition}) AND ${occurred}>=${month}-interval '1 month' AND ${occurred}<${month})::int ${key}_previous`,
  ]).join(',');
}
