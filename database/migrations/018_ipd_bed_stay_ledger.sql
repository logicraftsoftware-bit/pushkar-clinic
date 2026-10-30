CREATE TABLE IF NOT EXISTS ipd_bed_stays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE, bed_id uuid NOT NULL REFERENCES beds(id),
  ward_id uuid REFERENCES wards(id), room_id uuid REFERENCES rooms(id), bed_number text NOT NULL,
  daily_rate numeric(14,2) NOT NULL DEFAULT 0, started_at timestamptz NOT NULL, ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ipd_bed_stays_admission ON ipd_bed_stays(tenant_id,admission_id,started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ipd_bed_stays_open ON ipd_bed_stays(admission_id) WHERE ended_at IS NULL;
INSERT INTO ipd_bed_stays(tenant_id,admission_id,bed_id,ward_id,room_id,bed_number,daily_rate,started_at,ended_at)
SELECT a.tenant_id,a.id,a.bed_id,a.ward_id,a.room_id,b.bed_number,coalesce(nullif(a.bed_daily_charge,0),b.daily_charge),a.admitted_at,
 CASE WHEN lower(a.status) IN ('discharged','cancelled') THEN coalesce(a.discharged_at,a.updated_at) END
FROM ipd_admissions a JOIN beds b ON b.id=a.bed_id WHERE NOT EXISTS(SELECT 1 FROM ipd_bed_stays s WHERE s.admission_id=a.id);
