BEGIN;

CREATE TABLE IF NOT EXISTS bed_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('type', 'group', 'floor')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  color text,
  floor_id uuid REFERENCES bed_masters(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, name)
);

ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_type_id uuid REFERENCES bed_masters(id) ON DELETE RESTRICT;
ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_group_id uuid REFERENCES bed_masters(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_bed_masters_tenant_kind ON bed_masters(tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_beds_master_refs ON beds(tenant_id, bed_type_id, bed_group_id);

COMMIT;
