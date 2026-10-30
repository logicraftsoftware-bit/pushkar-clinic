import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  FlaskConical,
  HeartPulse,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Pill,
  ShieldCheck,
  Stethoscope,
  UserRound,
  WalletCards,
} from "lucide-react";
const App = lazy(() => import("../App"));
import { loginRequest } from "../http-response";
import Swal from "sweetalert2";
import { usePlatformBranding, type PlatformBranding } from "../branding";
import type { Role } from "../data";
import { updateBrowserPath } from "../navigation";
import {PORTAL_SESSION_KEY,readTabSession,writeTabSession,clearTabSession,restoreTabSession,TAB_SESSION_EVENT} from '../tab-session';
import "./portal.css";

type Portal =
  | "hospital_admin"
  | "accountant"
  | "branch_admin"
  | "hr_manager"
  | "inventory_manager"
  | "lab_manager"
  | "pharmacy_manager"
  | "radiologist"
  | "receptionist"
  | "nurse"
  | "doctor"
  | "patient"
  | "broker";
type LoginGroup = "admin" | "staff";
type Session = {
  forcePasswordChange?: boolean;
  token: string;
  loginActivityId?: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    portal: Portal;
  };
  hospital: {
    id: string;
    name: string;
    code: string;
    logoUrl?: string;
    status: string;
    branchId: string;
    branchName: string;
  };
  modules: string[];
};
const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
const SESSION_KEY = PORTAL_SESSION_KEY;
const portals: {
  value: Portal;
  label: string;
  description: string;
  icon: typeof Building2;
  role: Role;
}[] = [
  {
    value: "hospital_admin",
    label: "Hospital Admin",
    description: "Administration & operations",
    icon: Building2,
    role: "Hospital Admin",
  },
  {
    value: "accountant",
    label: "Accountant",
    description: "Billing, payments & finance",
    icon: UserRound,
    role: "Accountant",
  },
  {
    value: "branch_admin",
    label: "Branch Admin",
    description: "Branch administration",
    icon: Building2,
    role: "Branch Admin",
  },
  {
    value: "doctor",
    label: "Doctor",
    description: "Consultations & clinical care",
    icon: Stethoscope,
    role: "Doctor",
  },
  {
    value: "hr_manager",
    label: "HR Manager",
    description: "HR, attendance & payroll",
    icon: UserRound,
    role: "HR Manager",
  },
  {
    value: "inventory_manager",
    label: "Inventory Manager",
    description: "Stock, purchase & suppliers",
    icon: Pill,
    role: "Inventory Manager",
  },
  {
    value: "lab_manager",
    label: "Lab Manager",
    description: "Lab managers, technicians & pathologists",
    icon: FlaskConical,
    role: "Laboratory",
  },
  {
    value: "nurse",
    label: "Nurse",
    description: "Care tasks & medication",
    icon: HeartPulse,
    role: "Nurse",
  },
  {
    value: "patient",
    label: "Patient",
    description: "Appointments, records & payments",
    icon: UserRound,
    role: "Patient",
  },
  {
    value: "pharmacy_manager",
    label: "Pharmacy Manager",
    description: "Dispensing & inventory",
    icon: Pill,
    role: "Pharmacy",
  },
  {
    value: "radiologist",
    label: "Laboratory (Radiology)",
    description: "Shared laboratory orders, results & reports",
    icon: FlaskConical,
    role: "Laboratory",
  },
  {
    value: "receptionist",
    label: "Receptionist",
    description: "Appointments & patient flow",
    icon: UserRound,
    role: "Reception",
  },
  {
    value: "broker",
    label: "Broker Login",
    description: "Referrals, earnings & wallet",
    icon: WalletCards,
    role: "Broker",
  },
];
function readSession() {
  try {
    return JSON.parse(
      readTabSession(SESSION_KEY) ?? "null",
    ) as Session | null;
  } catch {
    return null;
  }
}

