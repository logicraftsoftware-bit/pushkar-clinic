// One row per ordered test. Classification uses saved results, never approval
// status or the aggregate status of other tests on the same order.
const labTestStatusBaseSql = `
WITH report AS (
  SELECT w.id order_id,t.test->>'test_id' test_id,
    coalesce(nullif(t.test->>'test_name',''),nullif(t.test->>'name',''),m.name,'Laboratory test') test_name,
    to_char(w.occurred_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') report_date,w.occurred_at registered_at,
    coalesce(nullif(p.medical_record_number,''),nullif(w.data->>'medical_record_number',''),w.data->>'legacy_patient_id','') uhid,
    coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),w.data->>'customer_name','Patient link pending') patient_name,
    coalesce(nullif(f.record_number,''),nullif(w.data->>'bill_number',''),w.data->>'legacy_opd_id','') bill_number,
    coalesce((SELECT string_agg(b->>'value',', ') FROM jsonb_array_elements(coalesce(w.data->'barcodes','[]'::jsonb)) b WHERE b->>'test_id'=t.test->>'test_id'),
      (SELECT string_agg(coalesce(s->>'barcode',s->>'barcode_id',s->>'barcode_no',s->>'bar_code'),', ') FROM jsonb_array_elements(coalesce(w.data->'sample_records','[]'::jsonb)) s WHERE s->>'testid'=m.data->>'legacy_id'),'') barcode,
    CASE WHEN progress.required>0 AND progress.filled=progress.required THEN 'Completed'
         WHEN progress.filled>0 THEN 'Partially Completed' ELSE 'Pending' END result_status
  FROM role_work_items w
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.data->'tests','[]'::jsonb)) t(test)
  LEFT JOIN patients p ON p.id=w.patient_id AND p.tenant_id=w.tenant_id
  LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id
  LEFT JOIN hospital_diagnostic_masters m ON m.id::text=t.test->>'test_id' AND m.tenant_id=w.tenant_id AND m.kind='test'
  LEFT JOIN LATERAL (SELECT r result FROM jsonb_array_elements(coalesce(w.data->'lab_results','[]'::jsonb)) r WHERE r->>'test_id'=t.test->>'test_id' LIMIT 1) saved ON true
  CROSS JOIN LATERAL (
    SELECT count(*) required,count(*) FILTER (WHERE trim(coalesce(parameter->>'value',''))<>'') filled
    FROM jsonb_array_elements(coalesce(saved.result->'parameters','[]'::jsonb)) parameter
    LEFT JOIN hospital_diagnostic_masters pm ON pm.id::text=parameter->>'parameter_id' AND pm.tenant_id=w.tenant_id AND pm.kind='parameter'
    WHERE coalesce(parameter->>'result_type_id',pm.data->>'result_type_id','3') NOT IN ('0','5')
  ) progress
  WHERE w.tenant_id=$1 AND w.workspace='laboratory'
    AND lower(w.kind) IN ('orders','pos','sample collection','results','verification','reports')
    AND w.status NOT IN ('Cancelled','Rejected')
    AND (w.occurred_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date
    AND ($4::text='' OR t.test->>'test_id'=$4)
    AND ($8::text='' OR coalesce(nullif(t.test->>'test_name',''),nullif(t.test->>'name',''),m.name,'Laboratory test') ILIKE $8)
)`;

export const labTestStatusSummarySql = `${labTestStatusBaseSql.replaceAll('$8','$6')}
SELECT count(*)::int total,
  count(*) FILTER(WHERE result_status<>'Completed')::int pending,
  count(*) FILTER(WHERE result_status='Completed')::int conducted
FROM report WHERE ($5='' OR concat_ws(' ',uhid,patient_name,bill_number,barcode,test_name) ILIKE $5)`;

export const labTestStatusReportSql = `${labTestStatusBaseSql}, filtered AS (
  SELECT * FROM report WHERE
    ($5='all' OR ($5='conducted' AND result_status='Completed') OR ($5='pending' AND result_status<>'Completed'))
    AND ($6='' OR concat_ws(' ',uhid,patient_name,bill_number,barcode,test_name) ILIKE $6)
)
SELECT *,count(*) OVER()::int total,count(*) OVER(PARTITION BY report_date,test_id)::int group_total FROM filtered
ORDER BY report_date,test_name,test_id,registered_at,order_id LIMIT 100 OFFSET $7`;
