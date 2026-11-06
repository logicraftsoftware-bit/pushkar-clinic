import {diagnosticMasterLabel} from "./hospital/diagnostic-master-labels";
import WorkspaceLink from './components/WorkspaceLink';
import {hasMenuAccess} from './menu-access';
import {LiveAccessProvider,useLiveAccess} from './hospital/LiveAccess';
import HosAiLauncher from './hospital/HosAiLauncher';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ElementType,
} from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  BedDouble,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  FileText,
  FileBarChart,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Mic,
  Package,
  Plug,
  Plus,
  Search,
  Shield,
  Settings,
  Stethoscope,
  ScrollText,
  Users,
  UserCog,
  WalletCards,
  X,
  Zap,
} from "lucide-react";

import { getDashboard } from "./api";
import type { PlatformBranding } from "./branding";
import GlobalSelectSearch from "./components/GlobalSelectSearch";
import { reportCategories, roles, type Role } from "./data";
import { pageFromPath, routeSlug, updateBrowserPath } from "./navigation";

const Overview = lazy(() => import('./hospital/DashboardOverview'));
const AccountingPage = lazy(() => import('./hospital/AccountingPage'));
const CancellationWorkflow = lazy(() => import('./hospital/CancellationWorkflow'));
const SiteActivity = lazy(() => import('./hospital/SiteActivity'));
const ReceptionLaboratory = lazy(() => import('./hospital/ReceptionLaboratory'));
const HospitalManagement = lazy(() => import('./hospital/HospitalManagement'));
const PathologyMasters = lazy(() => import('./hospital/HospitalManagement').then(module => ({default:module.PathologyMasters})));
const PharmacyMedicines = lazy(() => import('./hospital/HospitalManagement').then(module => ({default:module.PharmacyMedicines})));
const StaffManagement = lazy(() => import('./hospital/StaffManagement'));
const AccessControl = lazy(() => import('./hospital/AccessControl'));
const Patients = lazy(() => import('./hospital/Patients'));
const ReceptionLiveQueue=lazy(()=>import('./queue/ReceptionLiveQueue'));
const ClinicalOperations = lazy(() => import('./hospital/ClinicalOperations'));
const FinanceInventory = lazy(() => import('./hospital/FinanceInventory'));
const AccountantFinance = lazy(() => import('./hospital/AccountantFinance'));
const PharmacyInventory = lazy(() => import('./hospital/PharmacyInventory'));
const PharmacySuppliers = lazy(() => import('./hospital/PharmacyInventory').then(module => ({default:module.PharmacySuppliers})));
const PharmacyForecasting = lazy(() => import('./hospital/PharmacyForecasting'));
const PharmacyPrescriptionQueue = lazy(() => import('./hospital/PharmacyPrescriptionQueue'));
const PharmacyPOS = lazy(() => import('./hospital/PharmacyPOS'));
const Workforce = lazy(() => import('./hospital/Workforce'));
const AdminOperations = lazy(() => import('./hospital/AdminOperations'));
const DoctorPanel = lazy(() => import('./hospital/DoctorPanel'));
const ReceptionDischarge = lazy(() => import('./hospital/ReceptionDischarge'));
const RoleWorkspace = lazy(() => import('./hospital/RoleWorkspace'));
const NursingStation = lazy(() => import('./hospital/NursingStation'));
const AiAssistant = lazy(() => import('./hospital/AiAssistant'));
const OperationTheatre = lazy(() => import('./hospital/OperationTheatre'));
const DietaryManagement = lazy(() => import('./hospital/DietaryManagement'));
const BrokerDashboard = lazy(() => import('./hospital/ReferralWallet').then(module => ({default:module.BrokerDashboard})));
const ReferralAdmin = lazy(() => import('./hospital/ReferralWallet').then(module => ({default:module.ReferralAdmin})));

type Page = string;

type HospitalMenuItem = {
  label: string;
  icon: ElementType;
  children?: string[];
};

