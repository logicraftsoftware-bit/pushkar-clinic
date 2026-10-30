-- Match the lab list predicates and stable, newest-first pagination.
CREATE INDEX IF NOT EXISTS lab_results_navigation_idx
  ON role_work_items (tenant_id, occurred_at DESC, id DESC)
  WHERE workspace='laboratory' AND data->>'collected_at' IS NOT NULL;

CREATE INDEX IF NOT EXISTS lab_reports_navigation_idx
  ON role_work_items (tenant_id, occurred_at DESC, id DESC)
  WHERE workspace='laboratory'
    AND data->>'result_status' IN ('Completed','Partially Completed')
    AND data->'doctor_approval' IS NOT NULL
    AND data->'doctor_approval'<>'null'::jsonb;

CREATE INDEX IF NOT EXISTS lab_stage_navigation_idx
  ON role_work_items (tenant_id, (lower(kind)), status, occurred_at DESC, id DESC)
  WHERE workspace='laboratory';
