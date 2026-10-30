BEGIN;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'accountant';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username citext,
  ADD COLUMN IF NOT EXISTS force_password_change boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_expires_at date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_username
  ON users(tenant_id, username) WHERE username IS NOT NULL;

CREATE TABLE staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  employee_id text NOT NULL,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  profile_photo text,
  staff_type text NOT NULL,
  branch_id uuid REFERENCES branches(id),
  department_id uuid REFERENCES departments(id),
  designation text,
  employment_type text,
  joining_date date,
  status text NOT NULL DEFAULT 'Active',
  personal jsonb NOT NULL DEFAULT '{}',
  employment jsonb NOT NULL DEFAULT '{}',
  account jsonb NOT NULL DEFAULT '{}',
  professional jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, employee_id)
);

CREATE INDEX idx_staff_tenant_type ON staff_members(tenant_id, staff_type, status);
COMMIT;
