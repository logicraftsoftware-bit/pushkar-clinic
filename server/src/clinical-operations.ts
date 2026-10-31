import {withPrintDoctorDetails} from './doctor-print-profile.js';
import {doctorAppointmentCharges} from './doctor-service-fees.js';
import {reconcileOpdPayments} from "./opd-accounting.js";
import {clinicalDoctorLookupSql,appointmentDoctorSelectionSql} from './clinical-doctors.js';
import {doctorDay,doctorSlots,availableDoctorSlots,fiveMinuteDoctorSlots,upcomingDoctorSlots} from './doctor-availability.js';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import jwt from "jsonwebtoken";
import type { PoolClient } from "pg";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import {listPagination,listSearchPatterns,appointmentListSearchSql,patientListSearchSql} from './list-pagination.js';
import { hasPermission } from "./access-control.js";
import { accessibleBranchIds, assertBranchAccess } from "./branch-access.js";
import {clinicalPatientLookupSql,clinicalPatientEligibilitySql} from './clinical-patient-lookup.js';
import { configuredPrefix, operationalSettings } from "./settings-runtime.js";
import { checkInAppointment, checkInBody, CheckInError } from "./appointment-check-in.js";
type A = { sub: string; tenantId: string; branchId: string; role: string; portal?: string };
type R = Request & { portalUser?: A };
const router = Router();
let ready: Promise<unknown> | null = null;
const isActiveIpdStatus = (status: string) =>
  !["discharged", "cancelled"].includes(status.trim().toLowerCase());

