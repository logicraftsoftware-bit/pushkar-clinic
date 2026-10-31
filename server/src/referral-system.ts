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
export function ensureReferralSchema() {
  ready ??= pool.query(`
CREATE TABLE IF NOT EXISTS referral_partners(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,branch_id uuid REFERENCES branches(id),partner_code text NOT NULL,name text NOT NULL,phone text NOT NULL,password_hash text NOT NULL,email text NOT NULL DEFAULT '',partner_type text NOT NULL DEFAULT 'Referral Partner',status text NOT NULL DEFAULT 'Active',bank_details jsonb NOT NULL DEFAULT '{}',kyc jsonb NOT NULL DEFAULT '{}',minimum_withdrawal numeric(14,2) NOT NULL DEFAULT 500,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,partner_code),UNIQUE(tenant_id,phone));
CREATE TABLE IF NOT EXISTS referral_commission_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,branch_id uuid REFERENCES branches(id),partner_id uuid REFERENCES referral_partners(id) ON DELETE CASCADE,service_type text NOT NULL DEFAULT 'All',commission_type text NOT NULL CHECK(commission_type IN ('Percentage','Fixed','Custom')),rate numeric(14,2) NOT NULL DEFAULT 0,max_amount numeric(14,2),status text NOT NULL DEFAULT 'Active',effective_from date NOT NULL DEFAULT current_date,effective_to date,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_partner_id uuid REFERENCES referral_partners(id) ON DELETE SET NULL;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_consent boolean NOT NULL DEFAULT false;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_tagged_at timestamptz;
CREATE TABLE IF NOT EXISTS referral_commissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,branch_id uuid REFERENCES branches(id),partner_id uuid NOT NULL REFERENCES referral_partners(id),patient_id uuid NOT NULL REFERENCES patients(id),invoice_id uuid NOT NULL REFERENCES finance_records(id),rule_id uuid REFERENCES referral_commission_rules(id),service_type text NOT NULL,bill_amount numeric(14,2) NOT NULL DEFAULT 0,eligible_amount numeric(14,2) NOT NULL DEFAULT 0,commission_amount numeric(14,2) NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'Pending',hold_reason text NOT NULL DEFAULT '',approved_by uuid REFERENCES users(id),approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,invoice_id,partner_id));
CREATE TABLE IF NOT EXISTS referral_wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,partner_id uuid NOT NULL REFERENCES referral_partners(id),commission_id uuid REFERENCES referral_commissions(id),withdrawal_id uuid,transaction_type text NOT NULL,amount numeric(14,2) NOT NULL,reference text NOT NULL DEFAULT '',description text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'Posted',created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS referral_withdrawals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,partner_id uuid NOT NULL REFERENCES referral_partners(id),amount numeric(14,2) NOT NULL,method text NOT NULL,account_details jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'Requested',payment_reference text NOT NULL DEFAULT '',requested_at timestamptz NOT NULL DEFAULT now(),approved_by uuid REFERENCES users(id),approved_at timestamptz,paid_by uuid REFERENCES users(id),paid_at timestamptz,notes text NOT NULL DEFAULT '');
ALTER TABLE referral_wallet_transactions ADD COLUMN IF NOT EXISTS withdrawal_id uuid REFERENCES referral_withdrawals(id);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_partner ON referral_commissions(tenant_id,partner_id,status);
`);
  return ready;
}
function auth(req: R, res: Response, next: NextFunction) {
  try {
    req.portalUser = jwt.verify(
      req.header("authorization")?.replace(/^Bearer /i, "") || "",
      config.JWT_SECRET,
      { issuer: "careframe-api", audience: "careframe-portal" },
    ) as A;
    next();
  } catch {
    res.status(401).json({ error: "Session expired or invalid" });
  }
}
router.use(auth);
router.use(async (_q, _s, n) => {
  try {
    await ensureReferralSchema();
    n();
  } catch (e) {
    ready = null;
    n(e);
  }
});
const admin = (a: A) =>
  ["hospital_admin", "accountant"].includes(a.role) ||
  ["hospital_admin", "accountant"].includes(a.portal || "");