const hospitalMenu: HospitalMenuItem[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "AI Assistant", icon: Bot },
  { label: "Patients", icon: Users },
  { label: "Appointments & Queue", icon: CalendarDays },
  {label:"Live Queue",icon:ListChecks},
  {label:"Waiting Screens",icon:ListChecks},
  {
    label: "Reception Workspace",
    icon: Users,
    children: [
      "Reception Registration",
      "Reception Lab Orders",
      "Reception OPD Appointments",
      "Reception OPD Queue",
      "Reception IPD Admission",
      "Reception Discharge",
      "Reception Billing",
      "Reception Accounting",
      "Reception Lab Billing",
      "Reception Cancellation Requests",
      "Reception Refunds",
    ],
  },
  {
    label: "Patient Workspace",
    icon: UserCog,
    children: [
      "Patient Appointments",
      "Patient Medical Records",
      "Patient Prescriptions",
      "Patient Lab Reports",
      "Patient Radiology Reports",
      "Patient Bills & Payments",
      "Patient Discharge Summary",
      "Patient Notifications",
      "Patient Profile",
    ],
  },
  {
    label: "Doctor Workspace",
    icon: Stethoscope,
    children: [
      "Doctor OPD Appointments",
      "Doctor IPD Appointments",
      "Doctor Patient EMR",
      "Doctor Consultation",
      "Doctor Diagnosis",
      "Doctor Prescriptions",
      "Doctor Clinical Orders",
      "Doctor Follow-up",
      "Doctor AI Voice",
    ],
  },
  {
    label: "Nursing Workspace",
    icon: Activity,
    children: [
      "Nursing Station",
      "Nursing Vitals",
      "Nursing MAR",
      "Nursing Care Plan",
      "Nursing Doctor Orders",
      "Nursing Laboratory",
      "Nursing Shift Handover",
    ],
  },
  { label: "IPD & Admissions", icon: BedDouble },
  { label: "Operation Theatre", icon: Activity },
  {
    label: "Laboratory Workspace",
    icon: Activity,
    children: [
      "Lab Test Masters",
      "Lab Orders",
      "Lab Billing",
      "Lab Sample Collection",
      "Lab Results",
      "Lab Verification",
      "Lab Test Status Report",
      "Lab Reports",
      "Lab Device Integration",
    ],
  },
  {
    label: "Pharmacy Workspace",
    icon: Package,
    children: [
      "Pharmacy Prescription Queue",
      "Pharmacy POS",
      "Pharmacy Medicines",
      "Pharmacy Inventory",
      "Pharmacy Purchases",
      "Pharmacy Batch & Expiry",
      "Pharmacy Suppliers",
      "Pharmacy Forecasting",
    ],
  },
  { label: "Food & Dietary", icon: Package },
  {
    label: "Inventory & Purchase",
    icon: Package,
    children: [
      "Items",
      "Categories",
      "Suppliers",
      "Purchase Orders",
      "Purchases",
      "Stock",
      "Stock Transfers",
      "Low Stock",
    ],
  },
  {
    label: "Billing & Finance",
    icon: WalletCards,
    children: [
      "Invoices",
      "Payments",
      "Outstanding",
      "Refunds",
      "Expenses",
      "Finance Reports",
    ],
  },
  {
    label: "Accounting Workspace",
    icon: CreditCard,
    children: [
      "Accountant Billing",
      "Accountant Invoices",
      "Accountant Payments",
      "Accountant Refunds",
      "Accountant Cancellation Requests",
      "Accountant Insurance & TPA",
      "Accountant Expenses",
      "Accountant Accounting",
      "Accountant Revenue",
      "Accountant Financial Reports",
      "Accountant Tax & GST",
    ],
  },
  { label: "Insurance & TPA", icon: Shield },
  { label: "Referral Partners", icon: WalletCards },
  {
    label: "Broker Workspace",
    icon: WalletCards,
    children: [
      "Broker Referrals",
      "Broker Wallet",
      "Broker Withdrawals",
      "Broker Profile",
    ],
  },
  {
    label: "Clinic Management",
    icon: Building2,
    children: [
      "Branches",
      "Departments",
      "Bed",
      "Clinic Charges",
      "Print Header Footer",
      "Operations",
      "Pharmacy",
      "Refer Pharmacy",
      "Pathology",
      "Blood Bank",
      "Symptoms",
    ],
  },
  {
    label: "Staff Management",
    icon: UserCog,
    children: [
      "All Staff",
      "Branch Admin",
      "Doctor",
      "HR Manager",
      "Inventory Manager",
      "Lab Manager",
      "Lab Technician",
      "Pathologist",
      "Nurse",
      "Pharmacy Manager",
      "Radiologist",
      "Receptionist",
    ],
  },
  {
    label: "HR & Payroll",
    icon: ListChecks,
    children: [
      "Attendance",
      "Shifts",
      "Duty Roster",
      "Leave",
      "Payroll",
      "Holidays",
    ],
  },
  { label: "Reports & Analytics", icon: FileBarChart },
  { label: "Documents", icon: FileText },
  { label: "Notifications", icon: Bell },
  {
    label: "Access Control",
    icon: UserCog,
    children: ["Users", "Roles", "Permissions", "Login Activity"],
  },
  { label: "Audit Logs", icon: ScrollText },
  { label: "Integrations", icon: Plug },
  { label: "Settings", icon: Settings },
];
// Visibility only: all menu definitions and page implementations remain available.
const clinicAdminMenuVisibility: Record<string, readonly string[] | null> = {
  "Reception Workspace": ["Reception Registration", "Reception OPD Appointments", "Reception OPD Queue", "Reception Billing", "Reception Accounting"],
  "Patient Workspace": ["Patient Appointments", "Patient Medical Records", "Patient Prescriptions", "Patient Bills & Payments", "Patient Notifications", "Patient Profile"],
  "Doctor Workspace": ["Doctor OPD Appointments", "Doctor Patient EMR", "Doctor Consultation", "Doctor Diagnosis", "Doctor Prescriptions", "Doctor Clinical Orders", "Doctor Follow-up"],
  "Accounting Workspace": ["Accountant Billing", "Accountant Invoices", "Accountant Payments", "Accountant Accounting", "Accountant Revenue", "Accountant Financial Reports", "Accountant Tax & GST"],
  "Clinic Management": ["Branches", "Departments", "Clinic Charges", "Print Header Footer", "Pharmacy", "Symptoms"],
  "Staff Management": ["All Staff", "Branch Admin", "Doctor", "HR Manager", "Pharmacy Manager", "Receptionist"],
  "Pharmacy Workspace": null,
  "Notifications": null,
  "Access Control": null,
  "Audit Logs": null,
  "Integrations": null,
  "Settings": null,
};

function visibleMenuForRole(role: Role): HospitalMenuItem[] {
  const menu = roleMenus[role] ?? hospitalMenu;
  if (role !== "Clinic Admin") return menu;
  return Object.entries(clinicAdminMenuVisibility).flatMap(([label, children]) => {
    const item = menu.find(entry => entry.label === label);
    return item ? [{...item, children: children === null ? item.children : item.children?.filter(child => children.includes(child))}] : [];
  });
}

