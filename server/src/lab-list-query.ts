import {labOrderSummarySql} from './lab-order-list.js';
import {labSearchSql} from './lab-search.js';

// Large result/audit JSON is often TOASTed. Decode its few summary fields once
// per order, rather than repeatedly decompressing it for all fifteen counters.
export function labOrderFastSummarySql(filters:string){
  const aggregate=labOrderSummarySql()
    .replaceAll("w.data->>'collected_at'",'w.collected_at')
    .replaceAll("w.data->>'result_status'",'w.result_status')
    .replaceAll("w.data->'doctor_approval'",'w.doctor_approval')
    .replaceAll('f.due','w.due');
  return `WITH lab_states AS MATERIALIZED (
    SELECT w.status,w.occurred_at,x.collected_at,x.result_status,x.doctor_approval,f.due
    FROM role_work_items w
    CROSS JOIN LATERAL jsonb_to_record(CASE WHEN jsonb_typeof(w.data)='object' THEN w.data ELSE '{}'::jsonb END)
      AS x(bill_id text,collected_at text,result_status text,doctor_approval jsonb)
    LEFT JOIN finance_records f ON f.id=nullif(x.bill_id,'')::uuid AND f.tenant_id=w.tenant_id
    WHERE ${filters}
  ) SELECT ${aggregate} FROM lab_states w`;
}

export const labNavigationIndexesSql=`
CREATE INDEX IF NOT EXISTS lab_day_navigation_idx ON role_work_items(tenant_id,((occurred_at AT TIME ZONE 'Asia/Kolkata')::date),occurred_at DESC,id DESC) WHERE workspace='laboratory';
CREATE INDEX IF NOT EXISTS lab_results_navigation_idx ON role_work_items(tenant_id,occurred_at DESC,id DESC)
  WHERE workspace='laboratory' AND data->>'collected_at' IS NOT NULL;
CREATE INDEX IF NOT EXISTS lab_reports_navigation_idx ON role_work_items(tenant_id,occurred_at DESC,id DESC)
  WHERE workspace='laboratory' AND data->>'result_status' IN ('Completed','Partially Completed')
    AND data->'doctor_approval' IS NOT NULL AND data->'doctor_approval'<>'null'::jsonb;
CREATE INDEX IF NOT EXISTS lab_stage_navigation_idx ON role_work_items(tenant_id,(lower(kind)),status,occurred_at DESC,id DESC)
  WHERE workspace='laboratory';`;

// Results, samples and reports use only the total. Do not recalculate the whole
// dashboard or join patient/bill tables when these pages have no search filter.
export function labListCountPlan(stage:string,search:string,billedOnly:boolean,includeSummary=true){
  const dashboard=includeSummary&&(!stage||stage==='Orders');
  const invoices=dashboard||billedOnly||Boolean(search);
  return {
    aggregate:dashboard?labOrderSummarySql():'count(*)::int total',
    joins:`${search?'LEFT JOIN patients p ON p.id=w.patient_id ':''}${invoices?"LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id":''}`,
    search:search?labSearchSql(true):"($2::text='' AND $3::text[] IS NOT NULL)",
  };
}
