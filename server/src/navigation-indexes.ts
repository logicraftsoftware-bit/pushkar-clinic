// Match common tenant-scoped lists and the exact expressions used by login.
export const navigationIndexesSql=`
CREATE INDEX IF NOT EXISTS users_login_email_idx ON users((lower(email::text)));
CREATE INDEX IF NOT EXISTS users_login_phone_idx ON users(phone);
CREATE INDEX IF NOT EXISTS patients_tenant_created_idx ON patients(tenant_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clinical_tenant_date_idx ON clinical_appointments(tenant_id,appointment_date DESC,appointment_time DESC);
CREATE INDEX IF NOT EXISTS clinical_patient_date_idx ON clinical_appointments(tenant_id,patient_id,appointment_date DESC,appointment_time DESC);
CREATE INDEX IF NOT EXISTS clinical_doctor_date_idx ON clinical_appointments(tenant_id,doctor_id,appointment_date DESC,appointment_time DESC);
CREATE INDEX IF NOT EXISTS ipd_tenant_admitted_idx ON ipd_admissions(tenant_id,admitted_at DESC);
CREATE INDEX IF NOT EXISTS ipd_patient_admitted_idx ON ipd_admissions(tenant_id,patient_id,admitted_at DESC);
CREATE INDEX IF NOT EXISTS finance_patient_created_idx ON finance_records(tenant_id,patient_id,created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_kind_created_idx ON inventory_records(tenant_id,kind,created_at DESC);
CREATE INDEX IF NOT EXISTS staff_user_lookup_idx ON staff_members(user_id) WHERE user_id IS NOT NULL;
`;
