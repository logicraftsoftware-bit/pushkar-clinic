BEGIN;

CREATE TABLE super_admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'boxes',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hospital_modules (
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES platform_modules(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  PRIMARY KEY (tenant_id, module_id)
);

CREATE TABLE platform_settings (
  key citext PRIMARY KEY,
  value jsonb NOT NULL,
  category text NOT NULL DEFAULT 'general',
  description text NOT NULL DEFAULT '',
  is_public boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES super_admin_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid REFERENCES hospitals(id),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  source text NOT NULL,
  event_type text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hospital_modules_tenant_enabled ON hospital_modules (tenant_id, is_enabled);
CREATE INDEX idx_platform_events_time ON platform_events (created_at DESC);
CREATE INDEX idx_platform_events_unresolved ON platform_events (severity, created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_hospitals_status_created ON hospitals (status, created_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER platform_modules_updated_at BEFORE UPDATE ON platform_modules
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- No user accounts are seeded. Provision this clinic privately.

INSERT INTO platform_modules (code, name, description, icon) VALUES
  ('opd', 'OPD & Appointments', 'Patient registration, scheduling, queue and consultation workflows.', 'calendar'),
  ('ipd', 'IPD & Bed Management', 'Admissions, wards, beds, nursing and discharge workflows.', 'bed'),
  ('laboratory', 'Laboratory', 'Orders, samples, processing, verification and lab reporting.', 'flask'),
  ('radiology', 'Radiology', 'Imaging orders, studies, reporting and device workflow.', 'scan'),
  ('pharmacy', 'Pharmacy', 'Medicine inventory, purchases, dispensing and pharmacy billing.', 'pill'),
  ('billing', 'Billing & Finance', 'Invoices, collections, insurance, expenses and financial reports.', 'credit-card'),
  ('hr', 'HR & Payroll', 'Employees, attendance, shifts, leave and payroll.', 'users'),
  ('patient_portal', 'Patient Portal', 'Appointments, prescriptions, reports, bills and payments.', 'smartphone');

INSERT INTO platform_settings (key, value, category, description, is_public) VALUES
  ('platform_name', '"Careframe"', 'branding', 'Product name displayed across the platform.', true),
  ('support_email', '"support@careframe.health"', 'support', 'Default customer support email.', true),
  ('trial_days', '14', 'subscriptions', 'Default trial length for a new hospital.', false),
  ('maintenance_mode', 'false', 'operations', 'Block tenant access during planned maintenance.', true),
  ('session_timeout_minutes', '60', 'security', 'Administrative session inactivity timeout.', false);

COMMIT;
