import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { requireCrmIntegration } from './crm-integration-status.js';

const router = Router();
router.use(requireCrmIntegration);
const id = z.string().trim().min(1).max(200);
const optionalId = id.nullish();
const recordBase = z.object({ externalId: id, updatedAt: z.string().datetime().optional() });
const payloadSchema = z.object({
  branches: z.array(recordBase.extend({ name: z.string().trim().min(1), code: z.string().trim().min(1), phone: z.string().optional(), address: z.record(z.string(), z.unknown()).optional(), active: z.boolean().optional() })).default([]),
  departments: z.array(recordBase.extend({ branchExternalId: optionalId, name: z.string().trim().min(1), code: z.string().trim().min(1), active: z.boolean().optional() })).default([]),
  doctors: z.array(recordBase.extend({ branchExternalId: id, departmentExternalId: optionalId, name: z.string().trim().min(1), email: z.string().email().optional(), mobile: z.string().optional(), qualification: z.string().optional(), specialization: z.string().optional(), registrationNumber: z.string().optional(), consultationFee: z.coerce.number().nonnegative().optional(), active: z.boolean().optional(), schedules: z.array(z.object({ date: z.string().date(), from: z.string(), to: z.string(), maxSlots: z.coerce.number().int().positive().max(500).optional() })).optional() })).default([]),
  patients: z.array(recordBase.extend({ branchExternalId: id, medicalRecordNumber: z.string().optional(), name: z.string().trim().min(1), mobile: z.string().optional(), email: z.string().email().optional(), dateOfBirth: z.string().date().optional(), gender: z.enum(["male", "female", "other", "unknown"]).optional(), bloodGroup: z.string().optional(), address: z.record(z.string(), z.unknown()).optional(), active: z.boolean().optional() })).default([]),
  appointments: z.array(recordBase.extend({ appointmentNumber: z.string().trim().min(1), branchExternalId: id, departmentExternalId: optionalId, doctorExternalId: optionalId, patientExternalId: id, startsAt: z.string().datetime({ offset: true }), status: z.string().optional(), visitType: z.string().optional(), reason: z.string().optional(), tokenNumber: z.string().optional() })).default([]),
});

const hashKey = (value: string) => createHash("sha256").update(value).digest("hex");

