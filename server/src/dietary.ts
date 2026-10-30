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

type A = { sub: string; tenantId: string; branchId: string; role: string };
type R = Request & { user?: A };
const router = Router();
function auth(req: R, res: Response, next: NextFunction) {
  try {
    const a = jwt.verify(
      req.header("authorization")?.replace(/^Bearer /i, "") || "",
      config.JWT_SECRET,
      { issuer: "careframe-api", audience: "careframe-portal" },
    ) as A;
    if (!["hospital_admin", "doctor", "nurse"].includes(a.role))
      return void res
        .status(403)
        .json({ error: "Dietary workspace access required" });
    req.user = a;
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
}
let ready: Promise<unknown> | null = null;
let extensionsReady: Promise<unknown> | null = null;
router.use(auth);
router.use(async (_q, _s, n) => {
  try {
    ready ??= pool.query(
      `CREATE TABLE IF NOT EXISTS dietary_menu(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,item_code text NOT NULL,item_name text NOT NULL,category text NOT NULL DEFAULT 'Meals',meal_type text NOT NULL,patient_rate numeric(12,2) NOT NULL DEFAULT 0,attendant_rate numeric(12,2) NOT NULL DEFAULT 0,guest_rate numeric(12,2) NOT NULL DEFAULT 0,staff_rate numeric(12,2) NOT NULL DEFAULT 0,tax numeric(6,2) NOT NULL DEFAULT 0,package_eligible boolean NOT NULL DEFAULT false,complimentary_eligible boolean NOT NULL DEFAULT false,available boolean NOT NULL DEFAULT true,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,item_code));CREATE TABLE IF NOT EXISTS patient_diets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,admission_id uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,diet_type text NOT NULL,instructions text NOT NULL DEFAULT '',reason text NOT NULL DEFAULT '',active boolean NOT NULL DEFAULT true,changed_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());CREATE TABLE IF NOT EXISTS dietary_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,branch_id uuid REFERENCES branches(id),admission_id uuid REFERENCES ipd_admissions(id),patient_id uuid REFERENCES patients(id),menu_id uuid REFERENCES dietary_menu(id),order_number text NOT NULL,order_type text NOT NULL,item_name text NOT NULL,quantity numeric(10,2) NOT NULL,rate numeric(12,2) NOT NULL,amount numeric(14,2) NOT NULL,billing_class text NOT NULL,kitchen_status text NOT NULL DEFAULT 'Order Placed',delivery_status text NOT NULL DEFAULT 'Pending',remarks text NOT NULL DEFAULT '',timeline jsonb NOT NULL DEFAULT '{}',ledger_posted boolean NOT NULL DEFAULT false,ordered_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,order_number));CREATE TABLE IF NOT EXISTS dietary_package_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,package_name text NOT NULL,meal_type text NOT NULL,order_type text NOT NULL,included boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());CREATE TABLE IF NOT EXISTS dietary_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,user_id uuid REFERENCES users(id),action text NOT NULL,entity_type text NOT NULL,entity_id uuid,previous_value jsonb,new_value jsonb,remarks text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());ALTER TABLE dietary_menu ADD COLUMN IF NOT EXISTS allergens text[] NOT NULL DEFAULT '{}';ALTER TABLE dietary_orders ADD COLUMN IF NOT EXISTS received_by text NOT NULL DEFAULT '';ALTER TABLE dietary_orders ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES users(id);WITH duplicates AS(SELECT id,row_number()OVER(PARTITION BY tenant_id,lower(package_name),lower(meal_type),lower(order_type) ORDER BY created_at DESC,id DESC)position FROM dietary_package_rules WHERE active)UPDATE dietary_package_rules SET active=false WHERE id IN(SELECT id FROM duplicates WHERE position>1);CREATE UNIQUE INDEX IF NOT EXISTS dietary_package_rule_unique ON dietary_package_rules(tenant_id,lower(package_name),lower(meal_type),lower(order_type)) WHERE active`,
    );
    await ready;
    extensionsReady ??= pool.query(`
      ALTER TABLE dietary_orders
        ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS prepared_by uuid REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS meal_date date NOT NULL DEFAULT current_date,
        ADD COLUMN IF NOT EXISTS meal_type text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS auto_generated boolean NOT NULL DEFAULT false;
      ALTER TABLE patient_diets
        ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
      CREATE TABLE IF NOT EXISTS dietary_meal_schedules(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
        meal_type text NOT NULL,service_time time NOT NULL,generation_lead_minutes integer NOT NULL DEFAULT 120 CHECK(generation_lead_minutes>=0),
        active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tenant_id,meal_type));
      CREATE TABLE IF NOT EXISTS dietary_meal_holds(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
        admission_id uuid NOT NULL REFERENCES ipd_admissions(id) ON DELETE CASCADE,reason text NOT NULL,held_by uuid REFERENCES users(id),
        held_at timestamptz NOT NULL DEFAULT now(),resumed_by uuid REFERENCES users(id),resumed_at timestamptz,active boolean NOT NULL DEFAULT true);
      CREATE UNIQUE INDEX IF NOT EXISTS dietary_auto_meal_unique ON dietary_orders(tenant_id,admission_id,menu_id,meal_date,order_type) WHERE auto_generated AND kitchen_status<>'Cancelled';
      CREATE UNIQUE INDEX IF NOT EXISTS dietary_active_hold_unique ON dietary_meal_holds(tenant_id,admission_id) WHERE active;
    `);
    await extensionsReady;
    n();
  } catch (e) {
    ready = null;
    extensionsReady = null;
    n(e);
  }
});
const audit = (
  a: A,
  action: string,
  type: string,
  id: string,
  old: unknown,
  next: unknown,
  remarks = "",
) =>
  pool.query(
    `INSERT INTO dietary_audit(tenant_id,user_id,action,entity_type,entity_id,previous_value,new_value,remarks)VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      a.tenantId,
      a.sub,
      action,
      type,
      id,
      old ? JSON.stringify(old) : null,
      next ? JSON.stringify(next) : null,
      remarks,
    ],
  );
router.post(["/menu", "/rules"], (req: R, res, next) => {
  try {
    adminOnly(req.user!);
    next();
  } catch (e) {
    res.status(403).json({
      error: e instanceof Error ? e.message : "Hospital Admin access required",
    });
  }
});
router.post("/orders", async (req: R, res, next) => {
  const a = req.user!,
    id = req.body?.admission_id;
  if (a.role !== "hospital_admin" && (!id || !(await admissionAccess(a, id))))
    return void res
      .status(403)
      .json({ error: "Select a patient in your clinical assignment" });
  if (
    id &&
    ["Patient Meal", "Extra Patient Meal"].includes(
      String(req.body?.order_type),
    )
  ) {
    const diet = await pool.query(
      `SELECT diet_type FROM patient_diets WHERE tenant_id=$1 AND admission_id=$2 AND active ORDER BY created_at DESC LIMIT 1`,
      [a.tenantId, id],
    );
    if (diet.rows[0]?.diet_type === "NPO / Nil by Mouth")
      return void res.status(409).json({
        error:
          "Patient is NPO. Resume meals by changing the diet before ordering.",
      });
  }
  next();
});
const adminOnly = (a: A) => {
  if (a.role !== "hospital_admin")
    throw new Error("Hospital Admin access required");
};
async function admissionAccess(a: A, id: string) {
  return (
    await pool.query(
      `SELECT x.* FROM ipd_admissions x WHERE x.id=$1 AND x.tenant_id=$2 AND lower(trim(x.status)) NOT IN('discharged','cancelled') AND ($3='hospital_admin' OR ($3='doctor' AND x.consultant_doctor_id=$4) OR ($3='nurse' AND EXISTS(SELECT 1 FROM staff_members s WHERE s.user_id=$4 AND s.tenant_id=x.tenant_id AND s.staff_type='Nurse' AND x.ward_id=nullif(s.professional->>'ward_assignment','')::uuid)))`,
      [id, a.tenantId, a.role, a.sub],
    )
  ).rows[0];
}
router.get("/overview", async (req: R, res) => {
  const a = req.user!,
    scope = `($2='hospital_admin' OR ($2='doctor' AND x.consultant_doctor_id=$3) OR ($2='nurse' AND EXISTS(SELECT 1 FROM staff_members s WHERE s.user_id=$3 AND s.tenant_id=x.tenant_id AND s.staff_type='Nurse' AND x.ward_id=nullif(s.professional->>'ward_assignment','')::uuid)))`;
  const patients = await pool.query(
    `SELECT x.id admission_id,x.patient_id,x.ipd_number,x.admitted_at,x.status,x.reason_diagnosis,concat_ws(' ',p.first_name,p.last_name) patient_name,p.medical_record_number,p.sex,p.date_of_birth,p.allergies,b.name branch_name,w.name ward_name,r.room_number,r.room_type,bd.bed_number,concat_ws(' ',u.first_name,u.last_name) doctor_name,coalesce(d.diet_type,'Not Assigned') diet_type,coalesce(d.instructions,'') diet_instructions,d.created_at diet_changed_at,d.confirmed_at,d.confirmed_by,(h.id IS NOT NULL) meals_held,h.reason hold_reason FROM ipd_admissions x JOIN patients p ON p.id=x.patient_id LEFT JOIN branches b ON b.id=x.branch_id LEFT JOIN wards w ON w.id=x.ward_id LEFT JOIN rooms r ON r.id=x.room_id LEFT JOIN beds bd ON bd.id=x.bed_id LEFT JOIN users u ON u.id=x.consultant_doctor_id LEFT JOIN LATERAL(SELECT * FROM patient_diets q WHERE q.admission_id=x.id AND q.active ORDER BY q.created_at DESC LIMIT 1)d ON true LEFT JOIN LATERAL(SELECT id,reason FROM dietary_meal_holds q WHERE q.admission_id=x.id AND q.active ORDER BY q.held_at DESC LIMIT 1)h ON true WHERE x.tenant_id=$1 AND lower(trim(x.status))NOT IN('discharged','cancelled') AND ${scope} ORDER BY w.name,r.room_number,bd.bed_number`,
    [a.tenantId, a.role, a.sub],
  );
  const ids = patients.rows.map((x) => x.admission_id),
    [menu, orders, rules, schedules, audits] = await Promise.all([
      pool.query(
        `SELECT * FROM dietary_menu WHERE tenant_id=$1 AND active ORDER BY meal_type,item_name`,
        [a.tenantId],
      ),
      pool.query(
        `SELECT o.*,p.medical_record_number,concat_ws(' ',p.first_name,p.last_name)patient_name,x.ipd_number,w.name ward_name,r.room_number,b.bed_number FROM dietary_orders o LEFT JOIN patients p ON p.id=o.patient_id LEFT JOIN ipd_admissions x ON x.id=o.admission_id LEFT JOIN wards w ON w.id=x.ward_id LEFT JOIN rooms r ON r.id=x.room_id LEFT JOIN beds b ON b.id=x.bed_id WHERE o.tenant_id=$1 AND ($2='hospital_admin' OR o.admission_id=ANY($3::uuid[])) ORDER BY o.created_at DESC LIMIT 500`,
        [a.tenantId, a.role, ids],
      ),
      a.role === "hospital_admin"
        ? pool.query(
            `SELECT * FROM dietary_package_rules WHERE tenant_id=$1 ORDER BY package_name,meal_type`,
            [a.tenantId],
          )
        : Promise.resolve({ rows: [] }),
      pool.query(
        `SELECT * FROM dietary_meal_schedules WHERE tenant_id=$1 ORDER BY service_time`,
        [a.tenantId],
      ),
      a.role === "hospital_admin"
        ? pool.query(
            `SELECT a.*,concat_ws(' ',u.first_name,u.last_name)user_name FROM dietary_audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 300`,
            [a.tenantId],
          )
        : Promise.resolve({ rows: [] }),
    ]);
  const o = orders.rows;
  res.json({
    role: a.role,
    patients: patients.rows,
    menu: menu.rows,
    orders: o,
    rules: rules.rows,
    audits: audits.rows,
    schedules: schedules.rows,
    metrics: {
      patients: patients.rowCount,
      meals: o.filter((x) => x.kitchen_status !== "Cancelled").length,
      pending: o.filter((x) => x.kitchen_status === "Order Placed").length,
      accepted: o.filter((x) => x.kitchen_status === "Kitchen Accepted").length,
      preparing: o.filter((x) => x.kitchen_status === "Preparing").length,
      ready: o.filter((x) => x.kitchen_status === "Ready").length,
      outForDelivery: o.filter((x) => x.kitchen_status === "Out for Delivery")
        .length,
      delivered: o.filter((x) => x.delivery_status === "Delivered").length,
      cancelled: o.filter((x) => x.kitchen_status === "Cancelled").length,
      breakfastPending: o.filter(
        (x) =>
          x.meal_type === "Breakfast" &&
          !["Delivered", "Cancelled"].includes(x.kitchen_status),
      ).length,
      lunchPending: o.filter(
        (x) =>
          x.meal_type === "Lunch" &&
          !["Delivered", "Cancelled"].includes(x.kitchen_status),
      ).length,
      dinnerPending: o.filter(
        (x) =>
          x.meal_type === "Dinner" &&
          !["Delivered", "Cancelled"].includes(x.kitchen_status),
      ).length,
      npo: patients.rows.filter((x) => x.diet_type === "NPO / Nil by Mouth")
        .length,
      special: patients.rows.filter(
        (x) =>
          !["Normal Diet", "Not Assigned", "NPO / Nil by Mouth"].includes(
            x.diet_type,
          ),
      ).length,
      dietWise: Object.entries(
        patients.rows.reduce((counts: Record<string, number>, patient) => {
          counts[patient.diet_type] = (counts[patient.diet_type] || 0) + 1;
          return counts;
        }, {}),
      ).map(([name, count]) => ({ name, count })),
      wardWise: Object.entries(
        o.reduce((counts: Record<string, number>, order) => {
          const name = order.ward_name || "Unassigned";
          counts[name] = (counts[name] || 0) + 1;
          return counts;
        }, {}),
      ).map(([name, count]) => ({ name, count })),
    },
  });
});
router.post("/diets", async (req: R, res) => {
  const b = z
      .object({
        admission_id: z.string().uuid(),
        diet_type: z.string().min(2),
        instructions: z.string().default(""),
        reason: z.string().default(""),
      })
      .parse(req.body),
    a = req.user!;
  if (!(await admissionAccess(a, b.admission_id)))
    return void res
      .status(403)
      .json({ error: "Patient is not available in your clinical assignment" });
  const old = (
    await pool.query(
      `UPDATE patient_diets SET active=false WHERE tenant_id=$1 AND admission_id=$2 AND active RETURNING *`,
      [a.tenantId, b.admission_id],
    )
  ).rows[0];
  const q = await pool.query(
    `INSERT INTO patient_diets(tenant_id,admission_id,diet_type,instructions,reason,changed_by)VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [a.tenantId, b.admission_id, b.diet_type, b.instructions, b.reason, a.sub],
  );
  if (b.diet_type === "NPO / Nil by Mouth")
    await pool.query(
      `UPDATE dietary_orders SET kitchen_status='Cancelled',delivery_status='Cancelled',remarks=concat_ws(' · ',nullif(remarks,''),'Automatically cancelled: patient marked NPO'),timeline=timeline||jsonb_build_object('cancelled_at',now()),updated_at=now() WHERE tenant_id=$1 AND admission_id=$2 AND order_type IN('Patient Meal','Extra Patient Meal') AND kitchen_status NOT IN('Delivered','Cancelled')`,
      [a.tenantId, b.admission_id],
    );
  await audit(
    a,
    old ? "Diet Changed" : "Diet Created",
    "diet",
    q.rows[0].id,
    old,
    q.rows[0],
    b.reason,
  );
  res.status(201).json(q.rows[0]);
});
router.post("/menu", async (req: R, res) => {
  const b = z
      .object({
        item_code: z.string().min(1),
        item_name: z.string().min(1),
        category: z.string(),
        meal_type: z.string(),
        patient_rate: z.coerce.number().min(0),
        attendant_rate: z.coerce.number().min(0),
        guest_rate: z.coerce.number().min(0),
        staff_rate: z.coerce.number().min(0),
        tax: z.coerce.number().min(0).default(0),
        package_eligible: z.boolean().default(false),
        complimentary_eligible: z.boolean().default(false),
        allergens: z.array(z.string()).default([]),
      })
      .parse(req.body),
    a = req.user!;
  const q = await pool.query(
    `INSERT INTO dietary_menu(tenant_id,item_code,item_name,category,meal_type,patient_rate,attendant_rate,guest_rate,staff_rate,tax,package_eligible,complimentary_eligible,allergens)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(tenant_id,item_code)DO UPDATE SET item_name=excluded.item_name,category=excluded.category,meal_type=excluded.meal_type,patient_rate=excluded.patient_rate,attendant_rate=excluded.attendant_rate,guest_rate=excluded.guest_rate,staff_rate=excluded.staff_rate,tax=excluded.tax,package_eligible=excluded.package_eligible,complimentary_eligible=excluded.complimentary_eligible,allergens=excluded.allergens RETURNING *`,
    [
      a.tenantId,
      b.item_code,
      b.item_name,
      b.category,
      b.meal_type,
      b.patient_rate,
      b.attendant_rate,
      b.guest_rate,
      b.staff_rate,
      b.tax,
      b.package_eligible,
      b.complimentary_eligible,
      b.allergens,
    ],
  );
  await audit(a, "Menu Saved", "menu", q.rows[0].id, null, q.rows[0]);
  res.status(201).json(q.rows[0]);
});
router.post("/orders", async (req: R, res) => {
  const b = z
      .object({
        admission_id: z.string().uuid().nullable(),
        menu_id: z.string().uuid(),
        order_type: z.string(),
        quantity: z.coerce.number().positive(),
        billing_class: z.string(),
        remarks: z.string().default(""),
      })
      .parse(req.body),
    a = req.user!;
  const m = (
    await pool.query(
      `SELECT * FROM dietary_menu WHERE id=$1 AND tenant_id=$2 AND active AND available`,
      [b.menu_id, a.tenantId],
    )
  ).rows[0];
  if (!m) return void res.status(400).json({ error: "Menu item unavailable" });
  const x = b.admission_id
    ? (
        await pool.query(
          `SELECT x.*,p.allergies,r.room_type FROM ipd_admissions x JOIN patients p ON p.id=x.patient_id LEFT JOIN rooms r ON r.id=x.room_id WHERE x.id=$1 AND x.tenant_id=$2 AND lower(trim(x.status))NOT IN('discharged','cancelled')`,
          [b.admission_id, a.tenantId],
        )
      ).rows[0]
    : null;
  if (b.admission_id && !x)
    return void res.status(400).json({ error: "Active admission not found" });
  if (x && ["Patient Meal", "Extra Patient Meal"].includes(b.order_type)) {
    const diet = (
      await pool.query(
        `SELECT diet_type FROM patient_diets WHERE tenant_id=$1 AND admission_id=$2 AND active ORDER BY created_at DESC LIMIT 1`,
        [a.tenantId, b.admission_id],
      )
    ).rows[0];
    if (diet?.diet_type === "NPO / Nil by Mouth")
      return void res
        .status(409)
        .json({ error: "Patient is NPO. Meal ordering is blocked." });
    const allergy = String(x.allergies || "").toLowerCase(),
      conflicts = (m.allergens || []).filter((v: string) =>
        allergy.includes(String(v).toLowerCase()),
      );
    if (conflicts.length)
      return void res.status(409).json({
        error: `Meal blocked: conflicts with recorded allergy (${conflicts.join(", ")}).`,
      });
  }
  let billingClass = b.billing_class;
  if (x && m.package_eligible) {
    const rule = (
      await pool.query(
        `SELECT included FROM dietary_package_rules WHERE tenant_id=$1 AND active AND lower(package_name)=lower($2) AND lower(meal_type)=lower($3) AND lower(order_type)=lower($4) ORDER BY created_at DESC LIMIT 1`,
        [a.tenantId, x.room_type || "", m.meal_type, b.order_type],
      )
    ).rows[0];
    if (rule?.included) billingClass = "Included in Room Package";
  }
  if (
    a.role !== "hospital_admin" &&
    ["Complimentary", "Management Complimentary"].includes(billingClass)
  )
    return void res
      .status(403)
      .json({ error: "Complimentary meals require Hospital Admin approval" });
  if (
    ["Complimentary", "Management Complimentary"].includes(billingClass) &&
    !m.complimentary_eligible
  )
    return void res.status(409).json({
      error: "This menu item is not eligible for complimentary issue",
    });
  const duplicate = await pool.query(
    `SELECT id,order_number FROM dietary_orders WHERE tenant_id=$1 AND admission_id IS NOT DISTINCT FROM $2::uuid AND menu_id=$3 AND order_type=$4 AND created_at::date=current_date AND kitchen_status<>'Cancelled' LIMIT 1`,
    [a.tenantId, b.admission_id, m.id, b.order_type],
  );
  if (duplicate.rows[0])
    return void res.status(409).json({
      error: `Duplicate meal prevented (${duplicate.rows[0].order_number}).`,
    });
  const rate = Number(
      b.order_type.includes("Attendant")
        ? m.attendant_rate
        : b.order_type.includes("Guest")
          ? m.guest_rate
          : b.order_type.includes("Staff") || b.order_type.includes("Doctor")
            ? m.staff_rate
            : m.patient_rate,
    ),
    chargeable = ![
      "Complimentary",
      "Included in Room Package",
      "Included in Hospital Package",
      "Management Complimentary",
    ].includes(billingClass),
    amount = chargeable ? rate * b.quantity : 0,
    num = `FOOD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const q = await pool.query(
    `INSERT INTO dietary_orders(tenant_id,branch_id,admission_id,patient_id,menu_id,order_number,order_type,item_name,quantity,rate,amount,billing_class,remarks,timeline,ordered_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,jsonb_build_object('ordered_at',now()),$14)RETURNING *`,
    [
      a.tenantId,
      x?.branch_id || a.branchId,
      b.admission_id,
      x?.patient_id || null,
      b.menu_id,
      num,
      b.order_type,
      m.item_name,
      b.quantity,
      rate,
      amount,
      billingClass,
      b.remarks,
      a.sub,
    ],
  );
  await audit(
    a,
    "Food Ordered",
    "order",
    q.rows[0].id,
    null,
    q.rows[0],
    b.remarks,
  );
  res.status(201).json(q.rows[0]);
});
router.patch("/orders/:id/status", async (req: R, res) => {
  const b = z
      .object({
        status: z.enum([
          "Kitchen Accepted",
          "Preparing",
          "Ready",
          "Out for Delivery",
          "Delivered",
          "Cancelled",
        ]),
        remarks: z.string().default(""),
        received_by: z.string().trim().default(""),
      })
      .parse(req.body),
    a = req.user!,
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const old = (
      await c.query(
        `SELECT * FROM dietary_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, a.tenantId],
      )
    ).rows[0];
    if (!old) throw new Error("Order not found");
    if (
      a.role !== "hospital_admin" &&
      old.admission_id &&
      !(await admissionAccess(a, old.admission_id))
    )
      throw new Error("Order is outside your clinical assignment");
    const next: Record<string, string[]> = {
      "Order Placed": ["Kitchen Accepted", "Cancelled"],
      "Kitchen Accepted": ["Preparing", "Cancelled"],
      Preparing: ["Ready", "Cancelled"],
      Ready: ["Out for Delivery", "Cancelled"],
      "Out for Delivery": ["Delivered", "Cancelled"],
      Delivered: ["Cancelled"],
      Cancelled: [],
    };
    if (!next[old.kitchen_status]?.includes(b.status))
      throw new Error(
        `Invalid status change from ${old.kitchen_status} to ${b.status}`,
      );
    if (b.status === "Delivered" && !b.received_by)
      throw new Error("Received by is required to confirm delivery");
    if (b.status === "Cancelled" && !b.remarks)
      throw new Error("Cancellation or reversal reason is required");
    if (b.status === "Delivered" && old.admission_id) {
      const check = (
        await c.query(
          `SELECT p.allergies,d.diet_type,m.allergens FROM dietary_orders o JOIN ipd_admissions x ON x.id=o.admission_id JOIN patients p ON p.id=x.patient_id LEFT JOIN dietary_menu m ON m.id=o.menu_id LEFT JOIN LATERAL(SELECT diet_type FROM patient_diets WHERE admission_id=x.id AND active ORDER BY created_at DESC LIMIT 1)d ON true WHERE o.id=$1`,
          [old.id],
        )
      ).rows[0];
      if (check?.diet_type === "NPO / Nil by Mouth")
        throw new Error("Delivery blocked: patient is currently NPO");
      const allergy = String(check?.allergies || "").toLowerCase(),
        conflicts = (check?.allergens || []).filter((v: string) =>
          allergy.includes(String(v).toLowerCase()),
        );
      if (conflicts.length)
        throw new Error(
          `Delivery blocked: allergy conflict (${conflicts.join(", ")})`,
        );
    }
    const delivery =
      b.status === "Delivered"
        ? "Delivered"
        : b.status === "Cancelled"
          ? "Cancelled"
          : old.delivery_status;
    let q = await c.query(
      `UPDATE dietary_orders SET kitchen_status=$1,delivery_status=$2,received_by=CASE WHEN $1='Delivered' THEN $3 ELSE received_by END,delivered_by=CASE WHEN $1='Delivered' THEN $4 ELSE delivered_by END,accepted_by=CASE WHEN $1='Kitchen Accepted' THEN $4 ELSE accepted_by END,prepared_by=CASE WHEN $1='Ready' THEN $4 ELSE prepared_by END,remarks=CASE WHEN $5='' THEN remarks ELSE $5 END,timeline=timeline||jsonb_build_object(lower(replace($1,' ','_'))||'_at',now()),updated_at=now()WHERE id=$6 RETURNING *`,
      [b.status, delivery, b.received_by, a.sub, b.remarks, old.id],
    );
    if (
      b.status === "Delivered" &&
      !old.ledger_posted &&
      Number(old.amount) > 0 &&
      old.admission_id
    ) {
      await c.query(
        `UPDATE ipd_admissions SET charges=charges||jsonb_build_array(jsonb_build_object('source','Food & Dietary Charges','order_id',$1::text,'name',$2::text,'quantity',$3::numeric,'rate',$4::numeric,'amount',$5::numeric,'date',current_date)),total_amount=total_amount+$5::numeric,updated_at=now()WHERE id=$6 AND tenant_id=$7`,
        [
          old.id,
          old.item_name,
          old.quantity,
          old.rate,
          old.amount,
          old.admission_id,
          a.tenantId,
        ],
      );
      q = await c.query(
        `UPDATE dietary_orders SET ledger_posted=true WHERE id=$1 RETURNING *`,
        [old.id],
      );
    } else if (
      b.status === "Cancelled" &&
      old.ledger_posted &&
      Number(old.amount) > 0 &&
      old.admission_id
    ) {
      await c.query(
        `UPDATE ipd_admissions SET charges=(SELECT coalesce(jsonb_agg(v),'[]'::jsonb) FROM jsonb_array_elements(charges)v WHERE v->>'order_id'<>$1),total_amount=greatest(0,total_amount-$2::numeric),updated_at=now() WHERE id=$3 AND tenant_id=$4`,
        [old.id, old.amount, old.admission_id, a.tenantId],
      );
      q = await c.query(
        `UPDATE dietary_orders SET ledger_posted=false WHERE id=$1 RETURNING *`,
        [old.id],
      );
    }
    await c.query(
      `INSERT INTO dietary_audit(tenant_id,user_id,action,entity_type,entity_id,previous_value,new_value,remarks)VALUES($1,$2,$3,'order',$4,$5,$6,$7)`,
      [
        a.tenantId,
        a.sub,
        b.status === "Delivered"
          ? "Meal Delivered / Charge Posted"
          : b.status === "Cancelled" && old.ledger_posted
            ? "Charge Reversed"
            : "Order " + b.status,
        old.id,
        JSON.stringify(old),
        JSON.stringify(q.rows[0]),
        b.remarks,
      ],
    );
    await c.query("COMMIT");
    res.json(q.rows[0]);
  } catch (e) {
    await c.query("ROLLBACK");
    res
      .status(400)
      .json({ error: e instanceof Error ? e.message : "Unable to update" });
  } finally {
    c.release();
  }
});
router.post("/rules", async (req: R, res) => {
  const b = z
      .object({
        package_name: z.string().min(1),
        meal_type: z.string(),
        order_type: z.string(),
        included: z.boolean(),
      })
      .parse(req.body),
    a = req.user!;
  const q = await pool.query(
    `INSERT INTO dietary_package_rules(tenant_id,package_name,meal_type,order_type,included)VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,lower(package_name),lower(meal_type),lower(order_type)) WHERE active DO UPDATE SET included=excluded.included RETURNING *`,
    [a.tenantId, b.package_name, b.meal_type, b.order_type, b.included],
  );
  await audit(a, "Package Rule Saved", "rule", q.rows[0].id, null, q.rows[0]);
  res.status(201).json(q.rows[0]);
});

