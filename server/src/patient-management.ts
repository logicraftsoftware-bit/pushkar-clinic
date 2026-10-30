import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import {listPagination,listSearchPatterns,patientListSearchSql} from './list-pagination.js';
import { patientAgeFields, ageAddress } from "./patient-age.js";
import { hasPermission } from "./access-control.js";
import { accessibleBranchIds, assertBranchAccess } from "./branch-access.js";
import { configuredPrefix, operationalSettings } from "./settings-runtime.js";
import { ensureReferralSchema } from "./referral-system.js";
import { audit } from "./admin-operations.js";
type A = {
  sub: string;
  tenantId: string;
  branchId: string;
  role: string;
  portal?: string;
};
type R = Request & { portalUser?: A };
const router = Router();
let ready: Promise<unknown> | null = null;
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
router.use(auth);
router.use(async (req: R, res, next) => {
  ready ??= pool.query(
    `ALTER TABLE patients ADD COLUMN IF NOT EXISTS photo_url text;ALTER TABLE patients ADD COLUMN IF NOT EXISTS allergies text NOT NULL DEFAULT '';ALTER TABLE patients ADD COLUMN IF NOT EXISTS existing_conditions text NOT NULL DEFAULT '';ALTER TABLE patients ADD COLUMN IF NOT EXISTS current_medication text NOT NULL DEFAULT '';ALTER TABLE patients ADD COLUMN IF NOT EXISTS registration_fee numeric(14,2) NOT NULL DEFAULT 0;ALTER TABLE patients ADD COLUMN IF NOT EXISTS maintenance_fee numeric(14,2) NOT NULL DEFAULT 0;ALTER TABLE patients ADD COLUMN IF NOT EXISTS registration_addons jsonb NOT NULL DEFAULT '[]';ALTER TABLE patients ADD COLUMN IF NOT EXISTS deposit_amount numeric(14,2) NOT NULL DEFAULT 0;ALTER TABLE patients ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT '';ALTER TABLE patients ADD COLUMN IF NOT EXISTS payment_reference text NOT NULL DEFAULT '';ALTER TABLE patients ADD COLUMN IF NOT EXISTS discount numeric(14,2) NOT NULL DEFAULT 0;ALTER TABLE patients ADD COLUMN IF NOT EXISTS discount_remarks text NOT NULL DEFAULT '';ALTER TABLE patients ADD COLUMN IF NOT EXISTS registration_payment_status text NOT NULL DEFAULT 'Unpaid';ALTER TABLE patients ADD COLUMN IF NOT EXISTS payment_status_remarks text NOT NULL DEFAULT '';ALTER TABLE patients ADD COLUMN IF NOT EXISTS total_amount numeric(14,2) NOT NULL DEFAULT 0;ALTER TABLE patients ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active';`,
  );
  await ready;
  const action =
      req.method === "GET"
        ? "view"
        : req.method === "DELETE"
          ? "delete"
          : req.method === "PUT"
            ? "update"
            : "create",
    code = `patient.${action}`;
  if (
    !(await hasPermission(req.portalUser!.sub, req.portalUser!.tenantId, code))
  ) {
    res.status(403).json({ error: `Permission required: ${code}` });
    return;
  }
  next();
});
const nameField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[\p{L}][\p{L} '\-]*$/u,
    "Use letters, spaces, hyphens or apostrophes only",
  );
const optionalPhone = z
  .string()
  .trim()
  .max(10)
  .refine(
    (value) => !value || /^\d{10}$/.test(value),
    "Mobile number must contain exactly 10 digits",
  );
const meaningfulText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) => !value || /[\p{L}\p{N}]/u.test(value),
      "Enter meaningful text, not symbols only",
    );
