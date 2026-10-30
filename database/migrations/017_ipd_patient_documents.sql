ALTER TABLE ipd_admissions
  ADD COLUMN IF NOT EXISTS patient_documents jsonb NOT NULL DEFAULT '{}';
