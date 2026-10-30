BEGIN;

CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code citext NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  monthly_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  yearly_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (yearly_price >= 0),
  trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days >= 0),
  max_branches integer NOT NULL DEFAULT 1 CHECK (max_branches > 0),
  max_users integer NOT NULL DEFAULT 25 CHECK (max_users > 0),
  max_doctors integer NOT NULL DEFAULT 10 CHECK (max_doctors > 0),
  storage_limit_gb integer NOT NULL DEFAULT 10 CHECK (storage_limit_gb > 0),
  ai_usage_limit integer NOT NULL DEFAULT 0 CHECK (ai_usage_limit >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_plan_modules (
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES platform_modules(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, module_id)
);

ALTER TABLE hospitals
  ADD COLUMN logo_url text,
  ADD COLUMN hospital_type text,
  ADD COLUMN registration_number text,
  ADD COLUMN email citext,
  ADD COLUMN phone text,
  ADD COLUMN emergency_phone text,
  ADD COLUMN address_line text,
  ADD COLUMN city text,
  ADD COLUMN state text,
  ADD COLUMN pin_code text,
  ADD COLUMN country text NOT NULL DEFAULT 'India',
  ADD COLUMN gstin text;

ALTER TABLE subscriptions
  ADD COLUMN plan_id uuid REFERENCES subscription_plans(id),
  ADD COLUMN billing_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly'));

ALTER TABLE users ADD COLUMN phone text;

CREATE INDEX idx_plans_status ON subscription_plans (status, created_at DESC);
CREATE INDEX idx_plan_modules_plan ON subscription_plan_modules (plan_id);
CREATE INDEX idx_hospitals_email ON hospitals (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_hospitals_location ON hospitals (country, state, city) WHERE deleted_at IS NULL;
CREATE TRIGGER subscription_plans_updated_at BEFORE UPDATE ON subscription_plans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO subscription_plans (
  name, code, description, monthly_price, yearly_price, trial_days,
  max_branches, max_users, max_doctors, storage_limit_gb, ai_usage_limit
) VALUES (
  'Enterprise', 'enterprise', 'Complete hospital operations suite for growing healthcare groups.',
  49999, 539989, 14, 25, 1000, 250, 1000, 100000
);

INSERT INTO subscription_plan_modules (plan_id, module_id)
SELECT p.id, m.id FROM subscription_plans p CROSS JOIN platform_modules m
WHERE p.code = 'enterprise';

UPDATE subscriptions s SET plan_id = p.id
FROM subscription_plans p WHERE p.code = s.plan_code;

COMMIT;