const doctorMenu: HospitalMenuItem[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "AI Assistant", icon: Bot },
  { label: "OPD Appointments", icon: CalendarDays },
  { label: "IPD Appointments", icon: BedDouble },
  { label: "Operation Theatre", icon: Activity },
  { label: "Food & Dietary", icon: Package },
  { label: "Patient EMR", icon: FileText },
  { label: "Consultation", icon: Stethoscope },
  { label: "Diagnosis", icon: Activity },
  { label: "Prescriptions", icon: ScrollText },
  { label: "Clinical Orders", icon: ListChecks },
  { label: "Follow-up", icon: CalendarDays },
  { label: "AI Voice", icon: Mic },
];
const roleMenus: Partial<Record<Role, HospitalMenuItem[]>> = {
  Doctor: doctorMenu,
  Reception: [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "Lab Orders", icon: Activity },
    { label: "AI Assistant", icon: Bot },
    { label: "Patient Registration", icon: Users },
    { label: "OPD Appoinments", icon: CalendarDays },
    { label: "OPD Queue", icon: ListChecks },
    {label:"Live Queue",icon:ListChecks},
    {label:"Waiting Screens",icon:ListChecks},
    { label: "IPD Admission", icon: BedDouble },
    { label: "Discharge", icon: CheckCircle2 },
    { label: "Billing", icon: CreditCard },
    { label: "Accounting", icon: FileBarChart },
    { label: "Cancellation Requests", icon: FileText },
    { label: "Refunds", icon: WalletCards },
    { label: "Lab Billing", icon: CreditCard },
    { label: "Documents", icon: FileText },
    { label: "Notifications", icon: Bell },
  ],
  Nurse: [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "AI Assistant", icon: Bot },
    { label: "Nursing Station", icon: Users },
    { label: "Vitals", icon: Activity },
    { label: "MAR", icon: ListChecks },
    { label: "Care Plan", icon: FileText },
    { label: "Doctor Orders", icon: Stethoscope },
    { label: "Laboratory", icon: Activity },
    { label: "Operation Theatre", icon: Activity },
    { label: "Food & Dietary", icon: Package },
    { label: "Shift Handover", icon: Clock3 },
  ],
  Laboratory: [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "AI Assistant", icon: Bot },
    { label: "Orders", icon: ListChecks },
    { label: "Pathology Test", icon: Activity },
    { label: "Lab Billing", icon: CreditCard },
    { label: "Sample Collection", icon: Activity },
    { label: "Results", icon: FileText },
    { label: "Verification", icon: CheckCircle2 },
    { label: "Test Status Report", icon: FileBarChart },
    { label: "Reports", icon: FileBarChart },
    { label: "Device Integration", icon: Plug },
  ],
  Pharmacy: [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "AI Assistant", icon: Bot },
    { label: "Prescription Queue", icon: ScrollText },
    { label: "POS", icon: CreditCard },
    { label: "Medicines", icon: Package },
    { label: "Inventory", icon: Package },
    { label: "Purchases", icon: WalletCards },
    { label: "Batch & Expiry", icon: Package },
    { label: "Suppliers", icon: Users },
    { label: "Forecasting", icon: FileBarChart },
  ],
  Patient: [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "AI Assistant", icon: Bot },
    { label: "Appointments", icon: CalendarDays },
    { label: "Medical Records", icon: FileText },
    { label: "Prescriptions", icon: ScrollText },
    { label: "Lab Reports", icon: FileText },
    { label: "Radiology Reports", icon: FileText },
    { label: "Bills & Payments", icon: CreditCard },
    { label: "Discharge Summary", icon: BedDouble },
    { label: "Notifications", icon: Bell },
    { label: "Profile", icon: UserCog },
  ],
  "Branch Admin": [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "AI Assistant", icon: Bot },
    { label: "Patients", icon: Users },
    { label: "Appointments", icon: CalendarDays },
    { label: "Admissions/IPD", icon: BedDouble },
    { label: "Staff", icon: UserCog },
    { label: "Inventory", icon: Package },
    { label: "Reports", icon: FileBarChart },
    { label: "Settings", icon: Settings },
  ],
  "Inventory Manager": [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "AI Assistant", icon: Bot },
    { label: "Items", icon: Package },
    { label: "Categories", icon: ListChecks },
    { label: "Suppliers", icon: Users },
    { label: "Purchase Orders", icon: WalletCards },
    { label: "Purchases", icon: WalletCards },
    { label: "Stock", icon: Package },
    { label: "Transfers", icon: Activity },
    { label: "Assets", icon: Building2 },
    { label: "Low Stock", icon: Bell },
    { label: "Reports", icon: FileBarChart },
  ],
  Accountant: [
    { label: "Documents", icon: FileText },
    { label: "Appointments", icon: CalendarDays },
    { label: "Lab Orders", icon: Activity },
    { label: "All Staff", icon: Users },
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "AI Assistant", icon: Bot },
    { label: "Billing", icon: WalletCards },
    { label: "Invoices", icon: FileText },
    { label: "Payments", icon: CreditCard },
    { label: "Refunds", icon: Activity },
    { label: "Cancellation Requests", icon: FileText },
    { label: "Insurance & TPA", icon: Shield },
    { label: "Expenses", icon: WalletCards },
    { label: "Accounting", icon: ListChecks },
    { label: "Revenue", icon: Activity },
    { label: "Financial Reports", icon: FileBarChart },
    { label: "Tax & GST", icon: ScrollText },
  ],
  "HR Manager": [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "AI Assistant", icon: Bot },
    { label: "Employees", icon: Users },
    { label: "Attendance", icon: Clock3 },
    { label: "Leave", icon: CalendarDays },
    { label: "Roster", icon: ListChecks },
    { label: "Payroll", icon: CreditCard },
    { label: "Recruitment", icon: UserCog },
    { label: "Documents", icon: FileText },
    { label: "HR Reports", icon: FileBarChart },
  ],
  Radiologist: [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "AI Assistant", icon: Bot },
    { label: "Orders", icon: ListChecks },
    { label: "Pathology Test", icon: Activity },
    { label: "Lab Billing", icon: CreditCard },
    { label: "Sample Collection", icon: Activity },
    { label: "Results", icon: FileText },
    { label: "Verification", icon: CheckCircle2 },
    { label: "Test Status Report", icon: FileBarChart },
    { label: "Reports", icon: FileBarChart },
    { label: "Device Integration", icon: Plug },
  ],
  Broker: [
    { label: "Dashboard", icon: LayoutDashboard },
    { label: "Referrals", icon: Users },
    { label: "Wallet", icon: WalletCards },
    { label: "Withdrawals", icon: CreditCard },
    { label: "Profile", icon: UserCog },
  ],
};
const dedicatedRoles = new Set<Role>([
  "Doctor",
  "Reception",
  "Nurse",
  "Laboratory",
  "Pharmacy",
  "Patient",
  "Branch Admin",
  "Inventory Manager",
  "Accountant",
  "HR Manager",
  "Radiologist",
  "Broker",
]);
const menuPermission: Record<string, string> = {
  "Cancellation Requests":"menu.billing.view",
  Refunds:"menu.billing.view",
  "Lab Orders":"menu.billing.view",
  Dashboard: "menu.dashboard.view",
  "Clinic Management": "menu.hospital.view",
  "Staff Management": "menu.staff.view",
  Patients: "menu.patients.view",
  "Appointments & Queue": "menu.appointments.view",
  "IPD & Admissions": "menu.ipd.view",
  "Operation Theatre": "menu.ipd.view",
  "Referral Partners": "menu.billing.view",
  Laboratory: "menu.lab-orders.view",
  Radiology: "menu.patients.view",
  "Billing & Finance": "menu.billing.view",
  "Inventory & Purchase": "menu.inventory.view",
  "Insurance & TPA": "menu.insurance.view",
  "HR & Payroll": "menu.hr.view",
  "Reports & Analytics": "menu.reports.view",
  Documents: "menu.documents.view",
  Notifications: "menu.notifications.view",
  "Access Control": "menu.access.view",
  "Audit Logs": "menu.audit.view",
  Integrations: "menu.integrations.view",
  Settings: "menu.settings.view",
  Appointments: "menu.appointments.view",
  Queue: "menu.queue.view",
  Admissions: "menu.ipd.view",
  "OPD Appoinments": "menu.appointments.view",
  "OPD Queue": "menu.queue.view",
  "Live Queue":"menu.queue.view",
  "Waiting Screens":"menu.queue.view",
  "IPD Admission": "menu.ipd.view",
  Discharge: "menu.ipd.view",
  Payments: "menu.billing.view",
  "Nursing Station": "menu.patients.view",
  Vitals: "menu.vitals.view",
  MAR: "menu.mar.view",
  "Care Plans": "menu.care-plans.view",
  Medication: "menu.medication.view",
  "Shift Handover": "menu.handover.view",
  Orders: "menu.lab-orders.view",
  "Pathology Test": "menu.lab-orders.view",
  "Radiology Test": "menu.lab-orders.view",
  "Samples & Studies": "menu.samples.view",
  "Sample Collection": "menu.samples.view",
  Results: "menu.results.view",
  Verification: "menu.verification.view",
  "Test Status Report": "menu.reports.view",
  Reports: "menu.reports.view",
  "Device Integration": "menu.devices.view",
  "OPD Appointments": "menu.appointments.view",
  "IPD Appointments": "menu.ipd.view",
  "Patient EMR": "menu.emr.view",
  Consultation: "menu.consultation.view",
  Diagnosis: "menu.diagnosis.view",
  Prescriptions: "menu.prescriptions.view",
  "Clinical Orders": "menu.clinical-orders.view",
  "AI Voice Documentation": "menu.voice-documentation.view",
  "AI Voice": "menu.voice-documentation.view",
  "Follow-up": "menu.appointments.view",
  "Patient Registration": "menu.patients.view",
  Billing: "menu.billing.view",
  "Care Plan": "menu.care-plans.view",
  "Doctor Orders": "menu.clinical-orders.view",
  "Prescription Requests": "menu.prescriptions.view",
  "Prescription Queue": "menu.prescriptions.view",
  POS: "menu.pos.view",
  "Lab Billing": "menu.samples.view",
  Purchases: "menu.inventory.view",
  "Batches & Expiry": "menu.batches.view",
  "Batch & Expiry": "menu.batches.view",
  Inventory: "menu.inventory.view",
  Medicines: "menu.inventory.view",
  Items: "menu.inventory.view",
  Categories: "menu.inventory.view",
  Suppliers: "menu.inventory.view",
  "Purchase Orders": "menu.inventory.view",
  Stock: "menu.inventory.view",
  Transfers: "menu.inventory.view",
  Assets: "menu.inventory.view",
  "Low Stock": "menu.inventory.view",
  Forecasting: "menu.forecasting.view",
  "Bills & Payments": "menu.billing.view",
  "Discharge Records": "menu.discharge.view",
  "Discharge Summary": "menu.discharge.view",
  "Medical Records": "menu.emr.view",
  "Lab Reports": "menu.reports.view",
  "Radiology Reports": "menu.reports.view",
  Profile: "menu.dashboard.view",
  Accounting: "menu.billing.view",
  Revenue: "menu.billing.view",
  "Financial Reports": "menu.reports.view",
  "Tax & GST": "menu.reports.view",
  Employees: "menu.staff.view",
  Attendance: "menu.hr.view",
  Leave: "menu.hr.view",
  Roster: "menu.hr.view",
  Payroll: "menu.hr.view",
  Recruitment: "menu.hr.view",
  "HR Reports": "menu.reports.view",
  "Image Viewer": "menu.samples.view",
  Reporting: "menu.results.view",
};

