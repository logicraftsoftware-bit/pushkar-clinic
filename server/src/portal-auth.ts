import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { labStaffRoleCodes } from "./lab-staff-roles.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { ensureAdminSchema } from "./admin-operations.js";
import { operationalSettings } from "./settings-runtime.js";
import { ensureReferralSchema } from "./referral-system.js";
import { staffLoginFailure,loginServiceFailure } from "./login-failure.js";

const router = Router();
const portalRoles = {
  hospital_admin: { userRole: "hospital_admin", roleCode: "HOSPITAL_ADMIN" },
  accountant: { userRole: "accountant", roleCode: "ACCOUNTANT" },
  branch_admin: { userRole: "hospital_admin", roleCode: "BRANCH_ADMIN" },
  doctor: { userRole: "doctor", roleCode: "DOCTOR" },
  hr_manager: { userRole: "hr", roleCode: "HR_MANAGER" },
  inventory_manager: { userRole: "receptionist", roleCode: "INVENTORY_MANAGER" },
  lab_manager: { userRole: "laboratory", roleCode: "LAB_MANAGER" },
  nurse: { userRole: "nurse", roleCode: "NURSE" },
  patient: { userRole: "patient", roleCode: "PATIENT" },
  pharmacy_manager: { userRole: "pharmacist", roleCode: "PHARMACY_MANAGER" },
  radiologist: { userRole: "radiology", roleCode: "RADIOLOGIST" },
  receptionist: { userRole: "receptionist", roleCode: "RECEPTIONIST" },
} as const;
type StaffPortal = keyof typeof portalRoles;
const portalByRoleCode: Partial<Record<string, StaffPortal>> = {
  ACCOUNTANT: "accountant",
  BRANCH_ADMIN: "branch_admin",
  DOCTOR: "doctor",
  HR_MANAGER: "hr_manager",
  INVENTORY_MANAGER: "inventory_manager",
  LAB_MANAGER: "lab_manager",
  LAB_TECHNICIAN: "lab_manager",
  PATHOLOGIST: "lab_manager",
  NURSE: "nurse",
  PATIENT: "patient",
  PHARMACY_MANAGER: "pharmacy_manager",
  RADIOLOGIST: "radiologist",
  RECEPTIONIST: "receptionist",
};
const portalByUserRole: Partial<Record<string, StaffPortal>> = {
  accountant: "accountant",
  doctor: "doctor",
  hr: "hr_manager",
  laboratory: "lab_manager",
  nurse: "nurse",
  patient: "patient",
  pharmacist: "pharmacy_manager",
  radiology: "radiologist",
  receptionist: "receptionist",
};

const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimit(request: Request, response: Response, next: NextFunction) {
  const key = request.ip ?? "unknown",
    now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now)
    attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
  else if (entry.count >= 10) {
    response
      .status(429)
      .json({ error: "Too many login attempts. Try again later." });
    return;
  } else entry.count += 1;
  next();
}