router.post("/schedules", async (req: R, res) => {
  const a = req.user!;
  if (a.role !== "hospital_admin")
    return void res
      .status(403)
      .json({ error: "Hospital Admin access required" });
  const b = z
    .object({
      meal_type: z.string().trim().min(2),
      service_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      generation_lead_minutes: z.coerce
        .number()
        .int()
        .min(0)
        .max(1440)
        .default(120),
      active: z.boolean().default(true),
    })
    .parse(req.body);
  const q = await pool.query(
    `INSERT INTO dietary_meal_schedules(tenant_id,meal_type,service_time,generation_lead_minutes,active)VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(tenant_id,meal_type)DO UPDATE SET service_time=excluded.service_time,generation_lead_minutes=excluded.generation_lead_minutes,active=excluded.active,updated_at=now() RETURNING *`,
    [
      a.tenantId,
      b.meal_type,
      b.service_time,
      b.generation_lead_minutes,
      b.active,
    ],
  );
  await audit(
    a,
    "Meal Schedule Saved",
    "schedule",
    q.rows[0].id,
    null,
    q.rows[0],
  );
  res.status(201).json(q.rows[0]);
});

router.post("/diets/:admissionId/confirm", async (req: R, res) => {
  const a = req.user!,
    admissionId = String(req.params.admissionId);
  if (!(await admissionAccess(a, admissionId)))
    return void res
      .status(403)
      .json({ error: "Patient is outside your clinical assignment" });
  if (!["hospital_admin", "nurse"].includes(a.role))
    return void res
      .status(403)
      .json({ error: "Nursing confirmation is required" });
  const q = await pool.query(
    `UPDATE patient_diets SET confirmed_by=$1,confirmed_at=now() WHERE id=(SELECT id FROM patient_diets WHERE tenant_id=$2 AND admission_id=$3 AND active ORDER BY created_at DESC LIMIT 1) RETURNING *`,
    [a.sub, a.tenantId, admissionId],
  );
  if (!q.rows[0])
    return void res.status(404).json({ error: "No active diet order found" });
  await audit(a, "Diet Confirmed", "diet", q.rows[0].id, null, q.rows[0]);
  res.json(q.rows[0]);
});