const schema = z
  .object({
    branch_id: z.string().uuid("Select an authorized branch"),
    first_name: nameField,
    last_name: nameField,
    photo_url: z
      .string()
      .trim()
      .max(2_850_000, "Photo must be 2 MB or smaller")
      .refine(
        (value) =>
          !value ||
          /^data:image\/(jpeg|png|webp);base64,/i.test(value) ||
          /^https?:\/\//i.test(value),
        "Photo must be JPEG, PNG or WebP",
      )
      .optional()
      .default(""),
    date_of_birth: z
      .string()
      .nullable()
      .optional()
      .refine(
        (value) =>
          !value ||
          (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
            new Date(`${value}T00:00:00Z`).getTime() <= Date.now()),
        "Date of birth cannot be in the future",
      )
      .refine(
        (value) => {
          if (!value) return true;
          const dob = new Date(`${value}T00:00:00Z`);
          const oldest = new Date();
          oldest.setUTCFullYear(oldest.getUTCFullYear() - 120);
          oldest.setUTCHours(0, 0, 0, 0);
          return dob.getTime() >= oldest.getTime();
        },
        "Date of birth cannot be more than 120 years ago",
      ),
    sex: z.enum(["male", "female", "other", "unknown"]).default("unknown"),
    blood_group: z
      .enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown", ""])
      .optional()
      .default(""),
    phone: optionalPhone.default(""),
    email: z
      .string()
      .trim()
      .max(254)
      .refine(
        (value) =>
          !value ||
          /^[^\s@]+@[A-Za-z0-9][A-Za-z0-9-]{1,62}(?:\.[A-Za-z0-9][A-Za-z0-9-]{1,62})+$/.test(value),
        "Enter a complete email address",
      )
      .default(""),
    address: z
      .object({
        ...patientAgeFields,
        title: z.enum(["Mr.","Mrs.","Ms.","Miss","Master","Baby","Dr.",""]).optional(),
        line: meaningfulText(500).default(""),
        city: meaningfulText(100).default(""),
        state: z.string().trim().max(100).default(""),
        pin: z
          .string()
          .trim()
          .refine(
            (value) => !value || /^\d{6}$/.test(value),
            "PIN code must contain exactly 6 digits",
          )
          .default(""),
      })
      .default({ line: "", city: "", state: "", pin: "" }),
    emergency_contact: z
      .object({
        name: z.union([nameField, z.literal("")]).default(""),
        phone: optionalPhone.default(""),
        relationship: z
          .enum([
            "Parent",
            "Spouse",
            "Child",
            "Sibling",
            "Guardian",
            "Friend",
            "Other",
            "",
          ])
          .default(""),
      })
      .superRefine((value, ctx) => {
        if (
          (value.name || value.phone || value.relationship) &&
          (!value.name || !value.phone || !value.relationship)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Complete the emergency contact name, number and relationship",
          });
      })
      .default({ name: "", phone: "", relationship: "" }),
    allergies: meaningfulText(2000).default(""),
    existing_conditions: meaningfulText(2000).default(""),
    current_medication: meaningfulText(2000).default(""),
    registration_fee: z.coerce.number().min(0).default(0),
    maintenance_fee: z.coerce.number().min(0).default(0),
    registration_addons: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().min(1),
          price: z.coerce.number().min(0),
        }),
      )
      .default([]),
    payment_mode: z.string().default(""),
    payment_reference: z.string().default(""),
    discount: z.coerce.number().min(0).default(0),
    discount_remarks: z.string().default(""),
    registration_payment_status: z.enum(["Paid", "Unpaid"]).default("Unpaid"),
    payment_status_remarks: z.string().default(""),
    total_amount: z.coerce.number().min(0).default(0),
    status: z.string().default("Active"),
    referral_partner_id: z
      .union([z.string().uuid(), z.literal(""), z.null()])
      .optional()
      .transform((value) => value || null),
    referral_consent: z
      .union([
        z.boolean(),
        z.enum(["true", "false"]).transform((value) => value === "true"),
      ])
      .default(false),
    duplicate_override: z.boolean().default(false),
    duplicate_override_reason: z.string().trim().max(500).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.referral_partner_id && !value.referral_consent)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referral_partner_id"],
        message:
          "Referral consent is required before selecting a referral partner",
      });
    if (value.duplicate_override && value.duplicate_override_reason.length < 10)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duplicate_override_reason"],
        message:
          "A duplicate override reason of at least 10 characters is required",
      });
  });