router.post("/login", rateLimit, async (request, response) => {
  const body = z
    .object({
      identifier: z.string().min(3).max(200),
      password: z.string().min(8).max(200),
      portal: z.enum([
        "hospital_admin",
        "accountant",
        "branch_admin",
        "nurse",
        "doctor",
        "patient",
        "hr_manager",
        "inventory_manager",
        "lab_manager",
        "pharmacy_manager",
        "radiologist",
        "receptionist",
        "broker",
        "staff",
      ]),
    })
    .parse(request.body);

  let selectedPortal: StaffPortal | "broker" = body.portal === "staff" ? "doctor" : body.portal;
  let verifiedStaff:{id:string;passwordHash:string}|undefined;
  if (body.portal === "staff") {
    const match = await pool.query<{ role: string; role_codes: string[];verified_user_id:string;verified_password_hash:string }>(
      `WITH login_candidates AS MATERIALIZED (
         SELECT * FROM users WHERE lower(email::text)=lower($1) OR phone=$1
       ) SELECT u.role::text,u.id verified_user_id,u.password_hash verified_password_hash,
         ARRAY(SELECT upper(rr.code::text)
           FROM rbac_user_roles ur JOIN rbac_roles rr ON rr.id=ur.role_id
           WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id AND rr.status='Active'
           ORDER BY rr.code) role_codes
       FROM login_candidates u JOIN hospitals h ON h.id=u.tenant_id
       WHERE (lower(u.email::text)=lower($1) OR u.phone=$1)
         AND u.is_active AND h.deleted_at IS NULL AND h.status IN ('active','trial')
         AND (u.account_expires_at IS NULL OR u.account_expires_at>now())
         AND u.password_hash=crypt($2,u.password_hash)
       LIMIT 1`,
      [body.identifier.trim(), body.password],
    );
    const staff = match.rows[0];
    if(staff)verifiedStaff={id:staff.verified_user_id,passwordHash:staff.verified_password_hash};
    selectedPortal =
      staff?.role_codes.map((code) => portalByRoleCode[code]).find(Boolean) ??
      (staff ? portalByUserRole[staff.role] : undefined) ??
      "broker";
    if (!staff) {
      // Broker accounts use phone numbers; an email login must not run the
      // referral schema's ALTER TABLE statements just to report an auth error.
      if(body.identifier.includes('@')){
        response.status(401).json(await staffLoginFailure(body.identifier,body.password));
        return;
      }
      await ensureReferralSchema();
      const broker = await pool.query(
        `SELECT 1 FROM referral_partners p JOIN hospitals h ON h.id=p.tenant_id
         WHERE p.phone=$1 AND p.status='Active' AND h.status IN('active','trial')
           AND h.deleted_at IS NULL AND p.password_hash=crypt($2,p.password_hash) LIMIT 1`,
        [body.identifier.trim(), body.password],
      );
      if (!broker.rowCount) {
        response.status(401).json(await staffLoginFailure(body.identifier,body.password));
        return;
      }
    } else if (selectedPortal === "broker") {
      response.status(401).json({ error: "This account does not have an active staff role." });
      return;
    }
  }

  if(selectedPortal==="broker"){
    await ensureReferralSchema();
    const result=await pool.query(`UPDATE referral_partners p SET updated_at=now() FROM hospitals h,branches b WHERE p.tenant_id=h.id AND p.branch_id=b.id AND p.phone=$1 AND p.status='Active' AND h.status IN('active','trial') AND h.deleted_at IS NULL AND p.password_hash=crypt($2,p.password_hash) RETURNING p.id,p.tenant_id,p.branch_id,p.name,p.phone,p.email,p.partner_code,h.name hospital_name,h.code hospital_code,h.logo_url,h.status hospital_status,b.name branch_name`,[body.identifier.trim(),body.password]),partner=result.rows[0];
    if(!partner)return void response.status(401).json({error:"Invalid broker phone number, password, or hospital access."});
    const token=jwt.sign({sub:partner.id,tenantId:partner.tenant_id,branchId:partner.branch_id,role:"broker",portal:"broker"},config.JWT_SECRET,{expiresIn:"8h",issuer:"careframe-api",audience:"careframe-portal"});
    response.json({token,user:{id:partner.id,name:partner.name,email:partner.email,phone:partner.phone,role:"broker",portal:"broker"},hospital:{id:partner.tenant_id,name:partner.hospital_name,code:partner.hospital_code,logoUrl:partner.logo_url,status:partner.hospital_status,branchId:partner.branch_id,branchName:partner.branch_name},modules:[]});return;
  }

  const result = await pool.query<{
    force_password_change: boolean;
    id: string;
    tenant_id: string;
    branch_id: string;
    email: string;
    phone: string;
    first_name: string;
    last_name: string;
    role: string;
    hospital_name: string;
    hospital_code: string;
    logo_url: string | null;
    hospital_status: string;
    branch_name: string;
  }>(
    `WITH login_candidates AS MATERIALIZED (
       SELECT * FROM users WHERE lower(email::text)=lower($1) OR phone=$1
     ) UPDATE users u SET last_login_at=now()
     FROM login_candidates candidate,hospitals h, branches b
     WHERE u.id=candidate.id AND u.tenant_id=h.id AND u.branch_id=b.id
       AND (lower(u.email::text)=lower($1) OR u.phone=$1)
       AND u.role=$2::user_role AND (
         EXISTS(SELECT 1 FROM rbac_user_roles ur JOIN rbac_roles rr ON rr.id=ur.role_id
           WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id
             AND (upper(rr.code::text)=ANY($3::text[]) OR rr.is_system=false) AND rr.status='Active')
         OR NOT EXISTS(SELECT 1 FROM rbac_user_roles ur WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id)
       )
       AND u.is_active
       AND (u.account_expires_at IS NULL OR u.account_expires_at>now())
       AND h.deleted_at IS NULL AND h.status IN ('active','trial')
       AND CASE WHEN $5::uuid IS NOT NULL THEN candidate.id=$5 AND candidate.password_hash=$6
         ELSE candidate.password_hash=crypt($4,candidate.password_hash) END
     RETURNING u.force_password_change,u.id,u.tenant_id,u.branch_id,u.email,u.phone,u.first_name,u.last_name,u.role,
       h.name AS hospital_name,h.code AS hospital_code,h.logo_url,h.status AS hospital_status,
       b.name AS branch_name`,
    // Staff discovery already checked the password. Reuse that result only for
    // the same account and unchanged hash; all live account/role checks run again.
    [body.identifier.trim(), portalRoles[selectedPortal].userRole, selectedPortal==="lab_manager"?labStaffRoleCodes:[portalRoles[selectedPortal].roleCode], body.password,verifiedStaff?.id??null,verifiedStaff?.passwordHash??null],
  );
  const user = result.rows[0];
  if (!user) {
    if(body.portal==='staff'||body.portal==='doctor'){
      response.status(401).json(await staffLoginFailure(body.identifier,body.password,body.portal==='doctor'));
      return;
    }
    await ensureAdminSchema();
    const candidate = await pool.query(
      `SELECT u.id,u.tenant_id,u.branch_id,u.role,s.id employee_id FROM users u LEFT JOIN staff_members s ON s.user_id=u.id WHERE lower(u.email::text)=lower($1)OR u.phone=$1 LIMIT 1`,
      [body.identifier.trim()],
    );
    const x = candidate.rows[0];
    if (x)
      await pool.query(
        `INSERT INTO login_activity(tenant_id,user_id,employee_id,role,branch_id,ip_address,device_browser,login_status,identifier)VALUES($1,$2,$3,$4,$5,$6,$7,'Failed',$8)`,
        [
          x.tenant_id,
          x.id,
          x.employee_id || null,
          x.role,
          x.branch_id,
          request.ip,
          request.header("user-agent"),
          body.identifier.trim(),
        ],
      );
    // Give account-type guidance only after credentials and account state match.
    // Staff credentials must never create an administrator session.
    if(body.portal==='hospital_admin'){
      const staff=await pool.query(`SELECT u.id FROM users u JOIN hospitals h ON h.id=u.tenant_id
        WHERE (lower(u.email::text)=lower($1) OR u.phone=$1)
          AND u.role<>'hospital_admin' AND u.is_active
          AND (u.account_expires_at IS NULL OR u.account_expires_at>now())
          AND h.deleted_at IS NULL AND h.status IN ('active','trial')
          AND u.password_hash=crypt($2,u.password_hash)
          AND (NOT EXISTS(SELECT 1 FROM rbac_user_roles ur WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id)
            OR EXISTS(SELECT 1 FROM rbac_user_roles ur JOIN rbac_roles r ON r.id=ur.role_id WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id AND r.status='Active'))
        LIMIT 1`,[body.identifier.trim(),body.password]);
      if(staff.rowCount)return void response.status(401).json({code:'STAFF_LOGIN_REQUIRED',error:'This is a staff account. Select Staff Login to open your authorized workspace.'});
    }
    response
      .status(401)
      .json({ error: "Invalid login details, role, or hospital access." });
    return;
  }
  await ensureAdminSchema();
  attempts.delete(request.ip ?? "unknown");

  // Repair legacy accounts that predate RBAC. This runs only after the base
  // role and password have been verified and never replaces an existing role.
  await pool.query(
    `INSERT INTO rbac_user_roles(tenant_id,user_id,role_id)
     SELECT $1,$2,r.id FROM rbac_roles r
     WHERE r.tenant_id=$1 AND upper(r.code::text)=$3 AND r.status='Active'
       AND NOT EXISTS(SELECT 1 FROM rbac_user_roles ur WHERE ur.tenant_id=$1 AND ur.user_id=$2)
     ON CONFLICT DO NOTHING`,
    [user.tenant_id, user.id, portalRoles[selectedPortal].roleCode],
  );

  const [modules,runtimeSettings] = await Promise.all([
    pool.query<{ code: string }>(
      `SELECT m.code FROM hospital_modules hm JOIN platform_modules m ON m.id=hm.module_id
       WHERE hm.tenant_id=$1 AND hm.is_enabled AND m.is_active`,
      [user.tenant_id],
    ),
    operationalSettings(user.tenant_id),
  ]);
  const activity=await pool.query(
    `INSERT INTO login_activity(tenant_id,user_id,role,branch_id,ip_address,device_browser,login_status,identifier)VALUES($1,$2,$3,$4,$5,$6,'Success',$7)RETURNING id`,
    [
      user.tenant_id,
      user.id,
      user.role,
      user.branch_id,
      request.ip,
      request.header("user-agent"),
      body.identifier.trim(),
    ],
  );
  const token = jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenant_id,
      branchId: user.branch_id,
      role: user.role,
      portal: selectedPortal,
    },
    config.JWT_SECRET,
    { expiresIn: "8h", issuer: "careframe-api", audience: "careframe-portal" },
  );
  response.json({
    token,
    forcePasswordChange: user.force_password_change,
    loginActivityId: activity.rows[0].id,
    user: {
      id: user.id,
      name: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      phone: user.phone,
      role: user.role,
      portal: selectedPortal,
    },
    hospital: {
      id: user.tenant_id,
      name: user.hospital_name,
      code: user.hospital_code,
      logoUrl: user.logo_url,
      status: user.hospital_status,
      branchId: user.branch_id,
      branchName: user.branch_name,
      settings: runtimeSettings,
    },
    modules: modules.rows.map((item) => item.code),
  });
});