async function sync(t: string) {
  await pool.query(
    `WITH candidates AS(SELECT f.id invoice_id,f.branch_id,f.patient_id,p.referral_partner_id partner_id,f.total bill_amount,CASE WHEN upper(coalesce(f.data->>'care_type',''))='IPD' OR f.data?'admission_id' THEN 'IPD' WHEN lower(coalesce(f.data->>'source','')) LIKE '%laboratory%' THEN 'Diagnostics' ELSE 'OPD' END service_type,f.status FROM finance_records f JOIN patients p ON p.id=f.patient_id WHERE f.tenant_id=$1 AND f.kind IN('invoices','pharmacy-bill') AND p.referral_partner_id IS NOT NULL),rated AS(SELECT c.*,r.id rule_id,r.commission_type,r.rate,r.max_amount FROM candidates c LEFT JOIN LATERAL(SELECT * FROM referral_commission_rules x WHERE x.tenant_id=$1 AND x.status='Active' AND (x.partner_id=c.partner_id OR x.partner_id IS NULL) AND (x.branch_id=c.branch_id OR x.branch_id IS NULL) AND (x.service_type=c.service_type OR x.service_type='All') AND x.effective_from<=current_date AND (x.effective_to IS NULL OR x.effective_to>=current_date) ORDER BY (x.partner_id IS NOT NULL) DESC,(x.service_type<>'All') DESC,x.created_at DESC LIMIT 1)r ON true) INSERT INTO referral_commissions(tenant_id,branch_id,partner_id,patient_id,invoice_id,rule_id,service_type,bill_amount,eligible_amount,commission_amount,status) SELECT $1,branch_id,partner_id,patient_id,invoice_id,rule_id,service_type,bill_amount,bill_amount,CASE WHEN commission_type='Percentage' THEN least(CASE WHEN max_amount IS NULL THEN 999999999 ELSE max_amount END,bill_amount*rate/100) WHEN commission_type IN('Fixed','Custom') THEN rate ELSE 0 END,CASE WHEN status='Paid' THEN 'Eligible' ELSE 'Pending' END FROM rated WHERE rule_id IS NOT NULL ON CONFLICT(tenant_id,invoice_id,partner_id) DO UPDATE SET bill_amount=excluded.bill_amount,eligible_amount=excluded.eligible_amount,commission_amount=CASE WHEN referral_commissions.status IN('Pending','Eligible') THEN excluded.commission_amount ELSE referral_commissions.commission_amount END,status=CASE WHEN referral_commissions.status='Pending' AND excluded.status='Eligible' THEN 'Eligible' ELSE referral_commissions.status END,updated_at=now()`,
    [t],
  );
  await pool.query(
    `WITH reversed AS(SELECT c.* FROM referral_commissions c WHERE c.tenant_id=$1 AND c.status='Approved' AND EXISTS(SELECT 1 FROM finance_records r WHERE r.tenant_id=c.tenant_id AND r.kind='refunds' AND r.invoice_id=c.invoice_id) AND NOT EXISTS(SELECT 1 FROM referral_wallet_transactions t WHERE t.commission_id=c.id AND t.transaction_type='Refund Reversal')) INSERT INTO referral_wallet_transactions(tenant_id,partner_id,commission_id,transaction_type,amount,reference,description) SELECT tenant_id,partner_id,id,'Refund Reversal',-commission_amount,'REFUND-'||left(id::text,8),'Automatic reversal after invoice refund' FROM reversed`,
    [t],
  );
  await pool.query(
    `UPDATE referral_commissions c SET status='Adjusted',updated_at=now() WHERE c.tenant_id=$1 AND c.status='Approved' AND EXISTS(SELECT 1 FROM finance_records r WHERE r.tenant_id=c.tenant_id AND r.kind='refunds' AND r.invoice_id=c.invoice_id)`,
    [t],
  );
}
router.get("/lookups", async (req: R, res) => {
  const a = req.portalUser!;
  const q = await pool.query(
    `SELECT id,partner_code,name,phone FROM referral_partners WHERE tenant_id=$1 AND status='Active' AND (branch_id=$2 OR branch_id IS NULL) ORDER BY name`,
    [a.tenantId, a.branchId],
  );
  res.json(q.rows);
});
router.get("/partners", async (req: R, res) => {
  const a = req.portalUser!;
  if (!admin(a))
    return void res.status(403).json({ error: "Admin access required" });
  const q = await pool.query(
    `SELECT p.*,(SELECT coalesce(sum(t.amount),0) FROM referral_wallet_transactions t WHERE t.partner_id=p.id AND t.status='Posted') balance,(SELECT count(DISTINCT c.patient_id)::int FROM referral_commissions c WHERE c.partner_id=p.id) referrals FROM referral_partners p WHERE p.tenant_id=$1 ORDER BY p.created_at DESC`,
    [a.tenantId],
  );
  res.json(q.rows);
});
router.post("/partners", async (req: R, res) => {
  const a = req.portalUser!;
  if (!admin(a))
    return void res.status(403).json({ error: "Admin access required" });
  const b = z
      .object({
        name: z.string().min(2),
        phone: z.string().min(5),
        password: z.string().min(8),
        email: z.string().prefault(""),
        partner_type: z.string().prefault("Referral Partner"),
        branch_id: z.string().uuid().nullable().optional(),
        bank_details: z.record(z.string(), z.unknown()).prefault({}),
        kyc: z.record(z.string(), z.unknown()).prefault({}),
        minimum_withdrawal: z.coerce.number().min(0).prefault(500),
      })
      .parse(req.body),
    n = await pool.query(
      `SELECT count(*)::int+1 n FROM referral_partners WHERE tenant_id=$1`,
      [a.tenantId],
    ),
    code = `REF-${String(n.rows[0].n).padStart(5, "0")}`,
    q = await pool.query(
      `INSERT INTO referral_partners(tenant_id,branch_id,partner_code,name,phone,password_hash,email,partner_type,bank_details,kyc,minimum_withdrawal,created_by)VALUES($1,$2,$3,$4,$5,crypt($6,gen_salt('bf')),$7,$8,$9,$10,$11,$12)RETURNING id,partner_code,name,phone,email,status`,
      [
        a.tenantId,
        b.branch_id || a.branchId,
        code,
        b.name,
        b.phone,
        b.password,
        b.email,
        b.partner_type,
        b.bank_details,
        b.kyc,
        b.minimum_withdrawal,
        a.sub,
      ],
    );
  void audit({
    tenantId: a.tenantId,
    userId: a.sub,
    branchId: a.branchId,
    module: "Referral Wallet",
    action: "CREATE_PARTNER",
    recordId: q.rows[0].id,
  });
  res.status(201).json(q.rows[0]);
});
router.patch("/partners/:id", async (req: R, res) => {
  const a = req.portalUser!;
  if (!admin(a))
    return void res.status(403).json({ error: "Admin access required" });
  const b = z
      .object({
        name: z.string().min(2),
        phone: z.string().min(5),
        email: z.string().prefault(""),
        partner_type: z.string().min(2),
        status: z.enum(["Active", "Inactive", "Suspended"]),
        minimum_withdrawal: z.coerce.number().min(0),
        bank_details: z.record(z.string(), z.unknown()),
        kyc: z.record(z.string(), z.unknown()),
        password: z.string().min(8).optional(),
      })
      .parse(req.body),
    q = await pool.query(
      `UPDATE referral_partners SET name=$1,phone=$2,email=$3,partner_type=$4,status=$5,minimum_withdrawal=$6,bank_details=$7,kyc=$8,password_hash=CASE WHEN $9::text IS NULL THEN password_hash ELSE crypt($9,gen_salt('bf')) END,updated_at=now() WHERE id=$10 AND tenant_id=$11 RETURNING id`,
      [
        b.name,
        b.phone,
        b.email,
        b.partner_type,
        b.status,
        b.minimum_withdrawal,
        b.bank_details,
        b.kyc,
        b.password || null,
        req.params.id,
        a.tenantId,
      ],
    );
  res.json(q.rows[0]);
});
router.get("/rules", async (req: R, res) => {
  const a = req.portalUser!;
  if (!admin(a))
    return void res.status(403).json({ error: "Admin access required" });
  const q = await pool.query(
    `SELECT r.*,p.name partner_name FROM referral_commission_rules r LEFT JOIN referral_partners p ON p.id=r.partner_id WHERE r.tenant_id=$1 ORDER BY r.created_at DESC`,
    [a.tenantId],
  );
  res.json(q.rows);
});
router.post("/rules", async (req: R, res) => {
  const a = req.portalUser!;
  if (!admin(a))
    return void res.status(403).json({ error: "Admin access required" });
  const b = z
      .object({
        partner_id: z.string().uuid().nullable().optional(),
        service_type: z.enum([
          "All",
          "OPD",
          "IPD",
          "Surgery",
          "Diagnostics",
          "Dental",
          "Health Package",
          "Pharmacy",
        ]),
        commission_type: z.enum(["Percentage", "Fixed", "Custom"]),
        rate: z.coerce.number().min(0),
        max_amount: z.coerce.number().positive().nullable().optional(),
        effective_from: z.string(),
        effective_to: z.string().nullable().optional(),
      })
      .parse(req.body),
    invalidPercentage = b.commission_type === "Percentage" && b.rate > 100;
  if (invalidPercentage)
    return void res
      .status(400)
      .json({ error: "Percentage commission cannot exceed 100%" });
  const q = await pool.query(
    `INSERT INTO referral_commission_rules(tenant_id,branch_id,partner_id,service_type,commission_type,rate,max_amount,effective_from,effective_to,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)RETURNING *`,
    [
      a.tenantId,
      a.branchId,
      b.partner_id || null,
      b.service_type,
      b.commission_type,
      b.rate,
      b.max_amount || null,
      b.effective_from,
      b.effective_to || null,
      a.sub,
    ],
  );
  res.status(201).json(q.rows[0]);
});
router.get("/admin-dashboard", async (req: R, res) => {
  const a = req.portalUser!;
  if (!admin(a))
    return void res.status(403).json({ error: "Admin access required" });
  await sync(a.tenantId);
  const [summary, commissions, withdrawals, transactions] = await Promise.all([
    pool.query(
      `SELECT (SELECT count(*)::int FROM referral_partners WHERE tenant_id=$1) partners,(SELECT coalesce(sum(amount),0) FROM referral_wallet_transactions WHERE tenant_id=$1 AND status='Posted') wallet_liability,(SELECT coalesce(sum(commission_amount),0) FROM referral_commissions WHERE tenant_id=$1 AND status='Eligible') eligible,(SELECT coalesce(sum(commission_amount),0) FROM referral_commissions WHERE tenant_id=$1 AND status='Approved') approved`,
      [a.tenantId],
    ),
    pool.query(
      `SELECT c.*,p.name partner_name,p.partner_code,pt.medical_record_number,concat_ws(' ',pt.first_name,pt.last_name) patient_name,f.record_number invoice_number FROM referral_commissions c JOIN referral_partners p ON p.id=c.partner_id JOIN patients pt ON pt.id=c.patient_id JOIN finance_records f ON f.id=c.invoice_id WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 200`,
      [a.tenantId],
    ),
    pool.query(
      `SELECT w.*,p.name partner_name,p.partner_code FROM referral_withdrawals w JOIN referral_partners p ON p.id=w.partner_id WHERE w.tenant_id=$1 ORDER BY w.requested_at DESC`,
      [a.tenantId],
    ),
    pool.query(
      `SELECT t.*,p.name partner_name FROM referral_wallet_transactions t JOIN referral_partners p ON p.id=t.partner_id WHERE t.tenant_id=$1 ORDER BY t.created_at DESC LIMIT 200`,
      [a.tenantId],
    ),
  ]);
  res.json({
    summary: summary.rows[0],
    commissions: commissions.rows,
    withdrawals: withdrawals.rows,
    transactions: transactions.rows,
  });
});
router.post("/commissions/:id/action", async (req: R, res) => {
  const a = req.portalUser!;
  if (!admin(a))
    return void res.status(403).json({ error: "Admin access required" });
  const b = z
      .object({
        action: z.enum(["approve", "hold", "release"]),
        reason: z.string().prefault(""),
      })
      .parse(req.body),
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const found = await c.query(
        `SELECT * FROM referral_commissions WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, a.tenantId],
      ),
      row = found.rows[0];
    if (!row) throw new Error("Commission not found");
    if (b.action === "approve") {
      if (row.status !== "Eligible")
        throw new Error("Only eligible commission can be approved");
      await c.query(
        `UPDATE referral_commissions SET status='Approved',approved_by=$1,approved_at=now(),updated_at=now() WHERE id=$2`,
        [a.sub, row.id],
      );
      await c.query(
        `INSERT INTO referral_wallet_transactions(tenant_id,partner_id,commission_id,transaction_type,amount,reference,description,created_by)VALUES($1,$2,$3,'Commission Credit',$4,$5,$6,$7)`,
        [
          a.tenantId,
          row.partner_id,
          row.id,
          row.commission_amount,
          `COM-${String(row.id).slice(0, 8)}`,
          `Approved ${row.service_type} referral commission`,
          a.sub,
        ],
      );
    } else
      await c.query(
        `UPDATE referral_commissions SET status=$1,hold_reason=$2,updated_at=now() WHERE id=$3`,
        [b.action === "hold" ? "On Hold" : "Eligible", b.reason, row.id],
      );
    await c.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await c.query("ROLLBACK");
    res
      .status(400)
      .json({ error: e instanceof Error ? e.message : "Action failed" });
  } finally {
    c.release();
  }
});
router.post("/wallet/manual", async (req: R, res) => {
  const a = req.portalUser!;
  if (!admin(a))
    return void res.status(403).json({ error: "Admin access required" });
  const b = z
      .object({
        partner_id: z.string().uuid(),
        type: z.enum(["Manual Credit", "Manual Debit", "Refund Reversal"]),
        amount: z.coerce.number().positive(),
        reason: z.string().min(2),
      })
      .parse(req.body),
    signed = b.type === "Manual Credit" ? b.amount : -b.amount,
    q = await pool.query(
      `INSERT INTO referral_wallet_transactions(tenant_id,partner_id,transaction_type,amount,description,created_by)VALUES($1,$2,$3,$4,$5,$6)RETURNING *`,
      [a.tenantId, b.partner_id, b.type, signed, b.reason, a.sub],
    );
  res.status(201).json(q.rows[0]);
});
router.get("/broker-dashboard", async (req: R, res) => {
  const a = req.portalUser!;
  if (a.portal !== "broker")
    return void res.status(403).json({ error: "Broker access required" });
  await sync(a.tenantId);
  const [partner, summary, referrals, transactions, withdrawals] =
    await Promise.all([
      pool.query(
        `SELECT id,partner_code,name,phone,email,status,bank_details,kyc,minimum_withdrawal FROM referral_partners WHERE id=$1 AND tenant_id=$2`,
        [a.sub, a.tenantId],
      ),
      pool.query(
        `SELECT coalesce(sum(amount)FILTER(WHERE status='Posted'),0)-(SELECT coalesce(sum(amount),0) FROM referral_withdrawals WHERE partner_id=$1 AND tenant_id=$2 AND status IN('Requested','Approved')) available_balance,coalesce(sum(amount)FILTER(WHERE transaction_type='Commission Credit'),0) total_earned,coalesce(-sum(amount)FILTER(WHERE transaction_type='Withdrawal Debit'),0) total_paid,(SELECT coalesce(sum(commission_amount),0) FROM referral_commissions WHERE partner_id=$1 AND tenant_id=$2 AND status IN('Pending','Eligible','On Hold')) pending_amount,(SELECT coalesce(sum(amount),0) FROM referral_withdrawals WHERE partner_id=$1 AND tenant_id=$2 AND status IN('Requested','Approved')) pending_withdrawal FROM referral_wallet_transactions WHERE partner_id=$1 AND tenant_id=$2`,
        [a.sub, a.tenantId],
      ),
      pool.query(
        `SELECT pt.id patient_id,pt.medical_record_number,concat_ws(' ',pt.first_name,pt.last_name) patient_name,coalesce(b.total_bill,0) total_bill,coalesce(b.invoice_numbers,'No bill yet') invoice_numbers,coalesce(c.commission_amount,0) commission_amount,coalesce(c.services,'Pending billing') services,coalesce(c.statuses,'Referred') status FROM patients pt LEFT JOIN LATERAL(SELECT sum(f.total) total_bill,string_agg(f.record_number,', ' ORDER BY f.created_at DESC) invoice_numbers FROM finance_records f WHERE f.tenant_id=pt.tenant_id AND f.patient_id=pt.id AND f.kind IN('invoices','pharmacy-bill'))b ON true LEFT JOIN LATERAL(SELECT sum(rc.commission_amount) commission_amount,string_agg(DISTINCT rc.service_type,', ') services,string_agg(DISTINCT rc.status,', ') statuses FROM referral_commissions rc WHERE rc.tenant_id=pt.tenant_id AND rc.patient_id=pt.id AND rc.partner_id=$1)c ON true WHERE pt.tenant_id=$2 AND pt.referral_partner_id=$1 ORDER BY pt.referral_tagged_at DESC NULLS LAST,pt.created_at DESC`,
        [a.sub, a.tenantId],
      ),
      pool.query(
        `SELECT * FROM referral_wallet_transactions WHERE partner_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`,
        [a.sub, a.tenantId],
      ),
      pool.query(
        `SELECT * FROM referral_withdrawals WHERE partner_id=$1 AND tenant_id=$2 ORDER BY requested_at DESC`,
        [a.sub, a.tenantId],
      ),
    ]);
  res.json({
    partner: partner.rows[0],
    summary: summary.rows[0],
    referrals: referrals.rows,
    transactions: transactions.rows,
    withdrawals: withdrawals.rows,
  });
});
router.post("/withdrawals", async (req: R, res) => {
  const a = req.portalUser!,
    partner = a.portal === "broker" ? a.sub : req.body.partner_id;
  if (a.portal !== "broker" && !admin(a))
    return void res.status(403).json({ error: "Access denied" });
  const b = z
      .object({
        amount: z.coerce.number().positive(),
        method: z.enum(["Bank Transfer", "UPI", "Cash"]),
        notes: z.string().prefault(""),
      })
      .parse(req.body),
    balance = await pool.query(
      `SELECT coalesce(sum(amount),0)-(SELECT coalesce(sum(amount),0) FROM referral_withdrawals WHERE tenant_id=$1 AND partner_id=$2 AND status IN('Requested','Approved')) balance FROM referral_wallet_transactions WHERE tenant_id=$1 AND partner_id=$2 AND status='Posted'`,
      [a.tenantId, partner],
    ),
    p = await pool.query(
      `SELECT minimum_withdrawal,bank_details FROM referral_partners WHERE id=$1 AND tenant_id=$2`,
      [partner, a.tenantId],
    );
  if (
    !p.rows[0] ||
    b.amount < Number(p.rows[0].minimum_withdrawal) ||
    b.amount > Number(balance.rows[0].balance)
  )
    return void res.status(400).json({
      error: "Withdrawal is below the minimum or exceeds available balance",
    });
  const q = await pool.query(
    `INSERT INTO referral_withdrawals(tenant_id,partner_id,amount,method,account_details,notes)VALUES($1,$2,$3,$4,$5,$6)RETURNING *`,
    [a.tenantId, partner, b.amount, b.method, p.rows[0].bank_details, b.notes],
  );
  res.status(201).json(q.rows[0]);
});
router.post("/withdrawals/:id/action", async (req: R, res) => {
  const a = req.portalUser!;
  if (!admin(a))
    return void res.status(403).json({ error: "Admin access required" });
  const b = z
      .object({
        action: z.enum(["approve", "reject", "pay"]),
        payment_reference: z.string().prefault(""),
        notes: z.string().prefault(""),
      })
      .parse(req.body),
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const f = await c.query(
        `SELECT * FROM referral_withdrawals WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [req.params.id, a.tenantId],
      ),
      w = f.rows[0];
    if (!w) throw new Error("Withdrawal not found");
    if (b.action === "approve" && w.status === "Requested")
      await c.query(
        `UPDATE referral_withdrawals SET status='Approved',approved_by=$1,approved_at=now(),notes=$2 WHERE id=$3`,
        [a.sub, b.notes, w.id],
      );
    else if (
      b.action === "reject" &&
      ["Requested", "Approved"].includes(w.status)
    )
      await c.query(
        `UPDATE referral_withdrawals SET status='Rejected',notes=$1 WHERE id=$2`,
        [b.notes, w.id],
      );
    else if (b.action === "pay" && w.status === "Approved") {
      if (!b.payment_reference)
        throw new Error("Payment reference is required");
      const bal = await c.query(
        `SELECT coalesce(sum(amount),0) balance FROM referral_wallet_transactions WHERE partner_id=$1 AND tenant_id=$2`,
        [w.partner_id, a.tenantId],
      );
      if (Number(bal.rows[0].balance) < Number(w.amount))
        throw new Error("Insufficient wallet balance");
      await c.query(
        `UPDATE referral_withdrawals SET status='Paid',paid_by=$1,paid_at=now(),payment_reference=$2,notes=$3 WHERE id=$4`,
        [a.sub, b.payment_reference, b.notes, w.id],
      );
      await c.query(
        `INSERT INTO referral_wallet_transactions(tenant_id,partner_id,withdrawal_id,transaction_type,amount,reference,description,created_by)VALUES($1,$2,$3,'Withdrawal Debit',$4,$5,'Approved broker withdrawal',$6)`,
        [
          a.tenantId,
          w.partner_id,
          w.id,
          -Number(w.amount),
          b.payment_reference,
          a.sub,
        ],
      );
    } else throw new Error("Invalid withdrawal transition");
    await c.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await c.query("ROLLBACK");
    res
      .status(400)
      .json({ error: e instanceof Error ? e.message : "Action failed" });
  } finally {
    c.release();
  }
});
export default router;
