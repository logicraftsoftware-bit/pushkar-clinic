import {z} from 'zod';

export const diagnosticTestType = z.enum(['Pathology', 'Radiology', 'Neurology']).default('Pathology');

// Clinical routing retains the shared laboratory workflow for Neurology tests.
export function diagnosticClinicalDomain(test: {domain?:string; data?:Record<string,unknown>}) {
  return test.data?.test_type === 'Radiology' ? 'radiology' : 'pathology';
}

// Run in the startup schema transaction. Archive only retired master definitions;
// historical orders, billing records and reports are deliberately untouched.
export const diagnosticMasterUnificationSql = `
CREATE TABLE IF NOT EXISTS hospital_feature_migrations (
  name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS retired_diagnostic_test_masters (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, record jsonb NOT NULL,
  retired_at timestamptz NOT NULL DEFAULT now()
);
DO $merge$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospital_feature_migrations WHERE name='unified_diagnostic_test_master_v1') THEN
    INSERT INTO retired_diagnostic_test_masters(id,tenant_id,record)
      SELECT id,tenant_id,to_jsonb(m) FROM hospital_diagnostic_masters m
      WHERE domain='radiology' AND kind='test' ON CONFLICT(id) DO NOTHING;
    DELETE FROM hospital_diagnostic_masters WHERE domain='radiology' AND kind='test';
    UPDATE hospital_diagnostic_masters
      SET data=data || CASE WHEN nullif(data->>'test_type','') IS NOT NULL
        AND data->>'test_type'<>'Pathology' THEN jsonb_build_object('legacy_test_type',data->>'test_type') ELSE '{}'::jsonb END
        || '{"test_type":"Pathology"}'::jsonb
      WHERE domain='pathology' AND kind='test';
    INSERT INTO hospital_feature_migrations(name) VALUES('unified_diagnostic_test_master_v1');
  END IF;
END $merge$;
`;