router.post("/holds", async (req: R, res) => {
  const a = req.user!,
    b = z
      .object({
        admission_id: z.string().uuid(),
        reason: z.string().trim().min(3),
      })
      .parse(req.body);
  if (!(await admissionAccess(a, b.admission_id)))
    return void res
      .status(403)
      .json({ error: "Patient is outside your clinical assignment" });
  const q = await pool.query(
    `INSERT INTO dietary_meal_holds(tenant_id,admission_id,reason,held_by)VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,admission_id)WHERE active DO UPDATE SET reason=excluded.reason,held_by=excluded.held_by,held_at=now() RETURNING *`,
    [a.tenantId, b.admission_id, b.reason, a.sub],
  );
  await pool.query(
    `UPDATE dietary_orders SET kitchen_status='Cancelled',delivery_status='Cancelled',remarks=concat_ws(' · ',nullif(remarks,''),$3),timeline=timeline||jsonb_build_object('cancelled_at',now()),updated_at=now() WHERE tenant_id=$1 AND admission_id=$2 AND order_type IN('Patient Meal','Extra Patient Meal') AND kitchen_status NOT IN('Delivered','Cancelled')`,
    [a.tenantId, b.admission_id, `Meals held: ${b.reason}`],
  );
  await audit(
    a,
    "Meals Stopped",
    "hold",
    q.rows[0].id,
    null,
    q.rows[0],
    b.reason,
  );
  res.status(201).json(q.rows[0]);
});

