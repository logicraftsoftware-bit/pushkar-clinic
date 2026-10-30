import { pool } from "./db.js";
import {navigationIndexesSql} from './navigation-indexes.js';
import {diagnosticMasterUnificationSql} from './diagnostic-master-unification.js';
import {migrateRadiologyWorkspace} from './diagnostic-workflow.js';
import { cancellationSchemaSql } from "./cancellation-service.js";
import {siteAuditSchemaSql} from './site-audit-schema.js';
import {liveAccessSchemaSql} from './live-access-schema.js';
import {activateAuditTriggers} from './audit-context.js';
import {doctorScheduleSchemaSql} from './doctor-schedule-schema.js';
import {referPharmacySchemaSql} from './refer-pharmacy-schema.js';

let dbInitialized: Promise<void> | null = null;

export async function initializeDb(): Promise<void> {
  if (dbInitialized) return dbInitialized;

  dbInitialized = (async () => {
    console.log("Starting database schema initialization...");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Acquire an advisory lock to prevent concurrent database migrations/schema updates
      await client.query("SELECT pg_advisory_xact_lock($1)", [741_920_114]);

      // 1. Ensure patients columns (from patient-management.ts)
      await client.query(`
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS photo_url text;
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS allergies text NOT NULL DEFAULT '';
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS existing_conditions text NOT NULL DEFAULT '';
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS current_medication text NOT NULL DEFAULT '';
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS registration_fee numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS maintenance_fee numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS registration_addons jsonb NOT NULL DEFAULT '[]';
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS deposit_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT '';
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS payment_reference text NOT NULL DEFAULT '';
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS discount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS discount_remarks text NOT NULL DEFAULT '';
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS registration_payment_status text NOT NULL DEFAULT 'Unpaid';
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS payment_status_remarks text NOT NULL DEFAULT '';
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS total_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE patients ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active';
      `);

      // 2. Ensure clinical_appointments and ipd_admissions (from clinical-operations.ts)
      await client.query(`
        CREATE TABLE IF NOT EXISTS clinical_appointments(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          branch_id uuid NOT NULL REFERENCES branches(id),
          department_id uuid REFERENCES departments(id),
          patient_id uuid NOT NULL REFERENCES patients(id),
          doctor_id uuid REFERENCES users(id),
          appointment_number text NOT NULL,
          appointment_date date NOT NULL,
          appointment_time time NOT NULL,
          appointment_type text NOT NULL DEFAULT 'OPD',
          visit_type text NOT NULL DEFAULT 'New',
          reason text,
          consultation_fee numeric(12,2) NOT NULL DEFAULT 0,
          payment_status text NOT NULL DEFAULT 'Pending',
          source text NOT NULL DEFAULT 'Reception',
          token_number text,
          status text NOT NULL DEFAULT 'Booked',
          notes text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(tenant_id, appointment_number)
        );
        ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS symptoms text[] NOT NULL DEFAULT '{}';
        ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS charges jsonb NOT NULL DEFAULT '[]';
        ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;
        ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT '';
        ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) NOT NULL DEFAULT 0;
        ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS slot_serial integer;
        ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS cancellation_reason text NOT NULL DEFAULT '';
        ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
        ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS refund_amount numeric(12,2) NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS ipd_admissions(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          branch_id uuid NOT NULL REFERENCES branches(id),
          patient_id uuid NOT NULL REFERENCES patients(id),
          department_id uuid REFERENCES departments(id),
          consultant_doctor_id uuid REFERENCES users(id),
          ward_id uuid REFERENCES wards(id),
          room_id uuid REFERENCES rooms(id),
          bed_id uuid REFERENCES beds(id),
          ipd_number text NOT NULL,
          admitted_at timestamptz NOT NULL,
          admission_type text NOT NULL DEFAULT 'Planned',
          reason_diagnosis text,
          attendant jsonb NOT NULL DEFAULT '{}',
          insurance_tpa text,
          advance numeric(12,2) NOT NULL DEFAULT 0,
          expected_discharge date,
          status text NOT NULL DEFAULT 'Admitted',
          discharged_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(tenant_id, ipd_number)
        );
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS deposit_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT '';
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS payment_reference text NOT NULL DEFAULT '';
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS discount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS discount_remarks text NOT NULL DEFAULT '';
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS admission_payment_status text NOT NULL DEFAULT 'Unpaid';
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS payment_status_remarks text NOT NULL DEFAULT '';
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS registration_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS registration_fee_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS registration_addon_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS registration_deposit_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS registration_discount_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS total_amount numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS has_insurance boolean NOT NULL DEFAULT false;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS insurance_company text NOT NULL DEFAULT '';
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS policy_number text NOT NULL DEFAULT '';
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS insurance_document text NOT NULL DEFAULT '';
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS bed_daily_charge numeric(14,2) NOT NULL DEFAULT 0;
        ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS patient_documents jsonb NOT NULL DEFAULT '{}';

        CREATE TABLE IF NOT EXISTS ipd_transfer_history(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          admission_id uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,
          transfer_type text NOT NULL,
          from_details jsonb NOT NULL DEFAULT '{}',
          to_details jsonb NOT NULL DEFAULT '{}',
          notes text,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS ipd_bed_stays(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,admission_id uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,bed_id uuid NOT NULL REFERENCES beds(id),ward_id uuid REFERENCES wards(id),room_id uuid REFERENCES rooms(id),bed_number text NOT NULL,daily_rate numeric(14,2) NOT NULL DEFAULT 0,started_at timestamptz NOT NULL,ended_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX IF NOT EXISTS idx_ipd_bed_stays_admission ON ipd_bed_stays(tenant_id,admission_id,started_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ipd_bed_stays_open ON ipd_bed_stays(admission_id) WHERE ended_at IS NULL;
      `);

      // 3. Ensure finance and inventory tables (from finance-inventory.ts)
      await client.query(`
        CREATE TABLE IF NOT EXISTS finance_records(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          kind text NOT NULL,
          record_number text NOT NULL,
          patient_id uuid REFERENCES patients(id),
          invoice_id uuid REFERENCES finance_records(id) ON DELETE SET NULL,
          branch_id uuid REFERENCES branches(id),
          data jsonb NOT NULL DEFAULT '{}',
          amount numeric(14,2) NOT NULL DEFAULT 0,
          total numeric(14,2) NOT NULL DEFAULT 0,
          paid numeric(14,2) NOT NULL DEFAULT 0,
          due numeric(14,2) NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'Active',
          record_date date NOT NULL DEFAULT current_date,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE finance_records
          ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id),
          ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES finance_records(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id),
          ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS amount numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS paid numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS due numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active',
          ADD COLUMN IF NOT EXISTS record_date date NOT NULL DEFAULT current_date,
          ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
        CREATE UNIQUE INDEX IF NOT EXISTS finance_records_tenant_number_idx ON finance_records(tenant_id, record_number);

        CREATE TABLE IF NOT EXISTS inventory_records(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          kind text NOT NULL,
          record_code text NOT NULL,
          branch_id uuid REFERENCES branches(id),
          supplier_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          category_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          item_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          data jsonb NOT NULL DEFAULT '{}',
          quantity numeric(14,2) NOT NULL DEFAULT 0,
          amount numeric(14,2) NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'Active',
          record_date date NOT NULL DEFAULT current_date,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE inventory_records
          ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id),
          ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS quantity numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS amount numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active',
          ADD COLUMN IF NOT EXISTS record_date date NOT NULL DEFAULT current_date,
          ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
        CREATE UNIQUE INDEX IF NOT EXISTS inventory_records_tenant_code_idx ON inventory_records(tenant_id, record_code);
      `);

      // 4. Ensure hospital-management schemas
      await client.query(`
        ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS establishment_date date;
        ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS website text;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_type text;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_name text;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS email citext;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS emergency_phone text;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS address_line text;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS city text;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS state text;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS pin_code text;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS bed_capacity integer NOT NULL DEFAULT 0;
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS hod_name text;
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS location text;
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS phone_extension text;
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

        CREATE TABLE IF NOT EXISTS wards (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          branch_id uuid NOT NULL REFERENCES branches(id), department_id uuid REFERENCES departments(id), name text NOT NULL,
          code citext NOT NULL, ward_type text, floor text, capacity integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,code));

        CREATE TABLE IF NOT EXISTS rooms (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          branch_id uuid NOT NULL REFERENCES branches(id), ward_id uuid REFERENCES wards(id), room_number text NOT NULL, room_type text,
          floor text, daily_charge numeric(12,2) NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,branch_id,room_number));

        CREATE TABLE IF NOT EXISTS beds (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          branch_id uuid NOT NULL REFERENCES branches(id), ward_id uuid REFERENCES wards(id), room_id uuid REFERENCES rooms(id),
          bed_number text NOT NULL, bed_type text, daily_charge numeric(12,2) NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'Available' CHECK(status IN ('Available','Occupied','Reserved','Cleaning','Maintenance')),
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,branch_id,bed_number));

        CREATE TABLE IF NOT EXISTS bed_masters (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK(kind IN ('type','group','floor')), name text NOT NULL, description text NOT NULL DEFAULT '', color text,
          floor_id uuid REFERENCES bed_masters(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(tenant_id,kind,name));

        ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_type_id uuid REFERENCES bed_masters(id) ON DELETE RESTRICT;
        ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_group_id uuid REFERENCES bed_masters(id) ON DELETE RESTRICT;
        CREATE INDEX IF NOT EXISTS idx_bed_masters_tenant_kind ON bed_masters(tenant_id,kind);

        CREATE TABLE IF NOT EXISTS hospital_charge_masters (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK(kind IN ('charge','category','type','tax','unit')), name text NOT NULL,
          parent_id uuid REFERENCES hospital_charge_masters(id) ON DELETE RESTRICT, percentage numeric(7,2),
          modules text[] NOT NULL DEFAULT '{}', data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,kind,name));

        CREATE TABLE IF NOT EXISTS hospital_print_templates (
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE, document_type text NOT NULL,
          header_image text, footer_content text NOT NULL DEFAULT '', updated_by uuid REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,document_type));

        CREATE TABLE IF NOT EXISTS hospital_operation_masters (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK(kind IN ('operation','category')), name text NOT NULL,
          category_id uuid REFERENCES hospital_operation_masters(id) ON DELETE RESTRICT,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(tenant_id,kind,name));

        CREATE TABLE IF NOT EXISTS hospital_pharmacy_masters (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK(kind IN ('category','supplier','dosage','interval','duration','unit','company','group','medicine')),
          name text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,kind,name));
        ALTER TABLE hospital_pharmacy_masters DROP CONSTRAINT IF EXISTS hospital_pharmacy_masters_kind_check;
        ALTER TABLE hospital_pharmacy_masters ADD CONSTRAINT hospital_pharmacy_masters_kind_check CHECK(kind IN ('category','supplier','dosage','interval','duration','unit','company','group','medicine'));

        CREATE TABLE IF NOT EXISTS hospital_diagnostic_masters (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          domain text NOT NULL CHECK(domain IN ('pathology','radiology','blood','symptoms')), kind text NOT NULL,
          name text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,domain,kind,name));

        ALTER TABLE hospital_diagnostic_masters DROP CONSTRAINT IF EXISTS hospital_diagnostic_masters_domain_check;
        ALTER TABLE hospital_diagnostic_masters ADD CONSTRAINT hospital_diagnostic_masters_domain_check CHECK(domain IN ('pathology','radiology','blood','symptoms'));

        ALTER TABLE users ADD COLUMN IF NOT EXISTS username citext;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS force_password_change boolean NOT NULL DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS account_expires_at date;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id,username) WHERE username IS NOT NULL;

        CREATE TABLE IF NOT EXISTS staff_members (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          user_id uuid REFERENCES users(id) ON DELETE SET NULL, employee_id text NOT NULL, first_name text NOT NULL,
          middle_name text, last_name text NOT NULL, profile_photo text, staff_type text NOT NULL,
          branch_id uuid REFERENCES branches(id), department_id uuid REFERENCES departments(id), designation text,
          employment_type text, joining_date date, status text NOT NULL DEFAULT 'Active',
          personal jsonb NOT NULL DEFAULT '{}', employment jsonb NOT NULL DEFAULT '{}', account jsonb NOT NULL DEFAULT '{}',
          professional jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,employee_id));


        UPDATE staff_members SET staff_type='Pharmacy Manager' WHERE staff_type='Pharmacist';
        UPDATE staff_members SET staff_type='HR Manager' WHERE staff_type='HR';

        CREATE TABLE IF NOT EXISTS call_centre_crm_connections (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL UNIQUE REFERENCES hospitals(id) ON DELETE CASCADE,
          clinic_external_id text NOT NULL UNIQUE, clinic_name text NOT NULL DEFAULT '', api_key_prefix text NOT NULL,
          api_key_hash text NOT NULL, is_active boolean NOT NULL DEFAULT true, last_sync_at timestamptz,
          last_sync_status text NOT NULL DEFAULT 'Never synced', last_sync_summary jsonb NOT NULL DEFAULT '{}',
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS call_centre_crm_mappings (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          connection_id uuid NOT NULL REFERENCES call_centre_crm_connections(id) ON DELETE CASCADE,
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          entity_type text NOT NULL CHECK(entity_type IN ('branch','department','doctor','patient','appointment')),
          external_id text NOT NULL, erp_id uuid NOT NULL, source_updated_at timestamptz,
          last_synced_at timestamptz NOT NULL DEFAULT now(), UNIQUE(connection_id,entity_type,external_id));
        CREATE INDEX IF NOT EXISTS call_centre_crm_mappings_erp_idx ON call_centre_crm_mappings(tenant_id,entity_type,erp_id);
      `);

      await client.query(navigationIndexesSql);
      await client.query(cancellationSchemaSql);
      await client.query(siteAuditSchemaSql);
      await client.query(liveAccessSchemaSql);
      await client.query(doctorScheduleSchemaSql);
      await client.query(referPharmacySchemaSql);
      await client.query(diagnosticMasterUnificationSql);
      await migrateRadiologyWorkspace(client);
      await client.query("COMMIT");
      activateAuditTriggers();
      console.log("Database schema transaction committed successfully.");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Database schema transaction rolled back due to error:", error);
      throw error;
    } finally {
      client.release();
    }

    // 5. Run ALTER TYPE statements outside transaction block because they cannot be executed inside transaction blocks in PG
    try {
      await pool.query("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'accountant'");
      await pool.query("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr'");
      console.log("Altered user_role type values successfully.");
    } catch (e) {
      console.error("Non-fatal: could not alter type user_role", e);
    }
  })();

  return dbInitialized;
}
