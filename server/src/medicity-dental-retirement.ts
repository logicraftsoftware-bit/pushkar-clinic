// Retain IDs and all clinical/financial references. Run once, before catalogue
// synchronization, with a snapshot of the original catalogue for recovery.
export const medicityDentalRetirementSql=`
CREATE TABLE IF NOT EXISTS erp_catalog_retirements(
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  change_key text NOT NULL,snapshot jsonb NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,change_key)
);
DO $retire_dental$
DECLARE
  target_tenant uuid;
  candidate_count integer;
  dental_branches uuid[];
  retirement_key constant text := 'medicity-dental-centres-and-departments-20261029-v1';
BEGIN
  SELECT count(*),(array_agg(candidate.tenant_id))[1] INTO candidate_count,target_tenant
  FROM (
    SELECT DISTINCT b.tenant_id FROM branches b
    JOIN hospitals h ON h.id=b.tenant_id AND h.deleted_at IS NULL
    WHERE regexp_replace(lower(b.name),'[^a-z0-9]','','g') IN ('medicityguwahati','medicityguwahatihospital')
      AND EXISTS(SELECT 1 FROM branches paired WHERE paired.tenant_id=b.tenant_id
        AND regexp_replace(lower(paired.name),'[^a-z0-9]','','g')='medicityguwahatidiagnostics')
  ) candidate;
  IF candidate_count>1 THEN RAISE EXCEPTION 'Ambiguous Medicity hospital; dental retirement requires a unique hospital'; END IF;
  IF candidate_count=0 THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(retirement_key));
  IF EXISTS(SELECT 1 FROM erp_catalog_retirements WHERE tenant_id=target_tenant AND change_key=retirement_key) THEN RETURN; END IF;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO dental_branches FROM branches
  WHERE tenant_id=target_tenant AND regexp_replace(lower(name),'[^a-z0-9]','','g') IN (
    'medicityguwahatidentalbracesimplantcenter','medicityguwahatidentalbracesimplantcentre',
    'medicitymultispecialitydentalclinic','medicitymultispecialtydentalclinic'
  );
  IF cardinality(dental_branches)=0 AND NOT EXISTS(SELECT 1 FROM departments WHERE tenant_id=target_tenant AND regexp_replace(lower(name),'[^a-z0-9]','','g')='dental') THEN RETURN; END IF;
  INSERT INTO erp_catalog_retirements(tenant_id,change_key,snapshot)
  SELECT target_tenant,retirement_key,jsonb_build_object(
    'branches',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM branches b WHERE b.tenant_id=target_tenant AND b.id=ANY(dental_branches)),'[]'::jsonb),
    'departments',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM departments d WHERE d.tenant_id=target_tenant
      AND (d.branch_id=ANY(dental_branches) OR regexp_replace(lower(d.name),'[^a-z0-9]','','g')='dental')),'[]'::jsonb)
  );
  UPDATE departments SET is_active=false,updated_at=now() WHERE tenant_id=target_tenant AND is_active
    AND (branch_id=ANY(dental_branches) OR regexp_replace(lower(name),'[^a-z0-9]','','g')='dental');
  UPDATE branches SET is_active=false,updated_at=now() WHERE tenant_id=target_tenant AND is_active AND id=ANY(dental_branches);
END
$retire_dental$;
`;