router.post("/holds/:admissionId/resume", async (req: R, res) => {
  const a = req.user!,
    id = String(req.params.admissionId);
  if (!(await admissionAccess(a, id)))
    return void res
      .status(403)
      .json({ error: "Patient is outside your clinical assignment" });
  const q = await pool.query(
    `UPDATE dietary_meal_holds SET active=false,resumed_by=$1,resumed_at=now() WHERE tenant_id=$2 AND admission_id=$3 AND active RETURNING *`,
    [a.sub, a.tenantId, id],
  );
  if (!q.rows[0])
    return void res.status(404).json({ error: "No active meal hold found" });
  await audit(a, "Meals Resumed", "hold", q.rows[0].id, null, q.rows[0]);
  res.json(q.rows[0]);
});

router.post("/generate", async (req: R, res) => {
  const a = req.user!;
  if (a.role !== "hospital_admin")
    return void res
      .status(403)
      .json({ error: "Hospital Admin access required" });
  const b = z
    .object({
      meal_type: z.string().trim().min(2),
      meal_date: z
        .string()
        .date()
        .default(() => new Date().toISOString().slice(0, 10)),
    })
    .parse(req.body);
  const candidates = await pool.query(
    `SELECT x.id admission_id,x.patient_id,x.branch_id,r.room_type,d.diet_type,m.id menu_id,m.item_name,m.patient_rate,m.package_eligible
    FROM ipd_admissions x JOIN patients p ON p.id=x.patient_id JOIN patient_diets d ON d.admission_id=x.id AND d.active AND d.confirmed_at IS NOT NULL LEFT JOIN rooms r ON r.id=x.room_id
    JOIN LATERAL(SELECT dm.* FROM dietary_menu dm WHERE dm.tenant_id=x.tenant_id AND dm.active AND dm.available AND lower(dm.meal_type)=lower($2) AND (lower(dm.category)=lower(d.diet_type) OR lower(dm.item_name)=lower(d.diet_type) OR NOT EXISTS(SELECT 1 FROM dietary_menu z WHERE z.tenant_id=x.tenant_id AND z.active AND z.available AND lower(z.meal_type)=lower($2) AND (lower(z.category)=lower(d.diet_type) OR lower(z.item_name)=lower(d.diet_type)))) ORDER BY CASE WHEN lower(dm.category)=lower(d.diet_type) OR lower(dm.item_name)=lower(d.diet_type) THEN 0 ELSE 1 END,dm.created_at LIMIT 1)m ON true
    WHERE x.tenant_id=$1 AND lower(trim(x.status))NOT IN('discharged','cancelled') AND d.diet_type<>'NPO / Nil by Mouth' AND NOT EXISTS(SELECT 1 FROM dietary_meal_holds h WHERE h.tenant_id=x.tenant_id AND h.admission_id=x.id AND h.active) AND NOT EXISTS(SELECT 1 FROM unnest(m.allergens) allergen WHERE position(lower(allergen) in lower(coalesce(p.allergies,'')))>0)`,
    [a.tenantId, b.meal_type],
  );
  let created = 0,
    duplicates = 0;
  for (const x of candidates.rows) {
    const rule = x.package_eligible
      ? (
          await pool.query(
            `SELECT included FROM dietary_package_rules WHERE tenant_id=$1 AND active AND lower(package_name)=lower($2) AND lower(meal_type)=lower($3) AND lower(order_type)='patient meal' LIMIT 1`,
            [a.tenantId, x.room_type || "", b.meal_type],
          )
        ).rows[0]
      : null;
    const included = Boolean(rule?.included),
      amount = included ? 0 : Number(x.patient_rate),
      num = `FOOD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const q = await pool.query(
      `INSERT INTO dietary_orders(tenant_id,branch_id,admission_id,patient_id,menu_id,order_number,order_type,item_name,quantity,rate,amount,billing_class,remarks,timeline,ordered_by,meal_date,meal_type,auto_generated)VALUES($1,$2,$3,$4,$5,$6,'Patient Meal',$7,1,$8,$9,$10,'Automatically generated',jsonb_build_object('ordered_at',now()),$11,$12,$13,true) ON CONFLICT DO NOTHING RETURNING id`,
      [
        a.tenantId,
        x.branch_id,
        x.admission_id,
        x.patient_id,
        x.menu_id,
        num,
        x.item_name,
        x.patient_rate,
        amount,
        included ? "Included in Room Package" : "Chargeable",
        a.sub,
        b.meal_date,
        b.meal_type,
      ],
    );
    if (q.rowCount) created++;
    else duplicates++;
  }
  await audit(
    a,
    "Meal List Generated",
    "generation",
    crypto.randomUUID(),
    null,
    { meal_type: b.meal_type, meal_date: b.meal_date, created, duplicates },
  );
  res.status(201).json({ created, duplicates, eligible: candidates.rowCount });
});
export default router;
