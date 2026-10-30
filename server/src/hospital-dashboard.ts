import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { pool } from "./db.js";
import { accessibleBranchIds, assertBranchAccess } from "./branch-access.js";

type Auth = { sub: string; tenantId: string; branchId: string; role: string; portal?: string };
type AuthedRequest = Request & { portalUser?: Auth };
const router = Router();

function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    req.portalUser = jwt.verify(
      req.header("authorization")?.replace(/^Bearer /i, "") ?? "",
      config.JWT_SECRET,
      { issuer: "careframe-api", audience: "careframe-portal" },
    ) as Auth;
    next();
  } catch {
    res.status(401).json({ error: "Session expired or invalid" });
  }
}

const money = (value: unknown) => Number(value || 0);
async function safeQuery(text: string, values: unknown[] = []) {
  try {
    return await pool.query(text, values);
  } catch (error) {
    console.error("Dashboard data source failed", error);
    return { rows: [] };
  }
}

router.get("/hospital", auth, async (req: AuthedRequest, res) => {
  const tenantId = req.portalUser!.tenantId;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to ?? ""))
    ? String(req.query.to)
    : new Date().toISOString().slice(0, 10);
  const fallbackFrom = new Date(`${to}T00:00:00Z`);
  fallbackFrom.setUTCDate(fallbackFrom.getUTCDate() - 29);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? ""))
    ? String(req.query.from)
    : fallbackFrom.toISOString().slice(0, 10);
  const requestedBranchId = /^[0-9a-f-]{36}$/i.test(String(req.query.branchId ?? ""))
    ? String(req.query.branchId)
    : null;
  if (requestedBranchId) await assertBranchAccess(req.portalUser!, requestedBranchId);
  const branchIds = requestedBranchId ? [requestedBranchId] : await accessibleBranchIds(req.portalUser!);
  const departmentId = /^[0-9a-f-]{36}$/i.test(
    String(req.query.departmentId ?? ""),
  )
    ? String(req.query.departmentId)
    : null;

  const dates = await pool.query(`SELECT ($2::date-$1::date+1)::int days`, [
    from,
    to,
  ]);
  const days = Math.max(1, Math.min(366, dates.rows[0].days));
  const values = [tenantId, from, to, branchIds, departmentId];

  const [
    patients,
    revenue,
    beds,
    waiting,
    trend,
    departments,
    queue,
    activity,
    lookups,
  ] = await Promise.all([
    safeQuery(
      `SELECT count(*) FILTER(WHERE p.created_at::date BETWEEN $2::date AND $3::date)::int current,
          count(*) FILTER(WHERE p.created_at::date BETWEEN $2::date-$5::int AND $2::date-1)::int previous
         FROM patients p WHERE p.tenant_id=$1 AND p.deleted_at IS NULL AND ($4::uuid[] IS NULL OR p.branch_id=ANY($4))`,
      [...values.slice(0, 4), days],
    ),
    safeQuery(
      `SELECT coalesce(sum(f.amount)FILTER(WHERE f.record_date BETWEEN $2::date AND $3::date),0) current,
          coalesce(sum(f.amount)FILTER(WHERE f.record_date BETWEEN $2::date-$5::int AND $2::date-1),0) previous
         FROM finance_records f WHERE f.tenant_id=$1 AND f.kind='payments' AND ($4::uuid[] IS NULL OR f.branch_id=ANY($4))`,
      [...values.slice(0, 4), days],
    ),
    safeQuery(
      `SELECT count(*)::int total,count(*)FILTER(WHERE lower(b.status)='occupied')::int occupied
         FROM beds b WHERE b.tenant_id=$1 AND ($4::uuid[] IS NULL OR b.branch_id=ANY($4))`,
      values.slice(0, 4),
    ),
    safeQuery(
      `SELECT count(*) FILTER(WHERE a.appointment_date BETWEEN $2::date AND $3::date AND lower(a.status) IN ('waiting','checked in','checked_in'))::int current,
          count(*) FILTER(WHERE a.appointment_date BETWEEN $2::date-$6::int AND $2::date-1 AND lower(a.status) IN ('waiting','checked in','checked_in'))::int previous
         FROM clinical_appointments a WHERE a.tenant_id=$1 AND ($4::uuid[] IS NULL OR a.branch_id=ANY($4)) AND ($5::uuid IS NULL OR a.department_id=$5)`,
      [...values, days],
    ),
    safeQuery(
      `SELECT to_char(d.day,'DD Mon') day,
          coalesce((SELECT sum(f.amount) FROM finance_records f WHERE f.tenant_id=$1 AND f.kind='payments' AND f.record_date=d.day::date AND ($4::uuid[] IS NULL OR f.branch_id=ANY($4))),0)::numeric revenue,
          coalesce((SELECT sum(f.amount) FROM finance_records f WHERE f.tenant_id=$1 AND f.kind='payments' AND f.record_date=d.day::date-$5::int AND ($4::uuid[] IS NULL OR f.branch_id=ANY($4))),0)::numeric previous
         FROM generate_series($2::date,$3::date,'1 day') d(day)
         ORDER BY d.day`,
      [...values.slice(0, 4), days],
    ),
    safeQuery(
      `SELECT coalesce(nullif(f.data->>'department',''),'Unassigned') name,coalesce(sum(f.amount),0)::numeric amount
         FROM finance_records f WHERE f.tenant_id=$1 AND f.kind='payments' AND f.record_date BETWEEN $2::date AND $3::date AND ($4::uuid[] IS NULL OR f.branch_id=ANY($4))
         GROUP BY 1 ORDER BY amount DESC LIMIT 6`,
      values.slice(0, 4),
    ),
    safeQuery(
      `SELECT coalesce(a.token_number,a.appointment_number) token,upper(concat(p.first_name,' ',p.last_name)) name,
          concat(coalesce(d.name,'General'),' · ',p.medical_record_number) meta,to_char(a.appointment_time,'HH12:MI AM') time,a.status
         FROM clinical_appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN departments d ON d.id=a.department_id
         WHERE a.tenant_id=$1 AND a.appointment_date=current_date AND lower(a.status) NOT IN ('completed','cancelled','no show','no_show')
          AND ($4::uuid[] IS NULL OR a.branch_id=ANY($4)) AND ($5::uuid IS NULL OR a.department_id=$5)
         ORDER BY a.appointment_time LIMIT 8`,
      values,
    ),
    safeQuery(
      `SELECT * FROM (
          SELECT 'Payment received' title,f.record_number::text detail,f.amount::text value,f.created_at occurred_at FROM finance_records f WHERE f.tenant_id=$1 AND f.kind='payments' AND ($2::uuid[] IS NULL OR f.branch_id=ANY($2))
          UNION ALL SELECT 'Patient registered',concat(p.first_name,' ',p.last_name),p.medical_record_number::text,p.created_at FROM patients p WHERE p.tenant_id=$1 AND p.deleted_at IS NULL AND ($2::uuid[] IS NULL OR p.branch_id=ANY($2))
          UNION ALL SELECT 'Appointment updated',a.appointment_number,a.status,a.updated_at FROM clinical_appointments a WHERE a.tenant_id=$1 AND ($2::uuid[] IS NULL OR a.branch_id=ANY($2))
          UNION ALL SELECT 'IPD admission',i.ipd_number,i.status,i.created_at FROM ipd_admissions i WHERE i.tenant_id=$1 AND ($2::uuid[] IS NULL OR i.branch_id=ANY($2))
         ) x ORDER BY occurred_at DESC LIMIT 8`,
      [tenantId, branchIds],
    ),
    Promise.all([
      safeQuery(
        `SELECT id,name FROM branches WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR id=ANY($2)) AND is_active=true ORDER BY name`,
        [tenantId, branchIds],
      ),
      safeQuery(
        `SELECT id,name,branch_id FROM departments WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2)) AND is_active=true ORDER BY name`,
        [tenantId, branchIds],
      ),
    ]),
  ]);

  const percentChange = (current: number, previous: number) =>
    previous ? ((current - previous) / previous) * 100 : current ? 100 : 0;
  const metric = (
    label: string,
    value: string,
    current: number,
    previous: number,
    tone: string,
  ) => ({
    label,
    value,
    change: `${percentChange(current, previous) >= 0 ? "+" : ""}${percentChange(current, previous).toFixed(1)}%`,
    tone,
  });
  const patientNow = Number(patients.rows[0]?.current || 0);
  const patientPrevious = Number(patients.rows[0]?.previous || 0);
  const revenueNow = money(revenue.rows[0]?.current);
  const revenuePrevious = money(revenue.rows[0]?.previous);
  const occupied = Number(beds.rows[0]?.occupied || 0);
  const bedTotal = Number(beds.rows[0]?.total || 0);
  const waitingNow = Number(waiting.rows[0]?.current || 0);
  const waitingPrevious = Number(waiting.rows[0]?.previous || 0);
  const departmentTotal = departments.rows.reduce(
    (sum, row) => sum + money(row.amount),
    0,
  );
  const colors = [
    "#5b8def",
    "#8057ed",
    "#23b3a4",
    "#f49a64",
    "#b9c7d9",
    "#e16f85",
  ];

  const financeWhere = `f.tenant_id=$1 AND f.record_date BETWEEN $2::date AND $3::date AND ($4::uuid[] IS NULL OR f.branch_id=ANY($4))`;
  const [financeTotals, financeTrend, paymentModes, expenseCategories, receivableAging, claimStatuses, doctorRevenue] = await Promise.all([
    safeQuery(`SELECT
      coalesce(sum(total) FILTER(WHERE kind IN ('invoices','pharmacy-bill')),0)::numeric billed,
      coalesce(sum(amount) FILTER(WHERE kind='payments'),0)::numeric collected,
      coalesce(sum(amount) FILTER(WHERE kind='expenses'),0)::numeric expenses,
      coalesce(sum(due) FILTER(WHERE kind='invoices'),0)::numeric outstanding,
      coalesce(sum(due) FILTER(WHERE kind='invoices' AND (data?'insurance_tpa' OR data?'insurance_company')),0)::numeric tpa_receivable,
      coalesce(sum(amount) FILTER(WHERE kind='refunds'),0)::numeric refunds,
      coalesce(sum(amount) FILTER(WHERE kind='payments' AND lower(coalesce(data->>'payment_mode',''))='cash'),0)::numeric cash_balance,
      coalesce(sum(amount) FILTER(WHERE kind='payments' AND lower(coalesce(data->>'payment_mode','')) IN ('bank','card','upi','online','bank transfer')),0)::numeric bank_balance,
      count(*) FILTER(WHERE kind='invoices' AND due>0)::int active_claims
      FROM finance_records f WHERE ${financeWhere}`, values.slice(0,4)),
    safeQuery(`SELECT to_char(d.day,'DD Mon') label,
      coalesce(sum(f.total) FILTER(WHERE f.kind IN ('invoices','pharmacy-bill')),0)::numeric revenue,
      coalesce(sum(f.amount) FILTER(WHERE f.kind='payments'),0)::numeric collection,
      coalesce(sum(f.amount) FILTER(WHERE f.kind='expenses'),0)::numeric expense,
      coalesce(sum(f.due) FILTER(WHERE f.kind='invoices'),0)::numeric outstanding,
      coalesce(sum(f.amount) FILTER(WHERE f.kind='refunds'),0)::numeric refunds
      FROM generate_series($2::date,$3::date,'1 day') d(day)
      LEFT JOIN finance_records f ON f.record_date=d.day::date AND f.tenant_id=$1 AND ($4::uuid[] IS NULL OR f.branch_id=ANY($4))
      GROUP BY d.day ORDER BY d.day`, values.slice(0,4)),
    safeQuery(`SELECT coalesce(nullif(initcap(data->>'payment_mode'),''),'Other') name,sum(amount)::numeric value FROM finance_records f WHERE ${financeWhere} AND kind='payments' GROUP BY 1 ORDER BY value DESC LIMIT 6`, values.slice(0,4)),
    safeQuery(`SELECT coalesce(nullif(data->>'category',''),initcap(replace(kind,'-',' '))) name,sum(amount)::numeric value FROM finance_records f WHERE ${financeWhere} AND kind='expenses' GROUP BY 1 ORDER BY value DESC LIMIT 7`, values.slice(0,4)),
    safeQuery(`SELECT CASE WHEN current_date-record_date<=30 THEN '0-30d' WHEN current_date-record_date<=60 THEN '31-60d' WHEN current_date-record_date<=90 THEN '61-90d' ELSE '90+d' END name,sum(due)::numeric value FROM finance_records f WHERE ${financeWhere} AND kind='invoices' AND due>0 GROUP BY 1 ORDER BY min(current_date-record_date)`, values.slice(0,4)),
    safeQuery(`SELECT status name,sum(claimed_amount)::numeric value FROM insurance_claims WHERE tenant_id=$1 AND submission_date BETWEEN $2::date AND $3::date GROUP BY status ORDER BY value DESC`, values.slice(0,3)),
    safeQuery(`SELECT coalesce(nullif(data->>'doctor_name',''),nullif(data->>'doctor',''),'Unassigned') name,sum(total)::numeric value FROM finance_records f WHERE ${financeWhere} AND kind IN ('invoices','pharmacy-bill') GROUP BY 1 ORDER BY value DESC LIMIT 7`, values.slice(0,4)),
  ]);
  const ft = financeTotals.rows[0] || {};
  const billed = money(ft.billed), collected = money(ft.collected), expenses = money(ft.expenses), refunds = money(ft.refunds);

  res.json({
    metrics: [
      metric(
        "Patients registered",
        String(patientNow),
        patientNow,
        patientPrevious,
        "blue",
      ),
      metric(
        "Revenue collected",
        `₹${revenueNow.toLocaleString("en-IN")}`,
        revenueNow,
        revenuePrevious,
        "violet",
      ),
      {
        label: "Bed occupancy",
        value: bedTotal ? `${Math.round((occupied / bedTotal) * 100)}%` : "0%",
        change: `${occupied} / ${bedTotal}`,
        tone: "orange",
      },
      metric(
        "Waiting patients",
        String(waitingNow),
        waitingNow,
        waitingPrevious,
        "green",
      ),
    ],
    totals: {
      revenue: revenueNow,
      previousRevenue: revenuePrevious,
      patients: patientNow,
      waiting: waitingNow,
      occupied,
      beds: bedTotal,
    },
    trendData: trend.rows.map((row) => ({
      day: row.day,
      revenue: money(row.revenue),
      previous: money(row.previous),
    })),
    departments: departments.rows.map((row, index) => ({
      name: row.name,
      amount: money(row.amount),
      value: departmentTotal
        ? Math.round((money(row.amount) / departmentTotal) * 100)
        : 0,
      color: colors[index % colors.length],
    })),
    finance: {
      totals: { billed, collected, expenses, outstanding: money(ft.outstanding), tpaReceivable: money(ft.tpa_receivable), refunds, cashBalance: money(ft.cash_balance), bankBalance: money(ft.bank_balance), activeClaims: Number(ft.active_claims || 0), netProfit: collected-expenses-refunds, collectionEfficiency: billed ? collected/billed*100 : 0 },
      trend: financeTrend.rows.map(row => ({ label: row.label, revenue: money(row.revenue), collection: money(row.collection), expense: money(row.expense), outstanding: money(row.outstanding), profit: money(row.collection)-money(row.expense)-money(row.refunds), refunds: money(row.refunds) })),
      paymentModes: paymentModes.rows.map(row => ({ name: row.name, value: money(row.value) })),
      expenseCategories: expenseCategories.rows.map(row => ({ name: row.name, value: money(row.value) })),
      receivableAging: receivableAging.rows.map(row => ({ name: row.name, value: money(row.value) })),
      claimStatuses: claimStatuses.rows.map(row => ({ name: row.name, value: money(row.value) })),
      doctorRevenue: doctorRevenue.rows.map(row => ({ name: row.name, value: money(row.value) })),
    },
    queue: queue.rows.map((row) => ({
      ...row,
      tone: String(row.status).toLowerCase().replaceAll(" ", "-"),
    })),
    activityFeed: activity.rows.map((row) => ({
      ...row,
      occurredAt: row.occurred_at,
    })),
    filters: { branches: lookups[0].rows, departments: lookups[1].rows },
    range: { from, to, days },
    generatedAt: new Date().toISOString(),
  });
});

export default router;