function PortalLogin({
  onLogin,
  branding,
}: {
  onLogin: (session: Session) => void;
  branding: PlatformBranding;
}) {
  const [loginGroup, setLoginGroup] = useState<LoginGroup>("admin");
  const [portal, setPortal] = useState<Portal>("hospital_admin");
  const [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false),
    [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const selected = portals.find((item) => item.value === portal)!;
  function chooseGroup(group: LoginGroup) {
    setLoginGroup(group);
    setPortal(group === "admin" ? "hospital_admin" : "doctor");
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { response, result } = await loginRequest(`${API_URL}/api/v1/auth/login`, {
        identifier, password, portal: loginGroup === "staff" ? "staff" : portal,
      });
      if (!response.ok) {
        if(result.code==='STAFF_LOGIN_REQUIRED'){
          setLoginGroup('staff');setPortal('doctor');
          throw new Error('This is a staff account. Staff Login is now selected. Click Staff sign in to continue.');
        }
        throw new Error(`${result.error ?? "Unable to sign in"}${result.code ? ` (${result.code})` : ''}`);
      }
      writeTabSession(SESSION_KEY, JSON.stringify(result));
      onLogin(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="portal-login">
      <section className="portal-story">
        <div className="portal-brand">
          <span className={branding.logo ? "has-logo" : ""}>
            {branding.logo ? (
              <img src={branding.logo} alt="" />
            ) : (
              branding.name.charAt(0).toUpperCase()
            )}
          </span>
          {branding.name}
        </div>
        <div className="story-copy">
          <small>CONNECTED HEALTHCARE OPERATIONS</small>
          <h1>
            One secure workspace.
            <br />
            Every hospital role.
          </h1>
          <p>
            Sign in to your hospital’s private workspace for clinical,
            operational and administrative workflows.
          </p>
          <div className="story-points">
            <span>
              <ShieldCheck />
              Tenant-isolated access
            </span>
            <span>
              <CheckCircle2 />
              Role-based workspace
            </span>
            <span>
              <LockKeyhole />
              Secure authentication
            </span>
          </div>
        </div>
        <footer>{branding.name} Hospital ERP · Secure access portal</footer>
      </section>
      <main className="portal-login-main">
        <form onSubmit={submit}>
          <div className="portal-login-icon">
            <selected.icon />
          </div>
          <h2>Welcome back</h2>
          <p>Choose your account type and sign in.</p>
          <div className="portal-access-types" role="radiogroup" aria-label="Account type">
            <button type="button" role="radio" aria-checked={loginGroup === "admin"} className={loginGroup === "admin" ? "active" : ""} onClick={() => chooseGroup("admin")}>
              <Building2 />
              <span><strong>Admin / Super Admin</strong><small>Platform and hospital administration</small></span>
              {loginGroup === "admin" && <CheckCircle2 />}
            </button>
            <button type="button" role="radio" aria-checked={loginGroup === "staff"} className={loginGroup === "staff" ? "active" : ""} onClick={() => chooseGroup("staff")}>
              <UserRound />
              <span><strong>Staff Login</strong><small>Clinical, operational and support teams</small></span>
              {loginGroup === "staff" && <CheckCircle2 />}
            </button>
          </div>
          {loginGroup === "admin" ? (
            <div className="portal-admin-choice">
              <span>Hospital administrator credentials</span>
              <button type="button" onClick={() => { updateBrowserPath("/superadmin"); window.location.reload(); }}>Super Admin access</button>
            </div>
          ) : <div className="portal-staff-note">For doctors, nurses, Lab Managers, technicians, pathologists and other staff. Your authorized workspace will open automatically after sign in.</div>}
          <label className="portal-credential">
            <span className="portal-field-label">Email or phone</span>
            <div className="portal-input">
              <Mail />
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder="name@hospital.com or phone number"
                autoComplete="username"
              />
            </div>
          </label>
          <label className="portal-credential">
            <span className="portal-field-label">Password</span>
            <div className="portal-input">
              <LockKeyhole />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
              <button type="button" className="portal-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </label>
          <div className="portal-login-tools">
            <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember me</label>
            <button type="button" onClick={() => Swal.fire("Forgot password?", "Please contact your hospital administrator to reset your password.", "info")}>Forgot password?</button>
          </div>
          {error && <div className="portal-error">{error}</div>}
          <button className="portal-submit" disabled={loading}>
            {loading ? (
              <LoaderCircle className="spin" />
            ) : (
              <>
                <span>{loginGroup === "admin" ? "Admin sign in" : "Staff sign in"}</span>
                <ArrowRight />
              </>
            )}
          </button>
          <div className="portal-help">
            Access is managed by your hospital administrator.
          </div>
        </form>
      </main>
    </div>
  );
}

export default function PortalEntry() {
  const { branding } = usePlatformBranding();
  const [session, setSession] = useState<Session | null>(readSession);
  const [restoring,setRestoring]=useState(()=>!session&&new URL(location.href).searchParams.has('_session'));
  useEffect(()=>{
    if(!restoring)return;let current=true;
    restoreTabSession(SESSION_KEY).then(()=>{if(current){setSession(readSession());setRestoring(false);}}).catch(()=>{if(current)setRestoring(false);});
    return()=>{current=false;};
  },[restoring]);
  useEffect(()=>{
    const revoke=(event:Event)=>{clearTabSession(SESSION_KEY);setSession(null);updateBrowserPath('/login',true);window.dispatchEvent(new CustomEvent('app-error',{detail:(event as CustomEvent).detail||'Your access changed. Please sign in again.'}));};
    const requireChange=()=>setSession(old=>{if(!old)return old;const updated={...old,forcePasswordChange:true};writeTabSession(SESSION_KEY,JSON.stringify(updated));return updated;});
    const sync=(event:Event)=>{if((event as CustomEvent).detail?.key!==SESSION_KEY)return;const current=readSession();setSession(current);if(!current){setRestoring(false);updateBrowserPath('/login',true);}};
    window.addEventListener('password-change-required',requireChange);
    window.addEventListener('session-invalid',revoke);
    window.addEventListener(TAB_SESSION_EVENT,sync);
    return()=>{window.removeEventListener('session-invalid',revoke);window.removeEventListener('password-change-required',requireChange);window.removeEventListener(TAB_SESSION_EVENT,sync);};
  },[]);
  useEffect(() => {
    document.title = `${branding.name} — Hospital Operations`;
  }, [branding.name]);
  if(restoring)return <div role="status" style={{padding:24}}>Opening your signed-in workspace...</div>;
  if (!session) {
    if (window.location.pathname === "/") updateBrowserPath("/login", true);
    return <PortalLogin branding={branding} onLogin={setSession} />;
  }
  if(session.forcePasswordChange)return <PasswordChange session={session} onChanged={()=>{const updated={...session,forcePasswordChange:false};writeTabSession(SESSION_KEY,JSON.stringify(updated));setSession(updated);}} />;
  const role =
    portals.find((item) => item.value === session.user.portal)?.role ??
    "Hospital Admin";
  return (
    <Suspense fallback={<div role="status" style={{padding:24}}>Opening your workspace...</div>}>
    <App
      branding={branding}
      initialRole={role}
      session={session}
      onLogout={async () => {
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
        if (session.loginActivityId)
          fetch(`${API_URL}/api/v1/auth/logout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activityId: session.loginActivityId }),
          }).catch(() => {});
        clearTabSession(SESSION_KEY);
        setSession(null);
        updateBrowserPath("/login", true);
        window.dispatchEvent(
          new CustomEvent("app-success", { detail: "Logged out successfully" }),
        );
      }}
    />
    </Suspense>
  );
}

function PasswordChange({session,onChanged}:{session:Session;onChanged:()=>void}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const values=new FormData(event.currentTarget);setError('');
    if(values.get('newPassword')!==values.get('confirmPassword')){setError('Passwords do not match.');return;}
    setBusy(true);try{const response=await fetch(API_URL+'/api/v1/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token},body:JSON.stringify({currentPassword:values.get('currentPassword'),newPassword:values.get('newPassword')})});if(!response.ok){const data=await response.json();throw Error(data.error||'Unable to change password.');}onChanged();}catch(e){setError(e instanceof Error?e.message:'Unable to change password.');}finally{setBusy(false);}
  }
  return <div className="portal-login-main"><form onSubmit={submit}><h2>Change your temporary password</h2><p>You must set a new password before opening your workspace.</p>{[['currentPassword','Temporary password'],['newPassword','New password'],['confirmPassword','Confirm new password']].map(([name,label])=><label className="portal-credential" key={name}><span>{label}</span><input name={name} type="password" required minLength={8} maxLength={200} autoComplete={name==='currentPassword'?'current-password':'new-password'}/></label>)}{error&&<div className="portal-error">{error}</div>}<button className="portal-submit" disabled={busy}>Change password</button><button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('session-invalid',{detail:'Signed out.'}))}>Sign out</button></form></div>;
}