async function assertNoOtherActiveAdmission(
  client: PoolClient,
  tenantId: string,
  patientId: string,
  excludeAdmissionId?: string,
) {
  // Serialize admission changes for a patient so two simultaneous requests
  // cannot both pass the duplicate check.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `ipd-patient:${tenantId}:${patientId}`,
  ]);
  const active = await client.query(
    `SELECT ipd_number FROM ipd_admissions
     WHERE tenant_id=$1 AND patient_id=$2
       AND lower(trim(status)) NOT IN ('discharged','cancelled')
       AND ($3::uuid IS NULL OR id<>$3)
     LIMIT 1`,
    [tenantId, patientId, excludeAdmissionId || null],
  );
  if (active.rows[0])
    throw new Error(
      `This UHID already has an active IPD admission (${active.rows[0].ipd_number}). Discharge or cancel it before creating another admission.`,
    );
}
async function assertIpdDoctorAssignment(
  client: PoolClient,
  tenantId: string,
  branchId: string,
  departmentId: string | null | undefined,
  doctorId: string | null | undefined,
) {
  if (!doctorId) return;
  if (!departmentId) throw new Error("Select a department before selecting the consultant doctor");
  const doctor = await client.query(
    `SELECT coalesce(nullif(s.professional->'branch_fees'->($3::uuid)::text->>'department_id','')::uuid,s.department_id,u.department_id) department_id,
       (u.branch_id=$3 OR EXISTS(SELECT 1 FROM user_branch_access uba WHERE uba.tenant_id=$1 AND uba.user_id=u.id AND uba.branch_id=$3)) branch_allowed
     FROM users u JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id
     WHERE u.id=$2 AND u.tenant_id=$1 AND u.role='doctor' AND u.is_active=true AND s.status='Active'`,
    [tenantId, doctorId, branchId],
  );
  if (!doctor.rows[0]) throw new Error("Selected consultant doctor is not active");
  if (doctor.rows[0].department_id !== departmentId)
    throw new Error("Selected consultant doctor does not belong to the selected department");
  if (!doctor.rows[0].branch_allowed)
    throw new Error("Selected consultant doctor is not assigned to the patient's branch");
}
async function recalculateIpdBilling(client: PoolClient, tenantId: string, admissionId: string) {
  const result = await client.query(
    `WITH bed_bill AS (
       SELECT coalesce(sum(daily_rate * greatest(1,ceil(extract(epoch FROM (coalesce(ended_at,now())-started_at))/86400))),0) amount
       FROM ipd_bed_stays WHERE tenant_id=$1 AND admission_id=$2
     )
     UPDATE ipd_admissions a SET
       bed_daily_charge=bed_bill.amount,
       total_amount=greatest(0,bed_bill.amount+coalesce((SELECT sum(coalesce((x->>'amount')::numeric,0)) FROM jsonb_array_elements(a.charges) x),0)-a.discount),
       admission_payment_status=CASE WHEN greatest(0,bed_bill.amount+coalesce((SELECT sum(coalesce((x->>'amount')::numeric,0)) FROM jsonb_array_elements(a.charges) x),0)-a.discount)>0
         AND a.paid_amount+a.deposit_amount>=greatest(0,bed_bill.amount+coalesce((SELECT sum(coalesce((x->>'amount')::numeric,0)) FROM jsonb_array_elements(a.charges) x),0)-a.discount) THEN 'Paid' ELSE 'Unpaid' END,
       updated_at=now()
     FROM bed_bill WHERE a.id=$2 AND a.tenant_id=$1 RETURNING a.*`,
    [tenantId, admissionId],
  );
  return result.rows[0];
}
function auth(req: R, res: Response, next: NextFunction) {
  try {
    req.portalUser = jwt.verify(
      req.header("authorization")?.replace(/^Bearer /i, "") ?? "",
      config.JWT_SECRET,
      { issuer: "careframe-api", audience: "careframe-portal" },
    ) as A;
    next();
  } catch {
    res.status(401).json({ error: "Session expired or invalid" });
  }
}
function ensure() {
  ready ??= pool.query(`
CREATE TABLE IF NOT EXISTS clinical_appointments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id)ON DELETE CASCADE,branch_id uuid NOT NULL REFERENCES branches(id),department_id uuid REFERENCES departments(id),patient_id uuid NOT NULL REFERENCES patients(id),doctor_id uuid REFERENCES users(id),appointment_number text NOT NULL,appointment_date date NOT NULL,appointment_time time NOT NULL,appointment_type text NOT NULL DEFAULT 'OPD',visit_type text NOT NULL DEFAULT 'New',reason text,consultation_fee numeric(12,2)NOT NULL DEFAULT 0,payment_status text NOT NULL DEFAULT 'Pending',source text NOT NULL DEFAULT 'Reception',token_number text,status text NOT NULL DEFAULT 'Booked',notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,appointment_number));
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS symptoms text[] NOT NULL DEFAULT '{}';
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS charges jsonb NOT NULL DEFAULT '[]';
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT '';
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS payment_reference text NOT NULL DEFAULT '';
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS slot_serial integer;
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS cancellation_reason text NOT NULL DEFAULT '';
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE clinical_appointments ADD COLUMN IF NOT EXISTS refund_amount numeric(12,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS ipd_admissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id)ON DELETE CASCADE,branch_id uuid NOT NULL REFERENCES branches(id),patient_id uuid NOT NULL REFERENCES patients(id),department_id uuid REFERENCES departments(id),consultant_doctor_id uuid REFERENCES users(id),ward_id uuid REFERENCES wards(id),room_id uuid REFERENCES rooms(id),bed_id uuid REFERENCES beds(id),ipd_number text NOT NULL,admitted_at timestamptz NOT NULL,admission_type text NOT NULL DEFAULT 'Planned',reason_diagnosis text,attendant jsonb NOT NULL DEFAULT '{}',insurance_tpa text,advance numeric(12,2)NOT NULL DEFAULT 0,expected_discharge date,status text NOT NULL DEFAULT 'Admitted',discharged_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,ipd_number));
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
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS charges jsonb NOT NULL DEFAULT '[]';
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS consultation_fee numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS bed_daily_charge numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS patient_documents jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS has_insurance boolean NOT NULL DEFAULT false;
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS insurance_company text NOT NULL DEFAULT '';
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS policy_number text NOT NULL DEFAULT '';
ALTER TABLE ipd_admissions ADD COLUMN IF NOT EXISTS insurance_document text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS ipd_transfer_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id)ON DELETE CASCADE,admission_id uuid NOT NULL REFERENCES ipd_admissions(id)ON DELETE CASCADE,transfer_type text NOT NULL,from_details jsonb NOT NULL DEFAULT '{}',to_details jsonb NOT NULL DEFAULT '{}',notes text,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ipd_bed_stays(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,admission_id uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,bed_id uuid NOT NULL REFERENCES beds(id),ward_id uuid REFERENCES wards(id),room_id uuid REFERENCES rooms(id),bed_number text NOT NULL,daily_rate numeric(14,2) NOT NULL DEFAULT 0,started_at timestamptz NOT NULL,ended_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_ipd_bed_stays_admission ON ipd_bed_stays(tenant_id,admission_id,started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ipd_bed_stays_open ON ipd_bed_stays(admission_id) WHERE ended_at IS NULL;
INSERT INTO ipd_bed_stays(tenant_id,admission_id,bed_id,ward_id,room_id,bed_number,daily_rate,started_at,ended_at)
SELECT a.tenant_id,a.id,a.bed_id,a.ward_id,a.room_id,b.bed_number,coalesce(nullif(a.bed_daily_charge,0),b.daily_charge),a.admitted_at,
 CASE WHEN lower(a.status) IN ('discharged','cancelled') THEN coalesce(a.discharged_at,a.updated_at) END
FROM ipd_admissions a JOIN beds b ON b.id=a.bed_id WHERE NOT EXISTS(SELECT 1 FROM ipd_bed_stays s WHERE s.admission_id=a.id);`);
  return ready;
}
router.use(auth);
router.use(async (req: R, res, next) => {
  try {
    await ensure();
    if (
      ["/lookups","/patient-search"].includes(req.path) &&
      ((await hasPermission(
        req.portalUser!.sub,
        req.portalUser!.tenantId,
        "appointment.view",
      )) ||
        (await hasPermission(
          req.portalUser!.sub,
          req.portalUser!.tenantId,
          "ipd.view",
        )) ||
        (await hasPermission(
          req.portalUser!.sub,
          req.portalUser!.tenantId,
          "hospital.manage",
        )))
    )
      return next();
    const mod = req.path.startsWith("/appointments") ? "appointment" : "ipd",
      action =
        req.method === "GET"
          ? "view"
          : req.method === "DELETE"
            ? "cancel"
            : req.method === "POST"
              ? "create"
              : "update";
    let code = `${mod}.${action}`;
    if (mod === "appointment" && action === "cancel")
      code = "appointment.cancel";
    if (
      !(await hasPermission(
        req.portalUser!.sub,
        req.portalUser!.tenantId,
        code,
      ))
    ) {
      if (
        mod === "ipd" &&
        (await hasPermission(
          req.portalUser!.sub,
          req.portalUser!.tenantId,
          "hospital.manage",
        ))
      )
        return next();
      res.status(403).json({ error: `Permission required: ${code}` });
      return;
    }
    next();
  } catch (e) {
    ready = null;
    next(e);
  }
});
router.get("/lookups", async (req: R, res) => {
  const t = req.portalUser!.tenantId;
  const patientMode=z.enum(['all','none','recent']).prefault('all').parse(req.query.patients);
  const branchIds = await accessibleBranchIds(req.portalUser!);
  const [p, b, d, u, w, rm, be] = await Promise.all([
    patientMode==='none'?Promise.resolve({rows:[]}):pool.query(
      patientMode==='recent'?clinicalPatientLookupSql.replace('ORDER BY first_name,last_name,id','ORDER BY created_at DESC,id DESC LIMIT 25'):clinicalPatientLookupSql,
      [t],
    ),
    pool.query(
      `SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,
      [t, branchIds],
    ),
    pool.query(
      `SELECT id,name,branch_id FROM departments WHERE tenant_id=$1 AND is_active=true AND ($2::uuid[] IS NULL OR branch_id=ANY($2)) ORDER BY name`,
      [t, branchIds],
    ),
    pool.query(
      clinicalDoctorLookupSql,
      [t, branchIds],
    ),
    pool.query(
      `SELECT id,name,branch_id,department_id FROM wards WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2)) ORDER BY name`,
      [t, branchIds],
    ),
    pool.query(
      `SELECT id,room_number name,branch_id,ward_id FROM rooms WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2)) ORDER BY room_number`,
      [t, branchIds],
    ),
    pool.query(
      `SELECT b.id,b.bed_number name,b.branch_id,b.ward_id,b.room_id,b.status,b.daily_charge,
        bt.name bed_type,bg.name bed_group,f.name floor
       FROM beds b
       LEFT JOIN bed_masters bt ON bt.id=b.bed_type_id
       LEFT JOIN bed_masters bg ON bg.id=b.bed_group_id
       LEFT JOIN bed_masters f ON f.id=bg.floor_id
       WHERE b.tenant_id=$1 AND ($2::uuid[] IS NULL OR b.branch_id=ANY($2)) ORDER BY b.bed_number`,
      [t, branchIds],
    ),
  ]);
  const runtime=await operationalSettings(t);
  res.json({
    current_branch_id:b.rows.some(branch=>branch.id===req.portalUser!.branchId)?req.portalUser!.branchId:null,
    patients: p.rows,
    branches: b.rows,
    departments: d.rows,
    doctors: u.rows,
    wards: w.rows,
    rooms: rm.rows,
  beds: be.rows,
    symptom_types:(await pool.query(`SELECT id,name FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='symptoms' AND kind='type' ORDER BY name`,[t])).rows,
    charges:(await pool.query(`SELECT id,name,data,percentage FROM hospital_charge_masters WHERE tenant_id=$1 AND kind='charge' ORDER BY name`,[t])).rows,
    payment_methods: runtime.payment_methods,
    general_settings: runtime.general,
  });
});
router.get('/patient-search',async(req:R,res)=>{
  const search=z.string().trim().max(150).prefault('').parse(req.query.search);
  const patientId=z.string().uuid().optional().parse(req.query.patient_id);
  if(!patientId&&!search)return void res.json([]);
  const sql=clinicalPatientLookupSql.replace('FROM patients WHERE','FROM patients p WHERE').replace('ORDER BY first_name,last_name,id',
    `AND ($2::uuid IS NULL OR p.id=$2) AND ${patientListSearchSql} ORDER BY created_at DESC,id DESC LIMIT 25`);
  const result=await pool.query(sql,[req.portalUser!.tenantId,patientId??null,listSearchPatterns(search)]);
  res.set('Cache-Control','no-store');res.json(result.rows);
});
router.get('/appointment-slots',async(req:R,res)=>{
  const branchId=z.string().uuid().parse(req.query.branch_id),departmentId=z.string().uuid().parse(req.query.department_id);
  const doctorId=z.string().uuid().parse(req.query.doctor_id),date=z.string().parse(req.query.date),appointmentId=z.string().uuid().optional().parse(req.query.appointment_id),tenantId=req.portalUser!.tenantId;
  await assertBranchAccess(req.portalUser!,branchId);
  if(!(await pool.query(appointmentDoctorSelectionSql,[tenantId,[branchId],doctorId,departmentId])).rows.length)return void res.status(400).json({error:'Select a doctor assigned to the selected branch and department.'});
  const timing=await pool.query(`SELECT $1::date < (now() AT TIME ZONE 'Asia/Kolkata')::date past`,[date]);
  if(timing.rows[0]?.past){res.status(400).json({error:"Past appointment dates are not available."});return}
  const doctor=await pool.query(`SELECT coalesce(s.professional->'appointment_schedule','[]'::jsonb) schedule,s.professional->'appointment_default_schedule' recurring,coalesce(s.professional->'appointment_unavailable_dates','[]'::jsonb) unavailable,coalesce(nullif(trim(s.professional->>'slot_duration'),'')::int,20) duration,coalesce(nullif(trim(s.professional->>'maximum_appointments'),'')::int,0) maximum FROM users u LEFT JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id WHERE u.id=$1 AND u.tenant_id=$2`,[doctorId,tenantId]);
  const found=doctor.rows[0],day=doctorDay(found?.schedule??[],found?.recurring,date,found?.unavailable??[]);
  if(!day){res.json([]);return;}
  const booked=await pool.query(`SELECT appointment_time,slot_serial FROM clinical_appointments WHERE tenant_id=$1 AND doctor_id=$2 AND appointment_date=$3 AND id IS DISTINCT FROM $4 AND lower(status) NOT IN('cancelled','no show')`,[tenantId,doctorId,date,appointmentId||null]);
  const interval=z.coerce.number().refine(value=>value===5).optional().parse(req.query.slot_interval);
  if(interval===5){const limit=Number(day.max_slots||found?.maximum||0);return void res.json(upcomingDoctorSlots(limit&&booked.rows.length>=limit?[]:fiveMinuteDoctorSlots(day).filter(slot=>!booked.rows.some(row=>String(row.appointment_time).slice(0,5)===slot.time)).map(slot=>({...slot,serial:Math.max(0,...booked.rows.map(row=>Number(row.slot_serial||0)))+1})),date));}
  const slots=doctorSlots(day,found?.duration??20,found?.maximum??0);
  res.json(upcomingDoctorSlots(day.slot_mode==='capacity'?availableDoctorSlots(slots,booked.rows):slots.filter(slot=>!booked.rows.some(row=>String(row.appointment_time).slice(0,5)===slot.time)),date));

})
router.get('/print-template/:document',async(req:R,res)=>{
  const document=z.enum(['appointment','opd-bill','opd-prescription']).parse(req.params.document);
  const result=await pool.query(`SELECT header_image,footer_content FROM hospital_print_templates WHERE tenant_id=$1 AND document_type=$2`,[req.portalUser!.tenantId,document]);
  res.json(result.rows[0]??{header_image:'',footer_content:''});
})
const optionalId = z
  .union([z.string().uuid(), z.literal("")])
  .optional()
  .transform((v) => v || null);
const ap = z.object({
  branch_id: z.string().uuid(),
  department_id: optionalId,
  patient_id: z.string().uuid(),
  doctor_id: optionalId,
  appointment_date: z.string(),
  appointment_time: z.string(),
  slot_interval:z.coerce.number().refine(value=>value===5).optional(),
  appointment_type: z.string(),
  visit_type: z.string(),
  reason: z.string().prefault(""),
  consultation_fee: z.coerce.number().prefault(0),
  payment_status: z.string(),
  source: z.string(),
  token_number: z.string().prefault(""),
  status: z.string(),
  notes: z.string().prefault(""),
  symptoms:z.array(z.string()).optional().prefault([]),
  charges:z.array(z.unknown()).optional().prefault([]),
  doctor_fee_selection:z.preprocess(value=>{if(typeof value==='string'){try{return JSON.parse(value);}catch{return value;}}return value;},z.object({registration_fee:z.boolean(),maintenance_fee:z.boolean()}).optional()),
  discount:z.coerce.number().min(0).prefault(0),
  payment_mode:z.string().prefault(""),
  paid_amount:z.coerce.number().min(0).prefault(0),
});
router.get("/appointments", async (req: R, res) => {
  const branchIds = await accessibleBranchIds(req.portalUser!);
  if(req.query.page!==undefined){
    const {page,pageSize,search}=listPagination(req.query);
    const doctors=z.preprocess(value=>typeof value==='string'?value.split(',').filter(Boolean):value,z.array(z.string().uuid()).max(100).prefault([])).parse(req.query.doctor_ids);
    const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).prefault('').parse(req.query.date);
    const queue=z.enum(['0','1']).prefault('0').parse(req.query.queue)==='1';
    const where=`a.tenant_id=$1 AND ($2::uuid[] IS NULL OR a.branch_id=ANY($2)) AND ${search?appointmentListSearchSql:'$3::text[] IS NOT NULL'}
      AND (cardinality($4::uuid[])=0 OR a.doctor_id=ANY($4)) AND ($5::date IS NULL OR a.appointment_date=$5) AND (NOT $6::boolean OR a.status<>'Cancelled')`;
    const args=[req.portalUser!.tenantId,branchIds,listSearchPatterns(search),doctors,date||null,queue];
    const joins=search?`JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id LEFT JOIN users u ON u.id=a.doctor_id AND u.tenant_id=a.tenant_id LEFT JOIN departments d ON d.id=a.department_id AND d.tenant_id=a.tenant_id`:'';
    const order=queue?`CASE WHEN a.status IN ('Completed','No Show') THEN 1 ELSE 0 END,coalesce(a.slot_serial,nullif(substring(a.token_number FROM '([0-9]+)$'),'')::numeric,0),a.appointment_date DESC,a.appointment_time,a.id`:'a.appointment_date DESC,a.appointment_time DESC,a.id DESC';
    const [counts,rows,dates]=await Promise.all([
      pool.query(`SELECT a.status,count(*)::int count FROM clinical_appointments a ${joins} WHERE ${where} GROUP BY a.status`,args),
      pool.query(`SELECT a.*,concat(p.first_name,' ',p.last_name)patient_name,p.medical_record_number,p.address patient_address,p.date_of_birth patient_date_of_birth,p.sex gender,p.phone patient_phone,p.allergies,p.existing_conditions finding,p.registration_fee registration_fee_amount,p.maintenance_fee registration_addon_amount,p.discount registration_discount_amount,p.total_amount registration_amount,p.registration_addons registration_charges,concat(u.first_name,' ',u.last_name)doctor_name,d.name department_name,b.name branch_name FROM clinical_appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN users u ON u.id=a.doctor_id LEFT JOIN departments d ON d.id=a.department_id JOIN branches b ON b.id=a.branch_id WHERE ${where} ORDER BY ${order} LIMIT $7 OFFSET $8`,[...args,pageSize,(page-1)*pageSize]),
      queue?pool.query(`SELECT DISTINCT a.appointment_date::text date FROM clinical_appointments a ${joins} WHERE ${where.replace('($5::date IS NULL OR a.appointment_date=$5)','($5::date IS NULL OR $5::date IS NOT NULL)')} ORDER BY date`,args):Promise.resolve({rows:[]}),
    ]);
    const summary=Object.fromEntries(counts.rows.map(row=>[row.status,Number(row.count)]));
    res.set('Cache-Control','no-store');
    return void res.json({rows:await withPrintDoctorDetails(rows.rows,req.portalUser!.tenantId),total:counts.rows.reduce((total,row)=>total+Number(row.count),0),summary,dates:dates.rows.map(row=>row.date),page,page_size:pageSize});
  }
  const r = await pool.query(
    `SELECT a.*,concat(p.first_name,' ',p.last_name)patient_name,p.medical_record_number,p.address patient_address,p.date_of_birth patient_date_of_birth,p.sex gender,p.phone patient_phone,p.allergies,p.existing_conditions finding,p.registration_fee registration_fee_amount,p.maintenance_fee registration_addon_amount,p.discount registration_discount_amount,p.total_amount registration_amount,p.registration_addons registration_charges,concat(u.first_name,' ',u.last_name)doctor_name,d.name department_name,b.name branch_name FROM clinical_appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN users u ON u.id=a.doctor_id LEFT JOIN departments d ON d.id=a.department_id JOIN branches b ON b.id=a.branch_id WHERE a.tenant_id=$1 AND ($2::uuid[] IS NULL OR a.branch_id=ANY($2)) ORDER BY a.appointment_date DESC,a.appointment_time DESC`,
    [req.portalUser!.tenantId, branchIds],
  );
  res.json(await withPrintDoctorDetails(r.rows,req.portalUser!.tenantId));
});
router.post("/appointments", async (req: R, res) => {
  const b = ap.parse(req.body),t = req.portalUser!.tenantId;
  await assertBranchAccess(req.portalUser!, b.branch_id);
  if(!b.department_id||!b.doctor_id)return void res.status(400).json({error:'Select a branch, its department, and a doctor assigned to that department.'});
  const selectedDoctor=(await pool.query(appointmentDoctorSelectionSql,[t,[b.branch_id],b.doctor_id,b.department_id])).rows[0];
  if(!selectedDoctor)return void res.status(400).json({error:'Select a branch, its department, and a doctor assigned to that department.'});
  if(b.doctor_fee_selection)b.charges=doctorAppointmentCharges(b.charges as Record<string,any>[],selectedDoctor,b.doctor_fee_selection);
  if(!(await pool.query(clinicalPatientEligibilitySql,[b.patient_id,t])).rows[0])return void res.status(400).json({error:'Selected patient is unavailable in this hospital.'});
  if(!b.doctor_id){res.status(400).json({error:"Select an available doctor."});return}
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[`appointment-slot:${t}:${b.doctor_id}:${b.appointment_date}:${b.appointment_time.slice(0,5)}`]);
    const timing=await client.query(`SELECT ($1::date + $2::time) <= (now() AT TIME ZONE 'Asia/Kolkata') past`,[b.appointment_date,b.appointment_time]);
    if(timing.rows[0]?.past){await client.query("ROLLBACK");res.status(400).json({error:"Appointments cannot be booked for a past date or time."});return}
    const tokenInfo=await client.query(`SELECT concat(u.first_name,' ',u.last_name) doctor_name,d.name department_name,coalesce(s.professional->'appointment_schedule','[]'::jsonb) schedule,s.professional->'appointment_default_schedule' recurring,coalesce(s.professional->'appointment_unavailable_dates','[]'::jsonb) unavailable,coalesce(nullif(trim(s.professional->>'slot_duration'),'')::int,20) duration,coalesce(nullif(trim(s.professional->>'maximum_appointments'),'')::int,0) maximum FROM users u JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id AND s.status='Active' LEFT JOIN departments d ON d.id=$2 WHERE u.id=$1 AND u.tenant_id=$3 AND u.role='doctor' AND u.is_active=true AND (u.branch_id=$4 OR EXISTS(SELECT 1 FROM user_branch_access uba WHERE uba.tenant_id=$3 AND uba.user_id=u.id AND uba.branch_id=$4))`,[b.doctor_id,b.department_id||null,t,b.branch_id]);
    if(!tokenInfo.rows[0]){await client.query("ROLLBACK");res.status(400).json({error:"The selected doctor is unavailable for this branch."});return}
    const info=tokenInfo.rows[0],day=doctorDay(info.schedule??[],info.recurring,b.appointment_date,info.unavailable??[]);
    if(!day){await client.query('ROLLBACK');res.status(400).json({error:'The selected doctor is not scheduled on this date.'});return;}
    const selected=(b.slot_interval===5?fiveMinuteDoctorSlots(day):doctorSlots(day,info.duration,info.maximum)).find(slot=>slot.time===b.appointment_time.slice(0,5));
    if(!selected){await client.query('ROLLBACK');res.status(400).json({error:"The selected time is not an available slot in the doctor's schedule."});return;}
    let selectedSerial=selected.serial;
    if(b.slot_interval===5){
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`appointment-day:${t}:${b.doctor_id}:${b.appointment_date}`]);
      const booked=await client.query(`SELECT appointment_time,slot_serial FROM clinical_appointments WHERE tenant_id=$1 AND doctor_id=$2 AND appointment_date=$3 AND lower(status) NOT IN('cancelled','no show')`,[t,b.doctor_id,b.appointment_date]);
      if(Number(day.max_slots||info.maximum||0)&&booked.rows.length>=Number(day.max_slots||info.maximum)){await client.query('ROLLBACK');return void res.status(409).json({error:'The daily appointment limit has been reached.'});}
      selectedSerial=Math.max(0,...booked.rows.map(row=>Number(row.slot_serial||0)))+1;
    }
    if(b.slot_interval!==5&&day.slot_mode!=='capacity'){
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`appointment-day:${t}:${b.doctor_id}:${b.appointment_date}`]);
      const booked=await client.query(`SELECT appointment_time,slot_serial FROM clinical_appointments WHERE tenant_id=$1 AND doctor_id=$2 AND appointment_date=$3 AND lower(status) NOT IN('cancelled','no show')`,[t,b.doctor_id,b.appointment_date]);
      if(booked.rows.some(row=>Number(row.slot_serial)===selectedSerial))selectedSerial=Math.max(0,...booked.rows.map(row=>Number(row.slot_serial||0)))+1;
    }
    if(b.slot_interval!==5&&day.slot_mode==='capacity'){
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`appointment-day:${t}:${b.doctor_id}:${b.appointment_date}`]);
      const booked=await client.query(`SELECT appointment_time,slot_serial FROM clinical_appointments WHERE tenant_id=$1 AND doctor_id=$2 AND appointment_date=$3 AND lower(status) NOT IN('cancelled','no show')`,[t,b.doctor_id,b.appointment_date]);
      if(!availableDoctorSlots(doctorSlots(day,info.duration,info.maximum),booked.rows).some(slot=>slot.time===selected.time)){await client.query('ROLLBACK');res.status(409).json({error:'This appointment slot is already reserved or the daily limit has been reached. Select another available slot.'});return;}
    }
    const occupied=await client.query(`SELECT appointment_number FROM clinical_appointments WHERE tenant_id=$1 AND doctor_id=$2 AND appointment_date=$3 AND appointment_time=$4 AND lower(status) NOT IN('cancelled','no show') LIMIT 1`,[t,b.doctor_id,b.appointment_date,b.appointment_time]);
    if(occupied.rows[0]){await client.query("ROLLBACK");res.status(409).json({error:"This appointment slot was just booked by another user. Please select another available slot."});return}
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[`appointment-number:${t}`]);
    const prefix=await configuredPrefix(t,"appointment_prefix","APT"),existing=await client.query(`SELECT appointment_number FROM clinical_appointments WHERE tenant_id=$1`,[t]),next=Math.max(0,...existing.rows.map(row=>Number(String(row.appointment_number).match(/(\d+)$/)?.[1]||0)))+1,n=`${prefix}-${String(next).padStart(6,"0")}`;
    const initials=String(tokenInfo.rows[0].doctor_name||'DR').split(/\s+/).filter(Boolean).map((part:string)=>part[0]).join('').toUpperCase()||'DR',department=String(tokenInfo.rows[0].department_name||'GEN').replace(/[^a-z0-9]/gi,'').slice(0,5).toUpperCase()||'GEN',datePart=String(b.appointment_date).split('-').reverse().join(''),token=`${datePart}/${initials}/${department}/${String(selectedSerial).padStart(3,'0')}`;
    const r = await client.query(
    `INSERT INTO clinical_appointments(tenant_id,branch_id,department_id,patient_id,doctor_id,appointment_number,appointment_date,appointment_time,appointment_type,visit_type,reason,consultation_fee,payment_status,source,token_number,status,notes,symptoms,charges,discount,payment_mode,paid_amount,slot_serial)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)RETURNING *`,
    [
      t,
      b.branch_id,
      b.department_id || null,
      b.patient_id,
      b.doctor_id || null,
      n,
      b.appointment_date,
      b.appointment_time,
      b.appointment_type,
      b.visit_type,
      b.reason,
      b.consultation_fee,
      b.payment_status,
      b.source,
      token,
      "Booked",
      b.notes,
      b.symptoms,
      JSON.stringify(b.charges),
      b.discount,
      b.payment_mode,
      b.paid_amount,
      selectedSerial,
    ],
  );
    await reconcileOpdPayments(client,t,[b.branch_id],r.rows[0].id,req.portalUser!.sub);
    await client.query("COMMIT");
    res.status(201).json(r.rows[0]);
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
});
router.put("/appointments/:id", async (req: R, res) => {
  const b = ap.parse(req.body);
  await assertBranchAccess(req.portalUser!, b.branch_id);
  const branchIds = await accessibleBranchIds(req.portalUser!);
  const tenantId=req.portalUser!.tenantId;
  if(!b.department_id||!b.doctor_id||!(await pool.query(appointmentDoctorSelectionSql,[tenantId,[b.branch_id],b.doctor_id,b.department_id])).rows.length)return void res.status(400).json({error:'Select a branch, its department, and a doctor assigned to that department.'});
  if(!(await pool.query(clinicalPatientEligibilitySql,[b.patient_id,tenantId])).rows[0])return void res.status(400).json({error:'Selected patient is unavailable in this hospital.'});
  const current=await pool.query(`SELECT status,doctor_id,appointment_date::text,appointment_time,slot_serial,token_number FROM clinical_appointments WHERE id=$1 AND tenant_id=$2 AND ($3::uuid[] IS NULL OR branch_id=ANY($3))`,[req.params.id,tenantId,branchIds]);
  if(!current.rows[0]){res.status(404).json({error:"Appointment not found"});return}
  if(String(current.rows[0].status)!==b.status){res.status(409).json({error:"Use the appointment status action to change status."});return}
  if(b.status==='Cancelled'){res.status(409).json({error:'Cancelled appointments are read-only. Use Refunds to process any approved balance.'});return}
  const tokenInfo=await pool.query(`SELECT concat(u.first_name,' ',u.last_name) doctor_name,d.name department_name,coalesce(s.professional->'appointment_schedule','[]'::jsonb) schedule,s.professional->'appointment_default_schedule' recurring,coalesce(s.professional->'appointment_unavailable_dates','[]'::jsonb) unavailable,coalesce(nullif(trim(s.professional->>'slot_duration'),'')::int,20) duration FROM users u LEFT JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id LEFT JOIN departments d ON d.id=$2 WHERE u.id=$1 AND u.tenant_id=$3`,[b.doctor_id||null,b.department_id||null,tenantId]);
  const initials=String(tokenInfo.rows[0]?.doctor_name||'DR').split(/\s+/).filter(Boolean).map((part:string)=>part[0]).join('').toUpperCase()||'DR', department=String(tokenInfo.rows[0]?.department_name||'GEN').replace(/[^a-z0-9]/gi,'').slice(0,5).toUpperCase()||'GEN', datePart=String(b.appointment_date).split('-').reverse().join('');
  const info=tokenInfo.rows[0],day=doctorDay(info?.schedule??[],info?.recurring,b.appointment_date,info?.unavailable??[]),selected=day?(b.slot_interval===5?fiveMinuteDoctorSlots(day):doctorSlots(day,info?.duration)).find(slot=>slot.time===b.appointment_time.slice(0,5)):undefined;
  const unchanged=String(current.rows[0].doctor_id)===String(b.doctor_id)&&String(current.rows[0].appointment_date).slice(0,10)===String(b.appointment_date)&&String(current.rows[0].appointment_time).slice(0,5)===b.appointment_time.slice(0,5);
  if(!unchanged){
    const timing=await pool.query(`SELECT ($1::date + $2::time) <= (now() AT TIME ZONE 'Asia/Kolkata') past`,[b.appointment_date,b.appointment_time]);
    if(timing.rows[0]?.past){res.status(400).json({error:'Appointments cannot be moved to a past date or time.'});return;}
  }
  if((b.slot_interval===5||day?.slot_mode==='capacity')&&!selected&&!unchanged){res.status(400).json({error:"The selected time is not an available slot in the doctor's schedule."});return;}
  const minutes=(time:string)=>Number(time.split(':')[0])*60+Number(time.split(':')[1]);
  const legacySerial=day?Math.floor((minutes(b.appointment_time)-minutes(day.from_time))/Number(info?.duration||20))+1:1;
  const preserveQueueToken=b.slot_interval===5&&String(current.rows[0].doctor_id)===String(b.doctor_id)&&String(current.rows[0].appointment_date).slice(0,10)===String(b.appointment_date);
  const selectedSerial=(unchanged||preserveQueueToken)?Number(current.rows[0].slot_serial||selected?.serial||1):selected?.serial||(day?.slot_mode==='capacity'?1:legacySerial),tokenNumber=(unchanged||preserveQueueToken)&&current.rows[0].token_number?current.rows[0].token_number:`${datePart}/${initials}/${department}/${String(selectedSerial).padStart(3,'0')}`;

  const client=await pool.connect();
  try{
  await client.query('BEGIN');
  // Recover any older collection without assigning it to the person editing today.
  await reconcileOpdPayments(client,tenantId,branchIds,String(req.params.id));
  const r = await client.query(
      `UPDATE clinical_appointments SET branch_id=$1,department_id=$2,patient_id=$3,doctor_id=$4,appointment_date=$5,appointment_time=$6,appointment_type=$7,visit_type=$8,reason=$9,consultation_fee=$10,payment_status=$11,source=$12,token_number=$13,status=$14,notes=$15,symptoms=$16,charges=$17,discount=$18,payment_mode=$19,paid_amount=$20,slot_serial=$21,updated_at=now()WHERE id=$22 AND tenant_id=$23 AND status=$14 AND status<>'Cancelled' AND ($24::uuid[] IS NULL OR branch_id=ANY($24)) RETURNING *`,
      [
        b.branch_id,
        b.department_id || null,
        b.patient_id,
        b.doctor_id || null,
        b.appointment_date,
        b.appointment_time,
        b.appointment_type,
        b.visit_type,
        b.reason,
        b.consultation_fee,
        b.payment_status,
        b.source,
        tokenNumber,
        b.status,
        b.notes,
        b.symptoms,
        JSON.stringify(b.charges),
        b.discount,
        b.payment_mode,
        b.paid_amount,
        selectedSerial,
        req.params.id,
        tenantId,
        branchIds,
      ],
    );
  if(!r.rows[0]){await client.query('ROLLBACK');return void res.status(409).json({error:'Appointment status changed. Refresh before editing.'});}
  await reconcileOpdPayments(client,tenantId,[b.branch_id],r.rows[0].id,req.portalUser!.sub);
  await client.query("COMMIT");
  res.json(r.rows[0]);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
});
router.patch("/appointments/:id/check-in", async (req: R, res) => {
  const parsed = checkInBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid payment details." }); return; }
  const user = req.portalUser!;
  const branchIds = await accessibleBranchIds(user);
  const runtime = await operationalSettings(user.tenantId);
  const client = await pool.connect();
  try {
    const appointment = await checkInAppointment(client, user.tenantId, branchIds, String(req.params.id), user.sub, parsed.data, runtime.payment_methods);
    res.json({ appointment, message: parsed.data.payment ? "Payment details saved and patient checked in." : "Patient checked in." });
  } catch (error) {
    if (error instanceof CheckInError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  } finally { client.release(); }
});
const appointmentStatusBody=z.object({
  status:z.enum(["Booked","Confirmed","Checked In","Waiting","In Consultation","Completed","Cancelled","No Show"]),
  cancellation_reason:z.string().trim().max(500).optional().prefault(""),
});
const appointmentTransitions:Record<string,string[]>={
  "booked":["Confirmed","Checked In","Cancelled","No Show"],
  "confirmed":["Checked In","Cancelled","No Show"],
  "checked in":["Waiting","In Consultation","Cancelled","No Show"],
  "present":["Waiting","In Consultation","Cancelled","No Show"],
  "waiting":["In Consultation","Cancelled","No Show"],
  "in consultation":["Completed","Cancelled"],
  "completed":[],"cancelled":[],"no show":[],"absent":[],
};
router.patch("/appointments/:id/status",async(req:R,res)=>{
  if(req.body?.status==='Cancelled')return void res.status(409).json({error:'Submit a cancellation request against the OPD bill number. Accountant approval is required before cancellation or refund.'});
  const body=appointmentStatusBody.parse(req.body),tenantId=req.portalUser!.tenantId,branchIds=await accessibleBranchIds(req.portalUser!),client=await pool.connect();
  try{
    await client.query("BEGIN");
    const found=await client.query(`SELECT * FROM clinical_appointments WHERE id=$1 AND tenant_id=$2 AND ($3::uuid[] IS NULL OR branch_id=ANY($3)) FOR UPDATE`,[req.params.id,tenantId,branchIds]);
    const appointment=found.rows[0];
    if(!appointment){await client.query("ROLLBACK");res.status(404).json({error:"Appointment not found"});return}
    const current=String(appointment.status).trim().toLowerCase(),allowed=appointmentTransitions[current]??[];
    if(!allowed.includes(body.status)){await client.query("ROLLBACK");res.status(409).json({error:`Cannot move appointment from ${appointment.status} to ${body.status}. Follow the required check-in and consultation workflow.`});return}
    const updated=await client.query('UPDATE clinical_appointments SET status=$1,updated_at=now() WHERE id=$2 RETURNING *',[body.status,appointment.id]);
    await client.query('COMMIT');
    res.json({appointment:updated.rows[0],message:`Appointment status changed to ${body.status}.`});
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
});
router.delete("/appointments/:id", async (_req: R, res) => {
  res.status(409).json({error:'Use Cancellation Requests to cancel an appointment and retain its billing history.'});
});
const ipd = z.object({
  branch_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  admitted_at: z.string(),
  admission_type: z.string(),
  department_id: optionalId,
  consultant_doctor_id: optionalId,
  reason_diagnosis: z.string().prefault(""),
  ward_id: optionalId,
  room_id: optionalId,
  bed_id: optionalId,
  attendant_name: z.string().prefault(""),
  attendant_phone: z.string().trim().regex(/^\d{10}$/, "Attendant phone number must contain exactly 10 digits").or(z.literal("")).prefault(""),
  attendant_relationship: z.string().prefault(""),
  insurance_tpa: z.string().prefault(""),
  advance: z.coerce.number().prefault(0),
  deposit_amount: z.coerce.number().min(0).prefault(0),
  charges: z.array(z.unknown()).optional().prefault([]),
  paid_amount: z.coerce.number().min(0).prefault(0),
  consultation_fee: z.coerce.number().min(0).prefault(0),
  bed_daily_charge: z.coerce.number().min(0).prefault(0),
  patient_documents: z.record(z.string(),z.object({name:z.string().max(255),type:z.string().max(100),data:z.string().max(4000000)})).optional().prefault({}),
  payment_mode: z.string().prefault(""),
  payment_reference: z.string().prefault(""),
  discount: z.coerce.number().min(0).prefault(0),
  discount_remarks: z.string().prefault(""),
  admission_payment_status: z.enum(["Paid", "Unpaid"]).prefault("Unpaid"),
  payment_status_remarks: z.string().prefault(""),
  registration_amount: z.coerce.number().min(0).prefault(0),
  registration_fee_amount: z.coerce.number().min(0).prefault(0),
  registration_addon_amount: z.coerce.number().min(0).prefault(0),
  registration_deposit_amount: z.coerce.number().min(0).prefault(0),
  registration_discount_amount: z.coerce.number().min(0).prefault(0),
  total_amount: z.coerce.number().min(0).prefault(0),
  has_insurance: z
    .union([z.boolean(), z.enum(["Yes", "No"])])
    .transform((v) => v === true || v === "Yes"),
  insurance_company: z.string().prefault(""),
  policy_number: z.string().prefault(""),
  insurance_document: z.string().max(7000000).prefault(""),
  expected_discharge: z
    .union([z.string(), z.literal("")])
    .optional()
    .transform((v) => v || null),
  status: z.string().prefault("Admitted"),
});
router.get("/ipd", async (req: R, res) => {
  const branchIds = await accessibleBranchIds(req.portalUser!);
  const r = await pool.query(
    `SELECT a.*,concat(p.first_name,' ',p.last_name)patient_name,p.medical_record_number,p.registration_fee registration_fee_amount,p.maintenance_fee registration_addon_amount,p.deposit_amount registration_deposit_amount,p.discount registration_discount_amount,p.total_amount registration_amount,concat(u.first_name,' ',u.last_name)doctor_name,d.name department_name,b.name branch_name,w.name ward_name,rm.room_number,be.bed_number,bt.name bed_type,bg.name bed_group FROM ipd_admissions a JOIN patients p ON p.id=a.patient_id JOIN branches b ON b.id=a.branch_id LEFT JOIN users u ON u.id=a.consultant_doctor_id LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN wards w ON w.id=a.ward_id LEFT JOIN rooms rm ON rm.id=a.room_id LEFT JOIN beds be ON be.id=a.bed_id LEFT JOIN bed_masters bt ON bt.id=be.bed_type_id LEFT JOIN bed_masters bg ON bg.id=be.bed_group_id WHERE a.tenant_id=$1 AND ($2::uuid[] IS NULL OR a.branch_id=ANY($2)) ORDER BY a.admitted_at DESC`,
    [req.portalUser!.tenantId, branchIds],
  );
  res.json(await withPrintDoctorDetails(r.rows,req.portalUser!.tenantId));
});
router.get("/ipd/:id/details", async (req: R, res) => {
  const t=req.portalUser!.tenantId,id=String(req.params.id);
  const billingClient=await pool.connect();
  try { await recalculateIpdBilling(billingClient,t,id); } finally { billingClient.release(); }
  const admission=await pool.query(
    `SELECT a.*,concat(p.first_name,' ',p.last_name) patient_name,p.medical_record_number,
      concat(u.first_name,' ',u.last_name) doctor_name,d.name department_name,br.name branch_name,
      w.name ward_name,rm.room_number,be.bed_number,bt.name bed_type,bg.name bed_group
     FROM ipd_admissions a JOIN patients p ON p.id=a.patient_id JOIN branches br ON br.id=a.branch_id
     LEFT JOIN users u ON u.id=a.consultant_doctor_id LEFT JOIN departments d ON d.id=a.department_id
     LEFT JOIN wards w ON w.id=a.ward_id LEFT JOIN rooms rm ON rm.id=a.room_id LEFT JOIN beds be ON be.id=a.bed_id
     LEFT JOIN bed_masters bt ON bt.id=be.bed_type_id LEFT JOIN bed_masters bg ON bg.id=be.bed_group_id
     WHERE a.id=$1 AND a.tenant_id=$2`,[id,t]);
  if(!admission.rows[0]){res.status(404).json({error:"Admission not found"});return}
  await assertBranchAccess(req.portalUser!,admission.rows[0].branch_id);
  const [patient,transfers,invoices,bedStays]=await Promise.all([
    pool.query(`SELECT id,medical_record_number,first_name,last_name,date_of_birth,sex,blood_group,phone,email,address,emergency_contact,allergies,existing_conditions,current_medication,status,created_at FROM patients WHERE id=$1 AND tenant_id=$2`,[admission.rows[0].patient_id,t]),
    pool.query(`SELECT * FROM ipd_transfer_history WHERE admission_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`,[id,t]),
    pool.query(`SELECT f.*,coalesce((SELECT json_agg(p ORDER BY p.created_at DESC) FROM finance_records p WHERE p.tenant_id=f.tenant_id AND p.invoice_id=f.id),'[]'::json) payments FROM finance_records f WHERE f.tenant_id=$2 AND f.kind='invoices' AND f.data->>'admission_id'=$1 ORDER BY f.created_at DESC`,[id,t]),
    pool.query(`SELECT s.*,w.name ward_name,r.room_number,greatest(1,ceil(extract(epoch FROM (coalesce(s.ended_at,now())-s.started_at))/86400))::int days,s.daily_rate*greatest(1,ceil(extract(epoch FROM (coalesce(s.ended_at,now())-s.started_at))/86400)) amount FROM ipd_bed_stays s LEFT JOIN wards w ON w.id=s.ward_id LEFT JOIN rooms r ON r.id=s.room_id WHERE s.admission_id=$1 AND s.tenant_id=$2 ORDER BY s.started_at`,[id,t]),
  ]);
  res.json({admission:admission.rows[0],patient:patient.rows[0],transfers:transfers.rows,invoices:invoices.rows,bed_stays:bedStays.rows});
});
router.get("/discharge-requests",async(req:R,res)=>{
  const t=req.portalUser!.tenantId,branches=await accessibleBranchIds(req.portalUser!);
  const result=await pool.query(`SELECT w.id request_id,w.status request_status,w.created_at requested_at,w.data request_data,a.*,concat(p.first_name,' ',p.last_name) patient_name,p.medical_record_number,concat(u.first_name,' ',u.last_name) doctor_name,wa.name ward_name,ro.room_number,be.bed_number,
    greatest(0,a.total_amount-a.paid_amount-a.deposit_amount) admission_due,
    coalesce((SELECT n.status FROM role_work_items n WHERE n.tenant_id=w.tenant_id AND n.workspace='nurse' AND n.kind='discharge-clearance' AND n.data->>'admission_id'=a.id::text ORDER BY n.created_at DESC LIMIT 1),'Pending') nursing_clearance,
    coalesce((SELECT sum(f.due) FROM finance_records f WHERE f.tenant_id=a.tenant_id AND f.kind='invoices' AND f.data->>'admission_id'=a.id::text),0) invoice_due
    FROM role_work_items w JOIN ipd_admissions a ON a.id=(w.data->>'admission_id')::uuid JOIN patients p ON p.id=a.patient_id LEFT JOIN users u ON u.id=w.created_by LEFT JOIN wards wa ON wa.id=a.ward_id LEFT JOIN rooms ro ON ro.id=a.room_id LEFT JOIN beds be ON be.id=a.bed_id
    WHERE w.tenant_id=$1 AND w.workspace='reception' AND w.kind='ipd_discharge' AND ($2::uuid[] IS NULL OR w.branch_id=ANY($2)) ORDER BY CASE w.status WHEN 'Pending' THEN 0 ELSE 1 END,w.created_at DESC`,[t,branches]);
  res.json(result.rows);
});
router.post("/discharge-requests/:id/complete",async(req:R,res)=>{
  const t=req.portalUser!.tenantId,c=await pool.connect();
  try{await c.query("BEGIN");
    const request=await c.query(`SELECT w.*,a.branch_id,a.bed_id,a.id admission_id,a.total_amount,a.paid_amount,a.deposit_amount FROM role_work_items w JOIN ipd_admissions a ON a.id=(w.data->>'admission_id')::uuid WHERE w.id=$1 AND w.tenant_id=$2 AND w.workspace='reception' AND w.kind='ipd_discharge' FOR UPDATE OF w,a`,[req.params.id,t]);
    const row=request.rows[0];if(!row)throw new Error("Discharge request not found");if(row.status!=="Pending")throw new Error("This discharge request is already processed");await assertBranchAccess(req.portalUser!,row.branch_id);
    const nursing=await c.query(`SELECT status FROM role_work_items WHERE tenant_id=$1 AND workspace='nurse' AND kind='discharge-clearance' AND data->>'admission_id'=$2 ORDER BY created_at DESC LIMIT 1`,[t,row.admission_id]);
    if(nursing.rows[0]?.status!=='Completed')throw new Error("Nursing clearance is pending");
    const dietary=await c.query(`SELECT count(*) FILTER(WHERE kitchen_status NOT IN('Delivered','Cancelled'))::int pending,count(*) FILTER(WHERE delivery_status='Delivered' AND amount>0 AND NOT ledger_posted)::int unposted FROM dietary_orders WHERE tenant_id=$1 AND admission_id=$2`,[t,row.admission_id]);
    if(Number(dietary.rows[0].pending)>0)throw new Error(`${dietary.rows[0].pending} kitchen order(s) are still pending. Deliver or cancel them before discharge.`);
    if(Number(dietary.rows[0].unposted)>0)throw new Error(`${dietary.rows[0].unposted} delivered food charge(s) are not posted to the patient ledger.`);
    const admission=await recalculateIpdBilling(c,t,row.admission_id),invoice=await c.query(`SELECT count(*)::int count,coalesce(sum(due),0) due FROM finance_records WHERE tenant_id=$1 AND kind='invoices' AND data->>'admission_id'=$2`,[t,row.admission_id]);
    const due=invoice.rows[0].count?Number(invoice.rows[0].due):Math.max(0,Number(admission.total_amount)-Number(admission.paid_amount)-Number(admission.deposit_amount));
    if(due>0)throw new Error(`Bill clearance required. Outstanding amount is ₹${due.toFixed(2)}`);
    await c.query(`UPDATE ipd_admissions SET status='Discharged',discharged_at=now(),updated_at=now() WHERE id=$1`,[row.admission_id]);
    await c.query(`UPDATE ipd_bed_stays SET ended_at=now() WHERE admission_id=$1 AND tenant_id=$2 AND ended_at IS NULL`,[row.admission_id,t]);
    if(row.bed_id)await c.query(`UPDATE beds SET status='Cleaning' WHERE id=$1`,[row.bed_id]);
    await c.query(`UPDATE role_work_items SET status='Completed',data=data||jsonb_build_object('accepted_by',$1::text,'accepted_at',now()),updated_at=now() WHERE id=$2`,[req.portalUser!.sub,row.id]);
    await c.query("COMMIT");res.status(204).end();
  }catch(error){await c.query("ROLLBACK");res.status(400).json({error:error instanceof Error?error.message:"Unable to complete discharge"})}finally{c.release()}
});
router.post("/ipd", async (req: R, res) => {
  const b = ipd.parse(req.body),
    t = req.portalUser!.tenantId,
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const admissionDate=await c.query(`SELECT $1::timestamp::date=(now() AT TIME ZONE 'Asia/Kolkata')::date current_date`,[b.admitted_at]);
    if(!admissionDate.rows[0]?.current_date)throw new Error("IPD admission date must be the current hospital date. Past or future admission dates are not allowed.");
    if(b.expected_discharge && b.expected_discharge < b.admitted_at.slice(0,10))
      throw new Error("Expected discharge date cannot be earlier than the admission date.");
    if (isActiveIpdStatus(b.status))
      await assertNoOtherActiveAdmission(c, t, b.patient_id);
    let selectedBed: { branch_id: string; ward_id: string | null; room_id: string | null; status: string; daily_charge: string | number } | undefined;
    if (b.bed_id) {
      const lock = await c.query(
        `SELECT branch_id,ward_id,room_id,status,daily_charge FROM beds WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [b.bed_id, t],
      );
      if (lock.rows[0]?.status !== "Available")
        throw new Error("Selected bed is not available");
      selectedBed = lock.rows[0];
    }
    const patient = await c.query(
      `SELECT branch_id,registration_fee,maintenance_fee,deposit_amount,discount,total_amount FROM patients WHERE id=$1 AND tenant_id=$2`,
      [b.patient_id, t],
    );
    if (!patient.rows[0]) throw new Error("Patient not found");
    // Registration is a separate transaction and must never be rebilled in IPD.
    b.registration_amount = 0;
    b.registration_fee_amount = 0;
    b.registration_addon_amount = 0;
    b.registration_deposit_amount = 0;
    b.registration_discount_amount = 0;
    b.branch_id = patient.rows[0].branch_id;
    await assertBranchAccess(req.portalUser!, b.branch_id);
    await assertIpdDoctorAssignment(c,t,b.branch_id,b.department_id,b.consultant_doctor_id);
    if (selectedBed) {
      if (selectedBed.branch_id !== b.branch_id)
        throw new Error("Selected bed does not belong to the patient's branch");
      b.ward_id = selectedBed.ward_id;
      b.room_id = selectedBed.room_id;
    }
    const bedDailyCharge=Number(selectedBed?.daily_charge||0);
    b.consultation_fee = 0;
    const additionalTotal=b.charges.reduce((sum:number,item:any)=>sum+Number(item?.amount||0),0);
    b.consultation_fee = 0;
    if (b.discount > b.consultation_fee + bedDailyCharge + additionalTotal)
      throw new Error("Discount cannot exceed total charges");
    b.total_amount = b.consultation_fee + bedDailyCharge + additionalTotal - b.discount;
    if (b.paid_amount > b.total_amount)
      throw new Error("Paid amount cannot exceed the admission total");
    b.admission_payment_status = b.total_amount > 0 && b.paid_amount + b.deposit_amount >= b.total_amount ? "Paid" : "Unpaid";
    const n0 = await c.query(
        `SELECT count(*)::int+1 n FROM ipd_admissions WHERE tenant_id=$1`,
        [t],
      ),
      prefix=await configuredPrefix(t,"ipd_prefix","IPD"),
      n = `${prefix}-${String(n0.rows[0].n).padStart(6, "0")}`,
      r = await c.query(
        `INSERT INTO ipd_admissions(tenant_id,branch_id,patient_id,ipd_number,admitted_at,admission_type,department_id,consultant_doctor_id,reason_diagnosis,ward_id,room_id,bed_id,attendant,insurance_tpa,advance,deposit_amount,payment_mode,payment_reference,discount,discount_remarks,admission_payment_status,payment_status_remarks,registration_amount,total_amount,has_insurance,insurance_company,policy_number,insurance_document,expected_discharge,status,charges,paid_amount,consultation_fee,bed_daily_charge,patient_documents)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)RETURNING *`,
        [
          t,
          b.branch_id,
          b.patient_id,
          n,
          b.admitted_at,
          b.admission_type,
          b.department_id || null,
          b.consultant_doctor_id || null,
          b.reason_diagnosis,
          b.ward_id || null,
          b.room_id || null,
          b.bed_id || null,
          {
            name: b.attendant_name,
            phone: b.attendant_phone,
            relationship: b.attendant_relationship,
          },
          b.insurance_tpa,
          b.advance,
          b.deposit_amount,
          b.payment_mode,
          b.payment_reference,
          b.discount,
          b.discount_remarks,
          b.admission_payment_status,
          b.payment_status_remarks,
          b.registration_amount,
          b.total_amount,
          b.has_insurance,
          b.insurance_company,
          b.policy_number,
          b.insurance_document,
          b.expected_discharge || null,
          "Admitted",
          JSON.stringify(b.charges),
          b.paid_amount,
          b.consultation_fee,
          bedDailyCharge,
          JSON.stringify(b.patient_documents),
        ],
      );
    if (b.bed_id)
      await c.query(`UPDATE beds SET status='Occupied' WHERE id=$1`, [
        b.bed_id,
      ]);
    if (b.bed_id && selectedBed) {
      const bed=await c.query(`SELECT bed_number FROM beds WHERE id=$1`,[b.bed_id]);
      await c.query(`INSERT INTO ipd_bed_stays(tenant_id,admission_id,bed_id,ward_id,room_id,bed_number,daily_rate,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[t,r.rows[0].id,b.bed_id,selectedBed.ward_id,selectedBed.room_id,bed.rows[0].bed_number,bedDailyCharge,b.admitted_at]);
      await recalculateIpdBilling(c,t,r.rows[0].id);
    }
    await c.query("COMMIT");
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("Unable to create IPD admission", e);
    res.status(400).json({
      error:
        e instanceof Error && !e.message.includes("column")
          ? e.message
          : "Unable to save admission. Please refresh and try again.",
    });
  } finally {
    c.release();
  }
});
router.put("/ipd/:id", async (req: R, res) => {
  const b = ipd.parse(req.body),
    t = req.portalUser!.tenantId,
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const old = await c.query(
      `SELECT * FROM ipd_admissions WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [req.params.id, t],
    );
    if (!old.rows[0]) throw new Error("Admission not found");
    await assertBranchAccess(req.portalUser!, old.rows[0].branch_id);
    if(!isActiveIpdStatus(old.rows[0].status))throw new Error(`This admission is ${old.rows[0].status} and is read-only.`);
    if(String(b.status)!==String(old.rows[0].status))throw new Error("Use the admission status action to change status. Discharge requires the Reception Discharge workflow.");
    const expectedDate=await c.query(`SELECT $1::date>=GREATEST($2::timestamp::date,(now() AT TIME ZONE 'Asia/Kolkata')::date) valid`,[b.expected_discharge,b.admitted_at]);
    if(b.expected_discharge && !expectedDate.rows[0]?.valid)
      throw new Error("Expected discharge date cannot be earlier than the admission date or current hospital date.");
    if (isActiveIpdStatus(b.status))
      await assertNoOtherActiveAdmission(c, t, b.patient_id, String(req.params.id));
    b.bed_id=old.rows[0].bed_id;
    b.ward_id=old.rows[0].ward_id;
    b.room_id=old.rows[0].room_id;
    const patient = await c.query(
      `SELECT branch_id,registration_fee,maintenance_fee,deposit_amount,discount,total_amount FROM patients WHERE id=$1 AND tenant_id=$2`,
      [b.patient_id, t],
    );
    // Registration is billed only at patient registration, never again in IPD.
    b.registration_amount = 0;
    b.registration_fee_amount = 0;
    b.registration_addon_amount = 0;
    b.registration_deposit_amount = 0;
    b.registration_discount_amount = 0;
    b.branch_id = patient.rows[0]?.branch_id || b.branch_id;
    await assertBranchAccess(req.portalUser!, b.branch_id);
    await assertIpdDoctorAssignment(c,t,b.branch_id,b.department_id,b.consultant_doctor_id);
    if (b.bed_id) {
      const selectedBed = await c.query(
        `SELECT branch_id,ward_id,room_id,daily_charge FROM beds WHERE id=$1 AND tenant_id=$2`,
        [b.bed_id, t],
      );
      if (!selectedBed.rows[0]) throw new Error("Selected bed not found");
      if (selectedBed.rows[0].branch_id !== b.branch_id)
        throw new Error("Selected bed does not belong to the patient's branch");
      b.ward_id = selectedBed.rows[0].ward_id;
      b.room_id = selectedBed.rows[0].room_id;
      b.bed_daily_charge = Number(old.rows[0].bed_daily_charge||0);
    } else {
      b.bed_daily_charge = 0;
    }
    const additionalTotal=b.charges.reduce((sum:number,item:any)=>sum+Number(item?.amount||0),0);
    if (b.discount > b.consultation_fee + b.bed_daily_charge + additionalTotal)
      throw new Error("Discount cannot exceed total charges");
    b.total_amount = b.consultation_fee + b.bed_daily_charge + additionalTotal - b.discount;
    if (b.paid_amount > b.total_amount)
      throw new Error("Paid amount cannot exceed the admission total");
    b.admission_payment_status = b.total_amount > 0 && b.paid_amount + b.deposit_amount >= b.total_amount ? "Paid" : "Unpaid";
    const r = await c.query(
      `UPDATE ipd_admissions SET branch_id=$1,patient_id=$2,admitted_at=$3,admission_type=$4,department_id=$5,consultant_doctor_id=$6,reason_diagnosis=$7,ward_id=$8,room_id=$9,bed_id=$10,attendant=$11,insurance_tpa=$12,advance=$13,deposit_amount=$14,payment_mode=$15,payment_reference=$16,discount=$17,discount_remarks=$18,admission_payment_status=$19,payment_status_remarks=$20,registration_amount=$21,total_amount=$22,has_insurance=$23,insurance_company=$24,policy_number=$25,insurance_document=$26,expected_discharge=$27,status=$28,charges=$29,paid_amount=$30,consultation_fee=$31,bed_daily_charge=$32,patient_documents=$33,updated_at=now()WHERE id=$34 AND tenant_id=$35 RETURNING *`,
      [
        b.branch_id,
        b.patient_id,
        b.admitted_at,
        b.admission_type,
        b.department_id || null,
        b.consultant_doctor_id || null,
        b.reason_diagnosis,
        b.ward_id || null,
        b.room_id || null,
        b.bed_id || null,
        {
          name: b.attendant_name,
          phone: b.attendant_phone,
          relationship: b.attendant_relationship,
        },
        b.insurance_tpa,
        b.advance,
        b.deposit_amount,
        b.payment_mode,
        b.payment_reference,
        b.discount,
        b.discount_remarks,
        b.admission_payment_status,
        b.payment_status_remarks,
        b.registration_amount,
        b.total_amount,
        b.has_insurance,
        b.insurance_company,
        b.policy_number,
        b.insurance_document || old.rows[0].insurance_document,
        b.expected_discharge || null,
        b.status,
        JSON.stringify(b.charges),
        b.paid_amount,
        b.consultation_fee,
        b.bed_daily_charge,
        JSON.stringify(Object.keys(b.patient_documents).length?b.patient_documents:old.rows[0].patient_documents||{}),
        req.params.id,
        t,
      ],
    );
    const recalculated=await recalculateIpdBilling(c,t,String(req.params.id));
    await c.query("COMMIT");
    res.json(recalculated||r.rows[0]);
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("Unable to update IPD admission", e);
    res.status(400).json({
      error:
        e instanceof Error && !e.message.includes("column")
          ? e.message
          : "Unable to save admission. Please refresh and try again.",
    });
  } finally {
    c.release();
  }
});
router.put("/ipd/:id/transfer", async (req: R, res) => {
  const b = z
      .object({
        transfer_type: z.string(),
        department_id: z.preprocess(v=>v===""?null:v,z.string().uuid().nullable().optional()),
        consultant_doctor_id: z.preprocess(v=>v===""?null:v,z.string().uuid().nullable().optional()),
        ward_id: z.preprocess(v=>v===""?null:v,z.string().uuid().nullable().optional()),
        room_id: z.preprocess(v=>v===""?null:v,z.string().uuid().nullable().optional()),
        bed_id: z.preprocess(v=>v===""?null:v,z.string().uuid().nullable().optional()),
        notes: z.string().prefault(""),
      })
      .parse(req.body),
    t = req.portalUser!.tenantId,
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const old = await c.query(
      `SELECT * FROM ipd_admissions WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [req.params.id, t],
    );
    if (!old.rows[0]) throw new Error("Admission not found");
    await assertBranchAccess(req.portalUser!, old.rows[0].branch_id);
    if(!isActiveIpdStatus(old.rows[0].status)){
      await c.query("ROLLBACK");
      res.status(409).json({error:`Bed transfer is not allowed because this admission is ${old.rows[0].status}.`});
      return;
    }
    const newDepartment=b.department_id ?? old.rows[0].department_id;
    const newDoctor=b.consultant_doctor_id ?? old.rows[0].consultant_doctor_id;
    await assertIpdDoctorAssignment(c,t,old.rows[0].branch_id,newDepartment,newDoctor);
    let selectedBed:{branch_id:string;ward_id:string|null;room_id:string|null;status:string;daily_charge:number|string;bed_number:string}|undefined;
    if (b.bed_id && b.bed_id !== old.rows[0].bed_id) {
      const bed = await c.query(
        `SELECT branch_id,ward_id,room_id,status,daily_charge,bed_number FROM beds WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [b.bed_id, t],
      );
      if (bed.rows[0]?.status !== "Available")
        throw new Error("Selected bed is not available");
      if (bed.rows[0].branch_id!==old.rows[0].branch_id) throw new Error("Selected bed does not belong to this branch");
      selectedBed=bed.rows[0];
      if (old.rows[0].bed_id)
        await c.query(`UPDATE beds SET status='Available' WHERE id=$1`, [
          old.rows[0].bed_id,
        ]);
      await c.query(`UPDATE beds SET status='Occupied' WHERE id=$1`, [
        b.bed_id,
      ]);
      await c.query(`UPDATE ipd_bed_stays SET ended_at=now() WHERE admission_id=$1 AND tenant_id=$2 AND ended_at IS NULL`,[req.params.id,t]);
      await c.query(`INSERT INTO ipd_bed_stays(tenant_id,admission_id,bed_id,ward_id,room_id,bed_number,daily_rate,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())`,[t,req.params.id,b.bed_id,bed.rows[0].ward_id,bed.rows[0].room_id,bed.rows[0].bed_number,bed.rows[0].daily_charge]);
    }
    const to = {
      department_id: newDepartment,
      consultant_doctor_id: newDoctor,
      ward_id: selectedBed?.ward_id ?? old.rows[0].ward_id,
      room_id: selectedBed?.room_id ?? old.rows[0].room_id,
      bed_id: b.bed_id ?? old.rows[0].bed_id,
    };
    await c.query(
      `UPDATE ipd_admissions SET department_id=$1,consultant_doctor_id=$2,ward_id=$3,room_id=$4,bed_id=$5,updated_at=now()WHERE id=$6`,
      [
        to.department_id,
        to.consultant_doctor_id,
        to.ward_id,
        to.room_id,
        to.bed_id,
        req.params.id,
      ],
    );
    await c.query(
      `INSERT INTO ipd_transfer_history(tenant_id,admission_id,transfer_type,from_details,to_details,notes,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        t,
        req.params.id,
        b.transfer_type,
        old.rows[0],
        to,
        b.notes,
        req.portalUser!.sub,
      ],
    );
    await recalculateIpdBilling(c,t,String(req.params.id));
    await c.query("COMMIT");
    res.status(204).end();
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
router.put("/ipd/:id/status", async (req: R, res) => {
  const b = z.object({ status: z.string() }).parse(req.body),
    t = req.portalUser!.tenantId,
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const admission = await c.query(`SELECT branch_id,patient_id,status FROM ipd_admissions WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, t]);
    if (!admission.rows[0]) throw new Error("Admission not found");
    await assertBranchAccess(req.portalUser!, admission.rows[0].branch_id);
    if(b.status==="Discharged"){
      await c.query("ROLLBACK");
      res.status(409).json({error:"Complete discharge from Reception Discharge after nursing and bill clearance. Direct discharge is not allowed."});
      return;
    }
    if(!isActiveIpdStatus(admission.rows[0].status)){
      await c.query("ROLLBACK");
      res.status(409).json({error:`This admission is already ${admission.rows[0].status} and cannot be changed.`});
      return;
    }
    if (isActiveIpdStatus(b.status))
      await assertNoOtherActiveAdmission(
        c,
        t,
        admission.rows[0].patient_id,
        String(req.params.id),
      );
    const r = await c.query(
      `UPDATE ipd_admissions SET status=$1,discharged_at=CASE WHEN $1='Discharged'THEN now()ELSE discharged_at END,updated_at=now()WHERE id=$2 AND tenant_id=$3 RETURNING bed_id`,
      [b.status, req.params.id, t],
    );
    if (["Discharged","Cancelled"].includes(b.status) && r.rows[0]?.bed_id) {
      await c.query(`UPDATE beds SET status='Cleaning' WHERE id=$1`, [
        r.rows[0].bed_id,
      ]);
      await c.query(`UPDATE ipd_bed_stays SET ended_at=now() WHERE admission_id=$1 AND tenant_id=$2 AND ended_at IS NULL`,[req.params.id,t]);
      await recalculateIpdBilling(c,t,String(req.params.id));
    }
    await c.query("COMMIT");
    res.status(204).end();
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("Unable to update IPD admission status", e);
    res.status(400).json({
      error:
        e instanceof Error
          ? e.message
          : "Unable to update admission status. Please try again.",
    });
  } finally {
    c.release();
  }
});
export default router;
