import {withPrintDoctorDetails} from './doctor-print-profile.js';
import {reconcileOpdPayments} from "./opd-accounting.js";
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
import { accessibleBranchIds, assertBranchAccess } from "./branch-access.js";
import { configuredPrefix, operationalSettings } from "./settings-runtime.js";
import { postInventoryMovement } from "./inventory-movement.js";
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
function ensure() {
  ready ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Multiple API instances can start together. Serializing this setup
      // avoids PostgreSQL catalogue races while CREATE TABLE IF NOT EXISTS runs.
      await client.query("SELECT pg_advisory_xact_lock($1)", [741_920_114]);
      await client.query(
        `CREATE TABLE IF NOT EXISTS finance_records(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          kind text NOT NULL,
          record_number text NOT NULL,
          patient_id uuid REFERENCES patients(id),
          invoice_id uuid REFERENCES finance_records(id) ON DELETE SET NULL,
          branch_id uuid REFERENCES branches(id),
          data jsonb NOT NULL DEFAULT '{}',
          amount numeric(14,2) NOT NULL DEFAULT 0,
          total numeric(14,2) NOT NULL DEFAULT 0,
          paid numeric(14,2) NOT NULL DEFAULT 0,
          due numeric(14,2) NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'Active',
          record_date date NOT NULL DEFAULT current_date,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      // Repair databases created by an earlier version of this module. CREATE
      // TABLE IF NOT EXISTS alone never adds newly introduced columns.
      await client.query(
        `ALTER TABLE finance_records
          ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id),
          ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES finance_records(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id),
          ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS amount numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS total numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS paid numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS due numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active',
          ADD COLUMN IF NOT EXISTS record_date date NOT NULL DEFAULT current_date,
          ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS finance_records_tenant_number_idx
         ON finance_records(tenant_id, record_number)`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS inventory_records(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          kind text NOT NULL,
          record_code text NOT NULL,
          branch_id uuid REFERENCES branches(id),
          supplier_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          category_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          item_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          data jsonb NOT NULL DEFAULT '{}',
          quantity numeric(14,2) NOT NULL DEFAULT 0,
          amount numeric(14,2) NOT NULL DEFAULT 0,
          status text NOT NULL DEFAULT 'Active',
          record_date date NOT NULL DEFAULT current_date,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      await client.query(
        `ALTER TABLE inventory_records
          ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id),
          ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES inventory_records(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS quantity numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS amount numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active',
          ADD COLUMN IF NOT EXISTS record_date date NOT NULL DEFAULT current_date,
          ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS inventory_records_tenant_code_idx
         ON inventory_records(tenant_id, record_code)`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS pharmacy_stock_adjustments(
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
          batch_id uuid NOT NULL REFERENCES inventory_records(id) ON DELETE CASCADE,
          branch_id uuid REFERENCES branches(id),
          adjustment_type text NOT NULL CHECK(adjustment_type IN ('Add','Remove','Set')),
          requested_quantity numeric(14,2) NOT NULL,
          quantity_before numeric(14,2) NOT NULL,
          quantity_after numeric(14,2) NOT NULL,
          reason text NOT NULL,
          created_by uuid REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS pharmacy_stock_adjustments_tenant_time_idx
         ON pharmacy_stock_adjustments(tenant_id, created_at DESC)`,
      );
      await client.query(`CREATE INDEX IF NOT EXISTS finance_period_read_idx ON finance_records(tenant_id,record_date DESC,created_at DESC);
        CREATE INDEX IF NOT EXISTS finance_kind_period_read_idx ON finance_records(tenant_id,kind,record_date DESC,created_at DESC);
        CREATE INDEX IF NOT EXISTS finance_prior_receipt_idx ON finance_records(tenant_id,invoice_id,created_at,id) WHERE kind='payments';`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })();
  return ready;
}
router.use(auth);
router.use(async (req: R, res, next) => {
  try {
    await ensure();
    const inv =
        req.path.startsWith("/inventory") || req.path.startsWith("/pharmacy") ||
        (req.path === "/lookups" && String(req.query.keys ?? "").split(",").every(key => ["items","categories","suppliers","branches"].includes(key))),
      code = inv
        ? req.method === "GET"
          ? "inventory.view"
          : "inventory.manage"
        : req.method === "GET"
          ? "billing.view"
          : req.path.includes("refund")
            ? "billing.refund"
            : req.method === "POST"
              ? "billing.create"
              : "billing.update";
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
  const tenantId = req.portalUser!.tenantId;
  const branchIds = await accessibleBranchIds(req.portalUser!);
  const sql: Record<string, string> = {
    patients: `SELECT id,medical_record_number,concat_ws(' ',first_name,last_name) name FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY first_name`,
    branches: `SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,
    users: `SELECT id,concat(first_name,' ',last_name)name FROM users WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2)) AND is_active=true ORDER BY first_name`,
    items: `SELECT x.id,x.record_code code,x.data->>'name' name,x.quantity stock,b.name branch_name FROM inventory_records x LEFT JOIN branches b ON b.id=x.branch_id WHERE x.tenant_id=$1 AND ($2::uuid[] IS NULL OR x.branch_id=ANY($2)) AND x.kind='items'`,
    suppliers: `SELECT id,record_code code,data->>'name'name FROM inventory_records WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($2)) AND kind='suppliers'`,
    categories: `SELECT id,record_code code,data->>'name'name FROM inventory_records WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($2)) AND kind='categories'`,
    invoices: `SELECT id,record_number code,total,due FROM finance_records WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2)) AND kind='invoices' ORDER BY created_at DESC`,
  };
  const requested = String(req.query.keys ?? Object.keys(sql).join(","))
    .split(",")
    .filter((key) => key in sql);
  const results = await Promise.all(
    requested.map(async (key) => [
      key,
      (await pool.query(sql[key]!, key==='patients'?[tenantId]:[tenantId, branchIds])).rows,
    ]),
  );
  const runtime = await operationalSettings(tenantId);
  res.json({
    ...Object.fromEntries(results),
    payment_methods: runtime.payment_methods,
    general_settings: runtime.general,
  });
});
const kinds = [
  "invoices",
  "payments",
  "refunds",
  "expenses",
  "items",
  "categories",
  "suppliers",
  "purchase-orders",
  "purchases",
  "stock-transfers",
  "assets",
] as const;
const body = z.object({
  id: z.string().uuid().optional(),
  branch_id: z.string().prefault(""),
  patient_id: z.string().prefault(""),
  invoice_id: z.string().prefault(""),
  supplier_id: z.string().prefault(""),
  category_id: z.string().prefault(""),
  item_id: z.string().prefault(""),
  record_date: z.string().prefault(""),
  status: z.string().prefault("Active"),
  amount: z.coerce.number().prefault(0),
  total: z.coerce.number().prefault(0),
  paid: z.coerce.number().prefault(0),
  due: z.coerce.number().prefault(0),
  quantity: z.coerce.number().prefault(0),
  data: z.record(z.string(), z.unknown()).prefault({}),
});
const pharmacyPurchaseBody = z.object({
  supplier_id: z.string().uuid(),
  branch_id: z.string().prefault(""),
  invoice_number: z.string().min(1),
  purchase_date: z.string().min(1),
  payment_status: z.string().prefault("Unpaid"),
  notes: z.string().prefault(""),
  items: z
    .array(
      z.object({
        medicine_id: z.string().uuid(),
        batch_number: z.string().min(1),
        manufacturing_date: z.string().prefault(""),
        expiry_date: z.string().min(1).transform((value) => value.length === 7
          ? `${value}-${String(new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7)),0)).getUTCDate()).padStart(2,"0")}`
          : value),
        quantity: z.coerce.number().positive(),
        free_quantity: z.coerce.number().min(0).prefault(0),
        purchase_rate: z.coerce.number().min(0),
        mrp: z.coerce.number().min(0),
        gst_percent: z.coerce.number().min(0).prefault(0),
        discount_percent: z.coerce.number().min(0).prefault(0),
      }),
    )
    .min(1),
});
const pharmacySupplierBody = z.object({
  name: z.string().trim().min(2),
  contact_person: z.string().trim().prefault(""),
  phone: z.string().trim().prefault(""),
  email: z.string().trim().prefault(""),
  drug_license_number: z.string().trim().prefault(""),
  gstin: z.string().trim().prefault(""),
  address: z.string().trim().prefault(""),
  status: z.enum(["Active", "Inactive"]).prefault("Active"),
  notes: z.string().trim().prefault(""),
});

router.get("/pharmacy/suppliers", async (req: R, res) => {
  const t = req.portalUser!.tenantId;
  const result = await pool.query(
    `SELECT id,name,data,created_at,updated_at FROM hospital_pharmacy_masters WHERE tenant_id=$1 AND kind='supplier' ORDER BY name`,
    [t],
  );
  res.json(result.rows);
});
router.post("/pharmacy/suppliers", async (req: R, res) => {
  const b = pharmacySupplierBody.parse(req.body),
    t = req.portalUser!.tenantId;
  const data = {
    contact_person: b.contact_person,
    contact_person_name: b.contact_person,
    phone: b.phone,
    supplier_contact: b.phone,
    contact_person_phone: b.phone,
    email: b.email,
    drug_license_number: b.drug_license_number,
    gstin: b.gstin,
    address: b.address,
    status: b.status,
    notes: b.notes,
  };
  const result = await pool.query(
    `INSERT INTO hospital_pharmacy_masters(tenant_id,kind,name,data) VALUES($1,'supplier',$2,$3) RETURNING *`,
    [t, b.name, data],
  );
  res.status(201).json(result.rows[0]);
});
router.put("/pharmacy/suppliers/:id", async (req: R, res) => {
  const b = pharmacySupplierBody.parse(req.body),
    t = req.portalUser!.tenantId;
  const data = {
    contact_person: b.contact_person,
    contact_person_name: b.contact_person,
    phone: b.phone,
    supplier_contact: b.phone,
    contact_person_phone: b.phone,
    email: b.email,
    drug_license_number: b.drug_license_number,
    gstin: b.gstin,
    address: b.address,
    status: b.status,
    notes: b.notes,
  };
  const result = await pool.query(
    `UPDATE hospital_pharmacy_masters SET name=$1,data=$2,updated_at=now() WHERE id=$3 AND tenant_id=$4 AND kind='supplier' RETURNING *`,
    [b.name, data, req.params.id, t],
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "Supplier not found" });
    return;
  }
  res.json(result.rows[0]);
});
router.delete("/pharmacy/suppliers/:id", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    id = req.params.id;
  const used = await pool.query(
    `SELECT 1 FROM inventory_records WHERE tenant_id=$1 AND kind IN ('pharmacy-purchase','pharmacy-batch') AND data->>'supplier_id'=$2 LIMIT 1`,
    [t, id],
  );
  if (used.rowCount) {
    res
      .status(409)
      .json({
        error:
          "Supplier has purchase or batch history. Set it inactive instead of deleting it.",
      });
    return;
  }
  const result = await pool.query(
    `DELETE FROM hospital_pharmacy_masters WHERE id=$1 AND tenant_id=$2 AND kind='supplier' RETURNING id`,
    [id, t],
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "Supplier not found" });
    return;
  }
  res.status(204).end();
});

router.get("/pharmacy/lookups", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const [medicines, suppliers, branches] = await Promise.all([
    pool.query(
      `SELECT id,name,data FROM hospital_pharmacy_masters WHERE tenant_id=$1 AND kind='medicine' ORDER BY name`,
      [t],
    ),
    pool.query(
      `SELECT id,name,data FROM hospital_pharmacy_masters WHERE tenant_id=$1 AND kind='supplier' ORDER BY name`,
      [t],
    ),
    pool.query(
      `SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,
      [t, branchIds],
    ),
  ]);
  res.json({
    medicines: medicines.rows,
    suppliers: suppliers.rows,
    branches: branches.rows,
  });
});

