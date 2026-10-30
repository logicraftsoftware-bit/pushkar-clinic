ALTER TABLE ipd_admissions
  ADD COLUMN IF NOT EXISTS charges jsonb NOT NULL DEFAULT '[]';

ALTER TABLE ipd_admissions
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE ipd_admissions
  ADD COLUMN IF NOT EXISTS consultation_fee numeric(14,2) NOT NULL DEFAULT 0;
