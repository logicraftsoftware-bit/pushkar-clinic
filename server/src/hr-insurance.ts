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
import { settingSection } from "./settings-runtime.js";
type A = { sub: string; tenantId: string; branchId: string; role: string };
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
function ensure() {
  ready ??= pool.query(
    `CREATE TABLE IF NOT EXISTS insurance_claims(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id)ON DELETE CASCADE,patient_id uuid NOT NULL REFERENCES patients(id),claim_number text NOT NULL,insurance_company text NOT NULL,tpa text,policy_number text,policy_validity date,reference_type text,reference_number text,claimed_amount numeric(14,2)NOT NULL DEFAULT 0,approved_amount numeric(14,2)NOT NULL DEFAULT 0,settled_amount numeric(14,2)NOT NULL DEFAULT 0,submission_date date,status text NOT NULL DEFAULT 'Draft',documents jsonb NOT NULL DEFAULT '[]',remarks text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,claim_number));CREATE TABLE IF NOT EXISTS hr_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id)ON DELETE CASCADE,kind text NOT NULL,record_number text NOT NULL,employee_id uuid REFERENCES staff_members(id),branch_id uuid REFERENCES branches(id),data jsonb NOT NULL DEFAULT '{}',record_date date,status text NOT NULL DEFAULT 'Active',amount numeric(14,2)NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,record_number));`,
  );
  return ready;
}
router.use(auth);
router.use(async (req: R, res, next) => {
  try {
    await ensure();
    if (
      req.path === "/lookups" &&
      ((await hasPermission(req.portalUser!.sub, req.portalUser!.tenantId, "insurance.view")) ||
        (await hasPermission(req.portalUser!.sub, req.portalUser!.tenantId, "hr.view")))
    ) {
      next();
      return;
    }
    const m = req.path.startsWith("/insurance") ? "insurance" : "hr",
      code = `${m}.${req.method === "GET" ? "view" : "manage"}`;
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
    [p, s, b, u] = await Promise.all([
      pool.query(
        `SELECT id,concat(first_name,' ',last_name)name,medical_record_number FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY first_name`,
        [t],
      ),
      pool.query(
        `SELECT id,concat(first_name,' ',last_name)name,employee_id code FROM staff_members WHERE tenant_id=$1 AND status='Active' ORDER BY first_name`,
        [t],
      ),
      pool.query(
        `SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true ORDER BY name`,
        [t],
      ),
      pool.query(
        `SELECT id,concat(first_name,' ',last_name)name FROM users WHERE tenant_id=$1 AND is_active=true ORDER BY first_name`,
        [t],
      ),
    ]);
  res.json({
    patients: p.rows,
    employees: s.rows,
    branches: b.rows,
    users: u.rows,
  });
});
const claim = z.object({
  patient_id: z.string().uuid(),
  insurance_company: z.string().min(1),
  tpa: z.string().prefault(""),
  policy_number: z.string().prefault(""),
  policy_validity: z.string().optional().prefault(""),
  reference_type: z.string().prefault(""),
  reference_number: z.string().prefault(""),
  claimed_amount: z.coerce.number().prefault(0),
  approved_amount: z.coerce.number().prefault(0),
  settled_amount: z.coerce.number().prefault(0),
  submission_date: z.string().optional().prefault(""),
  status: z.string().prefault("Draft"),
  documents: z.string().prefault(""),
  remarks: z.string().prefault(""),
});
router.get("/insurance", async (req: R, res) => {
  const r = await pool.query(
    `SELECT c.*,concat(p.first_name,' ',p.last_name)patient_name,p.medical_record_number FROM insurance_claims c JOIN patients p ON p.id=c.patient_id WHERE c.tenant_id=$1 ORDER BY c.created_at DESC`,
    [req.portalUser!.tenantId],
  );
  res.json(r.rows);
});
router.post("/insurance", async (req: R, res) => {
  const b = claim.parse(req.body),
    t = req.portalUser!.tenantId,
    n0 = await pool.query(
      `SELECT count(*)::int+1 n FROM insurance_claims WHERE tenant_id=$1`,
      [t],
    ),
    n = `CLM-${String(n0.rows[0].n).padStart(6, "0")}`,
    r = await pool.query(
      `INSERT INTO insurance_claims(tenant_id,patient_id,claim_number,insurance_company,tpa,policy_number,policy_validity,reference_type,reference_number,claimed_amount,approved_amount,settled_amount,submission_date,status,documents,remarks)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)RETURNING *`,
      [
        t,
        b.patient_id,
        n,
        b.insurance_company,
        b.tpa,
        b.policy_number,
        b.policy_validity || null,
        b.reference_type,
        b.reference_number,
        b.claimed_amount,
        b.approved_amount,
        b.settled_amount,
        b.submission_date || null,
        b.status,
        b.documents ? [b.documents] : [],
        b.remarks,
      ],
    );
  res.status(201).json(r.rows[0]);
});
router.put("/insurance/:id", async (req: R, res) => {
  const b = claim.parse(req.body),
    r = await pool.query(
      `UPDATE insurance_claims SET patient_id=$1,insurance_company=$2,tpa=$3,policy_number=$4,policy_validity=$5,reference_type=$6,reference_number=$7,claimed_amount=$8,approved_amount=$9,settled_amount=$10,submission_date=$11,status=$12,documents=$13,remarks=$14,updated_at=now()WHERE id=$15 AND tenant_id=$16 RETURNING *`,
      [
        b.patient_id,
        b.insurance_company,
        b.tpa,
        b.policy_number,
        b.policy_validity || null,
        b.reference_type,
        b.reference_number,
        b.claimed_amount,
        b.approved_amount,
        b.settled_amount,
        b.submission_date || null,
        b.status,
        b.documents ? [b.documents] : [],
        b.remarks,
        req.params.id,
        req.portalUser!.tenantId,
      ],
    );
  res.json(r.rows[0]);
});
const hr = z.object({
  employee_id: z.string().optional().prefault(""),
  branch_id: z.string().optional().prefault(""),
  record_date: z.string().optional().prefault(""),
  status: z.string().prefault("Active"),
  amount: z.coerce.number().prefault(0),
  data: z.record(z.string(), z.unknown()).prefault({}),
});
router.get("/hr/:kind", async (req: R, res) => {
  const r = await pool.query(
    `SELECT h.*,concat(s.first_name,' ',s.last_name)employee_name,s.employee_id employee_code,b.name branch_name FROM hr_records h LEFT JOIN staff_members s ON s.id=h.employee_id LEFT JOIN branches b ON b.id=h.branch_id WHERE h.tenant_id=$1 AND h.kind=$2 ORDER BY coalesce(h.record_date,h.created_at::date)DESC`,
    [req.portalUser!.tenantId, req.params.kind],
  );
  res.json(r.rows);
});
router.post("/hr/:kind", async (req: R, res) => {
  const b = hr.parse(req.body),
    t = req.portalUser!.tenantId,
    kind = String(req.params.kind),
    n0 = await pool.query(
      `SELECT count(*)::int+1 n FROM hr_records WHERE tenant_id=$1 AND kind=$2`,
      [t, kind],
    ),
    n = `${kind.slice(0, 3).toUpperCase()}-${String(n0.rows[0].n).padStart(6, "0")}`,
    attendanceSettings=kind==="attendance"?await settingSection(t,"AttendanceSetting"):null;
  if(kind==="attendance"&&b.employee_id&&b.data.check_in){
    const staff=await pool.query(`SELECT staff_type FROM staff_members WHERE id=$1 AND tenant_id=$2`,[b.employee_id,t]);
    const role=staff.rows[0]?.staff_type, rules=(attendanceSettings?.roles??{})[role]??{}, checkIn=String(b.data.check_in);
    const matching=Object.entries(rules).find(([,rule])=>{const x=rule as {from?:string;upto?:string};return x.from&&x.upto&&checkIn>=x.from&&checkIn<=x.upto;});
    if(matching)b.status=matching[0].replace(/\s*\([^)]*\)$/,'').replace('Half Day Second Shift','Half Day');
  }
  const r = await pool.query(
      `INSERT INTO hr_records(tenant_id,kind,record_number,employee_id,branch_id,data,record_date,status,amount)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING *`,
      [
        t,
        kind,
        n,
        b.employee_id || null,
        b.branch_id || null,
        b.data,
        b.record_date || null,
        b.status,
        b.amount,
      ],
    );
  res.status(201).json(r.rows[0]);
});
router.put("/hr/:kind/:id", async (req: R, res) => {
  const b = hr.parse(req.body),
    r = await pool.query(
      `UPDATE hr_records SET employee_id=$1,branch_id=$2,data=$3,record_date=$4,status=$5,amount=$6,updated_at=now()WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [
        b.employee_id || null,
        b.branch_id || null,
        b.data,
        b.record_date || null,
        b.status,
        b.amount,
        req.params.id,
        req.portalUser!.tenantId,
      ],
    );
  res.json(r.rows[0]);
});
export default router;