router.get("/pharmacy/purchases", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const result = await pool.query(
    `SELECT p.*,s.name supplier_name,b.name branch_name,
    (SELECT count(*)::int FROM inventory_records x WHERE x.tenant_id=p.tenant_id AND x.kind='pharmacy-batch' AND x.data->>'purchase_id'=p.id::text) item_count
    FROM inventory_records p LEFT JOIN hospital_pharmacy_masters s ON s.id=(p.data->>'supplier_id')::uuid
    LEFT JOIN branches b ON b.id=p.branch_id WHERE p.tenant_id=$1 AND p.kind='pharmacy-purchase'
    AND ($2::uuid[] IS NULL OR p.branch_id IS NULL OR p.branch_id=ANY($2)) ORDER BY p.record_date DESC,p.created_at DESC`,
    [t, branchIds],
  );
  res.json(result.rows);
});
router.get("/pharmacy/purchases/:id", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const purchase = await pool.query(
    `SELECT p.*,s.name supplier_name FROM inventory_records p LEFT JOIN hospital_pharmacy_masters s ON s.id=(p.data->>'supplier_id')::uuid WHERE p.id=$1 AND p.tenant_id=$2 AND p.kind='pharmacy-purchase' AND ($3::uuid[] IS NULL OR p.branch_id IS NULL OR p.branch_id=ANY($3))`,
    [req.params.id, t, branchIds],
  );
  if (!purchase.rowCount) {
    res.status(404).json({ error: "Purchase not found" });
    return;
  }
  const items = await pool.query(
    `SELECT id,data,quantity FROM inventory_records WHERE tenant_id=$1 AND kind='pharmacy-batch' AND data->>'purchase_id'=$2 ORDER BY record_code`,
    [t, req.params.id],
  );
  res.json({
    ...purchase.rows[0],
    items: items.rows.map((x) => ({
      ...x.data,
      id: x.id,
      quantity: Number(x.data.purchased_quantity || 0),
      free_quantity: Number(x.data.free_quantity || 0),
      current_quantity: Number(x.quantity),
    })),
  });
});

router.get("/pharmacy/batches", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const result = await pool.query(
    `SELECT x.*,m.name medicine_name,m.data medicine_data,s.name supplier_name,b.name branch_name,
    CASE WHEN (x.data->>'expiry_date')::date<current_date THEN 'Expired'
         WHEN (x.data->>'expiry_date')::date<=current_date+interval '90 days' THEN 'Expiring Soon'
         WHEN x.quantity<=0 THEN 'Out of Stock' ELSE 'Available' END batch_status
    FROM inventory_records x JOIN hospital_pharmacy_masters m ON m.id=(x.data->>'medicine_id')::uuid
    LEFT JOIN hospital_pharmacy_masters s ON s.id=(x.data->>'supplier_id')::uuid LEFT JOIN branches b ON b.id=x.branch_id
    WHERE x.tenant_id=$1 AND x.kind='pharmacy-batch' AND ($2::uuid[] IS NULL OR x.branch_id IS NULL OR x.branch_id=ANY($2))
    ORDER BY (x.data->>'expiry_date')::date,m.name`,
    [t, branchIds],
  );
  res.json(result.rows);
});

router.get("/pharmacy/summary", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const result = await pool.query(
    `SELECT count(*) FILTER(WHERE quantity>0)::int active_batches,
    count(DISTINCT data->>'medicine_id') FILTER(WHERE quantity>0)::int medicines,
    coalesce(sum(quantity),0) units,coalesce(sum(quantity*coalesce((data->>'purchase_rate')::numeric,0)),0) stock_value,
    count(*) FILTER(WHERE quantity>0 AND (data->>'expiry_date')::date<=current_date+interval '90 days' AND (data->>'expiry_date')::date>=current_date)::int expiring,
    count(*) FILTER(WHERE quantity>0 AND (data->>'expiry_date')::date<current_date)::int expired,
    count(DISTINCT data->>'medicine_id') FILTER(WHERE quantity<=coalesce((data->>'reorder_level')::numeric,10))::int low_stock
    FROM inventory_records WHERE tenant_id=$1 AND kind='pharmacy-batch' AND ($2::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($2))`,
    [t, branchIds],
  );
  res.json(result.rows[0]);
});

router.get("/pharmacy/adjustments", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const result = await pool.query(
    `SELECT a.*,x.record_code,x.data->>'batch_number' batch_number,m.name medicine_name,
    concat_ws(' ',u.first_name,u.last_name) adjusted_by,b.name branch_name
    FROM pharmacy_stock_adjustments a JOIN inventory_records x ON x.id=a.batch_id
    LEFT JOIN hospital_pharmacy_masters m ON m.id=(x.data->>'medicine_id')::uuid
    LEFT JOIN users u ON u.id=a.created_by LEFT JOIN branches b ON b.id=a.branch_id
    WHERE a.tenant_id=$1 AND ($2::uuid[] IS NULL OR a.branch_id IS NULL OR a.branch_id=ANY($2))
    ORDER BY a.created_at DESC LIMIT 500`,
    [t, branchIds],
  );
  res.json(result.rows);
});

router.get("/pharmacy/prescriptions", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const result = await pool.query(
    `SELECT w.*,concat(p.first_name,' ',p.last_name) patient_name,p.medical_record_number,
    concat(u.first_name,' ',u.last_name) doctor_name,f.record_number bill_number,f.total bill_total
    FROM role_work_items w JOIN patients p ON p.id=w.patient_id LEFT JOIN users u ON u.id=w.created_by
    LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid
    WHERE w.tenant_id=$1 AND w.workspace='pharmacy' AND w.kind='prescription'
      AND ($2::uuid[] IS NULL OR w.branch_id IS NULL OR w.branch_id=ANY($2)) ORDER BY w.occurred_at DESC`,
    [t, branchIds],
  );
  res.json(result.rows);
});

