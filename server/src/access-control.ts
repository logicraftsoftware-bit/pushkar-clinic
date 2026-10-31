import { labApprovalPermissions } from "./lab-staff-roles.js";
import {roleLabel,baseRoleForCode} from './role-label.js';
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
type Auth = { sub: string; tenantId: string; branchId: string; role: string };
type Req = Request & { portalUser?: Auth };
const router = Router();
async function securityAudit(req: Req, action: string, recordId?: string) {
  const { audit } = await import("./admin-operations.js");
  const a = req.portalUser!;
  await audit({
    tenantId: a.tenantId,
    userId: a.sub,
    role: a.role,
    branchId: a.branchId,
    module: "Access Control",
    action,
    recordId,
    ip: req.ip,
    device: req.header("user-agent"),
  });
}
const permissionCodes = [
  ["patient", "view"],
  ["patient", "create"],
  ["patient", "update"],
  ["patient", "delete"],
  ["appointment", "view"],
  ["appointment", "create"],
  ["appointment", "update"],
  ["appointment", "cancel"],
  ["appointment", "export"],
  ["ipd", "view"],
  ["ipd", "create"],
  ["ipd", "update"],
  ["ipd", "cancel"],
  ["ipd", "export"],
  ["opd", "view"],
  ["opd", "create"],
  ["opd", "update"],
  ["prescription", "view"],
  ["prescription", "create"],
  ["lab.order", "view"],
  ["lab.result", "create"],
  ["lab.result", "verify"],
  ["radiology", "view"],
  ["radiology.report", "create"],
  ["radiology.report", "verify"],
  ["pharmacy", "view"],
  ["pharmacy", "sale"],
  ["pharmacy", "return"],
  ["pharmacy.inventory", "manage"],
  ["billing", "view"],
  ["billing", "create"],
  ["billing", "update"],
  ["billing", "refund"],
  ["reports", "view"],
  ["reports", "export"],
  ["inventory", "view"],
  ["inventory", "manage"],
  ["insurance", "view"],
  ["insurance", "manage"],
  ["hr", "view"],
  ["hr", "manage"],
  ["documents", "view"],
  ["documents", "manage"],
  ["audit", "view"],
  ["staff", "view"],
  ["staff", "create"],
  ["staff", "update"],
  ["staff", "delete"],
  ["hospital", "manage"],
  ["users", "manage"],
  ["roles", "manage"],
  ["permissions", "manage"],
  ["settings", "view"],
  ["settings", "manage"],
  ...[
    "dashboard",
    "patients",
    "appointments",
    "queue",
    "ipd",
    "billing",
    "inventory",
    "insurance",
    "hr",
    "reports",
    "documents",
    "notifications",
    "staff",
    "hospital",
    "access",
    "audit",
    "integrations",
    "settings",
    "vitals",
    "mar",
    "care-plans",
    "medication",
    "handover",
    "lab-orders",
    "samples",
    "results",
    "verification",
    "devices",
    "prescriptions",
    "pos",
    "batches",
    "forecasting",
    "emr",
    "consultation",
    "diagnosis",
    "clinical-orders",
    "voice-documentation",
    "discharge",
  ].map((x) => [`menu.${x}`, "view"]),
] as string[][];
const defaultRoles = [
  "Hospital Admin",
  "Branch Admin",
  "Doctor",
  "Nurse",
  "Receptionist",
  "Lab Manager",
  "Lab Technician",
  "Pathologist",
  "Radiologist",
  "Pharmacy Manager",
  "Accountant",
  "HR Manager",
  "Inventory Manager",
  "Patient",
];
const defaultPermissionTemplates: Record<string, string[]> = {
  HOSPITAL_ADMIN: ["*"],
  RECEPTIONIST: ["patient.view","patient.create","patient.update","appointment.view","appointment.create","appointment.update","appointment.cancel","ipd.view","ipd.create","ipd.update","billing.view","billing.create","billing.update","menu.dashboard.view","menu.patients.view","menu.appointments.view","menu.queue.view","menu.ipd.view","menu.billing.view","menu.notifications.view"],
  DOCTOR: ["patient.view","appointment.view","appointment.update","ipd.view","opd.view","opd.create","opd.update","prescription.view","prescription.create","lab.order.view","radiology.view","menu.dashboard.view","menu.appointments.view","menu.ipd.view","menu.emr.view","menu.consultation.view","menu.diagnosis.view","menu.prescriptions.view","menu.clinical-orders.view","menu.voice-documentation.view"],
  NURSE: ["patient.view","patient.update","ipd.view","ipd.update","opd.view","opd.update","prescription.view","lab.order.view","radiology.view","menu.dashboard.view","menu.patients.view","menu.vitals.view","menu.mar.view","menu.care-plans.view","menu.clinical-orders.view","menu.handover.view"],
  LAB_MANAGER: ["patient.view","lab.order.view","lab.result.create","lab.result.verify","radiology.view","radiology.report.create","radiology.report.verify","reports.view","reports.export","menu.dashboard.view","menu.lab-orders.view","menu.samples.view","menu.results.view","menu.verification.view","menu.reports.view","menu.devices.view"],
  LAB_TECHNICIAN: labApprovalPermissions,
  PATHOLOGIST: labApprovalPermissions,
  RADIOLOGIST: labApprovalPermissions,
  PHARMACY_MANAGER: ["patient.view","prescription.view","pharmacy.view","pharmacy.sale","pharmacy.return","pharmacy.inventory.manage","inventory.view","inventory.manage","billing.view","billing.create","menu.dashboard.view","menu.prescriptions.view","menu.pos.view","menu.inventory.view","menu.batches.view","menu.forecasting.view"],
  BRANCH_ADMIN: ["patient.view","patient.create","patient.update","appointment.view","appointment.create","appointment.update","ipd.view","ipd.create","ipd.update","inventory.view","inventory.manage","staff.view","staff.create","staff.update","reports.view","reports.export","settings.view","settings.manage","menu.dashboard.view","menu.patients.view","menu.appointments.view","menu.ipd.view","menu.inventory.view","menu.staff.view","menu.reports.view","menu.settings.view"],
  INVENTORY_MANAGER: ["inventory.view","inventory.manage","reports.view","reports.export","menu.dashboard.view","menu.inventory.view","menu.reports.view"],
  ACCOUNTANT: ["billing.view","billing.create","billing.update","billing.refund","insurance.view","insurance.manage","reports.view","reports.export","menu.dashboard.view","menu.billing.view","menu.insurance.view","menu.reports.view"],
  HR_MANAGER: ["hr.view","hr.manage","staff.view","staff.create","staff.update","documents.view","documents.manage","reports.view","reports.export","menu.dashboard.view","menu.hr.view","menu.staff.view","menu.documents.view","menu.reports.view"],
  PATIENT: ["menu.dashboard.view","menu.appointments.view","menu.emr.view","menu.prescriptions.view","menu.reports.view","menu.billing.view","menu.discharge.view","menu.notifications.view"],
};
let baseReady: Promise<unknown> | null = null;
const tenantSetup = new Map<string, Promise<void>>();
async function ensure(tenantId: string) {
  let ready = tenantSetup.get(tenantId);
  if (!ready) {
    ready = initializeTenantAccess(tenantId).catch(error => { tenantSetup.delete(tenantId); throw error; });
    tenantSetup.set(tenantId, ready);
  }
  await ready;
}
async function initializeTenantAccess(tenantId: string) {
  baseReady ??=
    pool.query(`CREATE TABLE IF NOT EXISTS rbac_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,name text NOT NULL,code citext NOT NULL,description text NOT NULL DEFAULT '',role_level integer NOT NULL DEFAULT 50,status text NOT NULL DEFAULT 'Active',is_system boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,code));
 CREATE TABLE IF NOT EXISTS rbac_permissions(code citext PRIMARY KEY,module text NOT NULL,action text NOT NULL,label text NOT NULL);
 CREATE TABLE IF NOT EXISTS rbac_role_permissions(role_id uuid REFERENCES rbac_roles(id) ON DELETE CASCADE,permission_code citext REFERENCES rbac_permissions(code) ON DELETE CASCADE,PRIMARY KEY(role_id,permission_code));
 CREATE TABLE IF NOT EXISTS rbac_role_defaults_applied(role_id uuid PRIMARY KEY REFERENCES rbac_roles(id) ON DELETE CASCADE,applied_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS rbac_role_template_migrations(role_id uuid REFERENCES rbac_roles(id) ON DELETE CASCADE,version integer NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(role_id,version));
 CREATE TABLE IF NOT EXISTS rbac_user_roles(tenant_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,user_id uuid REFERENCES users(id) ON DELETE CASCADE,role_id uuid REFERENCES rbac_roles(id) ON DELETE CASCADE,PRIMARY KEY(tenant_id,user_id,role_id));
 CREATE TABLE IF NOT EXISTS user_branch_access(tenant_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,user_id uuid REFERENCES users(id) ON DELETE CASCADE,branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,PRIMARY KEY(tenant_id,user_id,branch_id));
 CREATE TABLE IF NOT EXISTS user_department_access(tenant_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,user_id uuid REFERENCES users(id) ON DELETE CASCADE,department_id uuid REFERENCES departments(id) ON DELETE CASCADE,PRIMARY KEY(tenant_id,user_id,department_id));
 CREATE TABLE IF NOT EXISTS account_security_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,user_id uuid REFERENCES users(id) ON DELETE SET NULL,actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,action text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now())`);
  await baseReady;
  // Seed catalogues in two round trips instead of one query per permission/role.
  await pool.query(`INSERT INTO rbac_permissions(code,module,action,label)
    SELECT code,module,action,label FROM jsonb_to_recordset($1::jsonb)
      AS p(code text,module text,action text,label text) ON CONFLICT DO NOTHING`,
    [JSON.stringify(permissionCodes.map(([module,action])=>({code:`${module}.${action}`,module,action,label:`${module} ${action}`})))]);
  await pool.query(`INSERT INTO rbac_roles(tenant_id,name,code,role_level,is_system)
    SELECT $1,name,code,role_level,true FROM jsonb_to_recordset($2::jsonb)
      AS r(name text,code text,role_level integer) ON CONFLICT DO NOTHING`,
    [tenantId,JSON.stringify(defaultRoles.map((name,index)=>({name,code:name.toUpperCase().replaceAll(' ','_'),role_level:index===0?100:50})))]);
  for (const [obsolete,target] of [["PHARMACIST","PHARMACY_MANAGER"]]) {
    await pool.query(`INSERT INTO rbac_user_roles(tenant_id,user_id,role_id)
      SELECT ur.tenant_id,ur.user_id,target.id FROM rbac_user_roles ur
      JOIN rbac_roles old ON old.id=ur.role_id AND upper(old.code::text)=$2
      JOIN rbac_roles target ON target.tenant_id=old.tenant_id AND upper(target.code::text)=$3
      WHERE ur.tenant_id=$1 ON CONFLICT DO NOTHING`,[tenantId,obsolete,target]);
    await pool.query(`DELETE FROM rbac_roles WHERE tenant_id=$1 AND upper(code::text)=$2`,[tenantId,obsolete]);
  }
  const tenantRoles = await pool.query<{id:string;code:string}>(`SELECT id,upper(code::text) code FROM rbac_roles WHERE tenant_id=$1`,[tenantId]);
  for (const role of tenantRoles.rows) {
    const template=defaultPermissionTemplates[role.code];
    if(!template) continue;
    const claimed=await pool.query(`INSERT INTO rbac_role_defaults_applied(role_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING role_id`,[role.id]);
    if(!claimed.rowCount) continue;
    const existing=await pool.query<{count:number}>(`SELECT count(*)::int count FROM rbac_role_permissions WHERE role_id=$1`,[role.id]);
    if(role.code!=="HOSPITAL_ADMIN" && existing.rows[0]!.count>0) continue;
    if(template.includes("*")) await pool.query(`INSERT INTO rbac_role_permissions SELECT $1,code FROM rbac_permissions ON CONFLICT DO NOTHING`,[role.id]);
    else await pool.query(`INSERT INTO rbac_role_permissions(role_id,permission_code) SELECT $1,code FROM rbac_permissions WHERE code=ANY($2::citext[]) ON CONFLICT DO NOTHING`,[role.id,template]);
  }
  const roleUpdates:Record<string,string[]>={
    RECEPTIONIST:["menu.notifications.view"],
    NURSE:["lab.order.view","radiology.view","menu.clinical-orders.view"],
  };
  for(const role of tenantRoles.rows){
    const additions=roleUpdates[role.code];if(!additions)continue;
    const claimed=await pool.query(`INSERT INTO rbac_role_template_migrations(role_id,version)VALUES($1,2)ON CONFLICT DO NOTHING RETURNING role_id`,[role.id]);
    if(claimed.rowCount)await pool.query(`INSERT INTO rbac_role_permissions(role_id,permission_code)SELECT $1,code FROM rbac_permissions WHERE code=ANY($2::citext[])ON CONFLICT DO NOTHING`,[role.id,additions]);
  }
  for(const role of tenantRoles.rows){
    const additions=role.code==="PATIENT"?["menu.emr.view"]:[];
    if(!additions.length)continue;
    const claimed=await pool.query(`INSERT INTO rbac_role_template_migrations(role_id,version)VALUES($1,3)ON CONFLICT DO NOTHING RETURNING role_id`,[role.id]);
    if(claimed.rowCount)await pool.query(`INSERT INTO rbac_role_permissions(role_id,permission_code)SELECT $1,code FROM rbac_permissions WHERE code=ANY($2::citext[])ON CONFLICT DO NOTHING`,[role.id,additions]);
  }
  for(const role of tenantRoles.rows){
    const additions=role.code==="DOCTOR"?["ipd.view","menu.ipd.view"]:[];
    if(!additions.length)continue;
    const claimed=await pool.query(`INSERT INTO rbac_role_template_migrations(role_id,version)VALUES($1,4)ON CONFLICT DO NOTHING RETURNING role_id`,[role.id]);
    if(claimed.rowCount)await pool.query(`INSERT INTO rbac_role_permissions(role_id,permission_code)SELECT $1,code FROM rbac_permissions WHERE code=ANY($2::citext[])ON CONFLICT DO NOTHING`,[role.id,additions]);
  }
  for(const role of tenantRoles.rows){
    if(role.code!=="RADIOLOGIST")continue;
    const claimed=await pool.query('INSERT INTO rbac_role_template_migrations(role_id,version)VALUES($1,5)ON CONFLICT DO NOTHING RETURNING role_id',[role.id]);
    if(claimed.rowCount)await pool.query('INSERT INTO rbac_role_permissions(role_id,permission_code)SELECT $1,code FROM rbac_permissions WHERE code=ANY($2::citext[])ON CONFLICT DO NOTHING',[role.id,labApprovalPermissions]);
  }
  const admin = tenantRoles.rows.find((x)=>x.code==="HOSPITAL_ADMIN")!;
  await pool.query(
    `INSERT INTO rbac_user_roles SELECT $1,u.id,$2 FROM users u WHERE u.tenant_id=$1 AND u.role='hospital_admin' AND NOT EXISTS(SELECT 1 FROM rbac_user_roles ur WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id) ON CONFLICT DO NOTHING`,
    [tenantId, admin.id],
  );
  await pool.query(`INSERT INTO rbac_user_roles(tenant_id,user_id,role_id)
    SELECT u.tenant_id,u.id,r.id FROM users u JOIN rbac_roles r ON r.tenant_id=u.tenant_id AND upper(r.code::text)=CASE u.role::text
      WHEN 'receptionist' THEN 'RECEPTIONIST' WHEN 'doctor' THEN 'DOCTOR' WHEN 'nurse' THEN 'NURSE'
      WHEN 'laboratory' THEN 'LAB_MANAGER' WHEN 'radiology' THEN 'RADIOLOGIST' WHEN 'pharmacist' THEN 'PHARMACY_MANAGER'
      WHEN 'accountant' THEN 'ACCOUNTANT' WHEN 'hr' THEN 'HR_MANAGER' WHEN 'patient' THEN 'PATIENT' ELSE 'HOSPITAL_ADMIN' END
    WHERE u.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM rbac_user_roles ur WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id)
    ON CONFLICT DO NOTHING`,[tenantId]);
}
function auth(request: Req, response: Response, next: NextFunction) {
  try {
    const token = request.header("authorization")?.replace(/^Bearer /i, "");
    request.portalUser = jwt.verify(token ?? "", config.JWT_SECRET, {
      issuer: "careframe-api",
      audience: "careframe-portal",
    }) as Auth;
    next();
  } catch {
    response.status(401).json({ error: "Session expired or invalid" });
  }
}
router.use(auth);
router.use(async (req: Req, _res, next) => {
  try {
    await ensure(req.portalUser!.tenantId);
    next();
  } catch (e) {
    next(e);
  }
});
async function permissions(userId: string, tenantId: string) {
  const r = await pool.query<{ code: string }>(
    `SELECT DISTINCT rp.permission_code::text code FROM rbac_user_roles ur JOIN rbac_roles r ON r.id=ur.role_id AND r.status='Active' JOIN rbac_role_permissions rp ON rp.role_id=r.id WHERE ur.tenant_id=$1 AND ur.user_id=$2`,
    [tenantId, userId],
  );
  return r.rows.map((x) => x.code);
}
router.get("/me", async (req: Req, res) => {
  const a=req.portalUser!;
  const [roles,granted]=await Promise.all([
    pool.query(`SELECT r.id,r.name,r.code::text,r.is_system FROM rbac_user_roles ur JOIN rbac_roles r ON r.id=ur.role_id WHERE ur.tenant_id=$1 AND ur.user_id=$2 AND r.status='Active' ORDER BY r.role_level DESC,r.name`,[a.tenantId,a.sub]),
    permissions(a.sub,a.tenantId),
  ]);
  const managed=(granted.includes('roles.manage')||granted.includes('staff.view'))?await pool.query(`SELECT id,name,code::text,is_system FROM rbac_roles WHERE tenant_id=$1 AND NOT is_system ORDER BY lower(name)`,[a.tenantId]):null;
  res.set('Cache-Control','no-store');
  res.json({permissions:granted,roles:roles.rows.map(r=>({...r,name:roleLabel(r.name)})),managed_roles:managed?.rows.map(r=>({...r,name:roleLabel(r.name)}))??[]});
});
router.use(async (req: Req, res, next) => {
  const granted = await permissions(
      req.portalUser!.sub,
      req.portalUser!.tenantId,
    ),
    required = req.path.startsWith("/users") ? "users.manage" : "roles.manage";
  if (!granted.includes(required)) {
    res.status(403).json({ error: `Permission required: ${required}` });
    return;
  }
  next();
});
router.get("/permissions", async (_req, res) => {
  const r = await pool.query(
    `SELECT * FROM rbac_permissions ORDER BY module,action`,
  );
  res.json(r.rows);
});
router.get("/roles", async (req: Req, res) => {
  const r = await pool.query(
    `SELECT r.*,coalesce(array_agg(rp.permission_code::text)FILTER(WHERE rp.permission_code IS NOT NULL),'{}') permissions FROM rbac_roles r LEFT JOIN rbac_role_permissions rp ON rp.role_id=r.id WHERE r.tenant_id=$1 GROUP BY r.id ORDER BY r.role_level DESC,r.name`,
    [req.portalUser!.tenantId],
  );
  res.json(r.rows.map(role=>({...role,name:roleLabel(role.name)})));
});
router.post("/roles", async (req: Req, res) => {
  const b = z
    .object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(2).transform(roleLabel),
      code: z.string().trim().min(2).transform(value => value.toUpperCase().replace(/\s+/g, '_')),
      description: z.string().prefault(""),
      role_level: z.coerce.number().prefault(50),
      status: z.string().prefault("Active"),
      permissions: z.array(z.string()),
    })
    .parse(req.body);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = b.id
      ? await c.query(
          `UPDATE rbac_roles SET name=$1,code=$2,description=$3,role_level=$4,status=$5,updated_at=now()WHERE id=$6 AND tenant_id=$7 RETURNING id`,
          [
            b.name,
            b.code,
            b.description,
            b.role_level,
            b.status,
            b.id,
            req.portalUser!.tenantId,
          ],
        )
      : await c.query(
          `INSERT INTO rbac_roles(tenant_id,name,code,description,role_level,status)VALUES($1,$2,$3,$4,$5,$6)RETURNING id`,
          [
            req.portalUser!.tenantId,
            b.name,
            b.code,
            b.description,
            b.role_level,
            b.status,
          ],
        );
    const id = r.rows[0].id;
    await c.query(`DELETE FROM rbac_role_permissions WHERE role_id=$1`, [id]);
    for (const p of b.permissions)
      await c.query(`INSERT INTO rbac_role_permissions VALUES($1,$2)`, [id, p]);
    await c.query("COMMIT");
    await securityAudit(req, b.id ? "Changed role permissions" : "Created role", id);
    res.json({ id });
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
router.get("/users", async (req: Req, res) => {
  const r = await pool.query(
    `SELECT u.id,s.employee_id,concat(u.first_name,' ',u.last_name) staff,u.username,u.email,u.phone,u.is_active,u.last_login_at,u.created_at,u.account_expires_at,r.id role_id,r.name role_name,b.name branch_name,d.name department_name FROM users u LEFT JOIN staff_members s ON s.user_id=u.id LEFT JOIN rbac_user_roles ur ON ur.user_id=u.id AND ur.tenant_id=u.tenant_id LEFT JOIN rbac_roles r ON r.id=ur.role_id LEFT JOIN branches b ON b.id=u.branch_id LEFT JOIN departments d ON d.id=u.department_id WHERE u.tenant_id=$1 ORDER BY u.created_at DESC`,
    [req.portalUser!.tenantId],
  );
  res.json(r.rows.map(user=>({...user,role_name:user.role_name?roleLabel(user.role_name):user.role_name})));
});
router.put("/users/:id", async (req: Req, res) => {
  const b = z
    .object({
      role_id: z.string().uuid().optional(),
      is_active: z.boolean().optional(),
      reset_password: z.string().min(8).optional(),
    })
    .parse(req.body);
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const user=await c.query('SELECT id FROM users WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[req.params.id,req.portalUser!.tenantId]);
    if(!user.rowCount)throw Object.assign(Error('Staff account not found in this hospital.'),{status:404});
    if(b.role_id){
      const role=await c.query('SELECT id,code::text,is_system FROM rbac_roles WHERE id=$1 AND tenant_id=$2',[b.role_id,req.portalUser!.tenantId]);
      if(!role.rowCount)throw Object.assign(Error('Selected role does not belong to this hospital.'),{status:400});
      const base=role.rows[0].is_system?baseRoleForCode(role.rows[0].code):undefined;
      if(base)await c.query('UPDATE users SET role=$1::user_role WHERE id=$2 AND tenant_id=$3',[base,req.params.id,req.portalUser!.tenantId]);
    }
  if (b.role_id) {
    await c.query(
      `DELETE FROM rbac_user_roles WHERE tenant_id=$1 AND user_id=$2`,
      [req.portalUser!.tenantId, req.params.id],
    );
    await c.query(
      `INSERT INTO rbac_user_roles SELECT $1,$2,id FROM rbac_roles WHERE id=$3 AND tenant_id=$1`,
      [req.portalUser!.tenantId, req.params.id, b.role_id],
    );
  }
  await c.query(
    `UPDATE users SET is_active=coalesce($1,is_active),force_password_change=CASE WHEN $2 IS NOT NULL THEN true ELSE force_password_change END,password_hash=CASE WHEN $2 IS NOT NULL THEN crypt($2,gen_salt('bf',12))ELSE password_hash END WHERE id=$3 AND tenant_id=$4`,
    [
      b.is_active,
      b.reset_password ?? null,
      req.params.id,
      req.portalUser!.tenantId,
    ],
  );
  if (b.is_active !== undefined)
    await c.query(
      `UPDATE staff_members SET status=$1,employment=jsonb_set(coalesce(employment,'{}'::jsonb),'{status}',to_jsonb($1::text),true),updated_at=now() WHERE user_id=$2 AND tenant_id=$3`,
      [b.is_active ? "Active" : "Inactive", req.params.id, req.portalUser!.tenantId],
    );
    await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  if (b.role_id) await securityAudit(req, "Changed user's role", String(req.params.id));
  if (b.reset_password) await securityAudit(req, "Reset user password", String(req.params.id));
  if (b.is_active !== undefined)
    await securityAudit(
      req,
      b.is_active ? "Enabled user account" : "Disabled user account",
      String(req.params.id),
    );
  res.status(204).end();
});
export async function hasPermission(
  userId: string,
  tenantId: string,
  code: string,
) {
  await ensure(tenantId);
  return (await permissions(userId, tenantId)).includes(code);
}
export default router;
