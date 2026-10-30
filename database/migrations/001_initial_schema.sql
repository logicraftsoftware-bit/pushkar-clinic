BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE hospital_status AS ENUM ('trial', 'active', 'suspended', 'inactive');
CREATE TYPE subscription_status AS ENUM ('trial', 'active', 'past_due', 'cancelled', 'expired');
CREATE TYPE user_role AS ENUM (
  'super_admin', 'hospital_admin', 'receptionist', 'doctor', 'nurse',
  'laboratory', 'radiology', 'pharmacist', 'patient'
);
CREATE TYPE appointment_status AS ENUM (
  'scheduled', 'confirmed', 'checked_in', 'waiting', 'in_consultation',
  'completed', 'cancelled', 'no_show'
);
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'partially_paid', 'refunded', 'failed');

CREATE TABLE hospitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code citext NOT NULL UNIQUE,
  status hospital_status NOT NULL DEFAULT 'trial',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  currency char(3) NOT NULL DEFAULT 'INR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id),
  name text NOT NULL,
  code citext NOT NULL,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id),
  branch_id uuid REFERENCES branches(id),
  name text NOT NULL,
  code citext NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, code)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES hospitals(id),
  branch_id uuid REFERENCES branches(id),
  department_id uuid REFERENCES departments(id),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  role user_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  medical_record_number citext NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  date_of_birth date,
  sex text CHECK (sex IN ('male', 'female', 'other', 'unknown')),
  phone text,
  email citext,
  blood_group text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  emergency_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, medical_record_number)
);

CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  department_id uuid REFERENCES departments(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  doctor_id uuid NOT NULL REFERENCES users(id),
  scheduled_at timestamptz NOT NULL,
  duration_minutes smallint NOT NULL DEFAULT 20 CHECK (duration_minutes > 0),
  status appointment_status NOT NULL DEFAULT 'scheduled',
  source text NOT NULL DEFAULT 'reception',
  reason text,
  notes text,
  token_number text,
  checked_in_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id),
  plan_code citext NOT NULL,
  status subscription_status NOT NULL DEFAULT 'trial',
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  monthly_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id),
  branch_id uuid REFERENCES branches(id),
  patient_id uuid REFERENCES patients(id),
  invoice_number citext NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status payment_status NOT NULL DEFAULT 'pending',
  payment_method text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_number)
);

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid REFERENCES hospitals(id),
  branch_id uuid REFERENCES branches(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_branches_tenant_active ON branches (tenant_id, is_active);
CREATE INDEX idx_departments_tenant_branch ON departments (tenant_id, branch_id);
CREATE INDEX idx_users_tenant_branch_role ON users (tenant_id, branch_id, role) WHERE is_active;
CREATE INDEX idx_patients_tenant_branch_created ON patients (tenant_id, branch_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_tenant_phone ON patients (tenant_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_appointments_tenant_branch_scheduled ON appointments (tenant_id, branch_id, scheduled_at);
CREATE INDEX idx_appointments_doctor_scheduled ON appointments (tenant_id, doctor_id, scheduled_at);
CREATE INDEX idx_appointments_status_scheduled ON appointments (tenant_id, status, scheduled_at);
CREATE INDEX idx_subscriptions_status_expiry ON subscriptions (status, expires_at);
CREATE INDEX idx_payments_tenant_branch_created ON payments (tenant_id, branch_id, created_at DESC);
CREATE INDEX idx_payments_tenant_status ON payments (tenant_id, status, created_at DESC);
CREATE INDEX idx_audit_tenant_time ON audit_logs (tenant_id, occurred_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs (tenant_id, entity_type, entity_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER hospitals_updated_at BEFORE UPDATE ON hospitals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Application requests set: SET LOCAL app.tenant_id = '<hospital uuid>';
-- Super-admin connections must use a separately controlled database role.
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_branches ON branches USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_departments ON departments USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_users ON users USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_patients ON patients USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_appointments ON appointments USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_subscriptions ON subscriptions USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_payments ON payments USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation_audit_logs ON audit_logs USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