router.patch("/pharmacy/prescriptions/:id/cancel", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const result = await pool.query(
    `UPDATE role_work_items SET status='Cancelled',data=data||jsonb_build_object('cancelled_by',$1::text,'cancelled_at',now()),updated_at=now()
    WHERE id=$2 AND tenant_id=$3 AND workspace='pharmacy' AND kind='prescription' AND status='Pending'
      AND ($4::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($4)) RETURNING *`,
    [req.portalUser!.sub, req.params.id, t, branchIds],
  );
  if (!result.rowCount) {
    res
      .status(409)
      .json({ error: "Only pending prescriptions can be cancelled" });
    return;
  }
  res.json(result.rows[0]);
});

router.post("/pharmacy/prescriptions/:id/bill", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!),
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const queued = await c.query(
      `SELECT * FROM role_work_items WHERE id=$1 AND tenant_id=$2 AND workspace='pharmacy' AND kind='prescription'
      AND ($3::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($3)) FOR UPDATE`,
      [req.params.id, t, branchIds],
    );
    const row = queued.rows[0];
    if (!row) {
      await c.query("ROLLBACK");
      res.status(404).json({ error: "Prescription not found" });
      return;
    }
    if (row.status !== "Pending") {
      await c.query("ROLLBACK");
      res
        .status(409)
        .json({
          error: "Only pending prescriptions can be converted to a bill",
        });
      return;
    }
    const medicines = Array.isArray(row.data.medicines)
        ? row.data.medicines
        : [],
      names = medicines.map((x: Record<string, unknown>) =>
        String(x.name || "").toLowerCase(),
      );
    const rates = names.length
      ? await c.query(
          `SELECT m.id medicine_id,lower(m.name) medicine_name,coalesce(max((x.data->>'mrp')::numeric),0) rate
      FROM hospital_pharmacy_masters m LEFT JOIN inventory_records x ON x.tenant_id=m.tenant_id AND x.kind='pharmacy-batch' AND x.data->>'medicine_id'=m.id::text
      WHERE m.tenant_id=$1 AND m.kind='medicine' AND lower(m.name)=ANY($2::text[]) GROUP BY m.id,lower(m.name)`,
          [t, names],
        )
      : { rows: [] };
    const rateMap = new Map<string, number>();
    for (const x of rates.rows) {
      rateMap.set(String(x.medicine_id), Number(x.rate));
      rateMap.set(x.medicine_name, Number(x.rate));
    }
    const items = medicines.map((x: Record<string, unknown>) => {
        const quantity = Math.max(1, Number(x.quantity) || 1),
          rate =
            rateMap.get(String(x.medicine_id || "")) ??
            rateMap.get(String(x.name || "").toLowerCase()) ??
            0;
        return {
          ...x,
          quantity,
          rate,
          discount_percent: 0,
          amount: quantity * rate,
        };
      }),
      total = items.reduce(
        (sum: number, x: Record<string, unknown>) =>
          sum + Number(x.amount || 0),
        0,
      );
    const prefix = await configuredPrefix(t, "pharmacy_bill_prefix", "PHAB"),
      next = await c.query(
        `SELECT count(*)::int+1 n FROM finance_records WHERE tenant_id=$1 AND kind='pharmacy-bill'`,
        [t],
      ),
      number = `${prefix}-${String(next.rows[0].n).padStart(6, "0")}`;
    const bill = await c.query(
      `INSERT INTO finance_records(tenant_id,kind,record_number,patient_id,branch_id,data,total,due,status,record_date,created_by)
      VALUES($1,'pharmacy-bill',$2,$3,$4,$5,$6,$6,'Draft',current_date,$7) RETURNING *`,
      [
        t,
        number,
        row.patient_id,
        row.branch_id,
        {
          prescription_id: row.id,
          appointment_id: row.data.appointment_id,
          admission_id: row.data.admission_id,
          care_type: row.data.admission_id ? "IPD" : "OPD",
          doctor_id: row.data.doctor_id,
          items,
        },
        total,
        req.portalUser!.sub,
      ],
    );
    await c.query(
      `UPDATE role_work_items SET status='At POS',data=data||jsonb_build_object('bill_id',$1::text,'accepted_at',now(),'accepted_by',$2::text),updated_at=now() WHERE id=$3`,
      [bill.rows[0].id, req.portalUser!.sub, row.id],
    );
    await c.query("COMMIT");
    res.status(201).json(bill.rows[0]);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});

router.get("/pharmacy/pos", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const [bills, medicines] = await Promise.all([
    pool.query(
      `SELECT f.*,coalesce(nullif(concat_ws(' ',p.first_name,p.last_name),''),f.data->>'customer_name','Walk-in Customer') patient_name,p.medical_record_number,
      CASE WHEN upper(coalesce(f.data->>'care_type',''))='IPD' OR f.data ? 'admission_id' THEN 'IPD' ELSE 'OPD' END patient_type
      FROM finance_records f LEFT JOIN patients p ON p.id=f.patient_id WHERE f.tenant_id=$1 AND f.kind='pharmacy-bill'
      AND ($2::uuid[] IS NULL OR f.branch_id IS NULL OR f.branch_id=ANY($2)) ORDER BY f.created_at DESC`,
      [t, branchIds],
    ),
    pool.query(
      `SELECT m.id,m.name,m.data,coalesce(max((x.data->>'mrp')::numeric),0) price
      FROM hospital_pharmacy_masters m LEFT JOIN inventory_records x ON x.tenant_id=m.tenant_id AND x.kind='pharmacy-batch' AND x.data->>'medicine_id'=m.id::text
      WHERE m.tenant_id=$1 AND m.kind='medicine' GROUP BY m.id,m.name,m.data ORDER BY m.name`,
      [t],
    ),
  ]);
  res.json({ bills: bills.rows, medicines: medicines.rows });
});

router.get("/pharmacy/pos/print-template", async (req: R, res) => {
  const result = await pool.query(
    `SELECT header_image,footer_content FROM hospital_print_templates WHERE tenant_id=$1 AND document_type='pharmacy-bill'`,
    [req.portalUser!.tenantId],
  );
  res.json(result.rows[0] ?? { header_image: "", footer_content: "" });
});

router.post("/pharmacy/medicines", async (req: R, res) => {
  const body = z.object({name:z.string().trim().min(1),hsn_code:z.string().trim().prefault(""),tax:z.coerce.number().min(0).max(100).prefault(0),packing_type:z.string().trim().prefault("Box"),units_per_strip:z.coerce.number().positive().optional(),volume_ml:z.coerce.number().nonnegative().optional()}).parse(req.body);
  const data={hsn_code:body.hsn_code,tax:body.tax,packing_type:body.packing_type,units_per_strip:body.units_per_strip,volume_ml:body.volume_ml};
  const result=await pool.query(`INSERT INTO hospital_pharmacy_masters(tenant_id,kind,name,data) VALUES($1,'medicine',$2,$3) RETURNING id,name,data,0::numeric price`,[req.portalUser!.tenantId,body.name,data]);
  res.status(201).json(result.rows[0]);
});

const pharmacyBillBody=z.object({action:z.enum(["save","generate","reject"]),customer_name:z.string().trim().prefault("Walk-in Customer"),discount_percent:z.coerce.number().min(0).max(100).prefault(0),items:z.array(z.object({medicine_id:z.string().prefault(""),name:z.string().trim().min(1),type:z.string().prefault(""),hsn_code:z.string().prefault(""),gst_percent:z.coerce.number().min(0).max(100).prefault(0),dose:z.string().prefault(""),quantity:z.coerce.number().positive(),rate:z.coerce.number().min(0),instruction:z.string().prefault("")})).min(1)});

router.post("/pharmacy/pos",async(req:R,res)=>{
  const body=pharmacyBillBody.parse(req.body),t=req.portalUser!.tenantId;
  const subtotal=body.items.reduce((n,x)=>n+x.quantity*x.rate,0),discount=subtotal*body.discount_percent/100,tax=body.items.reduce((n,x)=>n+x.quantity*x.rate*(1-body.discount_percent/100)*x.gst_percent/100,0),total=subtotal-discount+tax;
  const prefix=await configuredPrefix(t,"pharmacy_bill_prefix","PHAB"),next=await pool.query(`SELECT count(*)::int+1 n FROM finance_records WHERE tenant_id=$1 AND kind='pharmacy-bill'`,[t]),number=`${prefix}-${String(next.rows[0].n).padStart(6,"0")}`,status=body.action==="generate"?"Bill Generated":"Draft";
  const data={customer_name:body.customer_name,care_type:"WALK-IN",subtotal,discount,discount_percent:body.discount_percent,tax,items:body.items.map(x=>({...x,amount:x.quantity*x.rate}))};
  const result=await pool.query(`INSERT INTO finance_records(tenant_id,kind,record_number,branch_id,data,total,due,status,record_date,created_by) VALUES($1,'pharmacy-bill',$2,$3,$4,$5,$5,$6,current_date,$7) RETURNING *`,[t,number,req.portalUser!.branchId||null,data,total,status,req.portalUser!.sub]);
  res.status(201).json(result.rows[0]);
});

