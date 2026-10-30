import {useEffect,useRef,useState,type ReactElement,type ElementType} from 'react';
import {ArrowDownRight,ArrowUpRight,CalendarDays,ChevronRight,Download,MoreHorizontal,Plus,Sparkles} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {getDashboard} from '../api';
import type {Role} from '../data';
type Metric = {
  label: string;
  value: string;
  change: string;
  tone: string;
  icon: ElementType;
};

function StatCard({ metric }: { metric: Metric }) {
  const positive = !metric.change.startsWith("-");
  return (
    <article className="stat-card">
      <div className={`stat-icon ${metric.tone}`}>
        <metric.icon size={21} />
      </div>
      <div className="stat-top">
        <span>{metric.label}</span>
        <button>
          <MoreHorizontal size={18} />
        </button>
      </div>
      <strong>{metric.value}</strong>
      <div className="stat-foot">
        <span className={positive ? "positive" : "negative"}>
          {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {metric.change}
        </span>
        <small>vs previous period</small>
      </div>
    </article>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <small>{label}</small>
      <strong>₹{payload[0].value}K</strong>
      <span>Revenue</span>
    </div>
  );
}

export default function Overview({
  role,
  initialData,
  token,
  userName,
}: {
  role: Role;
  initialData: Awaited<ReturnType<typeof getDashboard>>;
  token?: string;
  userName?: string;
}) {
  const [period, setPeriod] = useState("Last 30 days");
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [data, setData] = useState(initialData);
  const initialRequest=useRef(true);
  useEffect(() => {
    if (!token) return;
    // The shell already fetched the default period used by this first render.
    if(initialRequest.current){initialRequest.current=false;return;}
    const toDate = new Date();
    const fromDate = new Date(toDate);
    if (period === "Yesterday") {
      toDate.setDate(toDate.getDate() - 1);
      fromDate.setTime(toDate.getTime());
    } else if (period === "Last 7 days") {
      fromDate.setDate(fromDate.getDate() - 6);
    } else if (period === "Last 30 days") {
      fromDate.setDate(fromDate.getDate() - 29);
    }
    const date = (value: Date) => value.toISOString().slice(0, 10);
    getDashboard(
      role,
      {
        from: date(fromDate),
        to: date(toDate),
        branchId: branchId || undefined,
        departmentId: departmentId || undefined,
      },
      token,
    ).then(setData);
  }, [period, branchId, departmentId, role, token]);
  const totalRevenue = Number(data.totals?.revenue || 0);
  const previousRevenue = Number(data.totals?.previousRevenue || 0);
  const revenueChange = previousRevenue
    ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
    : totalRevenue
      ? 100
      : 0;
  const formatMoney = (value: number) => `₹${value.toLocaleString("en-IN")}`;
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="breadcrumb">
            Home <ChevronRight size={13} /> Dashboard
          </div>
          <h1>
            Good morning, {userName?.split(" ")[0] || "Admin"} <span>👋</span>
          </h1>
          <p>Here’s what’s happening across your hospital today.</p>
        </div>
        <div className="heading-actions">
          <button className="btn secondary">
            <Download size={17} /> Export
          </button>
          <button className="btn primary">
            <Plus size={17} /> Quick action
          </button>
        </div>
      </section>
      <div className="filterbar">
        {["Today", "Yesterday", "Last 7 days", "Last 30 days"].map((p) => (
          <button
            className={period === p ? "selected" : ""}
            onClick={() => setPeriod(p)}
            key={p}
          >
            {p}
          </button>
        ))}
        <span className="filter-spacer" />
        <select
          className="filter-select"
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
        >
          <option value="">All branches</option>
          {data.filters?.branches.map(
            (branch: { id: string; name: string }) => (
              <option value={branch.id} key={branch.id}>
                {branch.name}
              </option>
            ),
          )}
        </select>
        <select
          className="filter-select"
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
        >
          <option value="">All departments</option>
          {data.filters?.departments
            .filter(
              (department: { branch_id?: string }) =>
                !branchId || department.branch_id === branchId,
            )
            .map((department: { id: string; name: string }) => (
              <option value={department.id} key={department.id}>
                {department.name}
              </option>
            ))}
        </select>
        <button className="filter-select">
          <CalendarDays size={16} /> {data.range?.from} – {data.range?.to}
        </button>
      </div>
      <div className="metrics-grid">
        {data.metrics.map((m: Metric) => (
          <StatCard key={m.label} metric={m} />
        ))}
      </div>
      <div className="insight-banner">
        <div className="spark-icon">
          <Sparkles size={19} />
        </div>
        <div>
          <span>AI MANAGEMENT INSIGHT</span>
          <strong>
            Revenue is {revenueChange >= 0 ? "up" : "down"}{" "}
            {Math.abs(revenueChange).toFixed(1)}% for this period
          </strong>
          <p>
            {data.departments[0]?.name || "No department"} is the leading
            revenue source. {data.totals?.patients || 0} patients were
            registered in the selected period.
          </p>
        </div>
        <div className="insight-metric">
          <small>Underlying metric</small>
          <strong>
            {formatMoney(totalRevenue)}{" "}
            <em>
              {revenueChange >= 0 ? "+" : ""}
              {revenueChange.toFixed(1)}%
            </em>
          </strong>
          <span>vs {formatMoney(previousRevenue)} previous period</span>
        </div>
        <button>
          View analysis <ChevronRight size={15} />
        </button>
      </div>
      <div className="analytics-grid">
        <article className="panel revenue-panel">
          <div className="panel-head">
            <div>
              <h2>
                {role === "Super Admin"
                  ? "Subscription revenue"
                  : "Revenue overview"}
              </h2>
              <p>Daily performance compared to previous period</p>
            </div>
            <button className="dots">
              <MoreHorizontal size={20} />
            </button>
          </div>
          <div className="chart-summary">
            <div>
              <small>Total revenue</small>
              <strong>{formatMoney(totalRevenue)}</strong>
              <span className="positive">
                <ArrowUpRight size={14} /> {revenueChange.toFixed(1)}%
              </span>
            </div>
            <div className="legend">
              <span>
                <i className="current" /> Current period
              </span>
              <span>
                <i /> Previous period
              </span>
            </div>
          </div>
          <div className="main-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trendData} margin={{ left: -25, right: 4 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5b8def" stopOpacity=".28" />
                    <stop offset="100%" stopColor="#5b8def" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#e9edf3"
                  strokeDasharray="4 4"
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#8a94a6", fontSize: 11 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#8a94a6", fontSize: 11 }}
                  tickFormatter={(v) => `₹${v}K`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="previous"
                  stroke="#b6bfcc"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  fill="transparent"
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#4f7fe5"
                  strokeWidth={2.5}
                  fill="url(#rev)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Revenue by department</h2>
              <p>Contribution to total revenue</p>
            </div>
            <button className="dots">
              <MoreHorizontal size={20} />
            </button>
          </div>
          <div className="donut-wrap">
            <div className="donut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.departments}
                    dataKey="value"
                    innerRadius={63}
                    outerRadius={84}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {data.departments.map(
                      (d: { name: string; color: string }) => (
                        <Cell key={d.name} fill={d.color} />
                      ),
                    )}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-label">
                <strong>{formatMoney(totalRevenue)}</strong>
                <span>Total</span>
              </div>
            </div>
            <div className="department-list">
              {data.departments.map(
                (d: {
                  name: string;
                  color: string;
                  amount: string;
                  value: number;
                }) => (
                  <div key={d.name}>
                    <span>
                      <i style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <strong>
                      {d.amount}
                      <small>{d.value}%</small>
                    </strong>
                  </div>
                ),
              )}
            </div>
          </div>
        </article>
      </div>
      {data.finance && (
        <FinanceAnalytics
          finance={data.finance}
          departments={data.departments}
        />
      )}
      <div className="bottom-grid">
        <article className="panel queue-panel">
          <div className="panel-head">
            <div>
              <h2>Live patient queue</h2>
              <p>Current outpatient flow across departments</p>
            </div>
            <button className="text-button">
              View all <ChevronRight size={15} />
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Patient</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.queue.map((q: (typeof data.queue)[number]) => (
                  <tr key={q.token}>
                    <td>
                      <strong className="token">{q.token}</strong>
                    </td>
                    <td>
                      <strong>{q.name}</strong>
                      <small>{q.meta}</small>
                    </td>
                    <td>{q.time}</td>
                    <td>
                      <span className={`badge ${q.tone}`}>{q.status}</span>
                    </td>
                    <td>
                      <MoreHorizontal size={17} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="panel activity-panel">
          <div className="panel-head">
            <div>
              <h2>Recent activity</h2>
              <p>Live operational updates</p>
            </div>
            <button className="dots">
              <MoreHorizontal size={20} />
            </button>
          </div>
          <div className="feed">
            {data.activityFeed.map(
              (a: (typeof data.activityFeed)[number], i: number) => (
                <div className="feed-item" key={a.title}>
                  <div className={`feed-icon c${i}`}>
                    <a.icon size={17} />
                  </div>
                  <div>
                    <strong>{a.title}</strong>
                    <span>{a.detail}</span>
                  </div>
                  <div>
                    <strong>{a.value}</strong>
                    <small>{a.time} ago</small>
                  </div>
                </div>
              ),
            )}
          </div>
          <button className="activity-more">View all activity</button>
        </article>
      </div>
    </>
  );
}

type FinancePoint = {
  label?: string;
  name?: string;
  value?: number;
  revenue?: number;
  collection?: number;
  expense?: number;
  outstanding?: number;
  profit?: number;
  refunds?: number;
};

function FinanceAnalytics({
  finance,
  departments,
}: {
  finance: any;
  departments: Array<{ name: string; amount: string; value: number }>;
}) {
  const t = finance.totals || {};
  const money = (value: number) =>
    `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const compact = (value: number) =>
    `₹${(Number(value || 0) / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
  const kpis = [
    ["Total billing", t.billed, "Gross invoices raised", "blue"],
    [
      "Total collection",
      t.collected,
      `${Number(t.collectionEfficiency || 0).toFixed(1)}% collection efficiency`,
      "green",
    ],
    ["Total expense", t.expenses, "Operational spending", "orange"],
    [
      "Outstanding",
      t.outstanding,
      `${t.activeClaims || 0} open receivables`,
      "red",
    ],
    ["TPA receivable", t.tpaReceivable, "Insurance-backed dues", "violet"],
    [
      "Net profit",
      t.netProfit,
      "Collection less costs",
      Number(t.netProfit) >= 0 ? "green" : "red",
    ],
    ["Bank balance", t.bankBalance, "Non-cash collections", "blue"],
    ["Cash balance", t.cashBalance, "Cash collections", "green"],
    ["Refunds", t.refunds, "Refunded in selected period", "red"],
    [
      "Accounts payable",
      t.expenses,
      "Recorded operating liabilities",
      "orange",
    ],
    ["Period revenue", t.billed, "Billing across selected dates", "blue"],
    [
      "Period expense",
      t.expenses,
      `${t.billed ? ((t.expenses / t.billed) * 100).toFixed(1) : "0.0"}% of billed revenue`,
      "orange",
    ],
  ];
  const departmentBars = departments.map((d) => ({
    name: d.name,
    value: Number(String(d.amount).replace(/[^0-9.-]/g, "")) || 0,
  }));
  const colors = [
    "#4f7fe5",
    "#20a682",
    "#f39a32",
    "#865ad9",
    "#e35e67",
    "#23b3a4",
  ];
  return (
    <section className="finance-analytics">
      <div className="finance-title">
        <div>
          <span>FINANCIAL INTELLIGENCE</span>
          <h2>Revenue, collection & payment analytics</h2>
          <p>Live performance for the selected dashboard filters</p>
        </div>
        <strong>
          {money(t.netProfit)}
          <small>Net cash position</small>
        </strong>
      </div>
      <div className="finance-kpis">
        {kpis.map(([label, value, note, tone]) => (
          <article className={`finance-kpi ${tone}`} key={String(label)}>
            <span>{label}</span>
            <strong>{compact(Number(value))}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <div className="finance-chart-grid">
        <FinanceChart
          title="Revenue vs expense vs profit"
          subtitle="Daily financial movement"
        >
          <LineChart data={finance.trend}>
            <CartesianGrid vertical={false} stroke="#edf0f4" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Legend />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#4f7fe5"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="expense"
              stroke="#f39a32"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="profit"
              stroke="#20a682"
              strokeWidth={2}
            />
          </LineChart>
        </FinanceChart>
        <FinanceChart
          title="Revenue by department"
          subtitle="Contribution across clinical services"
        >
          <BarChart
            data={departmentBars}
            layout="vertical"
            margin={{ left: 15 }}
          >
            <CartesianGrid horizontal={false} stroke="#edf0f4" />
            <XAxis
              type="number"
              tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            />
            <YAxis type="category" dataKey="name" width={75} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Bar dataKey="value" fill="#4f7fe5" radius={[0, 4, 4, 0]} />
          </BarChart>
        </FinanceChart>
        <FinanceChart
          title="Collection vs outstanding"
          subtitle="Cash realization and exposure"
        >
          <BarChart data={finance.trend}>
            <CartesianGrid vertical={false} stroke="#edf0f4" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Legend />
            <Bar dataKey="collection" stackId="a" fill="#4f7fe5" />
            <Bar
              dataKey="outstanding"
              stackId="a"
              fill="#f39a32"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </FinanceChart>
        <FinanceChart title="Payment mode mix" subtitle="How patients paid">
          <PieChart>
            <Pie
              data={finance.paymentModes}
              dataKey="value"
              nameKey="name"
              innerRadius={48}
              outerRadius={78}
              paddingAngle={2}
            >
              {finance.paymentModes.map((_: FinancePoint, i: number) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => money(Number(v))} />
            <Legend />
          </PieChart>
        </FinanceChart>
        <FinanceChart
          title="Receivable aging"
          subtitle="Outstanding invoices by age"
        >
          <BarChart data={finance.receivableAging}>
            <CartesianGrid vertical={false} stroke="#edf0f4" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Bar dataKey="value" fill="#865ad9" radius={[4, 4, 0, 0]} />
          </BarChart>
        </FinanceChart>
        <FinanceChart
          title="Insurance / TPA claim status"
          subtitle="Claim value by workflow stage"
        >
          <BarChart data={finance.claimStatuses}>
            <CartesianGrid vertical={false} stroke="#edf0f4" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Bar dataKey="value" fill="#23b3a4" radius={[4, 4, 0, 0]} />
          </BarChart>
        </FinanceChart>
        <FinanceChart
          title="Doctor-wise revenue"
          subtitle="Professional revenue attribution"
        >
          <BarChart
            data={finance.doctorRevenue}
            layout="vertical"
            margin={{ left: 15 }}
          >
            <CartesianGrid horizontal={false} stroke="#edf0f4" />
            <XAxis
              type="number"
              tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            />
            <YAxis type="category" dataKey="name" width={75} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Bar dataKey="value" fill="#4f7fe5" radius={[0, 4, 4, 0]} />
          </BarChart>
        </FinanceChart>
        <FinanceChart
          title="Expense category mix"
          subtitle="Where operational spend goes"
        >
          <BarChart
            data={finance.expenseCategories}
            layout="vertical"
            margin={{ left: 15 }}
          >
            <CartesianGrid horizontal={false} stroke="#edf0f4" />
            <XAxis
              type="number"
              tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            />
            <YAxis type="category" dataKey="name" width={75} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Bar dataKey="value" fill="#f39a32" radius={[0, 4, 4, 0]} />
          </BarChart>
        </FinanceChart>
        <FinanceChart title="Refund trend" subtitle="Daily refund movement">
          <AreaChart data={finance.trend}>
            <CartesianGrid vertical={false} stroke="#edf0f4" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Area
              type="monotone"
              dataKey="refunds"
              stroke="#e35e67"
              fill="#ffe8ed"
              strokeWidth={2}
            />
          </AreaChart>
        </FinanceChart>
        <FinanceChart
          title="Cash flow"
          subtitle="Collection, expense and net position"
        >
          <LineChart data={finance.trend}>
            <CartesianGrid vertical={false} stroke="#edf0f4" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v) => money(Number(v))} />
            <Legend />
            <Line
              type="monotone"
              dataKey="collection"
              stroke="#4f7fe5"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="expense"
              stroke="#f39a32"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="profit"
              stroke="#20a682"
              strokeWidth={2}
            />
          </LineChart>
        </FinanceChart>
      </div>
    </section>
  );
}

function FinanceChart({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactElement;
}) {
  return (
    <article className="panel finance-chart">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <MoreHorizontal size={18} />
      </div>
      <div className="finance-chart-body">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </article>
  );
}
