BEGIN;

CREATE TABLE call_centre_crm_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES hospitals(id) ON DELETE CASCADE,
  clinic_external_id text NOT NULL,
  clinic_name text NOT NULL DEFAULT '',
  api_key_prefix text NOT NULL,
  api_key_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_sync_status text NOT NULL DEFAULT 'Never synced',
  last_sync_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_external_id)
);

CREATE TABLE call_centre_crm_mappings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES call_centre_crm_connections(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('branch','department','doctor','patient','appointment')),
  external_id text NOT NULL,
  erp_id uuid NOT NULL,
  source_updated_at timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, entity_type, external_id)
);

CREATE INDEX call_centre_crm_mappings_erp_idx
  ON call_centre_crm_mappings (tenant_id, entity_type, erp_id);

ALTER TABLE call_centre_crm_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_centre_crm_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_crm_connections ON call_centre_crm_connections
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_crm_mappings ON call_centre_crm_mappings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