router.put("/pharmacy/pos/:id", async (req: R, res) => {
  const body = pharmacyBillBody.parse(req.body),
    t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!);
  const subtotal = body.items.reduce((n, x) => n + x.quantity * x.rate, 0),
    discount = (subtotal * body.discount_percent) / 100,
    tax=body.items.reduce((n,x)=>n+x.quantity*x.rate*(1-body.discount_percent/100)*x.gst_percent/100,0),
    total = subtotal - discount + tax,
    status =
      body.action === "generate"
        ? "Bill Generated"
        : body.action === "reject"
          ? "Rejected"
          : "Draft",
    data = {
      subtotal,
      discount,
      discount_percent: body.discount_percent,
      tax,
      items: body.items.map((x) => ({ ...x, amount: x.quantity * x.rate })),
    };
  const result = await pool.query(
    `UPDATE finance_records SET data=data||$1::jsonb,total=$2,due=CASE WHEN $3='Bill Generated' THEN $2 ELSE due END,status=$3,updated_at=now()
    WHERE id=$4 AND tenant_id=$5 AND kind='pharmacy-bill' AND ($6::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($6)) RETURNING *`,
    [data, total, status, req.params.id, t, branchIds],
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "Pharmacy bill not found" });
    return;
  }
  const bill = result.rows[0];
  if (body.action !== "save" && bill.data?.prescription_id)
    await pool.query(
      `UPDATE role_work_items SET status=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3`,
      [status, bill.data.prescription_id, t],
    );
  res.json(bill);
});