router.get("/", async (req: R, res) => {
  const branchIds = await accessibleBranchIds(req.portalUser!);
  if(req.query.page!==undefined){
    const {page,pageSize,search}=listPagination(req.query);
    const where=`p.tenant_id=$1 AND ($2::uuid[] IS NULL OR p.branch_id=ANY($2)) AND p.deleted_at IS NULL AND ${search?patientListSearchSql:'$3::text[] IS NOT NULL'}`;
    const args=[req.portalUser!.tenantId,branchIds,listSearchPatterns(search)];
    const [count,result]=await Promise.all([
      pool.query(`SELECT count(*)::int total FROM patients p WHERE ${where}`,args),
      pool.query(`SELECT p.*,b.name branch_name FROM patients p JOIN branches b ON b.id=p.branch_id AND b.tenant_id=p.tenant_id WHERE ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT $4 OFFSET $5`,[...args,pageSize,(page-1)*pageSize]),
    ]);
    res.set('Cache-Control','no-store');
    return void res.json({rows:result.rows,total:count.rows[0].total,page,page_size:pageSize});
  }
  const r = await pool.query(
    `SELECT p.*,b.name branch_name FROM patients p JOIN branches b ON b.id=p.branch_id AND b.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND ($2::uuid[] IS NULL OR p.branch_id=ANY($2)) AND p.deleted_at IS NULL ORDER BY p.created_at DESC`,
    [req.portalUser!.tenantId, branchIds],
  );
  res.json(r.rows);
});
router.get('/branches',async(req:R,res)=>{
  const branchIds=await accessibleBranchIds(req.portalUser!);
  const result=await pool.query(`SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,[req.portalUser!.tenantId,branchIds]);
  res.json(result.rows);
});
router.get("/registration-settings", async (req: R, res) => {
  await ensureReferralSchema();
  const r = await pool.query(
      `SELECT key,value FROM hospital_settings WHERE tenant_id=$1 AND section='Patient' AND key='registration_fee'`,
      [req.portalUser!.tenantId],
    ),
    out: { registration_fee: number; registration_charges: unknown[] } = {
      registration_fee: 0,
      registration_charges: [],
    };
  for (const x of r.rows) {
    if (x.key === "registration_fee")
      out.registration_fee = Math.max(0, Number(x.value) || 0);
  }
  const charges = await pool.query(
    `SELECT id,name,coalesce((data->>'standard_charge')::numeric,0) price FROM hospital_charge_masters WHERE tenant_id=$1 AND kind='charge' ORDER BY name`,
    [req.portalUser!.tenantId],
  );
  out.registration_charges = charges.rows;
  const runtime = await operationalSettings(req.portalUser!.tenantId);
  const partners = await pool.query(
    `SELECT id,partner_code,name,phone FROM referral_partners WHERE tenant_id=$1 AND status='Active' ORDER BY name`,
    [req.portalUser!.tenantId],
  );
  const medicines = await pool.query(
    `SELECT name FROM hospital_pharmacy_masters WHERE tenant_id=$1 AND kind='medicine' ORDER BY name LIMIT 1000`,
    [req.portalUser!.tenantId],
  );
  res.json({
    ...out,
    referral_partners: partners.rows,
    medicines: medicines.rows.map((row) => row.name),
    can_override_duplicates: req.portalUser!.role === "hospital_admin",
    payment_methods: runtime.payment_methods,
    currency_symbol: runtime.general.currency_symbol ?? "₹",
    date_format: runtime.general.date_format ?? "dd-mm-yyyy",
    time_format: runtime.general.time_format ?? "12 Hour",
  });
});
router.get("/:id", async (req: R, res) => {
  const branchIds = await accessibleBranchIds(req.portalUser!);
  const p = await pool.query(
    `SELECT p.*,b.name branch_name FROM patients p JOIN branches b ON b.id=p.branch_id WHERE p.id=$1 AND p.tenant_id=$2 AND ($3::uuid[] IS NULL OR p.branch_id=ANY($3)) AND p.deleted_at IS NULL`,
    [req.params.id, req.portalUser!.tenantId, branchIds],
  );
  if (!p.rows[0]) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  let appointments: { rows: unknown[] } = { rows: [] },
    ipd: { rows: unknown[] } = { rows: [] };
  try {
    appointments = await pool.query(
      `SELECT a.*,concat(u.first_name,' ',u.last_name) doctor_name,d.name department_name FROM clinical_appointments a LEFT JOIN users u ON u.id=a.doctor_id AND u.tenant_id=a.tenant_id LEFT JOIN departments d ON d.id=a.department_id AND d.tenant_id=a.tenant_id WHERE a.patient_id=$1 AND a.tenant_id=$2 ORDER BY a.appointment_date DESC,a.appointment_time DESC`,
      [req.params.id, req.portalUser!.tenantId],
    );
    ipd = await pool.query(
      `SELECT * FROM ipd_admissions WHERE patient_id=$1 AND tenant_id=$2 ORDER BY admitted_at DESC`,
      [req.params.id, req.portalUser!.tenantId],
    );
  } catch {}
  const pay = await pool.query(
    `SELECT * FROM payments WHERE patient_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`,
    [req.params.id, req.portalUser!.tenantId],
  );
  res.json({
    patient: p.rows[0],
    appointments: appointments.rows,
    ipd: ipd.rows,
    payments: pay.rows,
  });
});
router.post("/", async (req: R, res) => {
  const b = schema.parse(req.body);
  if(!b.address.title)return void res.status(400).json({field:"Title",error:"Select a patient title"});
  await assertBranchAccess(req.portalUser!, b.branch_id);
  const canOverride = req.portalUser!.role === "hospital_admin";
  if (b.duplicate_override && !canOverride) {
    res.status(403).json({
      error:
        "Hospital Admin approval is required to override a possible duplicate",
    });
    return;
  }
  const duplicates = await pool.query(
    `SELECT id,medical_record_number,first_name,last_name,date_of_birth,phone,branch_id
     FROM patients
     WHERE tenant_id=$1 AND deleted_at IS NULL AND (
       ($4<>'' AND phone=$4 AND regexp_replace(lower(trim(first_name||' '||last_name)),'\\s+',' ','g')=$2)
       OR ($3::date IS NOT NULL AND date_of_birth=$3::date AND regexp_replace(lower(trim(first_name||' '||last_name)),'\\s+',' ','g')=$2)
     ) ORDER BY created_at DESC LIMIT 10`,
    [
      req.portalUser!.tenantId,
      `${b.first_name} ${b.last_name}`
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim(),
      b.date_of_birth || null,
      b.phone,
    ],
  );
  if (duplicates.rowCount && !b.duplicate_override) {
    const allowedBranches = await accessibleBranchIds(req.portalUser!);
    res.status(409).json({
      code: "POSSIBLE_DUPLICATE_PATIENT",
      error:
        "A possible duplicate patient already exists. Review the matching UHID before registering a new patient.",
      can_override: canOverride,
      matches: duplicates.rows.map((row) =>
        allowedBranches === null || allowedBranches.includes(row.branch_id)
          ? row
          : {
              medical_record_number:
                "Existing patient in another authorized workflow",
              restricted: true,
            },
      ),
    });
    return;
  }
  b.registration_fee = 0;
  if (b.discount > b.maintenance_fee) {
    res
      .status(400)
      .json({ error: "Discount cannot exceed registration charges" });
    return;
  }
  b.total_amount = b.maintenance_fee - b.discount;
  const valid = await pool.query(
    `SELECT 1 FROM branches WHERE id=$1 AND tenant_id=$2 AND is_active=true`,
    [b.branch_id, req.portalUser!.tenantId],
  );
  if (!valid.rowCount) {
    res.status(400).json({ error: "Invalid branch" });
    return;
  }
  const count = await pool.query(
    `SELECT count(*)::int+1 n FROM patients WHERE tenant_id=$1`,
    [req.portalUser!.tenantId],
  );
  const prefix = await configuredPrefix(
    req.portalUser!.tenantId,
    "uhid_prefix",
    "UHID",
  );
  const uhid = `${prefix}-${String(count.rows[0].n).padStart(6, "0")}`;
  const r = await pool.query(
    `INSERT INTO patients(tenant_id,branch_id,medical_record_number,first_name,last_name,photo_url,date_of_birth,sex,blood_group,phone,email,address,emergency_contact,allergies,existing_conditions,current_medication,registration_fee,maintenance_fee,registration_addons,payment_mode,payment_reference,discount,discount_remarks,registration_payment_status,payment_status_remarks,total_amount,status)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)RETURNING *`,
    [
      req.portalUser!.tenantId,
      b.branch_id,
      uhid,
      b.first_name,
      b.last_name,
      b.photo_url || null,
      b.date_of_birth || null,
      b.sex,
      b.blood_group || null,
      b.phone || null,
      b.email || null,
      ageAddress(b.address),
      b.emergency_contact,
      b.allergies,
      b.existing_conditions,
      b.current_medication,
      b.registration_fee,
      b.maintenance_fee,
      JSON.stringify(b.registration_addons),
      b.payment_mode,
      b.payment_reference,
      b.discount,
      b.discount_remarks,
      b.registration_payment_status,
      b.payment_status_remarks,
      b.total_amount,
      b.status,
    ],
  );
  if (b.referral_partner_id && b.referral_consent)
    await pool.query(
      `UPDATE patients SET referral_partner_id=$1,referral_consent=true,referral_tagged_at=now() WHERE id=$2 AND tenant_id=$3`,
      [b.referral_partner_id, r.rows[0].id, req.portalUser!.tenantId],
    );
  if (b.duplicate_override) {
    await audit({
      tenantId: req.portalUser!.tenantId,
      userId: req.portalUser!.sub,
      role: req.portalUser!.role,
      branchId: b.branch_id,
      module: "Patient Registration",
      action: "Duplicate Patient Override",
      recordId: r.rows[0].id,
      ip: req.ip,
      device: req.header("user-agent"),
      metadata: {
        reason: b.duplicate_override_reason,
        matched_patient_ids: duplicates.rows.map((row) => row.id),
        new_uhid: r.rows[0].medical_record_number,
      },
    });
  }
  res.status(201).json({
    ...r.rows[0],
    referral_partner_id: b.referral_partner_id || null,
    referral_consent: b.referral_consent,
  });
});
router.put('/:id/details',async(req:R,res)=>{
  if(Object.prototype.hasOwnProperty.call(req.body??{},'medical_record_number'))return void res.status(400).json({code:'IMMUTABLE_UHID',error:'UHID is system-generated and cannot be changed.'});
  const b=schema.parse(req.body);
  await assertBranchAccess(req.portalUser!,b.branch_id);
  const branchIds=await accessibleBranchIds(req.portalUser!);
  const result=await pool.query(`UPDATE patients SET branch_id=$1,first_name=$2,last_name=$3,photo_url=$4,date_of_birth=coalesce($5,date_of_birth),sex=$6,blood_group=$7,phone=$8,email=$9,address=coalesce(address,'{}'::jsonb)||$10::jsonb,emergency_contact=$11,allergies=$12,existing_conditions=$13,current_medication=$14,status=$15,referral_partner_id=$16,referral_consent=$17,referral_tagged_at=CASE WHEN $16::uuid IS NOT NULL AND $17 THEN coalesce(referral_tagged_at,now()) ELSE referral_tagged_at END,updated_at=now() WHERE id=$18 AND tenant_id=$19 AND ($20::uuid[] IS NULL OR branch_id=ANY($20)) AND deleted_at IS NULL RETURNING *`,[
    b.branch_id,b.first_name,b.last_name,b.photo_url||null,b.date_of_birth||null,b.sex,b.blood_group||null,b.phone||null,b.email||null,ageAddress(b.address),b.emergency_contact,b.allergies,b.existing_conditions,b.current_medication,b.status,b.referral_partner_id||null,b.referral_consent,req.params.id,req.portalUser!.tenantId,branchIds,
  ]);
  if(!result.rows[0])return void res.status(404).json({error:'Patient not found'});
  res.json(result.rows[0]);
});
router.put("/:id", async (req: R, res) => {
  if(Object.prototype.hasOwnProperty.call(req.body??{},"medical_record_number")){
    res.status(400).json({
      code:"IMMUTABLE_UHID",
      error:"UHID is system-generated and cannot be changed.",
    });
    return;
  }
  const b = schema.parse(req.body);
  await assertBranchAccess(req.portalUser!, b.branch_id);
  const branchIds = await accessibleBranchIds(req.portalUser!);
  const savedPatient = await pool.query(
    `SELECT id FROM patients WHERE id=$1 AND tenant_id=$2 AND ($3::uuid[] IS NULL OR branch_id=ANY($3)) AND deleted_at IS NULL`,
    [req.params.id, req.portalUser!.tenantId, branchIds],
  );
  if (!savedPatient.rows[0]) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  b.registration_fee = 0;
  if (b.discount > b.maintenance_fee) {
    res
      .status(400)
      .json({ error: "Discount cannot exceed registration charges" });
    return;
  }
  b.total_amount = b.maintenance_fee - b.discount;
  const r = await pool.query(
    `UPDATE patients SET branch_id=$1,first_name=$2,last_name=$3,photo_url=$4,date_of_birth=coalesce($5,date_of_birth),sex=$6,blood_group=$7,phone=$8,email=$9,address=coalesce(address,'{}'::jsonb)||$10::jsonb,emergency_contact=$11,allergies=$12,existing_conditions=$13,current_medication=$14,registration_fee=$15,maintenance_fee=$16,registration_addons=$17,deposit_amount=0,payment_mode=$18,payment_reference=$19,discount=$20,discount_remarks=$21,registration_payment_status=$22,payment_status_remarks=$23,total_amount=$24,status=$25,updated_at=now()WHERE id=$26 AND tenant_id=$27 AND deleted_at IS NULL RETURNING *`,
    [
      b.branch_id,
      b.first_name,
      b.last_name,
      b.photo_url || null,
      b.date_of_birth || null,
      b.sex,
      b.blood_group || null,
      b.phone || null,
      b.email || null,
      ageAddress(b.address),
      b.emergency_contact,
      b.allergies,
      b.existing_conditions,
      b.current_medication,
      b.registration_fee,
      b.maintenance_fee,
      JSON.stringify(b.registration_addons),
      b.payment_mode,
      b.payment_reference,
      b.discount,
      b.discount_remarks,
      b.registration_payment_status,
      b.payment_status_remarks,
      b.total_amount,
      b.status,
      req.params.id,
      req.portalUser!.tenantId,
    ],
  );
  if (!r.rows[0]) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  await pool.query(
    `UPDATE patients SET referral_partner_id=$1,referral_consent=$2,referral_tagged_at=CASE WHEN $1::uuid IS NOT NULL AND $2 THEN coalesce(referral_tagged_at,now()) ELSE referral_tagged_at END WHERE id=$3 AND tenant_id=$4`,
    [
      b.referral_partner_id || null,
      b.referral_consent,
      req.params.id,
      req.portalUser!.tenantId,
    ],
  );
  res.json(r.rows[0]);
});
router.delete("/:id", async (req: R, res) => {
  const branchIds = await accessibleBranchIds(req.portalUser!);
  const result = await pool.query(
    `UPDATE patients SET deleted_at=now(),status='Inactive' WHERE id=$1 AND tenant_id=$2 AND ($3::uuid[] IS NULL OR branch_id=ANY($3)) RETURNING id`,
    [req.params.id, req.portalUser!.tenantId, branchIds],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  res.status(204).end();
});
export default router;
