// Copy the hospital's active department catalogue into both requested branches.
// Existing IDs and clinical references stay intact; names prevent duplicate copies.
export const medicityDepartmentSyncSql = `
WITH targets AS (
  SELECT b.id,b.tenant_id FROM branches b
  JOIN hospitals h ON h.id=b.tenant_id AND h.deleted_at IS NULL
  WHERE lower(trim(b.name)) IN ('medicity guwahati diagnostics','medicity guwahati')
    AND EXISTS (SELECT 1 FROM branches paired WHERE paired.tenant_id=b.tenant_id
      AND lower(trim(paired.name))=CASE lower(trim(b.name))
        WHEN 'medicity guwahati' THEN 'medicity guwahati diagnostics' ELSE 'medicity guwahati' END)
), catalogue AS (
  SELECT DISTINCT ON (d.tenant_id,lower(trim(d.name))) d.*
  FROM departments d
  WHERE d.is_active=true AND EXISTS(SELECT 1 FROM targets t WHERE t.tenant_id=d.tenant_id)
  ORDER BY d.tenant_id,lower(trim(d.name)),d.created_at,d.id
)
INSERT INTO departments(tenant_id,branch_id,name,code,is_active,hod_name,location,phone_extension,description)
SELECT t.tenant_id,t.id,d.name,'SHARED-'||md5(lower(trim(d.name))),true,
  d.hod_name,d.location,d.phone_extension,d.description
FROM targets t JOIN catalogue d ON d.tenant_id=t.tenant_id
WHERE NOT EXISTS(SELECT 1 FROM departments existing WHERE existing.tenant_id=t.tenant_id
  AND existing.branch_id=t.id AND lower(trim(existing.name))=lower(trim(d.name)))
ON CONFLICT(tenant_id,branch_id,code) DO NOTHING
RETURNING id`;
