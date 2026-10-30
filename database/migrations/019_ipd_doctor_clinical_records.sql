CREATE TABLE IF NOT EXISTS doctor_clinical_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES users(id), patient_id uuid NOT NULL REFERENCES patients(id),
  appointment_id uuid REFERENCES clinical_appointments(id) ON DELETE SET NULL, record_type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE doctor_clinical_records
  ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES ipd_admissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_clinical_records_admission
  ON doctor_clinical_records(tenant_id, admission_id, created_at)
  WHERE admission_id IS NOT NULL;
