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
import { hasPermission } from "./access-control.js";
type A = { sub: string; tenantId: string; branchId: string; role: string };
type R = Request & { portalUser?: A };
const router = Router();
let ready: Promise<unknown> | null = null;
export function ensureAdminSchema() {
  ready ??= pool.query(
    `CREATE TABLE IF NOT EXISTS hospital_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id)ON DELETE CASCADE,name text NOT NULL,document_type text NOT NULL,related_type text,related_id text,branch_id uuid REFERENCES branches(id),file_data text,issue_date date,expiry_date date,description text,access_level text NOT NULL DEFAULT 'Hospital',uploaded_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());CREATE TABLE IF NOT EXISTS login_activity(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES hospitals(id)ON DELETE CASCADE,user_id uuid REFERENCES users(id)ON DELETE SET NULL,employee_id uuid REFERENCES staff_members(id)ON DELETE SET NULL,role text,branch_id uuid REFERENCES branches(id),login_time timestamptz NOT NULL DEFAULT now(),logout_time timestamptz,ip_address text,device_browser text,login_status text NOT NULL,identifier text,created_at timestamptz NOT NULL DEFAULT now());CREATE TABLE IF NOT EXISTS hospital_audit_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES hospitals(id)ON DELETE CASCADE,user_id uuid REFERENCES users(id)ON DELETE SET NULL,role text,branch_id uuid REFERENCES branches(id),module text NOT NULL,action text NOT NULL,record_id text,ip_address text,device text,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());CREATE TABLE IF NOT EXISTS hospital_settings(tenant_id uuid NOT NULL REFERENCES hospitals(id)ON DELETE CASCADE,section text NOT NULL,key text NOT NULL,value jsonb NOT NULL DEFAULT 'null',updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,section,key));`,
  );
  return ready;
}
export async function audit(entry: {
  tenantId: string;
  userId?: string;
  role?: string;
  branchId?: string;
  module: string;
  action: string;
  recordId?: string;
  ip?: string;
  device?: string;
  metadata?: unknown;
}) {
  await ensureAdminSchema();
  await pool.query(
    `INSERT INTO hospital_audit_logs(tenant_id,user_id,role,branch_id,module,action,record_id,ip_address,device,metadata)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      entry.tenantId,
      entry.userId || null,
      entry.role || null,
      entry.branchId || null,
      entry.module,
      entry.action,
      entry.recordId || null,
      entry.ip || null,
      entry.device || null,
      entry.metadata ?? {},
    ],
  );
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
router.use(auth);
router.use(async (req: R, res, next) => {
  try {
    await ensureAdminSchema();
    const path = req.path,
      code = path==='/lookups' && await hasPermission(req.portalUser!.sub,req.portalUser!.tenantId,'documents.manage') ? 'documents.manage' : path.startsWith("/documents")
        ? req.method === "GET"
          ? "documents.view"
          : "documents.manage"
        : path.startsWith("/login-activity")
          ? "users.manage"
          : path.startsWith("/audit")
            ? "audit.view"
            : req.method === "GET"
              ? "settings.view"
              : "settings.manage";
    if (
      !(await hasPermission(
        req.portalUser!.sub,
        req.portalUser!.tenantId,
        code,
      ))
    ) {
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
  const t = req.portalUser!.tenantId,
    [p, s, d, b] = await Promise.all([
      pool.query(
        `SELECT id,concat(first_name,' ',last_name)name FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL`,
        [t],
      ),
      pool.query(
        `SELECT id,concat(first_name,' ',last_name)name FROM staff_members WHERE tenant_id=$1`,
        [t],
      ),
      pool.query(`SELECT id,name FROM departments WHERE tenant_id=$1 AND is_active=true`, [t]),
      pool.query(`SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true`, [t]),
    ]);
  res.json({
    patients: p.rows,
    staff: s.rows,
    departments: d.rows,
    branches: b.rows,
  });
});
const doc = z.object({
  name: z.string().min(1),
  document_type: z.string().min(1),
  related_type: z.string().prefault(""),
  related_id: z.string().prefault(""),
  branch_id: z.string().prefault(""),
  file_data: z.string().prefault(""),
  issue_date: z.string().prefault(""),
  expiry_date: z.string().prefault(""),
  description: z.string().prefault(""),
  access_level: z.string().prefault("Hospital"),
});
router.get("/documents", async (req: R, res) => {
  const r = await pool.query(
    `SELECT d.*,b.name branch_name,concat(u.first_name,' ',u.last_name)uploaded_by_name FROM hospital_documents d LEFT JOIN branches b ON b.id=d.branch_id LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.tenant_id=$1 ORDER BY d.created_at DESC`,
    [req.portalUser!.tenantId],
  );
  res.json(r.rows);
});
router.post("/documents", async (req: R, res) => {
  const b = doc.parse(req.body),
    a = req.portalUser!,
    r = await pool.query(
      `INSERT INTO hospital_documents(tenant_id,name,document_type,related_type,related_id,branch_id,file_data,issue_date,expiry_date,description,access_level,uploaded_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)RETURNING *`,
      [
        a.tenantId,
        b.name,
        b.document_type,
        b.related_type,
        b.related_id,
        b.branch_id || null,
        b.file_data || null,
        b.issue_date || null,
        b.expiry_date || null,
        b.description,
        b.access_level,
        a.sub,
      ],
    );
  await audit({
    tenantId: a.tenantId,
    userId: a.sub,
    role: a.role,
    branchId: a.branchId,
    module: "Documents",
    action: "Uploaded document",
    recordId: r.rows[0].id,
  });
  res.status(201).json(r.rows[0]);
});
router.put("/documents/:id", async (req: R, res) => {
  const b = doc.parse(req.body),
    a = req.portalUser!,
    r = await pool.query(
      `UPDATE hospital_documents SET name=$1,document_type=$2,related_type=$3,related_id=$4,branch_id=$5,file_data=$6,issue_date=$7,expiry_date=$8,description=$9,access_level=$10,updated_at=now()WHERE id=$11 AND tenant_id=$12 RETURNING *`,
      [
        b.name,
        b.document_type,
        b.related_type,
        b.related_id,
        b.branch_id || null,
        b.file_data || null,
        b.issue_date || null,
        b.expiry_date || null,
        b.description,
        b.access_level,
        req.params.id,
        a.tenantId,
      ],
    );
  await audit({
    tenantId: a.tenantId,
    userId: a.sub,
    role: a.role,
    branchId: a.branchId,
    module: "Documents",
    action: "Updated document",
    recordId: String(req.params.id),
  });
  res.json(r.rows[0]);
});
router.get("/login-activity", async (req: R, res) => {
  const r = await pool.query(
    `SELECT l.*,CASE WHEN l.role='hospital_admin' THEN 'Clinic Admin' ELSE concat_ws(' ',u.first_name,u.last_name) END user_name,s.employee_id employee_code,concat(s.first_name,' ',s.last_name)employee_name,b.name branch_name FROM login_activity l LEFT JOIN users u ON u.id=l.user_id LEFT JOIN staff_members s ON s.id=coalesce(l.employee_id,(SELECT id FROM staff_members WHERE user_id=l.user_id LIMIT 1)) LEFT JOIN branches b ON b.id=l.branch_id WHERE l.tenant_id=$1 ORDER BY l.login_time DESC LIMIT 500`,
    [req.portalUser!.tenantId],
  );
  res.json(r.rows);
});
router.get("/audit", async (req: R, res) => {
  const r = await pool.query(
    `SELECT * FROM (SELECT a.id::text,a.role,a.module,a.action,a.record_id,a.ip_address,a.device,a.created_at,CASE WHEN a.role='hospital_admin' THEN 'Clinic Admin' ELSE concat_ws(' ',u.first_name,u.last_name) END user_name,b.name branch_name FROM hospital_audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN branches b ON b.id=a.branch_id WHERE a.tenant_id=$1 UNION ALL SELECT 'activity-'||a.id,a.actor_role,a.module,a.action,a.record_id,a.ip_address,a.request_path,a.created_at,a.actor_name,b.name FROM site_activity_events a LEFT JOIN branches b ON b.id=a.branch_id WHERE a.tenant_id=$1) logs ORDER BY created_at DESC LIMIT 1000`,
    [req.portalUser!.tenantId],
  );
  res.json(r.rows);
});
const defaults: Record<string, Record<string, unknown>> = {
  General: {
    hospital_logo: "",
    currency: "INR",
    date_format: "DD/MM/YYYY",
    time_format: "12 Hour",
    financial_year: "April - March",
  },
  Patient: {
    uhid_prefix: "UHID",
    registration_fee: 0,
    registration_addons: [],
  },
  Appointment: { opd_prefix: "OPD", slot_duration: 20 },
  Billing: { invoice_prefix: "INV", tax_enabled: true, tax_rate: 18 },
  Clinical: {
    ipd_prefix: "IPD",
    prescription_header: "",
    prescription_footer: "",
  },
  Notifications: {
    email_enabled: true,
    sms_enabled: false,
    appointment_reminders: true,
  },
  Security: {
    minimum_password_length: 8,
    require_uppercase: true,
    require_number: true,
    session_timeout: 60,
  },
};
router.get("/settings", async (req: R, res) => {
  const r = await pool.query(
      `SELECT section,key,value FROM hospital_settings WHERE tenant_id=$1`,
      [req.portalUser!.tenantId],
    ),
    out = structuredClone(defaults);
  for (const x of r.rows) (out[x.section] ??= {})[x.key] = x.value;
  res.json(out);
});
router.put("/settings/:section", async (req: R, res) => {
  const section = String(req.params.section),
    data = z.record(z.string(), z.unknown()).parse(req.body),
    a = req.portalUser!;
  for (const [key, value] of Object.entries(data))
    await pool.query(
      `INSERT INTO hospital_settings(tenant_id,section,key,value,updated_by)VALUES($1,$2,$3,$4,$5)ON CONFLICT(tenant_id,section,key)DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`,
      [a.tenantId, section, key, JSON.stringify(value), a.sub],
    );
  await audit({
    tenantId: a.tenantId,
    userId: a.sub,
    role: a.role,
    branchId: a.branchId,
    module: "Settings",
    action: `Updated ${section} settings`,
  });
  res.status(204).end();
});
export default router;
