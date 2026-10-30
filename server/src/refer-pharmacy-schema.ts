export const referPharmacySchemaSql = `
CREATE TABLE IF NOT EXISTS hospital_refer_pharmacies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(trim(name))>0), address text NOT NULL CHECK(length(trim(address))>0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(discount_amount>=0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE hospital_refer_pharmacies ADD COLUMN IF NOT EXISTS discount_percentage numeric(5,2) NOT NULL DEFAULT 0 CHECK(discount_percentage BETWEEN 0 AND 100);
ALTER TABLE hospital_refer_pharmacies ADD COLUMN IF NOT EXISTS source_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS idx_refer_pharmacies_source ON hospital_refer_pharmacies(tenant_id,source_id);
CREATE INDEX IF NOT EXISTS idx_refer_pharmacies_tenant ON hospital_refer_pharmacies(tenant_id);
`;
