ALTER TABLE ipd_admissions
  ADD COLUMN IF NOT EXISTS bed_daily_charge numeric(14,2) NOT NULL DEFAULT 0;
