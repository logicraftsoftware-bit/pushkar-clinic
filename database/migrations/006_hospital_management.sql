BEGIN;

ALTER TABLE hospitals
  ADD COLUMN IF NOT EXISTS establishment_date date,
  ADD COLUMN IF NOT EXISTS website text;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS branch_type text,
  ADD COLUMN IF NOT EXISTS manager_name text,
  ADD COLUMN IF NOT EXISTS email citext,
  ADD COLUMN IF NOT EXISTS emergency_phone text,
  ADD COLUMN IF NOT EXISTS address_line text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS pin_code text,
  ADD COLUMN IF NOT EXISTS bed_capacity integer NOT NULL DEFAULT 0;

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS hod_name text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS phone_extension text,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE wards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  department_id uuid REFERENCES departments(id),
  name text NOT NULL,
  code citext NOT NULL,
  ward_type text,
  floor text,
  capacity integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  ward_id uuid REFERENCES wards(id),
  room_number text NOT NULL,
  room_type text,
  floor text,
  daily_charge numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, room_number)
);

CREATE TABLE beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  ward_id uuid REFERENCES wards(id),
  room_id uuid REFERENCES rooms(id),
  bed_number text NOT NULL,
  bed_type text,
  daily_charge numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Available'
    CHECK (status IN ('Available','Occupied','Reserved','Cleaning','Maintenance')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, bed_number)
);

CREATE INDEX idx_wards_tenant ON wards(tenant_id, branch_id);
CREATE INDEX idx_rooms_tenant ON rooms(tenant_id, ward_id);
CREATE INDEX idx_beds_tenant_status ON beds(tenant_id, status);

COMMIT;