function Logo({
  compact = false,
  branding,
}: {
  compact?: boolean;
  branding: PlatformBranding;
}) {
  return (
    <div className="logo">
      <div className={`logo-mark ${branding.logo ? "custom" : ""}`}>
        {branding.logo ? (
          <img src={branding.logo} alt="" />
        ) : (
          <>
            <span />
            <span />
            <span />
            <span />
          </>
        )}
      </div>
      {!compact && <span>{branding.name}</span>}
    </div>
  );
}

function Sidebar({
  collapsed,
  setCollapsed,
  page,
  setPage,
  mobileOpen,
  closeMobile,
  hospital,
  branding,
  permissions,
  assignedRoles,
  managedRoles,
  role,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  page: Page;
  setPage: (v: Page) => void;
  mobileOpen: boolean;
  closeMobile: () => void;
  hospital?: {
    name: string;
    code: string;
    branchName: string;
    logoUrl?: string;
  };
  branding: PlatformBranding;
  permissions: Set<string> | null;
  assignedRoles: Array<{id:string;name:string;is_system:boolean}>;
  managedRoles: Array<{id:string;name:string;is_system:boolean}>;
  role: Role;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleSection = (label: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };
  return (
    <>
      {mobileOpen && (
        <button
          className="scrim"
          onClick={closeMobile}
          aria-label="Close menu"
        />
      )}
      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
      >
        <div className="sidebar-head">
          <Logo compact={collapsed} branding={branding} />
          <button className="icon-button sidebar-close" onClick={closeMobile}>
            <X size={18} />
          </button>
        </div>
        <div className="workspace-card">
          <div className="hospital-avatar">
            {hospital?.logoUrl ? (
              <img src={hospital.logoUrl} alt="" />
            ) : (
              (hospital?.code ?? "NH").slice(0, 2).toUpperCase()
            )}
          </div>
          {!collapsed && (
            <div>
              <strong>{hospital?.name ?? "NovaCare Clinic"}</strong>
              <small>{hospital?.branchName ?? "Central Branch"}</small>
            </div>
          )}
          {!collapsed && <ChevronDown size={15} />}
        </div>
        <nav className="hospital-nav">
          {!collapsed && <p className="nav-label">CLINIC WORKSPACE</p>}
          {!collapsed&&assignedRoles.filter(item=>!item.is_system).map(item=><p className="nav-label" key={item.id}>{item.name}</p>)}
          {visibleMenuForRole(role)
            .filter(
              (item) =>
                (item.label !== "AI Assistant" || role !== "Super Admin") &&
                canOpenPage(role,item.label,permissions),
            )
            .map((item) => {
              const childActive = item.children?.includes(page) ?? false;
              const isExpanded = expanded.has(item.label);
              const targetPage=item.children?.find(child=>canOpenPage(role,child,permissions))??item.label;
              const pageHref=(target:string)=>`/app/${routeSlug(role)}/${routeSlug(target)}`;
              return (
                <div
                  className={`hospital-nav-group ${isExpanded ? "expanded" : ""}`}
                  key={item.label}
                >
                  <WorkspaceLink
                    href={pageHref(targetPage)}
                    title={collapsed ? diagnosticMasterLabel(item.label) : undefined}
                    className={
                      page === item.label || childActive ? "active" : ""
                    }
                    onNavigate={() => {
                      if (item.children?.length && !collapsed)
                        toggleSection(item.label);
                      else {
                        setPage(targetPage);
                        closeMobile();
                      }
                    }}
                  >
                    <item.icon size={19} />
                    {!collapsed && (
                      <>
                        <span>{diagnosticMasterLabel(item.label)}</span>
                        {item.children?.length ? (
                          <ChevronDown className="nav-chevron" size={15} />
                        ) : null}
                      </>
                    )}
                  </WorkspaceLink>
                  {!collapsed && item.children?.length && isExpanded && (
                    <div className="hospital-submenu">
                      {item.children.filter(child=>canOpenPage(role,child,permissions)).map((child) => (
                        <WorkspaceLink
                          href={pageHref(child)}
                          key={child}
                          className={page === child ? "active" : ""}
                          aria-current={page===child?'page':undefined}
                          onNavigate={() => {
                            setPage(child);
                            closeMobile();
                          }}
                        >
                          <i />
                          <span>{diagnosticMasterLabel(child)}</span>
                        </WorkspaceLink>
                      ))}
                      {item.label==="Staff Management"&&role!=="Clinic Admin"&&managedRoles.map(custom=><WorkspaceLink href={`${pageHref('All Staff')}?${new URLSearchParams({staff_role:custom.name})}`} key={custom.id} title={`View ${custom.name} staff`} onNavigate={()=>{setPage("All Staff");const url=new URL(location.href);url.searchParams.set("staff_role",custom.name);history.replaceState({},"",url);window.dispatchEvent(new CustomEvent("staff-role-selected",{detail:custom.name}));closeMobile();}}><i/><span>{custom.name}</span></WorkspaceLink>)}
                    </div>
                  )}
                </div>
              );
            })}
        </nav>
        <div className="sidebar-foot">
          <div className="help-card">
            <CircleHelp size={20} />
            {!collapsed && (
              <div>
                <strong>Need help?</strong>
                <small>Visit support centre</small>
              </div>
            )}
          </div>
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronRight size={18} />
            {!collapsed && "Collapse sidebar"}
          </button>
        </div>
      </aside>
    </>
  );
}

function Header({
  token,
  role,
  setRole,
  openMenu,
  user,
  onLogout,
}: {
  token?:string;
  role: Role;
  setRole: (r: Role) => void;
  openMenu: () => void;
  user?: { name: string; role: string };
  onLogout?: () => void;
}) {
  const [roleOpen, setRoleOpen] = useState(false);
  return (
    <header className="topbar">
      <button className="icon-button menu-button" onClick={openMenu}>
        <Menu size={20} />
      </button>
      <div className="global-search">
        <Search size={18} />
        <input
          aria-label="Search"
          placeholder="Search patients, appointments, invoices…"
        />
        <kbd>⌘ K</kbd>
      </div>
      <div className="top-actions">
        {token&&<SiteActivity token={token}/>}
        <div className="role-picker">
          <button>
            <span className="live-dot" />
            {role}
          </button>
        </div>
        <button className="icon-button notification">
          <Bell size={19} />
          <span />
        </button>
        <div className="user-avatar">
          {(user?.name ?? "Arun Kumar")
            .split(" ")
            .map((v) => v[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="user-copy">
          <strong>{user?.name ?? "Arun Kumar"}</strong>
          <small>{role}</small>
        </div>
        {onLogout && (
          <button
            className="icon-button portal-logout"
            onClick={onLogout}
            title="Sign out"
          >
            <LogOut size={17} />
          </button>
        )}
      </div>
    </header>
  );
}

function Reports() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      reportCategories.filter((c) =>
        `${c.title} ${c.reports.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query],
  );
  return (
    <>
      <section className="page-heading reports-heading">
        <div>
          <div className="breadcrumb">
            Home <ChevronRight size={13} /> Reports
          </div>
          <h1>Reports centre</h1>
          <p>Explore, analyse and export operational and financial data.</p>
        </div>
        <button className="btn primary">
          <Plus size={17} /> Create custom report
        </button>
      </section>
      <div className="report-hero">
        <div>
          <span>REPORTING & ANALYTICS</span>
          <h2>Turn clinic data into clearer decisions.</h2>
          <p>
            Tenant-safe, permission-aware reporting with server-side filters and
            export-ready views.
          </p>
        </div>
        <div className="hero-stats">
          <span>
            <strong>61</strong> Standard reports
          </span>
          <span>
            <strong>8</strong> Categories
          </span>
          <span>
            <strong>12</strong> Scheduled
          </span>
        </div>
      </div>
      <div className="report-tools">
        <div className="report-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all reports…"
          />
        </div>
        <button className="btn secondary">
          <Clock3 size={16} /> Recent
        </button>
        <button className="btn secondary">
          <CalendarDays size={16} /> Scheduled
        </button>
      </div>
      <div className="report-grid">
        {filtered.map((c) => (
          <article className="report-card" key={c.title}>
            <div className={`report-icon ${c.color}`}>
              <c.icon size={22} />
            </div>
            <div className="report-title">
              <h3>{c.title}</h3>
              <span>{c.count} reports</span>
            </div>
            <div className="report-links">
              {c.reports.map((r) => (
                <button key={r}>
                  {r}
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
            <button className="view-category">
              View all {c.title.toLowerCase()} reports{" "}
              <ChevronRight size={14} />
            </button>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <FileBarChart size={34} />
          <h3>No reports found</h3>
          <p>Try another report name or category.</p>
        </div>
      )}
    </>
  );
}

function Placeholder({ page, brandName }: { page: Page; brandName: string }) {
  return (
    <div className="placeholder">
      <div className="placeholder-icon">
        <Activity size={27} />
      </div>
      <h1>{page}</h1>
      <p>
        This workspace is connected to the shared {brandName} design system and
        ready for its domain workflow.
      </p>
      <button className="btn primary">
        <Plus size={17} /> Add {page.toLowerCase()}
      </button>
    </div>
  );
}

const adminRoleWorkspacePages = new Set(
  hospitalMenu
    .filter((item) => item.label.endsWith("Workspace"))
    .flatMap((item) => item.children ?? []),
);

function AdminRoleWorkspace({
  page,
  token,
  onNavigate,
}: {
  page: string;
  token: string;
  onNavigate: (page: string) => void;
}) {
  if (page.startsWith("Doctor ")) {
    const target: Record<string, string> = {
      "Doctor OPD Appointments": "OPD Appointments",
      "Doctor IPD Appointments": "IPD Appointments",
      "Doctor Patient EMR": "Patient EMR",
      "Doctor Consultation": "Consultation",
      "Doctor Diagnosis": "Diagnosis",
      "Doctor Prescriptions": "Prescriptions",
      "Doctor Clinical Orders": "Clinical Orders",
      "Doctor Follow-up": "Follow-up",
      "Doctor AI Voice": "AI Voice",
    };
    return (
      <DoctorPanel page={target[page]} token={token} onNavigate={onNavigate} />
    );
  }
  if (page.startsWith("Nursing ") || page === "Nursing Station") {
    const target: Record<string, string> = {
      "Nursing Station": "Nursing Station",
      "Nursing Vitals": "Vitals",
      "Nursing MAR": "MAR",
      "Nursing Care Plan": "Care Plan",
      "Nursing Doctor Orders": "Doctor Orders",
      "Nursing Laboratory": "Laboratory",
      "Nursing Radiology": "Radiology",
      "Nursing Shift Handover": "Shift Handover",
    };
    return <NursingStation page={target[page]} token={token} />;
  }
  if (page === "Lab Test Masters") return <PathologyMasters token={token} />;
  if (page.startsWith("Lab ")) {
    const target: Record<string, string> = {
      "Lab Orders": "Orders",
      "Lab Billing": "Lab Billing",
      "Lab Sample Collection": "Sample Collection",
      "Lab Results": "Results",
      "Lab Verification": "Verification",
      "Lab Test Status Report": "Test Status Report",
      "Lab Reports": "Reports",
      "Lab Device Integration": "Device Integration",
    };
    return (
      <RoleWorkspace role="Laboratory" page={target[page]} token={token} />
    );
  }
  if (page === "Radiology Test Masters")
    return <PathologyMasters token={token} />;
  if (page.startsWith("Radiology ")) {
    const target: Record<string, string> = {
      "Radiology Orders": "Orders",
      "Radiology Image Viewer": "Image Viewer",
      "Radiology Reporting": "Reporting",
      "Radiology Verification": "Verification",
    };
    return (
      <RoleWorkspace role="Laboratory" page={target[page] === "Reporting" ? "Results" : target[page] === "Image Viewer" ? "Sample Collection" : target[page]} token={token} />
    );
  }
  if (page === "Pharmacy Prescription Queue")
    return <PharmacyPrescriptionQueue token={token} onNavigate={onNavigate} />;
  if (page === "Pharmacy POS") return <PharmacyPOS token={token} />;
  if (page === "Pharmacy Medicines") return <PharmacyMedicines token={token} />;
  if (
    [
      "Pharmacy Inventory",
      "Pharmacy Purchases",
      "Pharmacy Batch & Expiry",
    ].includes(page)
  )
    return (
      <PharmacyInventory page={page.replace("Pharmacy ", "")} token={token} />
    );
  if (page === "Pharmacy Suppliers") return <PharmacySuppliers token={token} />;
  if (page === "Pharmacy Forecasting")
    return <PharmacyForecasting token={token} />;
  if (page === "Reception Cancellation Requests")return <CancellationWorkflow token={token}/>;
  if (page === "Reception Refunds")return <CancellationWorkflow token={token} refunds/>;
  if (page === "Reception Accounting")return <AccountingPage token={token}/>;
  if (page === "Reception Registration") return <Patients token={token} />;
  if (page === "Reception OPD Appointments")
    return <ClinicalOperations page="Appointments & Queue" token={token} calendar />;
  if (page === "Reception OPD Queue")
    return <ClinicalOperations page="OPD Queue" token={token} />;
  if (page === "Reception IPD Admission")
    return <ClinicalOperations page="IPD & Admissions" token={token} />;
  if (page === "Reception Discharge")
    return <ReceptionDischarge token={token} />;
  if (page === "Reception Lab Orders")return <ReceptionLaboratory token={token}/>;
  if (page === "Reception Lab Billing")return <ReceptionLaboratory token={token} billingOnly/>;
  if (page === "Reception Billing")
    return <FinanceInventory page="Invoices" token={token} />;
  if (page.startsWith("Accountant "))
    return (
      <AccountantFinance page={page.replace("Accountant ", "")} token={token} />
    );
  if (page.startsWith("Broker "))
    return (
      <BrokerDashboard
        token={token}
        initialSection={page.replace("Broker ", "")}
      />
    );
  if (page.startsWith("Patient "))
    return (
      <RoleWorkspace
        role="Patient"
        page={page.replace("Patient ", "")}
        token={token}
      />
    );
  return null;
}

function HospitalApp({
  initialRole = "Clinic Admin",
  session,
  onLogout,
  branding,
}: {
  initialRole?: Role;
  session?: {
    token: string;
    user: { id?:string;name: string; role: string };
    hospital: {
      name: string;
      code: string;
      branchName: string;
      logoUrl?: string;
    };
  };
  onLogout?: () => void;
  branding: PlatformBranding;
}) {
  const initialMenu = roleMenus[initialRole] ?? hospitalMenu;
  const initialPages = Array.from(
    new Set([
      "Dashboard",
      "AI Assistant",
      ...initialMenu.flatMap((item) => [item.label, ...(item.children ?? [])]),
    ]),
  );
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [role, setRole] = useState<Role>(initialRole);
  const [page, setPage] = useState<Page>(
    () => pageFromPath(initialPages, 2) ?? (initialRole === "Clinic Admin" ? "Reception Registration" : "Dashboard"),
  );
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getDashboard>
  > | null>(null);
  const [error, setError] = useState("");
  const {ready:accessReady,permissions,roles:assignedRoles,managedRoles,error:accessError}=useLiveAccess();

  useEffect(() => {
    document.title = `${branding.name} — Clinic Operations`;
  }, [branding.name]);
  useEffect(() => {
    updateBrowserPath(`/app/${routeSlug(role)}/${routeSlug(page)}`, true);
    const onPopState = () => {
      const menu = roleMenus[role] ?? hospitalMenu;
      const pages = Array.from(
        new Set([
          "Dashboard",
          "AI Assistant",
          ...menu.flatMap((item) => [item.label, ...(item.children ?? [])]),
        ]),
      );
      setPage(pageFromPath(pages, 2) ?? (role === "Clinic Admin" ? "Reception Registration" : "Dashboard"));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [role]);


  useEffect(() => {
    let current = true;
    setData(null);
    setError("");
    if(page!=="Dashboard" || (session?.token && ["Doctor","Accountant","Broker"].includes(role)))return;
    getDashboard(role, {}, session?.token)
      .then((d) => current && setData(d))
      .catch(() => current && setError("Dashboard data could not be loaded."));
    return () => {
      current = false;
    };
  }, [role, session?.token, page === "Dashboard"]);

  const navigateToPage = (nextPage: Page) => {
    const url=new URL(location.href);url.searchParams.delete("staff_role");history.replaceState({},"",url);window.dispatchEvent(new CustomEvent("staff-role-selected",{detail:""}));
    setMobileOpen(false);
    setPage(nextPage);
    updateBrowserPath(`/app/${routeSlug(role)}/${routeSlug(nextPage)}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const changeRole = (nextRole: Role) => {
    setRole(nextRole);
    setPage("Dashboard");
    updateBrowserPath(`/app/${routeSlug(nextRole)}/dashboard`);
  };

  const pageAllowed=!session?.token||role==='Broker'||(accessReady&&canOpenPage(role,page,permissions));
  return (
    <div className="app">
      <GlobalSelectSearch />
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        page={page}
        setPage={navigateToPage}
        mobileOpen={mobileOpen}
        closeMobile={() => setMobileOpen(false)}
        hospital={session?.hospital}
        branding={branding}
        permissions={role==='Broker'?null:permissions}
        assignedRoles={assignedRoles}
        managedRoles={managedRoles}
        role={role}
      />
      <div className={`content-shell ${collapsed ? "wide" : ""}`}>
        <Header
          token={session?.token}
          role={role}
          setRole={changeRole}
          openMenu={() => setMobileOpen(true)}
          user={session?.user}
          onLogout={onLogout}
        />
        <main key={`${role}:${page}:${[...permissions??[]].sort().join(",")}`}>
          <Suspense fallback={<div role="status" style={{padding:24}}>Loading page...</div>}>
          {accessError&&<div role="alert" className="ac-error">{accessError}</div>}
          {!pageAllowed&&(!accessReady?<div role="status">Checking your current access...</div>:<div className="error-state" role="alert"><h2>Access unavailable</h2><p>Your current role does not have access to this page. Select an available workspace from the sidebar.</p></div>)}
          {pageAllowed&&<>
          {role !== "Super Admin" && page === "AI Assistant" && (
            <AiAssistant
              hospitalName={session?.hospital.name}
              userName={session?.user.name}
              token={session?.token}
              role={role}
            />
          )}
          {role === "Clinic Admin" &&
            session?.token &&
            adminRoleWorkspacePages.has(page) && (
              <AdminRoleWorkspace
                page={page}
                token={session.token}
                onNavigate={navigateToPage}
              />
            )}
          {page === "Dashboard" &&
            (role === "Doctor" && session?.token ? (
              <DoctorPanel
                page={page}
                token={session.token}
                onNavigate={navigateToPage}
              />
            ) : role === "Accountant" && session?.token ? (
              <AccountantFinance page="Dashboard" token={session.token} />
            ) : role === "Broker" && session?.token ? (
              <BrokerDashboard
                token={session.token}
                initialSection="Referrals"
              />
            ) : dedicatedRoles.has(role) && session?.token ? (
              <RoleWorkspace role={role} page={page} token={session.token} />
            ) : error ? (
              <div className="error-state">
                <AlertTriangle />
                <h2>Something went wrong</h2>
                <p>{error}</p>
                <button
                  className="btn primary"
                  onClick={() => location.reload()}
                >
                  Try again
                </button>
              </div>
            ) : data ? (
              <Overview
                role={role}
                initialData={data}
                token={session?.token}
                userName={session?.user.name}
              />
            ) : (
              <DashboardSkeleton />
            ))}
          {role === "Doctor" &&
            page !== "Dashboard" &&
            page !== "AI Assistant" &&
            page !== "Operation Theatre" &&
            page !== "Food & Dietary" &&
            doctorMenu.some((item) => item.label === page) &&
            session?.token && (
              <DoctorPanel
                page={page}
                token={session.token}
                onNavigate={navigateToPage}
              />
            )}
          {role === "Doctor" &&
            page === "Operation Theatre" &&
            session?.token && <OperationTheatre token={session.token} />}
          {role === "Doctor" && page === "Food & Dietary" && session?.token && (
            <DietaryManagement token={session.token} />
          )}
          {["Live Queue", "Waiting Screens"].includes(page) &&
            session?.token && (
              <ReceptionLiveQueue
                token={session.token}
                screensOnly={page === "Waiting Screens"}
              />
            )}
          {role !== "Doctor" &&
            dedicatedRoles.has(role) &&
            page !== "Dashboard" &&
            roleMenus[role]?.some((item) => item.label === page) &&
            session?.token &&
            page !== "AI Assistant" &&
            page !== "Live Queue" &&
            page !== "Waiting Screens" &&
            page !== "Documents" &&
            role !== "Nurse" &&
            role !== "Accountant" &&
            role !== "Broker" &&
            !(
              role === "Reception" &&
              [
                "Documents",
                "Patient Registration",
                "OPD Appoinments",
                "OPD Queue",
                "IPD Admission",
                "Discharge",
                "Billing",
                "Accounting",
                "Lab Orders",
                "Lab Billing",
                "Cancellation Requests",
                "Refunds",
              ].includes(page)
            ) &&
            !(
              role === "Pharmacy" &&
              [
                "Prescription Queue",
                "POS",
                "Medicines",
                "Purchases",
                "Inventory",
                "Batch & Expiry",
                "Suppliers",
                "Forecasting",
              ].includes(page)
            ) &&
            !(role === "Laboratory" && page === "Pathology Test") &&
            !(role === "Radiologist" && page === "Radiology Test") && (
              <RoleWorkspace role={role} page={page} token={session.token} />
            )}
          {role === "Nurse" &&
            page !== "Dashboard" &&
            page !== "AI Assistant" &&
            page !== "Operation Theatre" &&
            page !== "Food & Dietary" &&
            session?.token && (
              <NursingStation token={session.token} page={page} />
            )}
          {role === "Nurse" &&
            page === "Operation Theatre" &&
            session?.token && <OperationTheatre token={session.token} />}
          {role === "Nurse" && page === "Food & Dietary" && session?.token && (
            <DietaryManagement token={session.token} />
          )}
          {role === "Accountant" &&
            page !== "Documents" &&
            page !== "Dashboard" &&
            page !== "AI Assistant" &&
            session?.token && (
              <AccountantFinance page={page} token={session.token} />
            )}
          {role === "Broker" && page !== "Dashboard" && session?.token && (
            <BrokerDashboard token={session.token} initialSection={page} />
          )}
          {role === "Laboratory" &&
            page === "Pathology Test" &&
            session?.token && <PathologyMasters token={session.token} />}
          {role === "Radiologist" &&
            page === "Radiology Test" &&
            session?.token && <PathologyMasters token={session.token} />}
          {role === "Reception" &&
            page === "Patient Registration" &&
            session?.token && <Patients token={session.token} />}
          {role === "Reception" &&
            page === "OPD Appoinments" &&
            session?.token && (
              <ClinicalOperations
                calendar
                page="Appointments & Queue"
                token={session.token}
              />
            )}
          {role === "Reception" && page === "OPD Queue" && session?.token && (
            <ClinicalOperations page="OPD Queue" token={session.token} />
          )}
          {role === "Reception" &&
            page === "IPD Admission" &&
            session?.token && (
              <ClinicalOperations
                page="IPD & Admissions"
                token={session.token}
              />
            )}
          {role === "Reception" && page === "Lab Orders" && session?.token && <ReceptionLaboratory token={session.token}/> }
          {role === "Reception" && page === "Accounting" && session?.token && <AccountingPage token={session.token} receptionOnly/>}
          {role === "Reception" && page === "Lab Billing" && session?.token && <ReceptionLaboratory token={session.token} billingOnly/> }
          {role === "Reception" && ["Cancellation Requests","Refunds"].includes(page) && session?.token && <CancellationWorkflow key={page} token={session.token} refunds={page==="Refunds"}/> }
          {role === "Reception" && page === "Billing" && session?.token && (
            <FinanceInventory page="Invoices" token={session.token} />
          )}
          {role === "Reception" && page === "Discharge" && session?.token && (
            <ReceptionDischarge token={session.token} />
          )}
          {role === "Pharmacy" &&
            ["Purchases", "Inventory", "Batch & Expiry"].includes(page) &&
            session?.token && (
              <PharmacyInventory page={page} token={session.token} />
            )}
          {role === "Pharmacy" && page === "Suppliers" && session?.token && (
            <PharmacySuppliers token={session.token} />
          )}
          {role === "Pharmacy" && page === "Medicines" && session?.token && (
            <PharmacyMedicines token={session.token} />
          )}
          {role === "Pharmacy" && page === "Forecasting" && session?.token && (
            <PharmacyForecasting token={session.token} />
          )}
          {role === "Pharmacy" &&
            page === "Prescription Queue" &&
            session?.token && (
              <PharmacyPrescriptionQueue
                token={session.token}
                onNavigate={navigateToPage}
              />
            )}
          {role === "Pharmacy" && page === "POS" && session?.token && (
            <PharmacyPOS token={session.token} />
          )}
          {!dedicatedRoles.has(role) && page === "Reports & Analytics" && (
            <Reports />
          )}
          {!dedicatedRoles.has(role) &&
            page === "Operation Theatre" &&
            session?.token && <OperationTheatre token={session.token} />}
          {role === "Clinic Admin" &&
            page === "Food & Dietary" &&
            session?.token && <DietaryManagement token={session.token} />}
          {!dedicatedRoles.has(role) &&
            page === "Referral Partners" &&
            session?.token && <ReferralAdmin token={session.token} />}
          {!dedicatedRoles.has(role) &&
            [
              "Branches",
              "Departments",
              "Bed",
              "Clinic Charges",
              "Print Header Footer",
              "Operations",
              "Pharmacy",
              "Refer Pharmacy",
              "Pathology",
              "Radiology",
              "Blood Bank",
              "Symptoms",
            ].includes(page) &&
            session?.token && (
              <HospitalManagement page={page} token={session.token} />
            )}
          {[
            "All Staff",
            "Branch Admin",
            "Doctor",
            "HR Manager",
            "Inventory Manager",
            "Lab Manager",
            "Lab Technician",
            "Pathologist",
            "Nurse",
            "Pharmacy Manager",
            "Radiologist",
            "Receptionist",
          ].includes(page) &&
            session?.token && (
              <StaffManagement page={page} token={session.token} />
            )}
          {!dedicatedRoles.has(role) &&
            ["Users", "Roles", "Permissions"].includes(page) &&
            session?.token && (
              <AccessControl page={page} token={session.token} />
            )}
          {!dedicatedRoles.has(role) &&
            page === "Patients" &&
            session?.token && <Patients token={session.token} />}
          {role==='Accountant' && page==='Appointments' && session?.token && <ClinicalOperations page="Appointments & Queue" token={session.token}/>}
          {role==='Accountant' && page==='Lab Orders' && session?.token && <RoleWorkspace role="Laboratory" page="Orders" token={session.token}/>}
          {!dedicatedRoles.has(role) &&
            ["Appointments & Queue", "IPD & Admissions"].includes(page) &&
            session?.token && (
              <ClinicalOperations page={page} token={session.token} />
            )}
          {!dedicatedRoles.has(role) &&
            [
              "Invoices",
              "Payments",
              "Outstanding",
              "Refunds",
              "Expenses",
              "Finance Reports",
              "Items",
              "Categories",
              "Suppliers",
              "Purchase Orders",
              "Purchases",
              "Stock",
              "Stock Transfers",
              "Low Stock",
            ].includes(page) &&
            session?.token && (
              <FinanceInventory page={page} token={session.token} />
            )}
          {!dedicatedRoles.has(role) &&
            [
              "Insurance & TPA",
              "Attendance",
              "Shifts",
              "Duty Roster",
              "Leave",
              "Payroll",
              "Holidays",
            ].includes(page) &&
            session?.token && <Workforce page={page} token={session.token} />}
          {page==="Documents"&&session?.token&&<AdminOperations page="Documents" token={session.token}/> }
          {!dedicatedRoles.has(role) &&
            ["Login Activity", "Audit Logs", "Settings"].includes(
              page,
            ) &&
            session?.token && (
              <AdminOperations page={page} token={session.token} />
            )}
          {!dedicatedRoles.has(role) &&
            page !== "Dashboard" &&
            page !== "Live Queue" &&
            page !== "Waiting Screens" &&
            page !== "Reports & Analytics" &&
            !adminRoleWorkspacePages.has(page) &&
            ![
              "Clinic Profile",
              "Branches",
              "Departments",
              "Wards",
              "Rooms",
              "Bed",
              "Clinic Charges",
              "Print Header Footer",
              "Operations",
              "Pharmacy",
              "Refer Pharmacy",
              "Pathology",
              "Radiology",
              "Blood Bank",
              "Symptoms",
              "All Staff",
              "Branch Admin",
              "Doctor",
              "HR Manager",
              "Inventory Manager",
              "Lab Manager",
              "Lab Technician",
              "Pathologist",
              "Nurse",
              "Pharmacy Manager",
              "Radiologist",
              "Receptionist",
              "Users",
              "Roles",
              "Permissions",
              "Login Activity",
              "Patients",
              "Appointments & Queue",
              "IPD & Admissions",
              "Operation Theatre",
              "Food & Dietary",
              "Referral Partners",
              "Invoices",
              "Payments",
              "Outstanding",
              "Refunds",
              "Expenses",
              "Finance Reports",
              "Items",
              "Categories",
              "Suppliers",
              "Purchase Orders",
              "Purchases",
              "Stock",
              "Stock Transfers",
              "Low Stock",
              "Insurance & TPA",
              "Attendance",
              "Shifts",
              "Duty Roster",
              "Leave",
              "Payroll",
              "Holidays",
              "Documents",
              "Audit Logs",
              "Settings",
              "AI Assistant",
            ].includes(page) && (
              <Placeholder page={page} brandName={branding.name} />
            )}
          </>}
          </Suspense>
        </main>
      </div>
      {session?.token && role !== "Super Admin" && role !== "Clinic Admin" && page !== "AI Assistant" && (
        <HosAiLauncher userKey={`${session.hospital.code}:${session.user.id??session.user.name}`} onOpen={()=>navigateToPage('AI Assistant')}/>
      )}
      <nav className="mobile-app-nav" aria-label="Mobile navigation">
        <button onClick={() => setMobileOpen(true)}>
          <Menu />
          <span>Menu</span>
        </button>
        {role !== "Clinic Admin" && <button
          className={page === "Dashboard" ? "active" : ""}
          onClick={() => navigateToPage("Dashboard")}
        >
          <LayoutDashboard />
          <span>Dashboard</span>
        </button>}
        <button>
          <Zap />
          <span>Quick</span>
        </button>
      </nav>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="skeleton-page">
      <div className="skeleton title" />
      <div className="skeleton subtitle" />
      <div className="metrics-grid">
        {[1, 2, 3, 4].map((i) => (
          <div className="skeleton card" key={i} />
        ))}
      </div>
      <div className="skeleton banner" />
      <div className="analytics-grid">
        <div className="skeleton chart" />
        <div className="skeleton chart" />
      </div>
    </div>
  );
}

function canOpenPage(role:Role,page:string,permissions:Set<string>|null):boolean{
  if(!permissions)return true;
  const menu=roleMenus[role]??hospitalMenu,group=menu.find(item=>item.label===page);
  if(group?.children?.length&&!menuPermission[page])return group.children.some(child=>canOpenPage(role,child,permissions));
  const parent=menu.find(item=>item.children?.includes(page));
  let label=page;
  if(parent?.label.endsWith(' Workspace')&&/^(Doctor|Nursing|Reception|Accountant|Pharmacy|Radiology|Patient) /.test(page))label=page.replace(/^(Doctor|Nursing|Reception|Accountant|Pharmacy|Radiology|Patient) /,'');
  if(page.startsWith('Lab ')&&!['Lab Orders','Lab Billing'].includes(page))label=page.slice(4);
  const aliases:Record<string,string>={'Station':'Nursing Station','Registration':'Patient Registration','Accounting':'Billing','Revenue':'Billing','Tax & GST':'Billing','Financial Reports':'Reports','Test Masters':'Orders','Image Viewer':'Orders','Reporting':'Results','Medical Records':'Patient EMR','Lab Reports':'Reports','Radiology Reports':'Reports','Bills & Payments':'Billing','Discharge Summary':'Discharge','Doctor Orders':'Clinical Orders','Care Plan':'Care Plans','Laboratory':'Orders','AI Voice':'AI Voice','Billing':'Billing'};
  label=menuPermission[label]?label:aliases[label]??label;
  const reception=role==='Reception'||page.startsWith('Reception ');
  if(page==='All Staff')return hasMenuAccess('menu.staff.view',permissions);
  const required=reception&&['Lab Orders','Lab Billing'].includes(label)?'menu.billing.view':label==='Lab Orders'?'menu.lab-orders.view':label==='Billing'||['Invoices','Outstanding','Expenses'].includes(label)?'menu.billing.view':page==='Food & Dietary'?'ipd.view':menuPermission[label]??(parent?menuPermission[parent.label]:undefined);
  return hasMenuAccess(required,permissions);
}
export default function App(props:Parameters<typeof HospitalApp>[0]){return <LiveAccessProvider token={props.session?.token}><HospitalApp {...props} initialRole={props.initialRole === "Radiologist" ? "Laboratory" : props.initialRole}/></LiveAccessProvider>;}
