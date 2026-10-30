import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import SiteActivity from '../hospital/SiteActivity';
import WorkspaceLink from '../components/WorkspaceLink';
import {ADMIN_SESSION_KEY,restoreTabSession,TAB_SESSION_EVENT} from '../tab-session';
import Swal from "sweetalert2";
import { pageFromPath, routeSlug, updateBrowserPath } from "../navigation";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  Code2,
  CreditCard,
  Database,
  Edit3,
  FileBarChart,
  Globe2,
  Hospital,
  ImageIcon,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  UserRound,
  X,
  Boxes,
  Clock3,
  TrendingUp,
  Trash2,
  Upload,
  Link2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { adminApi, auth } from "./api";
import { usePlatformBranding, type PlatformBranding } from "../branding";
import { HospitalForm, PlanForm } from "./AdminForms";
import PlanList from "./PlanList";
import "./superadmin.css";

type Page =
  | "Dashboard"
  | "Hospitals"
  | "Subscriptions"
  | "Modules"
  | "Reports"
  | "Monitoring"
  | "CRM Connections"
  | "Platform Settings"
  | "Create Hospital"
  | "Edit Hospital"
  | "Create Plan"
  | "Edit Plan";
type Dashboard = {
  hospitals: {
    total: number;
    active: number;
    trial: number;
    suspended: number;
  };
  subscriptions: { active: number; expiring: number; monthly_revenue: string };
  users: { total: number };
  modules: { active: number };
  growth: { month: string; total: number }[];
  planDistribution: { name: string; value: number }[];
  activity: Event[];
};
type HospitalRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  branches: number;
  users: number;
  plan_code: string | null;
  subscription_status: string | null;
  expires_at: string | null;
};
type ModuleRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  enabled_hospitals: number;
};
type Subscription = {
  id: string;
  tenant_id: string;
  hospital_name: string;
  plan_code: string;
  status: string;
  starts_at: string;
  expires_at: string;
  monthly_amount: string;
};
type Setting = {
  key: string;
  value: unknown;
  category: string;
  description: string;
  is_public: boolean;
};
type Event = {
  id: number;
  severity: string;
  source: string;
  message: string;
  hospital_name?: string;
  created_at: string;
};

const nav: { label: Page; icon: typeof LayoutDashboard }[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Hospitals", icon: Hospital },
  { label: "CRM Connections", icon: Link2 },
  { label: "Subscriptions", icon: CreditCard },
  { label: "Modules", icon: Boxes },
  { label: "Reports", icon: FileBarChart },
  { label: "Monitoring", icon: Activity },
  { label: "Platform Settings", icon: Settings },
];