router.post("/bootstrap", async (request: Request, response: Response) => {
  const rawKey = request.header("x-api-key") ?? request.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!rawKey) return void response.status(401).json({ error: "CRM API key required" });
  const connectionResult = await pool.query(`SELECT * FROM call_centre_crm_connections WHERE api_key_hash=$1 AND is_active`, [hashKey(rawKey)]);
  const connection = connectionResult.rows[0];
  if (!connection) return void response.status(401).json({ error: "CRM connection is invalid or inactive" });
  const body = payloadSchema.parse(request.body);
  const client = await pool.connect();
  const summary = { branches: 0, departments: 0, doctors: 0, patients: 0, appointments: 0 };
  try {
    await client.query("BEGIN");
    const mapped = async (type: string, externalId: string) => (await client.query(`SELECT erp_id FROM call_centre_crm_mappings WHERE connection_id=$1 AND entity_type=$2 AND external_id=$3`, [connection.id, type, externalId])).rows[0]?.erp_id as string | undefined;
    const saveMap = async (type: string, externalId: string, erpId: string, updatedAt?: string) => client.query(`INSERT INTO call_centre_crm_mappings(connection_id,tenant_id,entity_type,external_id,erp_id,source_updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(connection_id,entity_type,external_id) DO UPDATE SET erp_id=excluded.erp_id,source_updated_at=excluded.source_updated_at,last_synced_at=now()`, [connection.id, connection.tenant_id, type, externalId, erpId, updatedAt ?? null]);

    for (const item of body.branches) {
      const existing = await mapped("branch", item.externalId);
      const row = existing
        ? (await client.query(`UPDATE branches SET name=$1,phone=$2,address=$3,is_active=$4,updated_at=now() WHERE id=$5 AND tenant_id=$6 RETURNING id`, [item.name, item.phone ?? null, item.address ?? {}, item.active ?? true, existing, connection.tenant_id])).rows[0]
        : (await client.query(`INSERT INTO branches(tenant_id,name,code,phone,address,is_active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,code) DO UPDATE SET name=excluded.name,phone=excluded.phone,address=excluded.address,is_active=excluded.is_active,updated_at=now() RETURNING id`, [connection.tenant_id, item.name, item.code, item.phone ?? null, item.address ?? {}, item.active ?? true])).rows[0];
      await saveMap("branch", item.externalId, row.id, item.updatedAt); summary.branches++;
    }
    for (const item of body.departments) {
      const branchId = item.branchExternalId ? await mapped("branch", item.branchExternalId) : null;
      if (item.branchExternalId && !branchId) throw new Error(`Department ${item.externalId}: branch mapping not found`);
      const existing = await mapped("department", item.externalId);
      const row = existing
        ? (await client.query(`UPDATE departments SET branch_id=$1,name=$2,code=$3,is_active=$4,updated_at=now() WHERE id=$5 AND tenant_id=$6 RETURNING id`, [branchId, item.name, item.code, item.active ?? true, existing, connection.tenant_id])).rows[0]
        : (await client.query(`INSERT INTO departments(tenant_id,branch_id,name,code,is_active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,branch_id,code) DO UPDATE SET name=excluded.name,is_active=excluded.is_active RETURNING id`, [connection.tenant_id, branchId, item.name, item.code, item.active ?? true])).rows[0];
      await saveMap("department", item.externalId, row.id, item.updatedAt); summary.departments++;
    }
    for (const item of body.doctors) {
      const branchId = await mapped("branch", item.branchExternalId), departmentId = item.departmentExternalId ? await mapped("department", item.departmentExternalId) : null;
      if (!branchId) throw new Error(`Doctor ${item.externalId}: branch mapping not found`);
      const [firstName, ...rest] = item.name.split(/\s+/), lastName = rest.join(" ") || "Doctor";
      const existing = await mapped("doctor", item.externalId);
      const requestedEmail = item.email ?? `crm-${connection.id}-${item.externalId}@integration.invalid`;
      const sameTenantUser = !existing && item.email ? (await client.query(`SELECT id FROM users WHERE tenant_id=$1 AND email=$2 AND role='doctor'`, [connection.tenant_id, item.email])).rows[0] : null;
      const emailOwnedElsewhere = !existing && !sameTenantUser && item.email ? (await client.query(`SELECT 1 FROM users WHERE email=$1`, [item.email])).rows[0] : null;
      const email = emailOwnedElsewhere ? `crm-${connection.id}-${item.externalId}@integration.invalid` : requestedEmail;
      const userId = existing ?? sameTenantUser?.id;
      const user = userId
        ? (await client.query(`UPDATE users SET branch_id=$1,department_id=$2,first_name=$3,last_name=$4,is_active=$5,updated_at=now() WHERE id=$6 AND tenant_id=$7 RETURNING id`, [branchId, departmentId, firstName, lastName, item.active ?? true, userId, connection.tenant_id])).rows[0]
        : (await client.query(`INSERT INTO users(tenant_id,branch_id,department_id,email,password_hash,first_name,last_name,role,is_active) VALUES($1,$2,$3,$4,crypt(gen_random_uuid()::text,gen_salt('bf',12)),$5,$6,'doctor',$7) RETURNING id`, [connection.tenant_id, branchId, departmentId, email, firstName, lastName, item.active ?? true])).rows[0];
      const professional = { qualification: item.qualification ?? "", specialization: item.specialization ?? "", registration_number: item.registrationNumber ?? "", consultation_fee: item.consultationFee ?? 0, ...(item.schedules ? { appointment_schedule: item.schedules.map(s => ({ appointment_date: s.date, from_time: s.from, to_time: s.to, max_slots: s.maxSlots ?? 20 })) } : {}) };
      await client.query(`INSERT INTO staff_members(tenant_id,user_id,employee_id,first_name,last_name,staff_type,branch_id,department_id,status,personal,employment,account,professional) VALUES($1,$2,$3,$4,$5,'Doctor',$6,$7,$8,$9,'{}','{}',$10) ON CONFLICT(tenant_id,employee_id) DO UPDATE SET user_id=excluded.user_id,first_name=excluded.first_name,last_name=excluded.last_name,branch_id=excluded.branch_id,department_id=excluded.department_id,status=excluded.status,personal=staff_members.personal||excluded.personal,professional=staff_members.professional||excluded.professional,updated_at=now()`, [connection.tenant_id, user.id, `CRM-${item.externalId}`, firstName, lastName, branchId, departmentId, item.active === false ? "Inactive" : "Active", { phone: item.mobile ?? "" }, professional]);
      await saveMap("doctor", item.externalId, user.id, item.updatedAt); summary.doctors++;
    }
    for (const item of body.patients) {
      const branchId = await mapped("branch", item.branchExternalId); if (!branchId) throw new Error(`Patient ${item.externalId}: branch mapping not found`);
      const [firstName, ...rest] = item.name.split(/\s+/), lastName = rest.join(" ") || "Patient";
      const existing = await mapped("patient", item.externalId), mrn = item.medicalRecordNumber ?? `CRM-${item.externalId}`;
      const patient = existing
        ? (await client.query(`UPDATE patients SET branch_id=$1,first_name=$2,last_name=$3,date_of_birth=$4,sex=$5,phone=$6,email=$7,blood_group=$8,address=$9,status=$10,updated_at=now() WHERE id=$11 AND tenant_id=$12 RETURNING id`, [branchId, firstName, lastName, item.dateOfBirth ?? null, item.gender ?? "unknown", item.mobile ?? null, item.email ?? null, item.bloodGroup ?? null, item.address ?? {}, item.active === false ? "Inactive" : "Active", existing, connection.tenant_id])).rows[0]
        : (await client.query(`INSERT INTO patients(tenant_id,branch_id,medical_record_number,first_name,last_name,date_of_birth,sex,phone,email,blood_group,address,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(tenant_id,medical_record_number) DO UPDATE SET branch_id=excluded.branch_id,first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone,email=excluded.email,address=excluded.address,updated_at=now() RETURNING id`, [connection.tenant_id, branchId, mrn, firstName, lastName, item.dateOfBirth ?? null, item.gender ?? "unknown", item.mobile ?? null, item.email ?? null, item.bloodGroup ?? null, item.address ?? {}, item.active === false ? "Inactive" : "Active"])).rows[0];
      await saveMap("patient", item.externalId, patient.id, item.updatedAt); summary.patients++;
    }
    for (const item of body.appointments) {
      const branchId = await mapped("branch", item.branchExternalId), patientId = await mapped("patient", item.patientExternalId), departmentId = item.departmentExternalId ? await mapped("department", item.departmentExternalId) : null, doctorId = item.doctorExternalId ? await mapped("doctor", item.doctorExternalId) : null;
      if (!branchId || !patientId) throw new Error(`Appointment ${item.externalId}: branch or patient mapping not found`);
      // Preserve the clinic's explicit local date/time instead of shifting it to UTC.
      const date = item.startsAt.slice(0,10), time = item.startsAt.slice(11,19);
      const existing = await mapped("appointment", item.externalId);
      const appointment = existing
        ? (await client.query(`UPDATE clinical_appointments SET branch_id=$1,department_id=$2,patient_id=$3,doctor_id=$4,appointment_date=$5,appointment_time=$6,visit_type=$7,reason=$8,token_number=$9,updated_at=now() WHERE id=$10 AND tenant_id=$11 RETURNING id`, [branchId, departmentId, patientId, doctorId, date, time, item.visitType ?? "New", item.reason ?? null, item.tokenNumber ?? null, existing, connection.tenant_id])).rows[0]
        : (await client.query(`INSERT INTO clinical_appointments(tenant_id,branch_id,department_id,patient_id,doctor_id,appointment_number,appointment_date,appointment_time,appointment_type,visit_type,reason,source,token_number,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'OPD',$9,$10,'Call Centre CRM',$11,$12) ON CONFLICT(tenant_id,appointment_number) DO UPDATE SET branch_id=excluded.branch_id,department_id=excluded.department_id,patient_id=excluded.patient_id,doctor_id=excluded.doctor_id,appointment_date=excluded.appointment_date,appointment_time=excluded.appointment_time,visit_type=excluded.visit_type,reason=excluded.reason,token_number=excluded.token_number,updated_at=now() RETURNING id`, [connection.tenant_id, branchId, departmentId, patientId, doctorId, item.appointmentNumber, date, time, item.visitType ?? "New", item.reason ?? null, item.tokenNumber ?? null, item.status ?? "Booked"])).rows[0];
      await saveMap("appointment", item.externalId, appointment.id, item.updatedAt); summary.appointments++;
    }
    await client.query(`UPDATE call_centre_crm_connections SET last_sync_at=now(),last_sync_status='Success',last_sync_summary=$1,updated_at=now() WHERE id=$2`, [summary, connection.id]);
    await client.query("COMMIT"); response.json({ success: true, tenantId: connection.tenant_id, summary });
  } catch (error) {
    await client.query("ROLLBACK");
    await pool.query(`UPDATE call_centre_crm_connections SET last_sync_at=now(),last_sync_status=$1,updated_at=now() WHERE id=$2`, [error instanceof Error ? `Failed: ${error.message}` : "Failed", connection.id]);
    response.status(400).json({ error: error instanceof Error ? error.message : "CRM sync failed" });
  } finally { client.release(); }
});

export default router;
