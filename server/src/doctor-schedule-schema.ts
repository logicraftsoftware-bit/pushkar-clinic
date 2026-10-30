// Installed during API initialization so availability does not depend on a manual job.
export const doctorScheduleSchemaSql = `
CREATE OR REPLACE FUNCTION apply_daily_doctor_schedule() RETURNS trigger AS $$
DECLARE
  p jsonb := coalesce(NEW.professional, '{}'::jsonb);
  start_day text := '2026-10-25';
BEGIN
  IF NEW.staff_type <> 'Doctor' OR p->>'daily_schedule_version' = '2026-10-25-v1' THEN
    RETURN NEW;
  END IF;
  NEW.professional := p || jsonb_build_object(
    'daily_schedule_version', '2026-10-25-v1',
    'daily_schedule_backup', coalesce(p->'daily_schedule_backup', p),
    'slot_duration', 5, 'maximum_appointments', 180,
    'appointment_default_schedule', jsonb_build_object(
      'from_time', '07:00', 'to_time', '22:00', 'max_slots', 180,
      'slot_mode', 'capacity', 'start_date', start_day),
    'appointment_schedule', coalesce((
      SELECT jsonb_agg(day) FROM jsonb_array_elements(coalesce(p->'appointment_schedule','[]'::jsonb)) day
      WHERE CASE WHEN day->>'appointment_date' ~ '^\\d{2}-\\d{2}-\\d{4}$'
        THEN to_char(to_date(day->>'appointment_date','DD-MM-YYYY'),'YYYY-MM-DD')
        ELSE left(day->>'appointment_date',10) END < start_day
    ), '[]'::jsonb),
    'appointment_unavailable_dates', coalesce((
      SELECT jsonb_agg(day) FROM jsonb_array_elements_text(coalesce(p->'appointment_unavailable_dates','[]'::jsonb)) day
      WHERE CASE WHEN day ~ '^\\d{2}-\\d{2}-\\d{4}$'
        THEN to_char(to_date(day,'DD-MM-YYYY'),'YYYY-MM-DD') ELSE left(day,10) END < start_day
    ), '[]'::jsonb)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS staff_daily_doctor_schedule ON staff_members;
CREATE TRIGGER staff_daily_doctor_schedule BEFORE INSERT OR UPDATE OF professional, staff_type
  ON staff_members FOR EACH ROW EXECUTE FUNCTION apply_daily_doctor_schedule();
UPDATE staff_members SET professional = coalesce(professional,'{}'::jsonb)
WHERE staff_type = 'Doctor' AND coalesce(professional->>'daily_schedule_version','') <> '2026-10-25-v1';
`;
