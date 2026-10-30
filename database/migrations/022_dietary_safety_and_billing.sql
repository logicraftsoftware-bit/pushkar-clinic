-- Dietary safety, delivery accountability, and package billing hardening.
CREATE TABLE IF NOT EXISTS dietary_menu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  item_code text NOT NULL,
  item_name text NOT NULL,
  category text NOT NULL DEFAULT 'Meals',
  meal_type text NOT NULL,
  patient_rate numeric(12,2) NOT NULL DEFAULT 0,
  attendant_rate numeric(12,2) NOT NULL DEFAULT 0,
  guest_rate numeric(12,2) NOT NULL DEFAULT 0,
  staff_rate numeric(12,2) NOT NULL DEFAULT 0,
  tax numeric(6,2) NOT NULL DEFAULT 0,
  package_eligible boolean NOT NULL DEFAULT false,
  complimentary_eligible boolean NOT NULL DEFAULT false,
  available boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, item_code)
);

CREATE TABLE IF NOT EXISTS patient_diets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  diet_type text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  changed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dietary_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  admission_id uuid REFERENCES ipd_admissions(id),
  patient_id uuid REFERENCES patients(id),
  menu_id uuid REFERENCES dietary_menu(id),
  order_number text NOT NULL,
  order_type text NOT NULL,
  item_name text NOT NULL,
  quantity numeric(10,2) NOT NULL,
  rate numeric(12,2) NOT NULL,
  amount numeric(14,2) NOT NULL,
  billing_class text NOT NULL,
  kitchen_status text NOT NULL DEFAULT 'Order Placed',
  delivery_status text NOT NULL DEFAULT 'Pending',
  remarks text NOT NULL DEFAULT '',
  timeline jsonb NOT NULL DEFAULT '{}',
  ledger_posted boolean NOT NULL DEFAULT false,
  ordered_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_number)
);

CREATE TABLE IF NOT EXISTS dietary_package_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  package_name text NOT NULL,
  meal_type text NOT NULL,
  order_type text NOT NULL,
  included boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dietary_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  remarks text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dietary_menu
  ADD COLUMN IF NOT EXISTS allergens text[] NOT NULL DEFAULT '{}';

ALTER TABLE dietary_orders
  ADD COLUMN IF NOT EXISTS received_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS prepared_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS meal_date date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS meal_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auto_generated boolean NOT NULL DEFAULT false;

ALTER TABLE patient_diets
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

CREATE TABLE IF NOT EXISTS dietary_meal_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  meal_type text NOT NULL,
  service_time time NOT NULL,
  generation_lead_minutes integer NOT NULL DEFAULT 120 CHECK (generation_lead_minutes >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, meal_type)
);

CREATE TABLE IF NOT EXISTS dietary_meal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
  reason text NOT NULL,
  held_by uuid REFERENCES users(id),
  held_at timestamptz NOT NULL DEFAULT now(),
  resumed_by uuid REFERENCES users(id),
  resumed_at timestamptz,
  active boolean NOT NULL DEFAULT true
);

WITH duplicates AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, lower(package_name), lower(meal_type), lower(order_type)
           ORDER BY created_at DESC, id DESC
         ) AS position
  FROM dietary_package_rules
  WHERE active
)
UPDATE dietary_package_rules
SET active = false
WHERE id IN (SELECT id FROM duplicates WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS dietary_package_rule_unique
  ON dietary_package_rules (
    tenant_id,
    lower(package_name),
    lower(meal_type),
    lower(order_type)
  )
  WHERE active;

CREATE INDEX IF NOT EXISTS dietary_orders_admission_status_idx
  ON dietary_orders (tenant_id, admission_id, kitchen_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS dietary_auto_meal_unique
  ON dietary_orders (tenant_id, admission_id, menu_id, meal_date, order_type)
  WHERE auto_generated AND kitchen_status <> 'Cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS dietary_active_hold_unique
  ON dietary_meal_holds (tenant_id, admission_id)
  WHERE active;

CREATE INDEX IF NOT EXISTS patient_diets_active_idx
  ON patient_diets (tenant_id, admission_id, created_at DESC)
  WHERE active;