function Login({ onLogin, branding }: { onLogin: () => void; branding: PlatformBranding }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await adminApi<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      auth.set(result.token);
      onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="sa-login">
      <div className="sa-login-art">
        <div className="sa-brand">
          <span className={`sa-brandmark ${branding.logo ? "has-logo" : ""}`}>{branding.logo ? <img src={branding.logo} alt="" /> : branding.name.charAt(0).toUpperCase()}</span>
          <span className="sa-brandname">{branding.name}</span>
        </div>
        <div>
          <span className="eyebrow">PLATFORM COMMAND CENTRE</span>
          <h1>Operate every hospital from one secure place.</h1>
          <p>
            Tenant lifecycle, subscriptions, modules, reporting and platform
            health—designed for confident SaaS operations.
          </p>
          <div className="login-proof">
            <span>
              <ShieldCheck /> Tenant-safe controls
            </span>
            <span>
              <Activity /> Live monitoring
            </span>
            <span>
              <BarChart3 /> Platform analytics
            </span>
          </div>
        </div>
        <small>{branding.name} Cloud · Enterprise Operations</small>
      </div>
      <form className="sa-login-form" onSubmit={submit}>
        <div className="login-card">
          <div className="login-icon">
            <LockKeyhole />
          </div>
          <h2>Super Admin access</h2>
          <p>Sign in to manage the {branding.name} platform.</p>
          <label>
            Username
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </label>
          {error && (
            <div className="form-error">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}
          <button className="sa-primary login-submit" disabled={loading}>
            {loading ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ShieldCheck size={18} />
            )}{" "}
            Sign in securely
          </button>
          <div className="secure-note">
            <LockKeyhole size={13} /> Protected administrative area
          </div>
        </div>
      </form>
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`sa-card ${className}`}>{children}</section>;
}
function Badge({ value }: { value: string }) {
  return (
    <span className={`sa-badge ${value.toLowerCase().replace("_", "-")}`}>
      {value.replace("_", " ")}
    </span>
  );
}
function PageHead({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="sa-pagehead">
      <div>
        <small>Platform / {title}</small>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function Loading() {
  return (
    <div className="sa-loading">
      <LoaderCircle className="spin" />
      <span>Loading platform data…</span>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="sa-empty">
      <Database />
      <h3>No data yet</h3>
      <p>{text}</p>
    </div>
  );
}

function LegacyDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const load = useCallback(
    () => adminApi<Dashboard>("/dashboard").then(setData),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!data) return <Loading />;
  const metrics = [
    [
      "Total hospitals",
      data.hospitals.total,
      `${data.hospitals.active} active`,
      Hospital,
      "blue",
    ],
    [
      "Active subscriptions",
      data.subscriptions.active,
      `${data.subscriptions.expiring} expiring`,
      CreditCard,
      "green",
    ],
    ["Platform users", data.users.total, "Across all tenants", Users, "violet"],
    [
      "Monthly revenue",
      `₹${Number(data.subscriptions.monthly_revenue).toLocaleString("en-IN")}`,
      "Subscription MRR",
      CircleDollarSign,
      "orange",
    ],
  ] as const;
  return (
    <>
      <PageHead
        title="Platform overview"
        text="Live SaaS performance, growth, revenue and tenant activity."
        action={
          <button className="sa-secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh data
          </button>
        }
      />
      <div className="sa-metrics">
        {metrics.map(([label, value, help, Icon, tone]) => (
          <Card key={label} className="sa-metric">
            <div className={`metric-icon ${tone}`}>
              <Icon />
            </div>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{help}</small>
          </Card>
        ))}
      </div>
      <div className="sa-status-strip">
        <div>
          <i className="ok" />
          <span>Platform operational</span>
          <small>All core services responding</small>
        </div>
        <div>
          <span>Trial hospitals</span>
          <strong>{data.hospitals.trial}</strong>
        </div>
        <div>
          <span>Suspended</span>
          <strong>{data.hospitals.suspended}</strong>
        </div>
        <div>
          <span>Active modules</span>
          <strong>{data.modules.active}</strong>
        </div>
      </div>
      <div className="sa-dashboard-grid">
        <Card>
          <div className="sa-cardhead">
            <div>
              <h2>Hospital growth</h2>
              <p>Registrations over the last six months</p>
            </div>
            <TrendingUp />
          </div>
          <div className="sa-chart">
            <ResponsiveContainer>
              <AreaChart data={data.growth}>
                <defs>
                  <linearGradient id="growth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#577ee8" stopOpacity=".28" />
                    <stop offset="1" stopColor="#577ee8" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#e8edf5"
                  strokeDasharray="4 4"
                />
                <XAxis dataKey="month" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip />
                <Area
                  dataKey="total"
                  type="monotone"
                  stroke="#527be0"
                  strokeWidth={3}
                  fill="url(#growth)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="sa-cardhead">
            <div>
              <h2>Recent platform activity</h2>
              <p>System and tenant events</p>
            </div>
            <Activity />
          </div>
          <div className="event-list">
            {data.activity.map((e) => (
              <div className="event" key={e.id}>
                <span className={`event-dot ${e.severity}`} />
                <div>
                  <strong>{e.message}</strong>
                  <small>
                    {e.hospital_name ?? e.source} ·{" "}
                    {new Date(e.created_at).toLocaleString()}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function DashboardPage() {
  const [refreshing, setRefreshing] = useState(false);
  const growth = [
    ["Aug",49,7],["Sep",65,9],["Oct",80,13],["Nov",89,16],["Dec",99,24],["Jan",106,20],
    ["Feb",108,18],["Mar",110,17],["Apr",116,21],["May",122,24],["Jun",127,26],["Jul",134,27],
  ].map(([month,total,newHospitals]) => ({ month, total, newHospitals }));
  const revenue = [
    ["Aug",3.1,.8],["Sep",5.5,1.2],["Oct",6,1.1],["Nov",6.1,1.3],["Dec",5.9,1.4],["Jan",6.8,1.8],
    ["Feb",5.2,1.5],["Mar",6.8,1.9],["Apr",6.4,2.1],["May",5.9,2],["Jun",7.7,2.3],["Jul",7.9,2.6],
  ].map(([month,mrr,newRevenue]) => ({ month, mrr, newRevenue }));
  const plans = [
    { name:"Enterprise", value:38, color:"#5146e5" }, { name:"Premium", value:32, color:"#5b7df0" },
    { name:"Standard", value:27, color:"#35c7a1" }, { name:"Starter", value:11, color:"#f7bf4d" },
  ];
  const metrics = [
    ["Total Hospitals","124","↑ 8.6%","vs last month",Hospital,"blue"],
    ["Active Subscriptions","108","↑ 4.2%","vs last month",CreditCard,"green"],
    ["Trial Hospitals","9","↓ 2","ending this week",UserRound,"orange"],
    ["Monthly Recurring Revenue","₹8.40L","↑ 12.4%","vs last month",CircleDollarSign,"violet"],
    ["Platform Users","4,850","↑ 7.1%","vs last month",Users,"blue"],
    ["Renewals / Expiry","12","View upcoming →","next 30 days",CalendarDays,"pink"],
  ] as const;
  const modules = [["OPD & Appointments",92],["Billing & Finance",88],["Pharmacy",76],["Laboratory",71],["IPD & Bed Management",64],["Radiology",52],["Patient Portal",47],["AI Features",31]] as const;
  const usage = [
    { Icon:Users, label:"Patients Managed", value:"48,450", tone:"blue" },
    { Icon:CalendarDays, label:"Appointments (This Month)", value:"22,840", tone:"violet" },
    { Icon:Code2, label:"API Requests", value:"1.8M", tone:"green" },
    { Icon:Cloud, label:"Storage Used", value:"420 GB", tone:"blue" },
  ];
  const activity = [
    ["NovaCare Hospital was registered","29 Jul 2026, 06:57 PM","green"],
    ["Enterprise subscription activated for NovaCare Hospital","29 Jul 2026, 06:31 PM","blue"],
    ["CityCare Hospital upgraded to Premium plan","29 Jul 2026, 06:12 PM","violet"],
    ["Payment received from HealthPlus Hospital","29 Jul 2026, 04:48 PM","green"],
    ["Sunrise Hospital storage usage crossed 75%","29 Jul 2026, 02:21 PM","red"],
  ];
  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 800);
  };
  return (
    <>
      <PageHead title="Welcome back, Super Admin" text="Here's what's happening with your platform today."
        action={<button className="sa-secondary" onClick={refresh}><RefreshCw className={refreshing ? "spin" : ""} size={16}/> Refresh</button>} />
      <div className="sa-metrics sa-metrics-six">
        {metrics.map(([label,value,change,help,Icon,tone]) => <Card key={label} className="sa-metric">
          <div className={`metric-icon ${tone}`}><Icon/></div><span>{label}</span><strong>{value}</strong>
          <small><b className={change.includes("↓") ? "down" : ""}>{change}</b> {help}</small>
        </Card>)}
      </div>
      <div className="sa-dashboard-grid sa-primary-charts">
        <Card><div className="sa-cardhead"><div><h2>Hospital Growth</h2><p>Registrations over time</p></div><select className="dash-select"><option>12 Months</option></select></div>
          <div className="sa-chart"><ResponsiveContainer><AreaChart data={growth}>
            <defs><linearGradient id="growth2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#635bff" stopOpacity=".2"/><stop offset="1" stopColor="#635bff" stopOpacity="0"/></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#e8edf5" strokeDasharray="4 4"/><XAxis dataKey="month" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Legend verticalAlign="top" height={34}/>
            <Area name="Total Hospitals" dataKey="total" type="monotone" stroke="#635bff" strokeWidth={2.5} fill="url(#growth2)"/><Area name="New Hospitals" dataKey="newHospitals" type="monotone" stroke="#36c9a2" strokeWidth={2} fill="transparent"/>
          </AreaChart></ResponsiveContainer></div>
        </Card>
        <Card><div className="sa-cardhead"><div><h2>Subscription Revenue</h2><p>MRR over time</p></div><select className="dash-select"><option>12 Months</option></select></div>
          <div className="sa-chart"><ResponsiveContainer><BarChart data={revenue}>
            <CartesianGrid vertical={false} stroke="#e8edf5" strokeDasharray="4 4"/><XAxis dataKey="month" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v}L`}/><Tooltip/><Legend verticalAlign="top" height={34}/>
            <Bar name="MRR (₹)" dataKey="mrr" fill="#526dff" radius={[3,3,0,0]}/><Bar name="New Revenue (₹)" dataKey="newRevenue" fill="#73ddc1" radius={[3,3,0,0]}/><Line dataKey="mrr" stroke="#665cff" strokeWidth={2}/>
          </BarChart></ResponsiveContainer></div>
        </Card>
      </div>
      <div className="sa-insight-grid">
        <Card className="dash-panel plan-panel"><div className="sa-cardhead"><div><h2>Plan Distribution</h2><p>By active subscriptions</p></div></div>
          <div className="plan-content"><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={plans} dataKey="value" cx="50%" cy="50%" innerRadius={43} outerRadius={60} paddingAngle={1} stroke="#fff" strokeWidth={1}>{plans.map(p=><Cell key={p.name} fill={p.color}/>)}</Pie></PieChart></ResponsiveContainer><div><strong>108</strong><span>Total</span></div></div>
          <div className="plan-legend">{plans.map(p=><div key={p.name}><i style={{background:p.color}}/><span>{p.name}</span><b>{Math.round(p.value/108*100)}% ({p.value})</b></div>)}</div></div>
        </Card>
        <Card className="dash-panel"><div className="sa-cardhead"><div><h2>Subscription Status</h2><p>All subscriptions</p></div></div>
          <div className="status-list">{[["Active",108,"green"],["Trial",9,"blue"],["Past Due",4,"orange"],["Expired",2,"gray"],["Suspended",1,"red"]].map(([a,b,c])=><div key={String(a)}><i className={String(c)}/><span>{a}</span><strong>{b}</strong></div>)}</div>
        </Card>
        <Card className="dash-panel renewal-panel"><div className="sa-cardhead"><div><h2>Upcoming Renewals</h2><p>Next 30 days</p></div></div>
          <table className="mini-table"><thead><tr><th>Hospital</th><th>Plan</th><th>Renewal Date</th><th>Amount</th></tr></thead><tbody>{[
            ["NovaCare Hospital","Enterprise","03 Aug 2026","₹49,999"],["CityCare Hospital","Premium","07 Aug 2026","₹29,999"],["HealthPlus Hospital","Standard","12 Aug 2026","₹19,999"],["Sunrise Hospital","Enterprise","18 Aug 2026","₹49,999"],["LifeCare Hospital","Standard","25 Aug 2026","₹19,999"],
          ].map(r=><tr key={r[0]}>{r.map(x=><td key={x}>{x}</td>)}</tr>)}</tbody></table><button className="text-link">View all renewals →</button>
        </Card>
        <Card className="dash-panel"><div className="sa-cardhead"><div><h2>Needs Attention</h2></div></div>
          <div className="attention-list">{[["4 subscriptions expiring in 7 days","orange"],["2 hospitals above 90% storage","orange"],["1 failed payment","red"],["3 integration errors","red"],["2 tenants approaching user limit","blue"]].map(([t,c])=><div key={t}><AlertTriangle className={c}/><span>{t}</span></div>)}</div><button className="text-link">View all alerts →</button>
        </Card>
      </div>
      <div className="sa-bottom-grid">
        <Card className="dash-panel"><div className="sa-cardhead"><div><h2>Platform Usage</h2><p>Key usage metrics across all tenants</p></div></div>
          <div className="usage-grid">{usage.map(({Icon,label,value,tone})=><div key={label}><span className={`usage-icon ${tone}`}><Icon/></span><p>{label}<strong>{value}</strong></p></div>)}</div>
        </Card>
        <Card className="dash-panel"><div className="sa-cardhead"><div><h2>Most Used Modules</h2><p>By hospitals</p></div></div>
          <div className="module-bars">{modules.map(([m,v],i)=><div key={m}><span>{m}</span><div><i style={{width:`${v}%`,background:i<2?"#5865f2":i<4?"#43b9ce":i<6?"#f5a552":"#ef6473"}}/></div><b>{v}%</b></div>)}</div>
        </Card>
        <Card className="dash-panel"><div className="sa-cardhead"><div><h2>Recent Platform Activity</h2><p>Latest system and tenant events</p></div></div>
          <div className="compact-events">{activity.map(([t,d,c])=><div key={t}><i className={c}/><span><strong>{t}</strong><small>{d}</small></span></div>)}</div><button className="text-link">View all activity →</button>
        </Card>
      </div>
    </>
  );
}

function HospitalsPage({
  onCreate,
  onEdit,
}: {
  onCreate: () => void;
  onEdit: (id: string) => void;
}) {
  const [rows, setRows] = useState<HospitalRow[]>([]),
    [modules, setModules] = useState<ModuleRow[]>([]);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [modal, setModal] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      Promise.all([
        adminApi<{ data: HospitalRow[] }>(
          `/hospitals?search=${encodeURIComponent(search)}&status=${status}`,
        ).then((r) => setRows(r.data)),
        adminApi<ModuleRow[]>("/modules").then(setModules),
      ]),
    [search, status],
  );
  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const fd = new FormData(event.currentTarget);
    try {
      await adminApi("/hospitals", {
        method: "POST",
        body: JSON.stringify({
          name: fd.get("name"),
          code: fd.get("code"),
          branchName: fd.get("branchName"),
          planCode: fd.get("planCode"),
          monthlyAmount: Number(fd.get("monthlyAmount")),
          trialDays: Number(fd.get("trialDays")),
          modules: fd.getAll("modules"),
        }),
      });
      setModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create hospital");
    }
  }
  async function changeStatus(id: string, value: string) {
    await adminApi(`/hospitals/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: value }),
    });
    load();
  }
  async function removeHospital(id: string, name: string) {
    if (!confirm(`Delete hospital "${name}"? Its users will be disabled and subscription cancelled.`)) return;
    await adminApi(`/hospitals/${id}`, { method: "DELETE" });
    load();
  }
  return (
    <>
      <PageHead
        title="Hospitals"
        text="Create, search and control every tenant on the platform."
        action={
          <button className="sa-primary" onClick={onCreate}>
            <Plus size={17} /> Create hospital
          </button>
        }
      />
      <Card>
        <div className="sa-toolbar">
          <div className="sa-search">
            <Search />
            <input
              placeholder="Search hospital or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option>active</option>
            <option>trial</option>
            <option>suspended</option>
            <option>inactive</option>
          </select>
          <button className="sa-secondary">
            <SlidersHorizontal size={16} /> Filters
          </button>
        </div>
        <div className="sa-tablewrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Hospital</th>
                <th>Plan</th>
                <th>Branches</th>
                <th>Users</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td>
                    <div className="hospital-cell">
                      <span>{h.name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <strong>{h.name}</strong>
                        <small>{h.code}</small>
                      </div>
                    </div>
                  </td>
                  <td>{h.plan_code ?? "—"}</td>
                  <td>{h.branches}</td>
                  <td>{h.users}</td>
                  <td>
                    {h.expires_at
                      ? new Date(h.expires_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td>
                    <Badge value={h.status} />
                  </td>
                  <td>
                    <div className="table-actions">
                      <select className="row-action" value={h.status} onChange={(e) => changeStatus(h.id, e.target.value)}>
                        <option>active</option><option>trial</option><option>suspended</option><option>inactive</option>
                      </select>
                      <button onClick={() => onEdit(h.id)}>Edit</button>
                      <button className="danger" onClick={() => removeHospital(h.id, h.name)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty text="Create your first hospital tenant." />}
        </div>
      </Card>
      {modal && (
        <div className="sa-modalback">
          <form className="sa-modal" onSubmit={create}>
            <div className="modal-head">
              <div>
                <h2>Create hospital</h2>
                <p>Provision tenant, branch, subscription and modules.</p>
              </div>
              <button type="button" onClick={() => setModal(false)}>
                <X />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <label>
                  Hospital name
                  <input
                    required
                    name="name"
                    placeholder="e.g. CityCare Hospital"
                  />
                </label>
                <label>
                  Tenant code
                  <input required name="code" placeholder="CITYCARE" />
                </label>
                <label>
                  Main branch
                  <input
                    required
                    name="branchName"
                    placeholder="Central Branch"
                  />
                </label>
                <label>
                  Subscription plan
                  <select name="planCode">
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </label>
                <label>
                  Monthly amount (₹)
                  <input
                    required
                    name="monthlyAmount"
                    type="number"
                    min="0"
                    defaultValue="24999"
                  />
                </label>
                <label>
                  Trial days
                  <input
                    required
                    name="trialDays"
                    type="number"
                    min="0"
                    defaultValue="14"
                  />
                </label>
              </div>
              <fieldset>
                <legend>Enabled modules</legend>
                <div className="module-checks">
                  {modules.map((m) => (
                    <label key={m.id}>
                      <input
                        type="checkbox"
                        name="modules"
                        value={m.id}
                        defaultChecked
                      />
                      <span>
                        <Check />
                        {m.name}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {error && (
                <div className="form-error">
                  <AlertTriangle />
                  {error}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="sa-secondary"
                onClick={() => setModal(false)}
              >
                Cancel
              </button>
              <button className="sa-primary">
                <Plus /> Create hospital
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function SubscriptionsPage() {
  const [rows, setRows] = useState<Subscription[]>([]);
  const load = useCallback(
    () => adminApi<Subscription[]>("/subscriptions").then(setRows),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  return (
    <>
      <PageHead
        title="Subscriptions"
        text="Track plans, recurring revenue, renewals and expiry risk."
      />
      <div className="sa-mini-metrics">
        <Card>
          <span>Subscription MRR</span>
          <strong>
            ₹
            {rows
              .reduce((n, r) => n + Number(r.monthly_amount), 0)
              .toLocaleString("en-IN")}
          </strong>
        </Card>
        <Card>
          <span>Active plans</span>
          <strong>{rows.filter((r) => r.status === "active").length}</strong>
        </Card>
        <Card>
          <span>Expiring in 30 days</span>
          <strong>
            {
              rows.filter(
                (r) =>
                  new Date(r.expires_at).getTime() - Date.now() < 2592000000,
              ).length
            }
          </strong>
        </Card>
      </div>
      <Card>
        <div className="sa-tablewrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Hospital</th>
                <th>Plan</th>
                <th>Monthly value</th>
                <th>Started</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.hospital_name}</strong>
                  </td>
                  <td className="capitalize">{r.plan_code}</td>
                  <td>₹{Number(r.monthly_amount).toLocaleString("en-IN")}</td>
                  <td>{new Date(r.starts_at).toLocaleDateString()}</td>
                  <td>{new Date(r.expires_at).toLocaleDateString()}</td>
                  <td>
                    <Badge value={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function ModulesPage() {
  const [rows, setRows] = useState<ModuleRow[]>([]),
    [editing, setEditing] = useState<ModuleRow | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () => adminApi<ModuleRow[]>("/modules").then(setRows),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  async function toggle(row: ModuleRow) {
    await adminApi(`/modules/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !row.is_active }),
    });
    load();
  }
  async function saveModule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const fd = new FormData(event.currentTarget);
    setError("");
    try {
      await adminApi(`/modules/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: fd.get("name"),
          code: fd.get("code"),
          description: fd.get("description"),
          isActive: fd.get("status") === "active",
        }),
      });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update module");
    }
  }
  return (
    <>
      <PageHead
        title="Modules"
        text="Control the product capabilities available for tenant subscriptions."
      />
      <div className="module-grid">
        {rows.map((m) => (
          <Card className="module-card" key={m.id}>
            <div className="module-cardtop">
              <span>
                <Boxes />
              </span>
              <button
                className={`switch ${m.is_active ? "on" : ""}`}
                onClick={() => toggle(m)}
              >
                <i />
              </button>
            </div>
            <h3>{m.name}</h3>
            <code>{m.code}</code>
            <p>{m.description}</p>
            <div>
              <span><strong>{m.enabled_hospitals}</strong> enabled hospitals</span>
              <button className="module-edit" onClick={() => setEditing(m)}><Edit3 /> Edit module</button>
            </div>
          </Card>
        ))}
      </div>
      {editing && <div className="sa-modalback"><form className="sa-modal module-edit-modal" onSubmit={saveModule}>
        <div className="modal-head"><div><h2>Edit module</h2><p>Update how this capability appears across plans and hospitals.</p></div><button type="button" onClick={() => setEditing(null)}><X /></button></div>
        <div className="modal-body"><div className="form-grid">
          <label>Module name<input name="name" required defaultValue={editing.name} /></label>
          <label>Module code<input name="code" required defaultValue={editing.code} /></label>
          <label className="wide">Description<textarea name="description" required rows={4} defaultValue={editing.description} /></label>
          <label>Status<select name="status" defaultValue={editing.is_active ? "active" : "inactive"}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        </div>{error && <div className="form-error"><AlertTriangle />{error}</div>}</div>
        <div className="modal-foot"><button type="button" className="sa-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="sa-primary"><Check /> Save module</button></div>
      </form></div>}
    </>
  );
}

function SettingsPage({
  onBrandingChange,
}: {
  onBrandingChange: (key: string, value: unknown) => void;
}) {
  const [rows, setRows] = useState<Setting[]>([]);
  const [activeCategory, setActiveCategory] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string | boolean>>({});
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const settings = await adminApi<Setting[]>("/settings");
      setRows(settings);
      setDrafts(Object.fromEntries(settings.map((row) => [row.key, row.value as string | boolean])));
      setActiveCategory((current) =>
        current && settings.some((row) => row.category === current)
          ? current
          : (settings[0]?.category ?? ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load platform settings");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function save(row: Setting, value: string | boolean) {
    const parsed = typeof row.value === "number" ? Number(value) : value;
    if (typeof row.value === "number" && (!Number.isFinite(parsed) || Number(parsed) < 0)) {
      setError(`${row.key.replaceAll("_", " ")} must be a valid positive number.`);
      return;
    }
    setSaving(row.key);
    setError("");
    try {
      const updated = await adminApi<Setting>(`/settings/${encodeURIComponent(row.key)}`, {
        method: "PUT",
        body: JSON.stringify({ value: parsed }),
      });
      setRows((current) => current.map((item) => item.key === row.key ? updated : item));
      setDrafts((current) => ({ ...current, [row.key]: updated.value as string | boolean }));
      if (updated.category === "branding") onBrandingChange(updated.key, updated.value);
      setSaved(row.key);
      window.setTimeout(() => setSaved((key) => key === row.key ? "" : key), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save setting");
      setDrafts((current) => ({ ...current, [row.key]: row.value as string | boolean }));
    } finally {
      setSaving("");
    }
  }
  const categories = [...new Set(rows.map((row) => row.category))];
  const visibleRows = rows.filter((row) => row.category === activeCategory);
  const categoryTitle = activeCategory
    ? activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1)
    : "Platform";
  const logo = String(rows.find((row) => row.key === "platform_logo")?.value ?? "");
  async function saveLogo(value: string) {
    setSaving("platform_logo");
    setError("");
    try {
      const updated = await adminApi<Setting>("/settings/platform_logo", {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      setRows((current) => {
        const exists = current.some((item) => item.key === updated.key);
        return exists
          ? current.map((item) => item.key === updated.key ? updated : item)
          : [...current, updated];
      });
      onBrandingChange("platform_logo", updated.value);
      setSaved("platform_logo");
      window.setTimeout(() => setSaved(""), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save platform logo");
    } finally {
      setSaving("");
    }
  }
  function selectLogo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Select a PNG, JPG, WebP, GIF, or SVG image.");
      return;
    }
    if (file.size > 500 * 1024) {
      setError("Logo must be smaller than 500 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => saveLogo(String(reader.result));
    reader.onerror = () => setError("Unable to read the selected logo.");
    reader.readAsDataURL(file);
  }
  return (
    <>
      <PageHead
        title="Platform Settings"
        text="Configure branding, subscriptions, security and operational defaults."
      />
      <div className="settings-layout">
        <aside>
          {categories.map((category) => (
            <button
              key={category}
              className={`capitalize ${activeCategory === category ? "active" : ""}`}
              onClick={() => setActiveCategory(category)}
            >
              <Settings />
              <span>{category}</span>
              <small>{rows.filter((row) => row.category === category).length}</small>
              <ChevronRight />
            </button>
          ))}
        </aside>
        <Card className="settings-card">
          <div className="sa-cardhead">
            <div>
              <h2>{categoryTitle} configuration</h2>
              <p>Saved changes apply across the SaaS platform immediately.</p>
            </div>
            <button className="settings-refresh" onClick={load} disabled={loading}>
              <RefreshCw className={loading ? "spin" : ""} /> Refresh
            </button>
          </div>
          {error && <div className="settings-error"><AlertTriangle /> {error}</div>}
          {!loading && activeCategory === "branding" && (
            <div className="branding-logo-row">
              <div>
                <strong>Platform logo</strong>
                <p>Displayed in the Super Admin navigation and platform branding.</p>
                <small>PNG, JPG, WebP, GIF or SVG · maximum 500 KB</small>
              </div>
              <div className="branding-logo-control">
                <span className="branding-logo-preview">
                  {logo ? <img src={logo} alt="Platform logo preview" /> : <ImageIcon />}
                </span>
                <div>
                  <label className="logo-upload-button">
                    {saving === "platform_logo" ? <LoaderCircle className="spin" /> : <Upload />}
                    {logo ? "Replace logo" : "Upload logo"}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(e) => selectLogo(e.target.files?.[0])} disabled={saving === "platform_logo"} />
                  </label>
                  {logo && <button type="button" className="logo-remove-button" onClick={() => saveLogo("")} disabled={saving === "platform_logo"}><Trash2 /> Remove</button>}
                  {saved === "platform_logo" && <span className="logo-saved"><Check /> Saved</span>}
                </div>
              </div>
            </div>
          )}
          {loading ? <div className="settings-loading"><LoaderCircle className="spin" /> Loading settings…</div> : visibleRows.map((row) => {
            const draft = drafts[row.key] ?? row.value;
            const changed = String(draft) !== String(row.value);
            return (
            <div className="setting-row" key={row.key}>
              <div>
                <strong>{row.key.replaceAll("_", " ")}</strong>
                <p>{row.description}</p>
                <small>{row.is_public ? "Visible to tenant applications" : "Super Admin only"}</small>
              </div>
              {typeof row.value === "boolean" ? (
                <button
                  type="button"
                  aria-label={`Toggle ${row.key.replaceAll("_", " ")}`}
                  className={`switch ${draft ? "on" : ""}`}
                  disabled={saving === row.key}
                  onClick={() => {
                    const next = !draft;
                    setDrafts((current) => ({ ...current, [row.key]: next }));
                    save(row, next);
                  }}
                >
                  <i />
                </button>
              ) : (
                <div className="setting-control">
                  <input
                    type={typeof row.value === "number" ? "number" : row.key.includes("email") ? "email" : "text"}
                    min={typeof row.value === "number" ? 0 : undefined}
                    value={String(draft)}
                    onChange={(e) => setDrafts((current) => ({ ...current, [row.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && changed) save(row, String(draft));
                    }}
                  />
                  <button
                    type="button"
                    className={`setting-save ${changed ? "changed" : ""}`}
                    disabled={!changed || saving === row.key}
                    onClick={() => save(row, String(draft))}
                  >
                    {saving === row.key ? <LoaderCircle className="spin" /> : saved === row.key ? <Check /> : "Save"}
                  </button>
                </div>
              )}
            </div>
          )})}
          {!loading && !visibleRows.length && <Empty text="No settings are available in this category." />}
        </Card>
      </div>
    </>
  );
}

function MonitoringPage() {
  const [data, setData] = useState<{
    health: {
      database: string;
      database_bytes: string;
      connections: number;
      uptime_seconds: number;
    };
    events: Event[];
  } | null>(null);
  const load = useCallback(
    () => adminApi<typeof data>("/monitoring").then(setData),
    [],
  );
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);
  if (!data) return <Loading />;
  return (
    <>
      <PageHead
        title="Monitoring"
        text="Database health, service status, alerts and tenant events."
        action={
          <button className="sa-secondary" onClick={load}>
            <RefreshCw />
            Refresh
          </button>
        }
      />
      <div className="health-grid">
        <Card>
          <Server />
          <span>API service</span>
          <strong className="healthy">Operational</strong>
          <small>Responding normally</small>
        </Card>
        <Card>
          <Database />
          <span>Database</span>
          <strong className="healthy">Connected</strong>
          <small>{data.health.database}</small>
        </Card>
        <Card>
          <Activity />
          <span>Connections</span>
          <strong>{data.health.connections}</strong>
          <small>Active PostgreSQL sessions</small>
        </Card>
        <Card>
          <Clock3 />
          <span>Database uptime</span>
          <strong>{Math.floor(data.health.uptime_seconds / 3600)}h</strong>
          <small>
            {(Number(data.health.database_bytes) / 1048576).toFixed(1)} MB
            stored
          </small>
        </Card>
      </div>
      <Card>
        <div className="sa-cardhead">
          <div>
            <h2>Platform event stream</h2>
            <p>Automatically refreshes every 30 seconds.</p>
          </div>
          <span className="live-indicator">
            <i />
            Live
          </span>
        </div>
        <div className="monitor-events">
          {data.events.map((e) => (
            <div key={e.id}>
              <span className={`event-symbol ${e.severity}`}>
                {e.severity === "critical" ? <AlertTriangle /> : <Activity />}
              </span>
              <div>
                <strong>{e.message}</strong>
                <small>
                  {e.hospital_name ?? "Platform"} · {e.source}
                </small>
              </div>
              <time>{new Date(e.created_at).toLocaleString()}</time>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

type CrmConnection = {
  integration_enabled: boolean;
  tenant_id: string; hospital_name: string; hospital_code: string; id: string | null;
  clinic_external_id: string | null; clinic_name: string | null; api_key_prefix: string | null;
  is_active: boolean | null; last_sync_at: string | null; last_sync_status: string | null;
  last_sync_summary: Record<string, number> | null;
};
type CrmClinic = { id: string; name: string; slug?: string; city?: string; state?: string; connectedTenantId: string | null; connectedHospitalName: string | null };

function CrmConnectionsPage() {
  const [rows, setRows] = useState<CrmConnection[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const load = useCallback(() => { setLoading(true); setError(""); return adminApi<CrmConnection[]>("/crm-connections").then(setRows).catch(e => setError(e instanceof Error ? e.message : "Unable to load CRM connections")).finally(() => setLoading(false)); }, []);
  useEffect(() => { void load(); }, [load]);
  async function connect(row: CrmConnection) {
    let clinics: CrmClinic[];
    try {
      clinics = await adminApi<CrmClinic[]>("/crm-clinics");
    } catch (e) {
      await Swal.fire("Unable to load CRM clinics", e instanceof Error ? e.message : "CareFlow360 is unavailable", "error");
      return;
    }
    const available = clinics.filter(clinic => !clinic.connectedTenantId || clinic.connectedTenantId === row.tenant_id);
    if (!available.length) {
      await Swal.fire("No CRM clinic available", "All CareFlow360 clinics are already connected to ERP hospitals.", "info");
      return;
    }
    const options = Object.fromEntries(available.map(clinic => [clinic.id, `${clinic.name}${clinic.city ? ` — ${clinic.city}${clinic.state ? `, ${clinic.state}` : ""}` : ""}`]));
    const result = await Swal.fire({
      title: `Connect ${row.hospital_name}`,
      text: "Choose the corresponding clinic from CareFlow360.",
      input: "select", inputOptions: options, inputValue: row.clinic_external_id ?? "",
      inputPlaceholder: "Select CRM clinic",
      showCancelButton: true, confirmButtonText: row.id ? "Rotate key & reconnect" : "Connect CRM",
      inputValidator: value => value ? undefined : "Select a CRM clinic",
    });
    if (!result.isConfirmed || !result.value) return;
    const clinic = available.find(item => item.id === result.value)!;
    const saved = await adminApi<{ apiKey: string }>("/crm-connections", { method: "POST", body: JSON.stringify({ tenantId: row.tenant_id, clinicExternalId: clinic.id, clinicName: clinic.name }) });
    await Swal.fire({ title: "CRM connected", icon: "success", html: `<p>Copy this key now. It is shown only once.</p><textarea class="swal2-textarea" readonly>${saved.apiKey}</textarea><p><code>POST /api/v1/crm-sync/bootstrap</code></p><p>Header: <code>X-API-Key</code></p>`, confirmButtonText: "I copied the key" });
    await load();
  }
  async function toggle(row: CrmConnection) {
    if (!row.id) return;
    await adminApi(`/crm-connections/${row.id}/status`, { method: "PATCH", body: JSON.stringify({ isActive: !row.is_active }) });
    await load();
  }
  return <>
    <PageHead title="Call Centre CRM Connections" text="Map each CRM clinic to one ERP hospital tenant. Synced master and OPD data stays linked to the ERP's native workflows." />
    {error && <div className="form-error">{error} <button type="button" onClick={() => void load()}>Retry</button></div>}
    <Card>
      {loading ? <Loading /> : <div className="sa-table-wrap"><table className="sa-table"><thead><tr><th>ERP hospital</th><th>CRM clinic</th><th>Status</th><th>Last sync</th><th>Imported</th><th>Action</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.tenant_id}>
          <td><strong>{row.hospital_name}</strong><small>{row.hospital_code}</small></td>
          <td>{row.id ? <><strong>{row.clinic_name || row.clinic_external_id}</strong><small>{row.clinic_external_id} · key {row.api_key_prefix}…</small></> : <span>Not connected</span>}</td>
          <td><Badge value={!row.integration_enabled ? "Disconnected" : !row.id ? "Not connected" : row.is_active ? "Active" : "Inactive"} /></td>
          <td>{row.last_sync_at ? <><strong>{row.last_sync_status}</strong><small>{new Date(row.last_sync_at).toLocaleString()}</small></> : "Never"}</td>
          <td>{row.last_sync_summary ? Object.entries(row.last_sync_summary).map(([key,value]) => `${key}: ${value}`).join(" · ") : "—"}</td>
          <td>{!row.integration_enabled ? <span>CRM temporarily disconnected</span> : <div className="table-actions"><button onClick={() => void connect(row)} title="Connect or rotate API key"><Link2 /></button>{row.id && <button onClick={() => void toggle(row)} title={row.is_active ? "Disable connection" : "Enable connection"}>{row.is_active ? <LockKeyhole /> : <Check />}</button>}</div>}</td>
        </tr>)}
        {!rows.length && !error && <tr><td colSpan={6}><Empty text="No ERP hospitals are available. Create a hospital first." /></td></tr>}
      </tbody></table></div>}
    </Card>
    <Card><div className="sa-cardhead"><div><h2>ERP-safe synchronization</h2><p>Branches and departments are imported first, then doctors and schedules, patients, and finally OPD appointments. External IDs are retained for repeatable updates. CRM sync does not overwrite ERP billing, consultation, clinical notes, prescriptions, or completed workflow state.</p></div></div></Card>
  </>;
}

function ReportsPage() {
  const [data, setData] = useState<{
    registrations: { period: string; hospitals: number }[];
    revenue: { period: string; revenue: string }[];
    statuses: { status: string; total: number }[];
    expiring: {
      hospital: string;
      plan_code: string;
      expires_at: string;
      days_remaining: number;
    }[];
  } | null>(null);
  useEffect(() => {
    adminApi<typeof data>("/reports").then(setData);
  }, []);
  if (!data) return <Loading />;
  return (
    <>
      <PageHead
        title="SaaS Reports"
        text="Platform registrations, subscription revenue, plan health and expiry risk."
        action={
          <button className="sa-secondary">
            <FileBarChart />
            Export report
          </button>
        }
      />
      <div className="report-summary">
        {data.statuses.map((s) => (
          <Card key={s.status}>
            <Badge value={s.status} />
            <strong>{s.total}</strong>
            <span>hospitals</span>
          </Card>
        ))}
      </div>
      <div className="sa-dashboard-grid">
        <Card>
          <div className="sa-cardhead">
            <div>
              <h2>Subscription revenue</h2>
              <p>Monthly recurring value by start period.</p>
            </div>
          </div>
          <div className="sa-chart">
            <ResponsiveContainer>
              <AreaChart data={data.revenue}>
                <CartesianGrid vertical={false} stroke="#e8edf5" />
                <XAxis dataKey="period" />
                <YAxis />
                <Tooltip />
                <Area dataKey="revenue" stroke="#7c5de3" fill="#eee9ff" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="sa-cardhead">
            <div>
              <h2>Expiring subscriptions</h2>
              <p>Renewal attention within 60 days.</p>
            </div>
          </div>
          {data.expiring.length ? (
            <div className="event-list">
              {data.expiring.map((x) => (
                <div className="event" key={x.hospital}>
                  <span className="event-dot warning" />
                  <div>
                    <strong>{x.hospital}</strong>
                    <small>
                      {x.plan_code} · {x.days_remaining} days remaining
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No subscriptions expire within 60 days." />
          )}
        </Card>
      </div>
    </>
  );
}

export default function SuperAdminApp() {
  const superAdminPages: Page[] = ["Dashboard", "Hospitals", "CRM Connections", "Create Hospital", "Edit Hospital", "Subscriptions", "Create Plan", "Edit Plan", "Modules", "Platform Settings", "Monitoring", "Reports"];
  const { branding, setBranding } = usePlatformBranding();
  const [loggedIn, setLoggedIn] = useState(Boolean(auth.token())),
    [page, setPageState] = useState<Page>(() => pageFromPath(superAdminPages, 1) ?? "Dashboard"),
    [mobile, setMobile] = useState(false),
    [editId, setEditId] = useState<string | undefined>(() => window.location.pathname.split("/").filter(Boolean)[2]);
  const [restoring,setRestoring]=useState(()=>!loggedIn&&new URL(location.href).searchParams.has('_session'));
  useEffect(()=>{
    if(!restoring)return;let current=true;
    restoreTabSession(ADMIN_SESSION_KEY).then(()=>{if(current){setLoggedIn(Boolean(auth.token()));setRestoring(false);}}).catch(()=>{if(current)setRestoring(false);});
    return()=>{current=false;};
  },[restoring]);
  useEffect(()=>{
    const sync=(event:globalThis.Event)=>{if((event as CustomEvent).detail?.key!==ADMIN_SESSION_KEY)return;const active=Boolean(auth.token());setLoggedIn(active);if(!active){setRestoring(false);updateBrowserPath('/superadmin/login',true);}};
    window.addEventListener(TAB_SESSION_EVENT,sync);return()=>window.removeEventListener(TAB_SESSION_EVENT,sync);
  },[]);
  const setPage = useCallback((nextPage: Page, entityId?: string) => {
    setPageState(nextPage);
    updateBrowserPath(`/superadmin/${routeSlug(nextPage)}${entityId ? `/${entityId}` : ""}`);
  }, []);
  useEffect(() => {
    if (loggedIn) updateBrowserPath(`/superadmin/${routeSlug(page)}`, true);
    const onPopState = () => {
      setPageState(pageFromPath(superAdminPages, 1) ?? "Dashboard");
      setEditId(window.location.pathname.split("/").filter(Boolean)[2]);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const updateBranding = useCallback((key: string, value: unknown) => {
    setBranding((current) => ({
      name: key === "platform_name" ? String(value || "careframe") : current.name,
      logo: key === "platform_logo" ? String(value || "") : current.logo,
    }));
  }, []);
  useEffect(() => {
    document.title = `${branding.name} — Hospital Operations`;
  }, [branding.name]);
  if(restoring)return <div role="status" style={{padding:24}}>Opening your signed-in workspace...</div>;
  if (!loggedIn) return <Login branding={branding} onLogin={() => { setLoggedIn(true); setPage("Dashboard"); }} />;
  let content: ReactNode;
  if (page === "Dashboard") content = <DashboardPage />;
  else if (page === "Hospitals") content = <HospitalsPage onCreate={() => setPage("Create Hospital")} onEdit={(id) => { setEditId(id); setPage("Edit Hospital", id); }} />;
  else if (page === "Create Hospital") content = <HospitalForm onBack={() => setPage("Hospitals")} onSaved={() => setPage("Hospitals")} />;
  else if (page === "Edit Hospital") content = <HospitalForm editId={editId} onBack={() => setPage("Hospitals")} onSaved={() => setPage("Hospitals")} />;
  else if (page === "Subscriptions") content = <PlanList onCreate={() => setPage("Create Plan")} onEdit={(id) => { setEditId(id); setPage("Edit Plan", id); }} />;
  else if (page === "Create Plan") content = <PlanForm onBack={() => setPage("Subscriptions")} onSaved={() => setPage("Subscriptions")} />;
  else if (page === "Edit Plan") content = <PlanForm editId={editId} onBack={() => setPage("Subscriptions")} onSaved={() => setPage("Subscriptions")} />;
  else if (page === "Modules") content = <ModulesPage />;
  else if (page === "CRM Connections") content = <CrmConnectionsPage />;
  else if (page === "Platform Settings") content = <SettingsPage onBrandingChange={updateBranding} />;
  else if (page === "Monitoring") content = <MonitoringPage />;
  else content = <ReportsPage />;
  const mobileNav: {
    label: string;
    page: Page;
    icon: typeof LayoutDashboard;
  }[] = [
    { label: "Hospitals", page: "Hospitals", icon: Hospital },
    { label: "Plans", page: "Subscriptions", icon: CreditCard },
    { label: "Dashboard", page: "Dashboard", icon: LayoutDashboard },
    { label: "Reports", page: "Reports", icon: FileBarChart },
    { label: "Settings", page: "Platform Settings", icon: Settings },
  ];
  return (
    <div className="sa-app">
      {mobile && (
        <button className="sa-scrim" onClick={() => setMobile(false)} />
      )}
      <aside className={mobile ? "open" : ""}>
        <div className="sa-brand">
          <span className={`sa-brandmark ${branding.logo ? "has-logo" : ""}`}>
            {branding.logo ? <img src={branding.logo} alt="" /> : branding.name.charAt(0).toUpperCase()}
          </span>
          <span className="sa-brandname">{branding.name}</span>
          <em>ADMIN</em>
        </div>
        <div className="sa-adminscope">
          <Globe2 />
          <div>
            <strong>Platform workspace</strong>
            <small>All hospitals & tenants</small>
          </div>
        </div>
        <nav>
          <p>PLATFORM</p>
          {nav.map((n) => (
            <WorkspaceLink
              href={`/superadmin/${routeSlug(n.label)}`}
              sessionKey={ADMIN_SESSION_KEY}
              className={page === n.label || (n.label === "Hospitals" && page.includes("Hospital")) || (n.label === "Subscriptions" && page.includes("Plan")) ? "active" : ""}
              key={n.label}
              onNavigate={() => {
                setPage(n.label);
                setMobile(false);
              }}
            >
              <n.icon />
              {n.label}
              {page === n.label && <ChevronRight />}
            </WorkspaceLink>
          ))}
        </nav>
        <div className="sa-sidefoot">
          <div>
            <span>DA</span>
            <div>
              <strong>Dwaipayan Admin</strong>
              <small>Super administrator</small>
            </div>
          </div>
          <button
            onClick={async () => {
              const result = await Swal.fire({
                title: "Log out?",
                text: "Are you sure you want to end your current session?",
                icon: "warning",
                showCancelButton: true,
                confirmButtonText: "Yes, log out",
                cancelButtonText: "Cancel",
                confirmButtonColor: "#d94f5c",
                cancelButtonColor: "#64748b",
                reverseButtons: true,
                focusCancel: true,
              });
              if (!result.isConfirmed) return;
              auth.clear();
              setLoggedIn(false);
              updateBrowserPath("/superadmin/login", true);
              window.dispatchEvent(
                new CustomEvent("app-success", {
                  detail: "Logged out successfully",
                }),
              );
            }}
          >
            <LogOut />
          </button>
        </div>
      </aside>
      <div className="sa-main">
        <header>
          <button className="mobile-menu" onClick={() => setMobile(true)}>
            <Menu />
          </button>
          <div className="sa-global-search">
            <Search />
            <input placeholder="Search hospitals, subscriptions, events…" />
          </div>
          <div className="sa-header-actions">
            <SiteActivity token={auth.token()||''}/>
            <span className="platform-live">
              <i />
              Platform live
            </span>
            <button>
              <Bell />
              <i />
            </button>
            <span className="admin-avatar">DA</span>
          </div>
        </header>
        <main>{content}</main>
        <nav className="sa-mobile-footer" aria-label="Mobile navigation">
          {mobileNav.map((item) => (
            <WorkspaceLink
              href={`/superadmin/${routeSlug(item.page)}`}
              sessionKey={ADMIN_SESSION_KEY}
              key={item.page}
              className={`${page === item.page ? "active" : ""} ${item.page === "Dashboard" ? "dashboard-item" : ""}`}
              onNavigate={() => setPage(item.page)}
            >
              <span>
                <item.icon />
              </span>
              <small>{item.label}</small>
            </WorkspaceLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