router.get("/pharmacy/forecast", async (req: R, res) => {
  const params = z
    .object({
      lookback_days: z.coerce.number().int().min(7).max(365).prefault(30),
      horizon_days: z.coerce.number().int().min(7).max(180).prefault(30),
      branch_id: z.string().uuid().optional(),
    })
    .parse(req.query);
  const t = req.portalUser!.tenantId,
    allowedBranches = await accessibleBranchIds(req.portalUser!);
  if (params.branch_id)
    await assertBranchAccess(req.portalUser!, params.branch_id);
  const selectedBranches = params.branch_id
    ? [params.branch_id]
    : allowedBranches;
  const [stock, movements, trend, branches] = await Promise.all([
    pool.query(
      `SELECT m.id medicine_id,m.name medicine_name,m.data medicine_data,
      coalesce(sum(x.quantity),0) current_stock,
      coalesce(sum((x.data->>'purchased_quantity')::numeric+coalesce((x.data->>'free_quantity')::numeric,0)),0) received_stock,
      coalesce(sum(x.quantity*coalesce((x.data->>'purchase_rate')::numeric,0)),0) stock_value,
      coalesce(sum(x.quantity) FILTER(WHERE (x.data->>'expiry_date')::date<current_date),0) expired_stock,
      coalesce(sum(x.quantity) FILTER(WHERE (x.data->>'expiry_date')::date BETWEEN current_date AND current_date+$3::int),0) expiring_stock,
      min((x.data->>'expiry_date')::date) FILTER(WHERE x.quantity>0) next_expiry,
      coalesce(max((x.data->>'reorder_level')::numeric),nullif(m.data->>'reorder_level','')::numeric,nullif(m.data->>'min_level','')::numeric,10) reorder_level
      FROM hospital_pharmacy_masters m LEFT JOIN inventory_records x ON x.tenant_id=m.tenant_id AND x.kind='pharmacy-batch'
        AND x.data->>'medicine_id'=m.id::text AND ($2::uuid[] IS NULL OR x.branch_id IS NULL OR x.branch_id=ANY($2))
      WHERE m.tenant_id=$1 AND m.kind='medicine' GROUP BY m.id,m.name,m.data ORDER BY m.name`,
      [t, selectedBranches, params.horizon_days],
    ),
    pool.query(
      `SELECT x.data->>'medicine_id' medicine_id,
      coalesce(sum(greatest(a.quantity_before-a.quantity_after,0)) FILTER(WHERE a.adjustment_type='Remove'),0) removed,
      coalesce(sum(greatest(a.quantity_after-a.quantity_before,0)) FILTER(WHERE a.adjustment_type='Add'),0) added,
      count(*) FILTER(WHERE a.adjustment_type='Remove')::int removal_events
      FROM pharmacy_stock_adjustments a JOIN inventory_records x ON x.id=a.batch_id
      WHERE a.tenant_id=$1 AND a.created_at>=now()-($3::int*interval '1 day')
        AND ($2::uuid[] IS NULL OR a.branch_id IS NULL OR a.branch_id=ANY($2)) GROUP BY x.data->>'medicine_id'`,
      [t, selectedBranches, params.lookback_days],
    ),
    pool.query(
      `SELECT d::date AS movement_date,coalesce(sum(greatest(a.quantity_before-a.quantity_after,0)) FILTER(WHERE a.adjustment_type='Remove'),0) removed
      FROM generate_series(current_date-13,current_date,interval '1 day') d LEFT JOIN pharmacy_stock_adjustments a
        ON a.tenant_id=$1 AND a.created_at::date=d::date AND ($2::uuid[] IS NULL OR a.branch_id IS NULL OR a.branch_id=ANY($2))
      GROUP BY d ORDER BY d`,
      [t, selectedBranches],
    ),
    pool.query(
      `SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,
      [t, allowedBranches],
    ),
  ]);
  const movementByMedicine = new Map(
    movements.rows.map((x) => [x.medicine_id, x]),
  );
  const items = stock.rows.map((row) => {
    const movement = movementByMedicine.get(row.medicine_id) || {},
      current = Number(row.current_stock),
      removed = Number(movement.removed || 0),
      daily = removed / params.lookback_days,
      reorder = Number(row.reorder_level || 10),
      forecastDemand = daily * params.horizon_days,
      projected = Math.max(0, current - forecastDemand),
      daysCover = daily > 0 ? current / daily : null,
      suggested = Math.max(0, Math.ceil(forecastDemand + reorder - current)),
      expired = Number(row.expired_stock),
      expiring = Number(row.expiring_stock);
    let status = "Healthy";
    if (expired > 0) status = "Expired stock";
    else if (current <= reorder) status = "Reorder now";
    else if (daysCover !== null && daysCover <= params.horizon_days)
      status = "Reorder soon";
    else if (expiring > 0) status = "Expiry risk";
    else if (!removed) status = "No usage data";
    return {
      ...row,
      current_stock: current,
      received_stock: Number(row.received_stock),
      stock_value: Number(row.stock_value),
      expired_stock: expired,
      expiring_stock: expiring,
      reorder_level: reorder,
      removed_units: removed,
      added_units: Number(movement.added || 0),
      removal_events: Number(movement.removal_events || 0),
      average_daily_usage: daily,
      forecast_demand: forecastDemand,
      projected_stock: projected,
      days_cover: daysCover,
      suggested_order: suggested,
      status,
    };
  });
  const summary = {
    medicines: items.length,
    current_units: items.reduce((n, x) => n + x.current_stock, 0),
    stock_value: items.reduce((n, x) => n + x.stock_value, 0),
    forecast_demand: items.reduce((n, x) => n + x.forecast_demand, 0),
    suggested_order: items.reduce((n, x) => n + x.suggested_order, 0),
    reorder_items: items.filter(
      (x) => x.status === "Reorder now" || x.status === "Reorder soon",
    ).length,
    expiry_risk_items: items.filter(
      (x) => x.expired_stock > 0 || x.expiring_stock > 0,
    ).length,
  };
  res.json({
    generated_at: new Date().toISOString(),
    lookback_days: params.lookback_days,
    horizon_days: params.horizon_days,
    summary,
    items,
    trend: trend.rows.map((x) => ({
      day: x.movement_date,
      removed: Number(x.removed),
    })),
    branches: branches.rows,
  });
});

router.post("/pharmacy/purchases", async (req: R, res) => {
  const b = pharmacyPurchaseBody.parse(req.body),
    t = req.portalUser!.tenantId,
    c = await pool.connect();
  const purchaseBranchId = b.branch_id || req.portalUser!.branchId || "";
  if (purchaseBranchId)
    await assertBranchAccess(req.portalUser!, purchaseBranchId);
  try {
    await c.query("BEGIN");
    const valid = await c.query(
      `SELECT count(*)::int n FROM hospital_pharmacy_masters WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,
      [t, [b.supplier_id, ...b.items.map((x) => x.medicine_id)]],
    );
    if (valid.rows[0].n !== b.items.length + 1)
      throw new Error("One or more medicines or the supplier are invalid");
    const next = await c.query(
      `SELECT count(*)::int+1 n FROM inventory_records WHERE tenant_id=$1 AND kind='pharmacy-purchase'`,
      [t],
    );
    const prefix = await configuredPrefix(
        t,
        "pharmacy_purchase_prefix",
        "PHPN",
      ),
      code = `${prefix}-${String(next.rows[0].n).padStart(6, "0")}`;
    const subtotal = b.items.reduce(
      (n, x) =>
        n + x.quantity * x.purchase_rate * (1 - x.discount_percent / 100),
      0,
    );
    const total = b.items.reduce(
      (n, x) =>
        n +
        x.quantity *
          x.purchase_rate *
          (1 - x.discount_percent / 100) *
          (1 + x.gst_percent / 100),
      0,
    );
    const purchase = await c.query(
      `INSERT INTO inventory_records(tenant_id,kind,record_code,branch_id,data,amount,status,record_date,created_by)
      VALUES($1,'pharmacy-purchase',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        t,
        code,
        purchaseBranchId || null,
        {
          supplier_id: b.supplier_id,
          invoice_number: b.invoice_number,
          payment_status: b.payment_status,
          notes: b.notes,
          subtotal,
          tax: total - subtotal,
        },
        total,
        b.payment_status,
        b.purchase_date,
        req.portalUser!.sub,
      ],
    );
    for (let i = 0; i < b.items.length; i++) {
      const x = b.items[i]!,
        qty = x.quantity + x.free_quantity;
      await c.query(
        `INSERT INTO inventory_records(tenant_id,kind,record_code,branch_id,data,quantity,amount,status,record_date,created_by)
        VALUES($1,'pharmacy-batch',$2,$3,$4,$5,$6,'Available',$7,$8)`,
        [
          t,
          `${code}-B${String(i + 1).padStart(2, "0")}`,
          purchaseBranchId || null,
          {
            purchase_id: purchase.rows[0].id,
            supplier_id: b.supplier_id,
            medicine_id: x.medicine_id,
            batch_number: x.batch_number,
            manufacturing_date: x.manufacturing_date,
            expiry_date: x.expiry_date,
            purchased_quantity: x.quantity,
            free_quantity: x.free_quantity,
            purchase_rate: x.purchase_rate,
            mrp: x.mrp,
            gst_percent: x.gst_percent,
            discount_percent: x.discount_percent,
            reorder_level: 10,
          },
          qty,
          x.quantity * x.purchase_rate,
          b.purchase_date,
          req.portalUser!.sub,
        ],
      );
    }
    await c.query("COMMIT");
    res.status(201).json(purchase.rows[0]);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});

router.put("/pharmacy/purchases/:id", async (req: R, res) => {
  const b = pharmacyPurchaseBody.parse(req.body),
    t = req.portalUser!.tenantId,
    c = await pool.connect(),
    purchaseBranchId = b.branch_id || req.portalUser!.branchId || "";
  if (purchaseBranchId)
    await assertBranchAccess(req.portalUser!, purchaseBranchId);
  try {
    await c.query("BEGIN");
    const purchase = await c.query(
      `SELECT * FROM inventory_records WHERE id=$1 AND tenant_id=$2 AND kind='pharmacy-purchase' FOR UPDATE`,
      [req.params.id, t],
    );
    if (!purchase.rowCount) {
      await c.query("ROLLBACK");
      res.status(404).json({ error: "Purchase not found" });
      return;
    }
    const existing = await c.query(
      `SELECT * FROM inventory_records WHERE tenant_id=$1 AND kind='pharmacy-batch' AND data->>'purchase_id'=$2 FOR UPDATE`,
      [t, req.params.id],
    );
    if (
      existing.rows.some(
        (x) =>
          Number(x.quantity) !==
          Number(x.data.purchased_quantity || 0) +
            Number(x.data.free_quantity || 0),
      )
    ) {
      await c.query("ROLLBACK");
      res
        .status(409)
        .json({
          error:
            "This purchase cannot be edited because its stock was adjusted or consumed.",
        });
      return;
    }
    const valid = await c.query(
      `SELECT count(*)::int n FROM hospital_pharmacy_masters WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,
      [t, [b.supplier_id, ...b.items.map((x) => x.medicine_id)]],
    );
    if (valid.rows[0].n !== b.items.length + 1)
      throw new Error("One or more medicines or the supplier are invalid");
    const subtotal = b.items.reduce(
        (n, x) =>
          n + x.quantity * x.purchase_rate * (1 - x.discount_percent / 100),
        0,
      ),
      total = b.items.reduce(
        (n, x) =>
          n +
          x.quantity *
            x.purchase_rate *
            (1 - x.discount_percent / 100) *
            (1 + x.gst_percent / 100),
        0,
      ),
      code = purchase.rows[0].record_code;
    await c.query(
      `DELETE FROM inventory_records WHERE tenant_id=$1 AND kind='pharmacy-batch' AND data->>'purchase_id'=$2`,
      [t, req.params.id],
    );
    await c.query(
      `UPDATE inventory_records SET branch_id=$1,data=$2,amount=$3,status=$4,record_date=$5,updated_at=now() WHERE id=$6`,
      [
        purchaseBranchId || null,
        {
          supplier_id: b.supplier_id,
          invoice_number: b.invoice_number,
          payment_status: b.payment_status,
          notes: b.notes,
          subtotal,
          tax: total - subtotal,
        },
        total,
        b.payment_status,
        b.purchase_date,
        req.params.id,
      ],
    );
    for (let i = 0; i < b.items.length; i++) {
      const x = b.items[i]!,
        qty = x.quantity + x.free_quantity;
      await c.query(
        `INSERT INTO inventory_records(tenant_id,kind,record_code,branch_id,data,quantity,amount,status,record_date,created_by) VALUES($1,'pharmacy-batch',$2,$3,$4,$5,$6,'Available',$7,$8)`,
        [
          t,
          `${code}-B${String(i + 1).padStart(2, "0")}`,
          purchaseBranchId || null,
          {
            purchase_id: req.params.id,
            supplier_id: b.supplier_id,
            medicine_id: x.medicine_id,
            batch_number: x.batch_number,
            manufacturing_date: x.manufacturing_date,
            expiry_date: x.expiry_date,
            purchased_quantity: x.quantity,
            free_quantity: x.free_quantity,
            purchase_rate: x.purchase_rate,
            mrp: x.mrp,
            gst_percent: x.gst_percent,
            discount_percent: x.discount_percent,
            reorder_level: 10,
          },
          qty,
          x.quantity * x.purchase_rate,
          b.purchase_date,
          req.portalUser!.sub,
        ],
      );
    }
    await c.query("COMMIT");
    res.json({ id: req.params.id, record_code: code });
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});

router.delete("/pharmacy/purchases/:id", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const purchase = await c.query(
      `SELECT id FROM inventory_records WHERE id=$1 AND tenant_id=$2 AND kind='pharmacy-purchase' FOR UPDATE`,
      [req.params.id, t],
    );
    if (!purchase.rowCount) {
      await c.query("ROLLBACK");
      res.status(404).json({ error: "Purchase not found" });
      return;
    }
    const batches = await c.query(
      `SELECT quantity,data FROM inventory_records WHERE tenant_id=$1 AND kind='pharmacy-batch' AND data->>'purchase_id'=$2 FOR UPDATE`,
      [t, req.params.id],
    );
    if (
      batches.rows.some(
        (x) =>
          Number(x.quantity) !==
          Number(x.data.purchased_quantity || 0) +
            Number(x.data.free_quantity || 0),
      )
    ) {
      await c.query("ROLLBACK");
      res
        .status(409)
        .json({
          error:
            "This purchase cannot be deleted because its stock was adjusted or consumed.",
        });
      return;
    }
    await c.query(
      `DELETE FROM inventory_records WHERE tenant_id=$1 AND kind='pharmacy-batch' AND data->>'purchase_id'=$2`,
      [t, req.params.id],
    );
    await c.query(
      `DELETE FROM inventory_records WHERE id=$1 AND tenant_id=$2 AND kind='pharmacy-purchase'`,
      [req.params.id, t],
    );
    await c.query("COMMIT");
    res.status(204).end();
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});

router.post("/pharmacy/batches/:id/adjust", async (req: R, res) => {
  const parsed = z
      .object({
        quantity: z.coerce.number().nonnegative(),
        reason: z.string().trim().min(2),
        type: z.enum(["Add", "Remove", "Set"]),
      })
      .parse(req.body),
    t = req.portalUser!.tenantId;
  const branchIds = await accessibleBranchIds(req.portalUser!);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const existing = await c.query(
      `SELECT * FROM inventory_records WHERE id=$1 AND tenant_id=$2 AND kind='pharmacy-batch'
      AND ($3::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($3)) FOR UPDATE`,
      [req.params.id, t, branchIds],
    );
    if (!existing.rowCount) {
      await c.query("ROLLBACK");
      res.status(404).json({ error: "Batch not found" });
      return;
    }
    const before = Number(existing.rows[0].quantity),
      after =
        parsed.type === "Set"
          ? parsed.quantity
          : parsed.type === "Add"
            ? before + parsed.quantity
            : Math.max(0, before - parsed.quantity);
    const result = await c.query(
      `UPDATE inventory_records SET quantity=$1,
      data=data||jsonb_build_object('last_adjustment_reason',$2::text,'last_adjusted_at',now()),updated_at=now()
      WHERE id=$3 RETURNING *`,
      [after, parsed.reason, req.params.id],
    );
    const batch = result.rows[0];
    await c.query(
      `INSERT INTO pharmacy_stock_adjustments(tenant_id,batch_id,branch_id,adjustment_type,requested_quantity,quantity_before,quantity_after,reason,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        t,
        batch.id,
        batch.branch_id,
        parsed.type,
        parsed.quantity,
        before,
        after,
        parsed.reason,
        req.portalUser!.sub,
      ],
    );
    await c.query("COMMIT");
    res.json(batch);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
router.get('/finance/lab-invoices/:id',async(req:R,res)=>{
  const a=req.portalUser!,branches=await accessibleBranchIds(a);
  const own=a.role==='receptionist'||a.portal==='receptionist';
  const result=await pool.query(`SELECT f.*,concat_ws(' ',p.first_name,p.last_name) patient_name,p.medical_record_number,
    p.phone patient_phone,p.date_of_birth patient_date_of_birth,p.address patient_address,
    w.data accounting_lab_data,f.data->'tests' tests,coalesce(t.header_image,'') pathology_header_image,coalesce(t.footer_content,'') pathology_footer_content
    FROM finance_records f LEFT JOIN patients p ON p.id=f.patient_id AND p.tenant_id=f.tenant_id
    LEFT JOIN role_work_items w ON w.id::text=f.data->>'lab_order_id' AND w.tenant_id=f.tenant_id
    LEFT JOIN hospital_print_templates t ON t.tenant_id=f.tenant_id AND t.document_type='pathology'
    WHERE f.id=$1 AND f.tenant_id=$2 AND f.kind='invoices' AND f.data ? 'lab_order_id'
      AND ($3::uuid[] IS NULL OR f.branch_id=ANY($3)) AND (NOT $4::boolean OR f.created_by=$5)`,
    [z.string().uuid().parse(req.params.id),a.tenantId,branches,own,a.sub]);
  const bill=result.rows[0];if(!bill)return void res.status(404).json({error:'Laboratory invoice not found'});
  const payments=await pool.query(`SELECT * FROM finance_records WHERE invoice_id=$1 AND tenant_id=$2 AND kind='payments' ORDER BY created_at,id`,[bill.id,a.tenantId]);
  res.json((await withPrintDoctorDetails([{...bill,payments:payments.rows}],a.tenantId))[0]);
});
router.get("/finance/accounting-options", async (req: R, res) => {
  const tenantId=req.portalUser!.tenantId,branchIds=await accessibleBranchIds(req.portalUser!);
  const [branches,departments,doctors]=await Promise.all([pool.query(`SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,[tenantId,branchIds]),
  pool.query(`SELECT id,name,branch_id FROM departments WHERE tenant_id=$1 AND (branch_id IS NULL OR $2::uuid[] IS NULL OR branch_id=ANY($2)) AND is_active=true ORDER BY name`,[tenantId,branchIds]),
  pool.query(`SELECT DISTINCT u.id,trim(concat_ws(' ',u.first_name,u.last_name)) name,a.branch_id FROM clinical_appointments a JOIN users u ON u.id=a.doctor_id AND u.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND ($2::uuid[] IS NULL OR a.branch_id=ANY($2)) ORDER BY name`,[tenantId,branchIds])]);
  res.json({branches:branches.rows,departments:departments.rows,doctors:doctors.rows,encounters:['OPD','IPD','Laboratory & Radiology','Pharmacy']});
});
router.get("/finance/:kind", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    k = String(req.params.kind ?? "");
  const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).prefault("");
  const from=day.parse(req.query.from),to=day.parse(req.query.to);
  if(from&&to&&from>to)return void res.status(400).json({error:"From Date must be on or before To Date"});
  const branchIds = await accessibleBranchIds(req.portalUser!);
  if (["invoices", "outstanding", "reports"].includes(k)) {
    const invoicePrefix = await configuredPrefix(t, "invoice_prefix", "INV");
    await pool.query(
      `INSERT INTO finance_records(tenant_id,kind,record_number,patient_id,branch_id,data,amount,total,paid,due,status,record_date)
       SELECT a.tenant_id,'invoices',$2||'-'||a.ipd_number,a.patient_id,a.branch_id,
         jsonb_build_object('source','IPD Admission','admission_id',a.id,'ipd_number',a.ipd_number,'care_type','IPD','services','IPD Admission','admitted_at',a.admitted_at,'patient_sex',p.sex,'patient_dob',p.date_of_birth,'doctor_name',concat_ws(' ',u.first_name,u.last_name),'department_name',d.name,'ward_name',w.name,'room_number',rm.room_number,'bed_number',be.bed_number,'payer',CASE WHEN a.has_insurance THEN coalesce(nullif(a.insurance_company,''),'Insurance') ELSE 'Self' END,'registration_fee',0,'registration_addons',0,'registration_deposit',0,'registration_discount',0,'registration_total',0,'consultation_fee',coalesce(a.consultation_fee,0),'bed_daily_charge',coalesce(a.bed_daily_charge,0),'admission_charges',coalesce(a.charges,'[]'::jsonb),'admission_deposit',coalesce(a.deposit_amount,0),'patient_credit',greatest(coalesce(a.paid_amount,0)+coalesce(a.deposit_amount,0)-a.total_amount,0),'admission_discount',coalesce(a.discount,0),'payment_mode',coalesce(a.payment_mode,''),'payment_reference',coalesce(a.payment_reference,'')),
         0,a.total_amount,least(coalesce(a.paid_amount,0)+coalesce(a.deposit_amount,0),a.total_amount),greatest(a.total_amount-coalesce(a.paid_amount,0)-coalesce(a.deposit_amount,0),0),CASE WHEN coalesce(a.paid_amount,0)+coalesce(a.deposit_amount,0)>=a.total_amount AND a.total_amount>0 THEN 'Paid' WHEN coalesce(a.paid_amount,0)+coalesce(a.deposit_amount,0)>0 THEN 'Partially Paid' ELSE 'Unpaid' END,a.admitted_at::date
       FROM ipd_admissions a JOIN patients p ON p.id=a.patient_id LEFT JOIN users u ON u.id=a.consultant_doctor_id LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN wards w ON w.id=a.ward_id LEFT JOIN rooms rm ON rm.id=a.room_id LEFT JOIN beds be ON be.id=a.bed_id
       WHERE a.tenant_id=$1
       ON CONFLICT(tenant_id,record_number) DO UPDATE SET patient_id=excluded.patient_id,branch_id=excluded.branch_id,data=excluded.data,total=excluded.total,paid=excluded.paid,due=excluded.due,status=excluded.status,updated_at=now()
       WHERE (finance_records.patient_id,finance_records.branch_id,finance_records.data,finance_records.total,finance_records.paid,finance_records.due,finance_records.status)
         IS DISTINCT FROM (excluded.patient_id,excluded.branch_id,excluded.data,excluded.total,excluded.paid,excluded.due,excluded.status)`,
      [t, invoicePrefix],
    );
  }
  // Accounting needs admission synchronization, but not a duplicate invoice ledger download.
  if (k === 'invoices' && req.query.sync_only === 'true') {
    res.json({synced:true});
    return;
  }
  if (k === "reports") {
    const r = await pool.query(
      `SELECT coalesce(sum(total)FILTER(WHERE kind='invoices'),0)invoiced,coalesce(sum(amount)FILTER(WHERE kind='payments'),0)collected,coalesce(sum(due)FILTER(WHERE kind='invoices'),0)outstanding,coalesce(sum(amount)FILTER(WHERE kind='expenses'),0)expenses,coalesce(sum(amount)FILTER(WHERE kind='refunds'),0)refunds FROM finance_records WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2))`,
      [t, branchIds],
    );
    res.json(r.rows);
    return;
  }
  const selfAccounting=(k==='all'||k==='reception-accounting')&&(req.portalUser!.portal==='receptionist'||req.portalUser!.role==='receptionist');
  const combinedAccounting=k==='all'||k==='reception-accounting';
  if(combinedAccounting){
    const client=await pool.connect();
    try{await client.query('BEGIN');await reconcileOpdPayments(client,t,branchIds);await client.query('COMMIT');}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  const where =
      k === "outstanding"
        ? `f.kind='invoices' AND f.due>0`
        : combinedAccounting
          ? `true`
          : `f.kind=$2`,
    vals: unknown[] = ["outstanding", "all", "reception-accounting"].includes(k) ? [t] : [t, k];
  vals.push(branchIds);
  const branchParameter = vals.length;
  const ownerClause=selfAccounting?` AND (f.created_by=$${vals.push(req.portalUser!.sub)} OR (f.created_by IS NULL AND f.data->>'legacy_receipt'='true' AND f.data->>'source'='OPD Appointment'))`:'';
  const periodClause=`${from?` AND f.record_date >= $${vals.push(from)}::date`:""}${to?` AND f.record_date <= $${vals.push(to)}::date`:""}`;
  const accountingFields=combinedAccounting?`,i.data invoice_data,i.record_date invoice_record_date,i.amount accounting_invoice_amount,i.total accounting_invoice_total,
    coalesce(a.department_id,ad.department_id)::text accounting_department_id,
    coalesce(a.doctor_id,ad.consultant_doctor_id)::text accounting_doctor_id,
    coalesce(d.name,f.data->>'department_name',i.data->>'department_name') accounting_department_name,
    coalesce(nullif(trim(concat_ws(' ',doc.first_name,doc.last_name)),''),f.data->>'doctor_name',i.data->>'doctor_name') accounting_doctor_name,
    CASE WHEN coalesce(nullif(f.data->>'lab_order_id',''),nullif(i.data->>'lab_order_id','')) IS NOT NULL
      OR lower(coalesce(f.data->>'source','')||' '||coalesce(i.data->>'source','')) LIKE '%lab%' THEN 'Laboratory'
      WHEN lower(coalesce(f.data->>'source','')||' '||coalesce(i.data->>'source','')) LIKE '%radiolog%' THEN 'Radiology'
      WHEN f.kind='pharmacy-bill' OR i.kind='pharmacy-bill'
        OR lower(coalesce(f.data->>'source','')||' '||coalesce(i.data->>'source','')) LIKE '%pharmacy%' THEN 'Pharmacy'
      WHEN a.id IS NOT NULL THEN 'OPD' WHEN ad.id IS NOT NULL THEN 'IPD' ELSE NULL END accounting_encounter,
    a.appointment_number,coalesce(a.visit_type,ad.admission_type) accounting_visit_type,
    a.consultation_fee accounting_opd_amount,a.charges accounting_appointment_charges,
    a.discount accounting_appointment_discount,l.data accounting_lab_data,
    (f.kind='payments' AND f.invoice_id IS NOT NULL AND EXISTS(SELECT 1 FROM finance_records earlier WHERE earlier.tenant_id=f.tenant_id AND earlier.invoice_id=f.invoice_id AND earlier.kind='payments' AND (earlier.created_at,earlier.id)<(f.created_at,f.id))) accounting_is_balance_payment`:'';
  const accountingJoins=combinedAccounting?`
    LEFT JOIN clinical_appointments a ON a.id::text=coalesce(f.data->>'appointment_id',i.data->>'appointment_id') AND a.tenant_id=f.tenant_id
    LEFT JOIN ipd_admissions ad ON ad.id::text=coalesce(f.data->>'admission_id',i.data->>'admission_id') AND ad.tenant_id=f.tenant_id
    LEFT JOIN departments d ON d.id=coalesce(a.department_id,ad.department_id) AND d.tenant_id=f.tenant_id
    LEFT JOIN users doc ON doc.id=coalesce(a.doctor_id,ad.consultant_doctor_id) AND doc.tenant_id=f.tenant_id
    LEFT JOIN role_work_items l ON l.id::text=coalesce(f.data->>'lab_order_id',i.data->>'lab_order_id') AND l.tenant_id=f.tenant_id`:'';
  const r = await pool.query(
    `SELECT f.*,p.medical_record_number,p.phone patient_phone,concat(p.first_name,' ',p.last_name)patient_name,h.name hospital_name,b.name branch_name,i.record_number invoice_number,concat(u.first_name,' ',u.last_name)created_by_name${accountingFields} FROM finance_records f LEFT JOIN finance_records i ON i.id=f.invoice_id AND i.tenant_id=f.tenant_id LEFT JOIN patients p ON p.id=coalesce(f.patient_id,i.patient_id) AND p.tenant_id=f.tenant_id LEFT JOIN hospitals h ON h.id=f.tenant_id LEFT JOIN branches b ON b.id=f.branch_id LEFT JOIN users u ON u.id=f.created_by AND u.tenant_id=f.tenant_id ${accountingJoins} WHERE f.tenant_id=$1 AND ${where} AND ($${branchParameter}::uuid[] IS NULL OR f.branch_id=ANY($${branchParameter}))${ownerClause}${periodClause} ORDER BY f.record_date DESC,f.created_at DESC`,
    vals,
  );
  res.json(await withPrintDoctorDetails(r.rows,t));
});
router.post("/finance/:kind", async (req: R, res) => {
  const k = req.params.kind as (typeof kinds)[number];
  if (
    !kinds.includes(k) ||
    [
      "items",
      "categories",
      "suppliers",
      "purchase-orders",
      "purchases",
      "stock-transfers",
      "assets",
    ].includes(k)
  ) {
    res.status(400).json({ error: "Invalid finance resource" });
    return;
  }
  const b = body.parse(req.body),
    t = req.portalUser!.tenantId;
  if (b.branch_id) await assertBranchAccess(req.portalUser!, b.branch_id);
  const branchIds = await accessibleBranchIds(req.portalUser!);
  if (b.patient_id) {
    const patient = await pool.query(
      `SELECT 1 FROM patients WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [b.patient_id, t],
    );
    if (!patient.rowCount) {
      res.status(403).json({ error: "Patient is outside your branch access" });
      return;
    }
  }
  if (b.invoice_id) {
    const invoice = await pool.query(
      `SELECT f.status,f.data,EXISTS(SELECT 1 FROM role_work_items w WHERE w.tenant_id=f.tenant_id AND w.workspace='laboratory' AND w.data->>'bill_id'=f.id::text) lab_bill FROM finance_records f WHERE f.id=$1 AND f.tenant_id=$2 AND f.kind='invoices' AND ($3::uuid[] IS NULL OR f.branch_id=ANY($3))`,
      [b.invoice_id, t, branchIds],
    );
    if (!invoice.rowCount) {
      res.status(403).json({ error: "Invoice is outside your branch access" });
      return;
    }
    const linked=invoice.rows[0];
    if(k==='payments'&&['Cancelled','Refunded'].includes(linked.status))return void res.status(409).json({error:'This invoice is cancelled and cannot receive further payments.'});
    if(k==='refunds'&&(linked.lab_bill||linked.data?.lab_order_id||linked.data?.appointment_id||/laboratory|opd/i.test(String(linked.data?.source||''))))return void res.status(409).json({error:'OPD and lab refunds require an approved cancellation request. Reception must process the approved refund.'});
  }
  if(k==='refunds'&&(b.data?.appointment_id||b.data?.lab_order_id||b.data?.cancellation_request_id))return void res.status(409).json({error:'Process this refund through the approved cancellation request.'});
  const c=await pool.connect();
  try {
    await c.query("BEGIN");
    if(k==='payments'&&b.invoice_id){
      const invoice=await c.query(`SELECT status FROM finance_records WHERE id=$1 AND tenant_id=$2 AND kind='invoices' FOR UPDATE`,[b.invoice_id,t]);
      if(!invoice.rowCount||['Cancelled','Refunded'].includes(invoice.rows[0].status)){await c.query('ROLLBACK');return void res.status(409).json({error:'This invoice is cancelled and cannot receive further payments.'});}
    }
    const n0 = await c.query(
        `SELECT count(*)::int+1 n FROM finance_records WHERE tenant_id=$1 AND kind=$2`,
        [t, k],
      ),
      defaultPrefix =
        (
          {
            invoices: "INV",
            payments: "REC",
            refunds: "REF",
            expenses: "EXP",
          } as Record<string, string>
        )[k] ?? "FIN",
      prefixKey =
        (
          {
            invoices: "invoice_prefix",
            payments: "receipt_prefix",
            refunds: "transaction_prefix",
            expenses: "transaction_prefix",
          } as Record<string, string>
        )[k] ?? "transaction_prefix",
      pre = await configuredPrefix(t, prefixKey, defaultPrefix),
      num = `${pre}-${String(n0.rows[0].n).padStart(6, "0")}`,
      total = k === "invoices" ? b.total : b.amount,
      due = k === "invoices" ? Math.max(total - b.paid, 0) : 0,
      r = await c.query(
        `INSERT INTO finance_records(tenant_id,kind,record_number,patient_id,invoice_id,branch_id,data,amount,total,paid,due,status,record_date,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13::date,current_date),$14)RETURNING *`,
        [
          t,
          k,
          num,
          b.patient_id || null,
          b.invoice_id || null,
          b.branch_id || null,
          b.data,
          b.amount,
          total,
          b.paid,
          due,
          b.status,
          b.record_date || null,
          req.portalUser!.sub,
        ],
      );
    if (k === "payments" && b.invoice_id)
      await c.query(
        `UPDATE finance_records SET paid=least(total,paid+$1),due=greatest(0,total-paid-$1),status=CASE WHEN total-paid-$1<=0 THEN 'Paid' ELSE 'Partially Paid' END,updated_at=now()WHERE id=$2 AND tenant_id=$3`,
        [b.amount, b.invoice_id, t],
      );
    if (k === "refunds" && b.invoice_id)
      await c.query(
        `UPDATE finance_records SET paid=greatest(0,paid-$1),due=least(total,due+$1),status='Refunded',updated_at=now()WHERE id=$2 AND tenant_id=$3`,
        [b.amount, b.invoice_id, t],
      );
    await c.query("COMMIT");
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
router.get("/inventory/:kind", async (req: R, res) => {
  const t = req.portalUser!.tenantId,
    k = req.params.kind;
  const branchIds = await accessibleBranchIds(req.portalUser!);
  if (k === "stock" || k === "low-stock") {
    const extra =
      k === "low-stock"
        ? `AND x.quantity<=coalesce(nullif(x.data->>'reorder_level','')::numeric,0)`
        : "";
    const r = await pool.query(
      `SELECT x.*,b.name branch_name,c.data->>'name'category_name,s.data->>'name'supplier_name FROM inventory_records x LEFT JOIN branches b ON b.id=x.branch_id LEFT JOIN inventory_records c ON c.id=x.category_id LEFT JOIN inventory_records s ON s.id=x.supplier_id WHERE x.tenant_id=$1 AND ($2::uuid[] IS NULL OR x.branch_id=ANY($2)) AND x.kind='items' ${extra} ORDER BY x.data->>'name'`,
      [t, branchIds],
    );
    res.json(r.rows);
    return;
  }
  const r = await pool.query(
    `SELECT x.*,b.name branch_name,c.data->>'name'category_name,s.data->>'name'supplier_name,i.data->>'name'item_name,d.name destination_branch_name FROM inventory_records x LEFT JOIN branches b ON b.id=x.branch_id LEFT JOIN inventory_records c ON c.id=x.category_id LEFT JOIN inventory_records s ON s.id=x.supplier_id LEFT JOIN inventory_records i ON i.id=x.item_id LEFT JOIN branches d ON d.id::text=x.data->>'to_branch' AND d.tenant_id=x.tenant_id WHERE x.tenant_id=$1 AND ($3::uuid[] IS NULL OR x.branch_id=ANY($3) OR (x.branch_id IS NULL AND x.kind IN ('categories','suppliers'))) AND x.kind=$2 ORDER BY x.record_date DESC,x.created_at DESC`,
    [t, k, branchIds],
  );
  res.json(r.rows);
});
router.post("/inventory/:kind", async (req: R, res) => {
  const k = req.params.kind as (typeof kinds)[number];
  if (
    !kinds.includes(k) ||
    ["invoices", "payments", "refunds", "expenses"].includes(k)
  ) {
    res.status(400).json({ error: "Invalid inventory resource" });
    return;
  }
  const b = body.parse(req.body),
    t = req.portalUser!.tenantId,
    branchIds = await accessibleBranchIds(req.portalUser!),
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [t]);
    z.number().finite().nonnegative().parse(b.quantity);
    z.number().finite().nonnegative().parse(b.amount);
    if (b.branch_id) {
      z.string().uuid().parse(b.branch_id);
      if (branchIds !== null && !branchIds.includes(b.branch_id)) throw Object.assign(new Error("Branch access denied"), {status:403});
      const branch = await c.query("SELECT id FROM branches WHERE tenant_id=$1 AND id=$2", [t,b.branch_id]);
      if (!branch.rows[0]) throw Object.assign(new Error("Invalid branch"), {status:400});
    }
    for (const [id, expected] of [[b.category_id,'categories'],[b.supplier_id,'suppliers']]) {
      if (!id) continue;
      z.string().uuid().parse(id);
      const ref = await c.query("SELECT id FROM inventory_records WHERE tenant_id=$1 AND id=$2 AND kind=$3 AND ($4::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($4))", [t,id,expected,branchIds]);
      if (!ref.rows[0]) throw Object.assign(new Error("Invalid inventory reference"), {status:400});
    }
    if (['items','categories','suppliers','assets'].includes(k)) z.string().trim().min(1).parse(b.data.name);
    if (k==='assets') z.string().trim().min(1).parse(b.data.serial_number);
    if (['items','assets'].includes(k) && !b.branch_id) throw Object.assign(new Error("Select a branch"), {status:400});
    if (['purchase-orders','purchases'].includes(k) && !b.supplier_id) throw Object.assign(new Error("Select a supplier"), {status:400});
    await postInventoryMovement(c,t,k,b,branchIds);
    if (['purchases','stock-transfers'].includes(k)) b.status='Completed';
    const n0 = await c.query(
        `SELECT count(*)::int+1 n FROM inventory_records WHERE tenant_id=$1 AND kind=$2`,
        [t, k],
      ),
      pre: { [key: string]: string } = {
        items: "ITM",
        categories: "CAT",
        suppliers: "SUP",
        "purchase-orders": "PO",
        purchases: "PUR",
        "stock-transfers": "TRF",
        assets: "AST",
      },
      num = String(
        b.data.code || `${pre[k]}-${String(n0.rows[0].n).padStart(5, "0")}`,
      ),
      r = await c.query(
        `INSERT INTO inventory_records(tenant_id,kind,record_code,branch_id,supplier_id,category_id,item_id,data,quantity,amount,status,record_date,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12::date,current_date),$13)RETURNING *`,
        [
          t,
          k,
          num,
          b.branch_id || null,
          b.supplier_id || null,
          b.category_id || null,
          b.item_id || null,
          b.data,
          b.quantity,
          b.amount,
          b.status,
          b.record_date || null,
          req.portalUser!.sub,
        ],
      );
    await c.query("COMMIT");
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
router.put("/:area/:kind/:id", async (req: R, res) => {
  if (!["inventory","finance"].includes(String(req.params.area))) {res.status(404).json({error:"Resource not found"});return;}
  if (req.params.area === "inventory" && !["items","categories","suppliers","purchase-orders","assets"].includes(String(req.params.kind))) {
    res.status(400).json({error:"Posted stock movements cannot be edited."}); return;
  }
  const b = body.parse(req.body),
    table =
      req.params.area === "finance" ? "finance_records" : "inventory_records",
    number = table === "finance_records" ? "record_number" : "record_code",
    t = req.portalUser!.tenantId;
  if (b.branch_id) await assertBranchAccess(req.portalUser!, b.branch_id);
  const branchIds = await accessibleBranchIds(req.portalUser!);
  if (req.params.area === "inventory") {
    z.number().finite().nonnegative().parse(b.quantity);
    z.number().finite().nonnegative().parse(b.amount);
    if (['items','categories','suppliers','assets'].includes(String(req.params.kind))) z.string().trim().min(1).parse(b.data.name);
    if (req.params.kind === 'assets') z.string().trim().min(1).parse(b.data.serial_number);
    const existing = await pool.query("SELECT branch_id FROM inventory_records WHERE tenant_id=$1 AND id=$2 AND kind=$3 AND ($4::uuid[] IS NULL OR branch_id=ANY($4) OR (branch_id IS NULL AND kind IN ('categories','suppliers')))", [t,req.params.id,req.params.kind,branchIds]);
    if (!existing.rows[0]) {res.status(404).json({error:"Record not found"});return;}
    if (['items','assets'].includes(String(req.params.kind)) && existing.rows[0].branch_id !== b.branch_id) {
      res.status(400).json({error:"Use a stock transfer to move an item between branches."});return;
    }
    for (const [id, kind] of [[b.category_id,'categories'],[b.supplier_id,'suppliers'],[b.item_id,'items']]) {
      if (!id) continue;
      z.string().uuid().parse(id);
      const ref = await pool.query("SELECT id FROM inventory_records WHERE tenant_id=$1 AND id=$2 AND kind=$3 AND ($4::uuid[] IS NULL OR branch_id IS NULL OR branch_id=ANY($4))", [t,id,kind,branchIds]);
      if (!ref.rows[0]) {res.status(400).json({error:"Invalid inventory reference"});return;}
    }
  }
  const r =
    table === "finance_records"
      ? await pool.query(
          `UPDATE finance_records SET branch_id=$1,patient_id=$2,invoice_id=$3,data=$4,amount=$5,total=$6,paid=$7,due=greatest(0,$6-$7),status=$8,record_date=coalesce($9::date,record_date),updated_at=now() WHERE id=$10 AND tenant_id=$11 AND ($12::uuid[] IS NULL OR branch_id=ANY($12)) RETURNING id,${number}`,
          [
            b.branch_id || null,
            b.patient_id || null,
            b.invoice_id || null,
            b.data,
            b.amount,
            b.total,
            b.paid,
            b.status,
            b.record_date || null,
            req.params.id,
            t,
            branchIds,
          ],
        )
      : await pool.query(
          `UPDATE inventory_records SET branch_id=$1,supplier_id=$2,category_id=$3,item_id=$4,data=$5,quantity=$6,amount=$7,status=$8,record_date=coalesce($9::date,record_date),updated_at=now() WHERE id=$10 AND tenant_id=$11 AND kind=$13 AND ($12::uuid[] IS NULL OR branch_id=ANY($12) OR (branch_id IS NULL AND kind IN ('categories','suppliers'))) RETURNING id,${number}`,
          [
            b.branch_id || null,
            b.supplier_id || null,
            b.category_id || null,
            b.item_id || null,
            b.data,
            b.quantity,
            b.amount,
            b.status,
            b.record_date || null,
            req.params.id,
            t,
            branchIds,
            req.params.kind,
          ],
        );
  if (!r.rows[0]) {res.status(404).json({error:"Record not found"});return;}
  res.json(r.rows[0]);
});
export default router;