router.use((error:unknown,request:Request,response:Response,next:NextFunction)=>{
  const failure=request.path==='/login'?loginServiceFailure(error):null;
  if(!failure)return next(error);
  console.error('Login service failure',failure.code,(error as {code?:string}).code);
  response.status(503).json(failure);
});

router.post('/change-password', async (request,response)=>{
  let claims: {sub:string;tenantId:string;role:string};
  try { claims=jwt.verify(request.header('authorization')?.replace(/^Bearer /i,'')??'',config.JWT_SECRET,{issuer:'careframe-api',audience:'careframe-portal'}) as typeof claims; }
  catch { return void response.status(401).json({error:'Session expired or invalid.'}); }
  if(claims.role==='broker')return void response.status(403).json({error:'This account cannot use staff password changes.'});
  const body=z.object({currentPassword:z.string().min(8).max(200),newPassword:z.string().min(8).max(200)}).parse(request.body);
  if(body.currentPassword===body.newPassword)return void response.status(400).json({error:'Choose a password different from your temporary password.'});
  const updated=await pool.query(`UPDATE users SET password_hash=crypt($1,gen_salt('bf',12)),force_password_change=false,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND is_active AND password_hash=crypt($4,password_hash) RETURNING id`,[body.newPassword,claims.sub,claims.tenantId,body.currentPassword]);
  if(!updated.rowCount)return void response.status(400).json({error:'Current password is incorrect or your account is unavailable.'});
  response.status(204).end();
});

router.post("/logout", async (request, response) => {
  await ensureAdminSchema();
  const id = z
    .object({ activityId: z.string().uuid() })
    .parse(request.body).activityId;
  await pool.query(`UPDATE login_activity SET logout_time=now()WHERE id=$1`, [
    id,
  ]);
  response.status(204).end();
});

export default router;
