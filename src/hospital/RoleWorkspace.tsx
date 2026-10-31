import {printLabBillingPdf} from './lab-billing-pdf';
import LabWorkflowPage from './LabWorkflowPage';
import {inLabSampleQueue,sampleCollectionRow} from "../../server/src/lab-sample-queue";
import {useLiveAccess} from './LiveAccess';
import EditLabOrder from "./EditLabOrder";
import SelectedPatientEditor,{PatientEditButton} from './SelectedPatientEditor';
import {normalizeLabResultFormats,isPapSmearTest} from '../../server/src/lab-result-format';
import FinanceInventory from "./FinanceInventory";
import LabOrdersPage from './LabOrdersPage';
import LabTestStatusReport from './LabTestStatusReport';
import {defaultLabNumericResults,labOrderEditable,labTestComplete,labTestResultStatus,labResultProgress,lockedLabTestIds,reportableLabTests} from "../../server/src/lab-result-completion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Activity,
  Barcode as BarcodeIcon,
  ClipboardPlus,
  FileText,
  LoaderCircle,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import Barcode from "react-barcode";
import { QRCodeSVG } from "qrcode.react";
import Swal from "sweetalert2";
import "./role-workspace.css";
import "./lab-patient-selector.css";
import LabReportActions from "./LabReportActions";
import LabInvoiceDownloads from "./LabInvoiceDownloads";
import SavedLabBill from "./SavedLabBill";
import ReferPharmacySelect from './ReferPharmacySelect';
import {labPharmacyBilling} from '../../server/src/lab-billing';
import { LaboratoryOperations } from "./LaboratoryOperations";
import {hospitalClock} from './opd-workflow';
import { openWorkspaceTab } from "../workspace-tab";

type Row = Record<string, any>;
const API = import.meta.env.VITE_API_URL ?? "";
async function api(path: string, token: string, options: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1/workspaces${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Unable to load workspace");
  return d;
}
const roleCopy: Record<string, { title: string; subtitle: string }> = {
  Reception: {
    title: "Reception Workspace",
    subtitle:
      "Patient registration, appointments, queue, admissions and payment collection.",
  },
  Nurse: {
    title: "Nursing Workspace",
    subtitle:
      "Assigned patients, vitals, MAR, care plans, medication and shift handover.",
  },
  Laboratory: {
    title: "Laboratory Workspace",
    subtitle:
      "Orders, samples and studies, results, verification, reports and devices.",
  },
  Pharmacy: {
    title: "Pharmacy Workspace",
    subtitle:
      "Prescription requests, POS, purchases, batches, expiry, inventory and forecasting.",
  },
  Patient: {
    title: "Patient Portal",
    subtitle:
      "Appointments, prescriptions, reports, bills, payments and discharge records.",
  },
  "Branch Admin": {
    title: "Branch Admin Workspace",
    subtitle:
      "Branch-level operations, staff, appointments, patients, admissions, inventory, reports and settings.",
  },
  "Inventory Manager": {
    title: "Inventory Manager Workspace",
    subtitle:
      "Inventory masters, suppliers, purchasing, stock, transfers, assets, alerts and reporting.",
  },
  Accountant: {
    title: "Accountant Workspace",
    subtitle:
      "Billing, invoices, payments, claims, expenses, accounting, revenue and tax reporting.",
  },
  "HR Manager": {
    title: "HR Manager Workspace",
    subtitle:
      "Employees, attendance, leave, rosters, payroll, recruitment, documents and HR reports.",
  },
  Radiologist: {
    title: "Radiologist Workspace",
    subtitle:
      "Assigned imaging studies, interpretation, findings, approvals and DICOM/PACS workflows.",
  },
};
const workPages: Record<string, string[]> = {
  Reception: ["Notifications"],
  Nurse: ["Vitals", "MAR", "Care Plan", "Doctor Orders", "Shift Handover"],
  Laboratory: [
    "Pathology Test",
    "Orders",
    "Lab Billing",
    "Sample Collection",
    "Results",
    "Verification",
    "Reports",
    "Device Integration",
  ],
  Pharmacy: [
    "Prescription Queue",
    "POS",
    "Inventory",
    "Purchases",
    "Batch & Expiry",
    "Suppliers",
    "Forecasting",
  ],
  "Branch Admin": ["Staff", "Reports", "Settings"],
  "Inventory Manager": [
    "Items",
    "Categories",
    "Suppliers",
    "Purchase Orders",
    "Purchases",
    "Stock",
    "Transfers",
    "Assets",
    "Low Stock",
    "Reports",
  ],
  Accountant: [
    "Billing",
    "Invoices",
    "Payments",
    "Refunds",
    "Insurance & TPA",
    "Expenses",
    "Accounting",
    "Revenue",
    "Financial Reports",
    "Tax & GST",
  ],
  "HR Manager": [
    "Employees",
    "Attendance",
    "Leave",
    "Roster",
    "Payroll",
    "Recruitment",
    "Documents",
    "HR Reports",
  ],
  Radiologist: [
    "Radiology Test",
    "Orders",
    "Image Viewer",
    "Reporting",
    "Verification",
  ],
};
function source(page: string, data: Row) {
  if (
    page === "Patients" ||
    page === "Assigned Patients" ||
    page === "Employees" ||
    page === "Staff" ||
    page === "Profile"
  )
    return data.patients ?? [];
  if (page.includes("Appointment") || page === "Queue")
    return data.appointments ?? [];
  if (page.includes("Admission") || page === "Discharge Summary")
    return data.admissions ?? [];
  if (
    [
      "Billing",
      "Invoices",
      "Payments",
      "Refunds",
      "Insurance & TPA",
      "Expenses",
      "Accounting",
      "Financial Reports",
      "Revenue",
      "Tax & GST",
      "Bills & Payments",
    ].includes(page)
  )
    return data.finances ?? [];
  if (page === "Orders" && data.workspace !== "radiology")
    return (data.workItems ?? []).filter(
      (x: Row) =>
        x.workspace === "laboratory" &&
        ["orders", "pos", "sample collection", "results", "verification", "reports"].includes(String(x.kind).toLowerCase()),
    );
  if (page === "Sample Collection")
    return (data.workItems ?? []).filter(
      (x: Row) =>
        x.workspace === "laboratory" &&
        inLabSampleQueue(x),
    ).map(sampleCollectionRow);
  if (page === "Lab Billing")
    return (data.workItems ?? []).filter(
      (x: Row) => x.workspace === "laboratory" && String(x.kind).toLowerCase() === "pos",
    );
  if (page === "Results")
    return (data.workItems ?? []).filter(
      (x: Row) => x.workspace === "laboratory" && Boolean(x.data?.collected_at),
    );
  if (page === "Reports")
    return (data.workItems ?? []).filter(
      (x: Row) => x.workspace === "laboratory" && ["Completed","Partially Completed"].includes(x.data?.result_status) && Boolean(x.data?.doctor_approval),
    );
  const radiologyKinds: Record<string, string> = {
    Orders: "orders",
    "Image Viewer": "image viewer",
    Reporting: "reporting",
    Verification: "verification",
  };
  if (data.workspace === "radiology" && radiologyKinds[page])
    return (data.workItems ?? []).filter(
      (x: Row) => x.workspace === "radiology",
    );
  const nativeInventory = [
    "Inventory",
    "Items",
    "Categories",
    "Suppliers",
    "Purchase Orders",
    "Purchases",
    "Stock",
    "Transfers",
    "Assets",
    "Low Stock",
    "Reports",
  ].includes(page)
    ? (data.inventory ?? [])
    : [];
  const wanted: Record<string, string[]> = {
    Prescriptions: ["prescription"],
    "Medical Records": [
      "consultation",
      "diagnosis",
      "prescription",
      "order",
      "follow_up",
      "voice_documentation",
    ],
    "Lab Reports": ["lab report", "lab result", "result", "results"],
    "Radiology Reports": ["radiology report", "reporting", "diagnostic report"],
    Reports: ["report", "reports", "results"],
    Notifications: ["notification"],
  };
  const work = (data.workItems ?? []).filter((x: Row) =>
    (wanted[page] ?? [page.toLowerCase()]).includes(
      String(x.kind).toLowerCase(),
    ),
  );
  if (nativeInventory.length) return [...nativeInventory, ...work];
  return work;
}
export default function RoleWorkspace(props:{role:string;page:string;token:string}){
  if(props.role==='Laboratory'&&['Results','Verification','Reports'].includes(props.page))return <LabWorkflowPage key={props.page} token={props.token} page={props.page}/>;
  if(props.role==='Laboratory'&&props.page==='Test Status Report')return <LabTestStatusReport token={props.token}/>;
  if(props.role==="Radiologist")return <RoleWorkspace {...props} role="Laboratory" page={props.page==="Reporting"?"Results":props.page==="Image Viewer"?"Sample Collection":props.page}/>;
  if(props.role==='Inventory Manager') return <FinanceInventory key={props.page} page={props.page==='Transfers'?'Stock Transfers':props.page==='Reports'?'Inventory Reports':props.page} token={props.token}/>;
  if(props.role==='Laboratory'&&(props.page==='Orders'||props.page==='Lab Billing'))return <LabOrdersPage token={props.token} billing={props.page==='Lab Billing'}/>;
  return <LegacyRoleWorkspace key={`${props.role}:${props.page}`} {...props}/>;
}
function LegacyRoleWorkspace({
  role,
  page,
  token,
}: {
  role: string;
  page: string;
  token: string;
}) {
  const [data, setData] = useState<Row>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [selfRegistrationUrl, setSelfRegistrationUrl] = useState(""),
    [creatingRegistrationQr, setCreatingRegistrationQr] = useState(false),
    [creatingLabBill, setCreatingLabBill] = useState(new URLSearchParams(window.location.search).get("lab") === "create");
  const labList=role === "Laboratory" && ["Orders","Sample Collection","Lab Billing","Results","Reports","Verification"].includes(page);
  const [listPage,setListPage]=useState(1),[labSearch,setLabSearch]=useState("");
  const [sampleRange,setSampleRange]=useState(()=>({from:hospitalClock().date,to:hospitalClock().date}));
  const sampleDates=role==='Laboratory'&&page==='Sample Collection';
  const [editingLabOrder,setEditingLabOrder]=useState<Row|null>(null);
  const requestId=useRef(0);
  const activeRequest=useRef<AbortController|null>(null);
  useEffect(()=>{const timer=window.setTimeout(()=>{setListPage(1);setLabSearch(query.trim());},300);return ()=>window.clearTimeout(timer);},[query]);
  useEffect(()=>{setListPage(1);setQuery("");setLabSearch("");},[page]);
  const load = useCallback(async () => {
    const current=++requestId.current;
    activeRequest.current?.abort();
    const controller=new AbortController();activeRequest.current=controller;
    setLoading(true);
    try {
      const overview = labList ? await api(`/lab-orders?stage=${encodeURIComponent(page)}&page=${listPage}&search=${encodeURIComponent(labSearch)}${sampleDates?`&from=${sampleRange.from}&to=${sampleRange.to}`:''}`, token,{signal:controller.signal}).then(result=>({workspace:"laboratory",workItems:result.rows,total:result.total,page_size:result.page_size})) : await api("/overview", token,{signal:controller.signal});
      if(current!==requestId.current)return;
      setData(overview);
      setError("");
    } catch (e) {
      if(current!==requestId.current)return;
      setError(e instanceof Error ? e.message : "Unable to load workspace");
    } finally {
      if(current===requestId.current)setLoading(false);
    }
  }, [token, labList, page, listPage, labSearch,sampleDates,sampleRange]);
  useEffect(() => {
    load();
    return ()=>{++requestId.current;activeRequest.current?.abort();};
  }, [load]);
  useEffect(() => {
    if (page !== "Sample Collection" && (role !== "Laboratory" || page !== "Orders")) return;
    const refreshOrders = () => { void load(); };
    window.addEventListener("focus", refreshOrders);
    return () => window.removeEventListener("focus", refreshOrders);
  }, [role, page, load]);
  const rows = useMemo(
    () =>
      source(page, data).filter((x: Row) =>
        labList || JSON.stringify(x).toLowerCase().includes(query.toLowerCase()),
      ),
    [page, data, query, labList],
  );
  const copy = roleCopy[role] ?? roleCopy.Reception;
  async function createSelfRegistrationQr() {
    setCreatingRegistrationQr(true);
    try {
      const result = await api("/self-registration-link", token, { method: "POST" });
      setSelfRegistrationUrl(`${window.location.origin}/self-registration/${encodeURIComponent(result.token)}`);
    } catch (reason) {
      await Swal.fire("Unable to create QR code", reason instanceof Error ? reason.message : "Request failed", "error");
    } finally { setCreatingRegistrationQr(false); }
  }
  function printSelfRegistrationQr() {
    const svg = document.querySelector("#self-registration-qr svg")?.outerHTML;
    if (!svg) return;
    const popup = window.open("", "_blank", "width=720,height=800");
    if (!popup) return void Swal.fire("Printing blocked", "Please allow pop-ups and try again.", "warning");
    popup.document.write(`<!doctype html><html><head><title>Patient Self Registration QR</title><style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;text-align:center;color:#172033;padding-top:25mm}h1{font-size:25px;margin-bottom:8px}p{font-size:15px;color:#526177;margin:8px auto;max-width:520px}.qr{display:inline-block;margin:25px;padding:22px;border:2px solid #172033;border-radius:14px}.qr svg{display:block;width:320px;height:320px}.help{font-weight:bold;color:#172033}.url{font-size:9px;overflow-wrap:anywhere}@media print{button{display:none}}</style></head><body><h1>Patient Self Registration</h1><p>Scan this QR code with your phone camera to register as a patient.</p><div class="qr">${svg}</div><p class="help">Complete the form and show your generated UHID at reception.</p><p class="url">${selfRegistrationUrl}</p><script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script></body></html>`);
    popup.document.close();
  }
  if(editingLabOrder)return <EditLabOrder order={editingLabOrder} token={token} onClose={()=>setEditingLabOrder(null)} onSaved={()=>{setEditingLabOrder(null);load();}}/>;
  if (creatingLabBill && role === "Laboratory") return <CreateLabOwnBill token={token} onClose={() => { const url=new URL(window.location.href);url.searchParams.delete("lab");window.history.replaceState({},"",url);setCreatingLabBill(false);load(); }} onCreated={() => { load(); }} />;
  if (loading && !data.workItems)
    return (
      <div className="workspace-loading">
        <LoaderCircle className="spin" /> Loading {role.toLowerCase()}{" "}
        workspace…
      </div>
    );
  return (
    <section className="role-workspace">
      <header>
        <div>
          <small>
            {copy.title} / {page}
          </small>
          <h1>{page === "Dashboard" ? copy.title : page}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <div className="workspace-header-actions">
          {role === "Reception" && page === "Dashboard" && (
            <button className="primary" disabled={creatingRegistrationQr} onClick={createSelfRegistrationQr}>
              <Printer /> {creatingRegistrationQr ? "Creating QR…" : "Print Self Registration QR Code"}
            </button>
          )}
          {role === "Laboratory" && page === "Orders" && <button className="primary" onClick={() => { const url=new URL(window.location.href);url.searchParams.set('lab','create');history.replaceState({},'',url);setCreatingLabBill(true); }}><Plus /> Create Lab Order</button>}
          <button onClick={load}><RefreshCw /> Refresh</button>
        </div>
      </header>
      {error && <div className="workspace-error">{error}</div>}
      {role === "Patient" && !data.patientLinked && (
        <div className="workspace-error">
          Your login email or phone is not linked to a patient record. Ask
          reception to update it.
        </div>
      )}
      {selfRegistrationUrl && (
        <div className="workspace-view-back">
          <section className="workspace-view self-registration-qr-modal">
            <header><div><h2>Patient Self Registration</h2><p>Scan to open the public registration page.</p></div><button onClick={() => setSelfRegistrationUrl("")}>×</button></header>
            <div id="self-registration-qr"><QRCodeSVG value={selfRegistrationUrl} size={300} level="H" includeMargin /><p>This QR is linked to the current hospital branch.</p></div>
            <footer><button onClick={() => setSelfRegistrationUrl("")}>Close</button><button className="primary" onClick={printSelfRegistrationQr}><Printer /> Print QR Code</button></footer>
          </section>
        </div>
      )}
      {page === "Dashboard" ? (
        <>
          <div className="workspace-metrics">
            {[
              ["Patients", data.metrics?.patients],
              ["Today's appointments", data.metrics?.appointments],
              ["Waiting", data.metrics?.waiting],
              ["Pending tasks", data.metrics?.pending],
            ].map((x) => (
              <article key={x[0]}>
                <span>{x[0]}</span>
                <strong>{x[1] ?? 0}</strong>
              </article>
            ))}
          </div>
          <WorkTable
            rows={(data.workItems ?? []).slice(0, 8)}
            token={token}
            reload={load}
            onEditLabOrder={setEditingLabOrder}
          />
        </>
      ) : (
        <>
          {sampleDates&&<div className="workspace-toolbar" aria-label="Sample collection date range"><label>From Date<input type="date" value={sampleRange.from} max={sampleRange.to||undefined} onChange={event=>{setListPage(1);setSampleRange(range=>({...range,from:event.target.value}));}}/></label><label>To Date<input type="date" value={sampleRange.to} min={sampleRange.from||undefined} onChange={event=>{setListPage(1);setSampleRange(range=>({...range,to:event.target.value}));}}/></label><button type="button" onClick={()=>{const today=hospitalClock().date;setListPage(1);setSampleRange({from:today,to:today});}}>Today</button></div>}
          {!(role==="Laboratory"&&page==="Verification")&&<div className="workspace-toolbar">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={labList ? "Search test, patient, phone, UHID, order or bill" : `Search ${page.toLowerCase()}`}
            />
            <span>{loading ? "Loading..." : `${labList ? data.total ?? 0 : rows.length} records`}</span>
          </div>}
          {role === "Laboratory" && ["Sample Collection", "Results", "Verification", "Reports"].includes(page) ? <LaboratoryOperations token={token} page={page} dateRange={sampleDates?sampleRange:undefined}><WorkTable rows={rows} token={token} reload={load} page={page} onEditLabOrder={setEditingLabOrder} /></LaboratoryOperations> : <WorkTable rows={rows} token={token} reload={load} page={page} onEditLabOrder={setEditingLabOrder} />}
          {labList && page!=="Verification" && <div className="workspace-header-actions" style={{marginTop:16}}><button disabled={loading || listPage===1} onClick={()=>setListPage(current=>current-1)}>Previous</button><span>Page {listPage} of {Math.max(1,Math.ceil((data.total||0)/50))}</span><button disabled={loading || listPage*50 >= (data.total||0)} onClick={()=>setListPage(current=>current+1)}>Next</button></div>}
          {role !== "Radiologist" && workPages[role]?.includes(page) && !["Orders", "Sample Collection", "Lab Billing", "Results", "Reports", "Verification"].includes(page) && (
            <CreateWork
              page={page}
              patients={data.patients ?? []}
              token={token}
              reload={load}
            />
          )}
          {creatingLabBill && <CreateLabOwnBill token={token} onClose={() => setCreatingLabBill(false)} onCreated={() => { setCreatingLabBill(false); load(); }} />}
        </>
      )}
    </section>
  );
}
function WorkTable({
  rows,
  token,
  reload,
  page,
  onEditLabOrder,
}: {
  rows: Row[];
  token: string;
  reload: () => void;
  page?: string;
  onEditLabOrder: (order: Row) => void;
}) {
  const [viewing, setViewing] = useState<Row | null>(null);
  const [billing, setBilling] = useState<Row | null>(null);
  const [labResult, setLabResult] = useState<{ record: Row; report: boolean } | null>(null);
  const [openingResults,setOpeningResults]=useState(false);
  const isSamples = page === "Sample Collection";
  const isPos = page === "Lab Billing";
  const isResults = page === "Results";
  const isReports = page === "Reports";
  const isOrders = page === "Orders";
  const isImageViewer = page === "Image Viewer";
  const isRadiologyReporting = page === "Reporting";
  const isRadiologyVerification = page === "Verification";
  async function complete(row: Row) {
    const result = await Swal.fire({
      title: "Update status?",
      text: `Mark ${row.title ?? row.record_number ?? "record"} as completed?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Yes, complete",
    });
    if (!result.isConfirmed) return;
    try {
      await api(`/work-items/${row.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ status: "Completed" }),
      });
      await Swal.fire("Updated", "Status updated successfully.", "success");
      reload();
    } catch (e) {
      Swal.fire(
        "Unable to update",
        e instanceof Error ? e.message : "Request failed",
        "error",
      );
    }
  }
  async function labAction(row: Row, action: "cancel" | "send_bill" | "send_sample") {
    const result = await Swal.fire({
      title: "Confirm action",
      text:
        action === "cancel"
          ? "Cancel this lab order?"
          : action === "send_bill" ? "Generate the bill and send this order to Lab Billing?" : "Billing is complete. Send this order to Sample Collection?",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Yes",
    });
    if (!result.isConfirmed) return;
    try {
      await api(`/work-items/${row.id}/lab-action`, token, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      await Swal.fire(
        "Updated",
        action === "cancel"
          ? "Lab order cancelled."
          : action === "send_bill" ? "Bill generated and order sent to Lab Billing." : "Order sent to Sample Collection.",
        "success",
      );
      reload();
    } catch (e) {
      Swal.fire(
        "Unable to update",
        e instanceof Error ? e.message : "Request failed",
        "error",
      );
    }
  }
  async function radiologyAction(
    row: Row,
    action:
      | "cancel"
      | "start_study"
      | "complete_study"
      | "submit_report"
      | "verify",
  ) {
    let report: string | undefined;
    if (action === "submit_report") {
      const answer = await Swal.fire({
        title: "Enter radiology report",
        input: "textarea",
        inputLabel: "Findings / Impression",
        inputValue: row.data?.report ?? "",
        inputPlaceholder: "Enter findings and clinical impression",
        showCancelButton: true,
        confirmButtonText: "Submit for verification",
        inputValidator: (value) =>
          value.trim().length < 2 ? "Radiology report is required" : undefined,
      });
      if (!answer.isConfirmed) return;
      report = answer.value.trim();
    } else {
      const labels = {
        cancel: ["Cancel radiology order?", "Cancel Order"],
        start_study: ["Start this imaging study?", "Start Study"],
        complete_study: ["Mark imaging as completed?", "Send to Reporting"],
        verify: ["Verify and approve this radiology report?", "Verify Report"],
      } as const;
      const answer = await Swal.fire({
        title: labels[action][0],
        icon: "question",
        showCancelButton: true,
        confirmButtonText: labels[action][1],
      });
      if (!answer.isConfirmed) return;
    }
    try {
      await api(`/work-items/${row.id}/radiology-action`, token, {
        method: "PATCH",
        body: JSON.stringify({ action, report }),
      });
      await Swal.fire("Updated", "Radiology workflow updated successfully.", "success");
      reload();
    } catch (e) {
      Swal.fire(
        "Unable to update",
        e instanceof Error ? e.message : "Request failed",
        "error",
      );
    }
  }
  async function generateBarcodes(row: Row) {
    const answer = await Swal.fire({
      title: "Who is collecting the sample?",
      input: "text",
      inputLabel: "Collector name",
      inputPlaceholder: "Enter phlebotomist / staff name",
      showCancelButton: true,
      confirmButtonText: "Generate barcodes",
      inputValidator: (value) => value.trim().length < 2 ? "Collector name is required" : undefined,
    });
    if (!answer.isConfirmed) return;
    try {
      const updated = await api(`/work-items/${row.id}/sample-action`, token, {
        method: "PATCH",
        body: JSON.stringify({ action: "generate_barcodes", collector: answer.value.trim() }),
      });
      setViewing({ ...row, ...updated });
      reload();
    } catch (e) { Swal.fire("Unable to generate", e instanceof Error ? e.message : "Request failed", "error"); }
  }
  async function markCollected(row: Row) {
    const answer = await Swal.fire({ title: "Sample collected?", text: "The billed order will move to Laboratory Results.", icon: "question", showCancelButton: true, confirmButtonText: "Collected" });
    if (!answer.isConfirmed) return;
    try {
      const updated = await api(`/work-items/${row.id}/sample-action`, token, { method: "PATCH", body: JSON.stringify({ action: "collected" }) });
      setViewing(null);
      await Swal.fire("Sample recorded", "The order is now available in Laboratory Results.", "success");
      reload();
    } catch (e) { Swal.fire("Unable to collect", e instanceof Error ? e.message : "Request failed", "error"); }
  }
  async function openBill(row: Row) {
    try {
      setBilling(await api(`/work-items/${row.id}/lab-bill`, token));
    } catch (e) { Swal.fire("Unable to open bill", e instanceof Error ? e.message : "Request failed", "error"); }
  }
  async function openResults(row: Row, report = false) {
    if(openingResults)return;setOpeningResults(true);
    try {
      setLabResult({ record: await api(`/work-items/${row.id}/lab-results${report?'':'?mode=entry'}`, token), report });
    } catch (e) { Swal.fire("Unable to open results", e instanceof Error ? e.message : "Request failed", "error"); }finally{setOpeningResults(false);}
  }
  if(openingResults)return <div className="workspace-loading" role="status" aria-live="polite"><LoaderCircle className="spin"/> Opening laboratory results...</div>;
  if (labResult&&!labResult.report)
    return <LabResultModal record={labResult.record} report={labResult.report} token={token} pageMode returnLabel={isReports ? "Back to Reports" : "Back to Results"} onClose={() => {setLabResult(null);reload();}} onSaved={() => { setLabResult(null); reload(); }} />;
  function printBarcodes(row: Row, selectedValue?: string) {
    const items = (row.data?.barcodes ?? []).filter((item: Row) => !selectedValue || item.value === selectedValue);
    const labels = items.map((item: Row) => {
      const svg = document.querySelector(`[data-barcode-value="${CSS.escape(item.value)}"] svg`);
      if (!svg) return "";
      const safe = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
      return `<section class="label"><strong>${safe(item.test_name)}</strong><div>${svg.outerHTML}</div><small>${safe(row.patient_name)} · ${safe(row.medical_record_number)}</small><small>Collected by: ${safe(row.data?.collector)}</small></section>`;
    }).join("");
    if (!labels) return;
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) return void Swal.fire("Printing blocked", "Please allow pop-ups for this site and try again.", "warning");
    popup.document.write(`<!doctype html><html><head><title>Lab Barcodes</title><style>@page{margin:8mm}.label{box-sizing:border-box;width:90mm;min-height:38mm;padding:5mm;border:1px dashed #aaa;page-break-inside:avoid;font-family:Arial,sans-serif}.label strong,.label small{display:block;margin-bottom:2mm}.label svg{max-width:100%;height:auto}body{display:flex;flex-wrap:wrap;gap:4mm;margin:0}@media print{.label{border:0}}</style></head><body>${labels}<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script></body></html>`);
    popup.document.close();
  }
  return (
    <>
      {labResult?.report&&<LabReportActions record={labResult.record} tests={labResult.record.tests||[]} token={token} selectionOnly onBack={()=>setLabResult(null)} backLabel="Close"/>}
      <div className="workspace-card">
        <table>
          <thead>
            <tr>
              <th>Record / Date</th>
              <th>Patient / Details</th>
              <th>Type</th>
              <th>Status</th>
              {isOrders && rows.some(row => row.workspace === "laboratory") && <th>Bill</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? i}>
                <td>
                  <strong>
                    {(isReports || isResults || isSamples) && r.workspace === "laboratory" && /^Direct Lab\b/i.test(String(r.title))
                      ? `Direct Lab · ${r.medical_record_number || r.data?.medical_record_number || "UHID not recorded"}`
                      : r.title ??
                      r.appointment_number ??
                      r.ipd_number ??
                      r.record_number ??
                      r.record_code ??
                      "Record"}
                  </strong>
                  <small>
                    {r.appointment_date ??
                      r.record_date ??
                      (r.occurred_at
                        ? new Date(r.occurred_at).toLocaleString()
                        : "")}
                  </small>
                </td>
                <td>
                  <div className="workspace-patient">
                    <span>
                      {r.patient_name ??
                        r.medical_record_number ??
                        r.data?.name ??
                        r.data?.medicine ??
                        "—"}
                    </span>
                    {(isReports || isResults || isSamples) && r.workspace === "laboratory" && <small>Bill: {r.bill_number || r.data?.bill_number || "Not recorded"}</small>}
                    {r.workspace === "radiology"&&<small>Ordering doctor: {r.ordering_doctor_name||"Not recorded"}</small>}
                    {page === "Orders" && r.workspace === "laboratory" && (
                      <span
                        className={`workspace-patient-type ${r.patient_type === "IPD" ? "ipd" : r.patient_type === "Lab Own" ? "lab-own" : "opd"}`}
                      >
                        {r.patient_type === "Lab Own" ? "LAB OWN" : `${r.patient_type || "OPD"} PATIENT`}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {r.kind ?? r.appointment_type ?? r.data?.category ?? "—"}
                </td>
                <td>
                  <b>{isResults || isReports ? r.data?.result_status || "Pending Results" : r.status ?? r.payment_status ?? "Active"}</b>
                  {isOrders && r.workspace === "laboratory" && r.data?.result_status && <small>Results: {r.data.result_status}</small>}
                </td>
                {isOrders && rows.some(row => row.workspace === "laboratory") && <td>{r.bill_id ? <><b>Bill Generated</b><small>{r.bill_number}</small><small>{r.bill_status}</small></> : <small>Not generated</small>}</td>}
                <td>
                  {isOrders && r.workspace === "radiology" ? (
                    <div className="workspace-order-actions">
                      <button onClick={() => setViewing(r)}>View</button>
                      <button className="send" disabled={r.status !== "Pending"} onClick={() => radiologyAction(r, "start_study")}>Start Study</button>
                      <button className="cancel" disabled={r.status !== "Pending"} onClick={() => radiologyAction(r, "cancel")}>Cancel</button>
                    </div>
                  ) : isImageViewer ? (
                    <div className="workspace-order-actions">
                      <button onClick={() => setViewing(r)}>View</button>
                      <button className="send" disabled={r.kind !== "image viewer" || r.status !== "Study In Progress"} onClick={() => radiologyAction(r, "complete_study")}>Imaging Completed</button>
                    </div>
                  ) : isRadiologyReporting ? (
                    <div className="workspace-order-actions">
                      <button onClick={() => setViewing(r)}>View</button>
                      <button className="send" disabled={r.kind !== "reporting" || r.status !== "Awaiting Report"} onClick={() => radiologyAction(r, "submit_report")}><FileText /> Enter Report</button>
                    </div>
                  ) : isRadiologyVerification && r.workspace === "radiology" ? (
                    <div className="workspace-order-actions">
                      <button onClick={() => setViewing(r)}>View Report</button>
                      <button className="send" disabled={r.kind !== "verification" || r.status !== "Awaiting Verification"} onClick={() => radiologyAction(r, "verify")}>{r.status === "Verified" ? "Verified" : "Verify"}</button>
                    </div>
                  ) : isResults ? (
                    <div className="workspace-order-actions"><button data-permission="lab.result.create" onClick={() => openResults(r)}>{r.data?.doctor_approval ? "View / Finish Results" : r.data?.result_status === "Completed" ? "Edit Results" : "Enter Results"}</button></div>
                  ) : isReports ? (
                    <div className="workspace-order-actions"><button className="send" onClick={() => openResults(r, true)}><FileText /> Print Report</button></div>
                  ) : isSamples ? (
                    <div className="workspace-order-actions">
                      <button onClick={() => setViewing(r)}>View</button>
                      <button className="send" disabled={r.status !== "Awaiting Sample"} onClick={() => generateBarcodes(r)}><BarcodeIcon /> Generate</button>
                      <button className="send" disabled={r.status !== "Barcode Generated"} onClick={() => markCollected(r)}>Collected</button>
                    </div>
                  ) : isPos ? (
                    <div className="workspace-order-actions">
                      <button onClick={() => setViewing(r)}>View</button>
                      <button className="send" onClick={() => openBill(r)}>Open Bill</button>
                      <button disabled={!labOrderEditable(r)} onClick={()=>onEditLabOrder(r)}>Edit Order</button><button className="send" disabled={!r.data?.bill_id} onClick={() => labAction(r,"send_sample")}>Send to Sample Collection</button>
                    </div>
                  ) : page === "Orders" && r.workspace === "laboratory" ? (
                    <div className="workspace-order-actions">
                      <button onClick={() => setViewing(r)}>View</button>
                      <button disabled={!labOrderEditable(r)} onClick={()=>onEditLabOrder(r)}>Edit Order</button>{r.bill_id ? <button className="send" onClick={() => openBill(r)}>Open Bill</button> : <button
                        className="send"
                        disabled={r.kind !== "orders" || r.status !== "Pending"}
                        onClick={() => labAction(r, "send_bill")}
                      >
                        Send to Billing
                      </button>}
                      <button
                        className="cancel"
                        disabled={r.kind !== "orders" || r.status !== "Pending"}
                        onClick={() => labAction(r, "cancel")}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    r.workspace &&
                    String(r.status).toLowerCase() !== "completed" && (
                      <button onClick={() => complete(r)}>Complete</button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="workspace-empty">No records found.</div>
        )}
      </div>
      {viewing && (
        <div className="workspace-view-back">
          <section className="workspace-view">
            <header>
              <div>
                <h2>
                  {viewing.workspace === "radiology"
                    ? "Radiology Order"
                    : isPos
                      ? "Laboratory Bill"
                      : isSamples
                        ? "Sample Collection"
                        : "Lab Order"}
                </h2>
                <p>
                  {viewing.patient_name} · {viewing.medical_record_number}
                </p>
              </div>
              <button onClick={() => setViewing(null)}>×</button>
            </header>
            <div>
              <h3>Ordered Tests</h3>
              {(viewing.data?.tests ?? []).map((test: Row, index: number) => (
                <article key={test.test_id ?? index}>
                  <b>
                    {index + 1}. {test.name}
                  </b>
                  <span>Priority: {test.priority || "Routine"}</span>
                  <span>Instructions: {test.instruction || "—"}</span>
                  <span>
                    Amount: ₹{Number(test.amount || 0).toLocaleString("en-IN")}
                  </span>
                </article>
              ))}
              <h3>Clinical Details</h3>
              <p>
                <b>Diagnosis:</b> {viewing.data?.diagnosis || "—"}
              </p>
              {viewing.data?.barcodes?.length > 0 && <div className="sample-barcodes">
                <div className="sample-barcode-heading"><h3>Test Barcodes</h3><button onClick={() => printBarcodes(viewing)}><Printer /> Print all</button></div>
                <p><b>Collected by:</b> {viewing.data.collector}</p>
                {viewing.data.barcodes.map((item: Row) => <article key={item.value} data-barcode-value={item.value}>
                  <strong>{item.test_name}</strong><Barcode value={item.value} height={48} width={1.35} fontSize={11} margin={4}/>
                  <button onClick={() => printBarcodes(viewing, item.value)}><Printer /> Print</button>
                </article>)}
              </div>}
              {isPos && <div className="sample-bill"><h3>Bill</h3><p><b>Invoice:</b> {viewing.data?.bill_number}</p><p><b>Total:</b> ₹{Number((viewing.data?.tests ?? []).reduce((n: number, x: Row) => n + Number(x.amount || 0), 0)).toLocaleString("en-IN")}</p><p><b>Status:</b> {viewing.status}</p></div>}
              <p>
                <b>Investigation:</b> {viewing.data?.investigation || "—"}
              </p>
              {viewing.workspace === "radiology" && viewing.data?.report && (
                <div className="sample-bill">
                  <h3>Radiology Report</h3>
                  <p>{viewing.data.report}</p>
                  <p><b>Status:</b> {viewing.status}</p>
                </div>
              )}
            </div>
            <footer>
              {isSamples && viewing.status === "Awaiting Sample" && <button className="primary" onClick={() => generateBarcodes(viewing)}>Generate barcodes</button>}
              {isSamples && viewing.status === "Barcode Generated" && <button className="primary" onClick={() => markCollected(viewing)}>Collected</button>}
              <button onClick={() => setViewing(null)}>Close</button>
            </footer>
          </section>
        </div>
      )}
      {billing && <LabBill bill={billing} token={token} onClose={() => setBilling(null)} onSaved={reload} />}
    </>
  );
}

export async function printLabBill(bill:Row,token:string){
  try{await printLabBillingPdf(()=>api(`/work-items/${bill.data?.lab_order_id||bill.order_id}/lab-bill`,token));}
  catch(error){await Swal.fire('Unable to print bill',error instanceof Error?error.message:'Request failed','error');}
}

export function LabBill({ bill:initialBill, token, onClose, onSaved }: { bill: Row; token: string; onClose: () => void; onSaved: () => void }) {
  const [bill,setBill]=useState(initialBill);
  const [mode, setMode] = useState(String(bill.data?.payment_mode || "Cash"));
  const [paid, setPaid] = useState(String(Number(bill.paid || 0)));
  const [discount, setDiscount] = useState(String(Number(bill.data?.discount_amount || 0)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(bill.data?.payment_mode || Number(bill.paid) > 0));
  const tests: Row[] = Array.isArray(bill.tests) ? bill.tests : [];
  const subtotal = Number(bill.amount || 0), discountNumber = Number(discount || 0), total = Math.max(subtotal - discountNumber, 0), paidNumber = Number(paid || 0), due = Math.max(total - paidNumber, 0);
  async function save(testIndex?:number) {
    if (discountNumber < 0 || discountNumber > subtotal) return void Swal.fire("Invalid discount", `Discount must be between ₹0 and ₹${subtotal.toLocaleString("en-IN")}.`, "warning");
    if (paidNumber < 0 || paidNumber > total) return void Swal.fire("Invalid amount", `Paid amount must be between ₹0 and ₹${total.toLocaleString("en-IN")}.`, "warning");
    setSaving(true);
    try {
      await api(`/work-items/${bill.data?.lab_order_id}/lab-bill`, token, { method: "PATCH", body: JSON.stringify({ payment_mode: mode, paid: paidNumber, discount: discountNumber }) });
      setBill(await api(`/work-items/${bill.data?.lab_order_id}/lab-bill`,token));
      await Swal.fire("Payment updated", "The laboratory bill and balance were updated.", "success");
      setSaved(true);
      onSaved();
    } catch (e) { Swal.fire("Unable to update bill", e instanceof Error ? e.message : "Request failed", "error"); }
    finally { setSaving(false); }
  }
  return <div className="workspace-view-back"><section className="workspace-view lab-bill-modal">
    <header><div><h2>Laboratory Bill</h2><p>{bill.record_number}</p></div><button onClick={onClose}>×</button></header>
    <div>
      <div className="lab-bill-meta"><p><span>Patient</span><b>{bill.patient_name}</b></p><p><span>Patient ID</span><b>{bill.medical_record_number}</b></p><p><span>Collected by</span><b>{bill.collector || "—"}</b></p><p><span>Bill date</span><b>{String(bill.record_date).slice(0, 10)}</b></p></div>
      <h3>Test breakdown</h3>
      <table className="lab-bill-table"><thead><tr><th>#</th><th>Test</th><th>Priority</th><th>Amount</th></tr></thead><tbody>{tests.map((test, index) => <tr key={test.test_id ?? index}><td>{index + 1}</td><td>{test.name}</td><td>{test.priority || "Routine"}</td><td>₹{Number(test.amount || 0).toLocaleString("en-IN")}</td></tr>)}</tbody></table>
      <div className="lab-bill-totals"><p><span>Subtotal</span><b>₹{subtotal.toLocaleString("en-IN")}</b></p><p><span>Discount</span><b>₹{discountNumber.toLocaleString("en-IN")}</b></p><p><span>Tax</span><b>₹0</b></p><p className="grand"><span>Bill total</span><b>₹{total.toLocaleString("en-IN")}</b></p></div>
      <div className="lab-payment-fields"><label><span>Discount amount</span><input type="number" disabled={!!bill.data?.refer_pharmacy_id} min="0" max={subtotal} step="0.01" value={discount} onChange={(e) => { setDiscount(e.target.value); setSaved(false); }} /></label><label><span>Payment mode</span><select value={mode} onChange={(e) => { setMode(e.target.value); setSaved(false); }}><option>Cash</option><option>Card</option><option>UPI</option><option>Bank Transfer</option><option>Insurance</option></select></label><label><span>Paid amount</span><input type="number" min="0" max={total} step="0.01" value={paid} onChange={(e) => { setPaid(e.target.value); setSaved(false); }} /></label></div>
      <div className="lab-payment-summary"><span>Remaining amount</span><strong>₹{due.toLocaleString("en-IN")}</strong></div>
    </div>
    <div><LabInvoiceDownloads bill={bill} loadBill={()=>api(`/work-items/${bill.data?.lab_order_id||bill.order_id}/lab-bill`,token)}/></div>
    <footer>{saved && <button className="primary" onClick={()=>printLabBill(bill,token)}><Printer /> Print Bill</button>}<button onClick={onClose}>Close</button><button data-permission="lab.result.create" className="primary" disabled={saving} onClick={()=>save()}>{saving ? "Saving…" : "Save Payment"}</button></footer>
  </section></div>;
}

export function CreateLabOwnBill({ token, onClose, onCreated, editOrder }: { token: string; onClose: () => void; onCreated: () => void; editOrder?:Row }) {
  const editing=!!editOrder,initial=editOrder?.data||{};
  const [diagnosis,setDiagnosis]=useState(String(initial.diagnosis||''));
  const [tests,setTests]=useState<Row[]>([]),[selected,setSelected]=useState<string[]>((initial.tests||[]).map((test:Row)=>test.test_id)),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[mode,setMode]=useState<"existing"|"new">("existing"),[patient,setPatient]=useState<Row|null>(editOrder?{id:editOrder.patient_id,patient_name:editOrder.patient_name||initial.customer_name,medical_record_number:editOrder.medical_record_number||initial.medical_record_number,phone:editOrder.patient_phone||initial.phone,sex:initial.gender}:null),[search,setSearch]=useState(""),[matches,setMatches]=useState<Row[]>([]),[searching,setSearching]=useState(false),[registering,setRegistering]=useState(false);
  const [doctors,setDoctors]=useState<Row[]>([]),[referral,setReferral]=useState(initial.referred_by_id||""),[testSearch,setTestSearch]=useState(""),[discount,setDiscount]=useState(String(initial.manual_discount_amount??initial.discount_amount??0)),[paidOverride,setPaid]=useState<string|null>(editOrder?String(editOrder.bill_paid??initial.paid_amount??0):null),[paymentMode,setPaymentMode]=useState(initial.payment_mode||"Cash"),[savedBill,setSavedBill]=useState<Row|null>(null),[urgent,setUrgent]=useState(!!initial.urgent||(initial.tests||[]).some((test:Row)=>test.priority==="Urgent"));
  const [editingPatientId,setEditingPatientId]=useState('');
  const [recentAppointments,setRecentAppointments]=useState<Row[]>([]),[recentError,setRecentError]=useState('');
  useEffect(()=>{if(editing)return;const controller=new AbortController();api('/lab-recent-appointments',token,{signal:controller.signal}).then(setRecentAppointments).catch(error=>{if(!controller.signal.aborted)setRecentError(error.message);});return()=>controller.abort();},[token]);
  const [investigation,setInvestigation]=useState({source:initial.source||"Self"});
  const [options,setOptions]=useState<{partners:Row[];staff:Row[];centers:Row[];pharmacies:Row[]}>({partners:[],staff:[],centers:[],pharmacies:[]});
  const [pharmacyId,setPharmacyId]=useState(initial.refer_pharmacy_id||'');
  const [pharmacyDiscountOverride,setPharmacyDiscountOverride]=useState<string|null>(editOrder?String(initial.pharmacy_discount_percentage||0):null);
  const [partnerId,setPartnerId]=useState(initial.referral_partner_id||""),[collectorId,setCollectorId]=useState(initial.collector_id||""),[centerId,setCenterId]=useState(editOrder?.branch_id||initial.center_id||""),[optionsLoading,setOptionsLoading]=useState(true),[optionsError,setOptionsError]=useState("");
  useEffect(()=>{api("/lab-registration-options",token).then(data=>{if(editOrder){
        const retain=(rows:Row[],id:string,name:string,extra:Row={})=>id&&!rows.some(row=>row.id===id)?[...rows,{id,name,...extra}]:rows;
        data.centers=retain(data.centers,editOrder.branch_id,initial.center||'Order center');
        data.partners=retain(data.partners,initial.referral_partner_id,initial.executive||'Saved executive');
        data.staff=retain(data.staff,initial.collector_id,initial.collector||'Saved collector');
        data.pharmacies=retain(data.pharmacies||[],initial.refer_pharmacy_id,initial.refer_pharmacy_name||'Saved pharmacy',{discount_percentage:initial.pharmacy_discount_percentage});
      }
      setOptions(data);if(!editing)setCenterId(data.current_center_id||data.centers[0]?.id||"");}).catch(e=>setOptionsError(e.message)).finally(()=>setOptionsLoading(false));},[token]);
  useEffect(()=>{api("/lab-referrals",token).then(rows=>setDoctors(initial.referred_by_id&&!rows.some((row:Row)=>row.id===initial.referred_by_id)?[...rows,{id:initial.referred_by_id,name:initial.referred_by||'Saved doctor'}]:rows)).catch(e=>Swal.fire("Unable to load referring doctors",e.message,"error"));},[token]);
  useEffect(() => { if(!centerId)return;let active=true;setLoading(true);setTests([]);api(`/lab-tests?center_id=${encodeURIComponent(centerId)}`, token).then(data=>{if(active){const saved:Row[]=initial.tests||[];setTests([...data.map((test:Row)=>{const prior=saved.find(row=>row.test_id===test.id);return prior?{...test,data:{...test.data,amount:prior.amount??test.data?.amount}}:test;}),...saved.filter(prior=>!data.some((test:Row)=>test.id===prior.test_id)).map(prior=>({id:prior.test_id,name:prior.name||prior.test_name,data:{amount:prior.amount}}))]);}}).catch((e) => {if(active){setTests([]);Swal.fire("Unable to load tests", e instanceof Error ? e.message : "Request failed", "error");}}).finally(() => {if(active)setLoading(false);});return()=>{active=false;}; }, [token,centerId]);
  useEffect(()=>{
    const controller=new AbortController();
    if(mode!=="existing"||patient||search.trim().length<2){setMatches([]);setSearching(false);return;}
    setMatches([]);setSearching(true);
    const timer=window.setTimeout(()=>{api(`/lab-patients?search=${encodeURIComponent(search.trim())}`,token,{signal:controller.signal}).then(rows=>{if(!controller.signal.aborted)setMatches(rows);}).catch(e=>{if(!controller.signal.aborted)Swal.fire("Unable to search",e.message,"error");}).finally(()=>{if(!controller.signal.aborted)setSearching(false);});},300);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[search,mode,patient,token]);
  const total = tests.filter((test) => selected.includes(test.id)).reduce((sum, test) => sum + Number(test.data?.amount || 0), 0);
  const pharmacy=options.pharmacies?.find(row=>row.id===pharmacyId);
  const pharmacyDiscountPercentage=pharmacy ? pharmacyDiscountOverride??String(pharmacy.discount_percentage||0) : "0";
  let pharmacyTotals:ReturnType<typeof labPharmacyBilling>|null=null;
  try{pharmacyTotals=labPharmacyBilling([total],Number(discount),0,Number(pharmacyDiscountPercentage));}catch{/* Invalid input is shown when saving. */}
  const netTotal=pharmacyTotals?.total??0;
  const paid=paidOverride??netTotal.toFixed(2);
  async function submit() {
    if(!patient)return void Swal.fire("Select patient","Search and select an existing patient, or register a new patient.","warning");
    if (!selected.length) return void Swal.fire("Select tests", "Select at least one pathology test.", "warning");
    setSaving(true);
    try {
      if (!pharmacyTotals || !Number.isFinite(Number(paid)) || Number(paid)<0 || Number(paid)>netTotal) throw new Error("Check discount and paid amount against the bill total");
      if(editOrder){
        await api(`/work-items/${editOrder.id}/lab-order`,token,{method:'PATCH',body:JSON.stringify({test_ids:selected,discount:Number(discount),diagnosis,urgent,updated_at:editOrder.updated_at,referred_by:referral||null,source:investigation.source,referral_partner_id:partnerId||null,collector_id:collectorId||null,refer_pharmacy_id:pharmacyId||null,pharmacy_discount_percentage:Number(pharmacyDiscountPercentage)})});
        onCreated();return;
      }
      const result=await api("/lab-own-orders",token,{method:"POST",body:JSON.stringify({patient_id:patient.id,appointment_id:patient.appointment_id||null,test_ids:selected,referred_by:referral||null,urgent,...investigation,referral_partner_id:partnerId||null,collector_id:collectorId||null,refer_pharmacy_id:pharmacyId||null,pharmacy_discount_percentage:Number(pharmacyDiscountPercentage),center_id:centerId||null,discount:Number(discount),paid:Number(paid),payment_mode:paymentMode})});
      setSavedBill(result.bill);onCreated();
    } catch (e) { Swal.fire(editing?"Unable to update lab order":"Unable to create bill", e instanceof Error ? e.message : "Request failed", "error"); }
    finally { setSaving(false); }
  }
  async function register(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=new FormData(e.currentTarget);setRegistering(true);try{const created=await api("/lab-patients",token,{method:"POST",body:JSON.stringify(Object.fromEntries(form))});setPatient(created);await Swal.fire("Patient registered",`${created.patient_name} was registered as ${created.medical_record_number} and selected automatically.`,"success")}catch(error){Swal.fire("Unable to register patient",error instanceof Error?error.message:"Request failed","error")}finally{setRegistering(false)}}
  const savedOrderId=savedBill?.data?.lab_order_id;
  const loadSavedBill=useCallback(()=>api(`/work-items/${savedOrderId}/lab-bill`,token),[savedOrderId,token]);
  if(savedBill) return <SavedLabBill initialBill={savedBill} loadBill={loadSavedBill} onClose={onClose} onNewOrder={()=>{setSavedBill(null);setPatient(null);setSelected([]);setSearch("");setDiscount("0");setPaid(null);setPharmacyId("");setPharmacyDiscountOverride(null);}}/>;
  return <>{editingPatientId&&<SelectedPatientEditor patientId={editingPatientId} token={token} branches={options.centers} onClose={()=>setEditingPatientId('')} onSaved={updated=>{setPatient(current=>({...current,...updated}));setRecentAppointments(current=>current.map(row=>row.id===updated.id?{...row,...updated}:row));setEditingPatientId('');}}/>}<div className="selected-patient-draft" hidden={!!editingPatientId}><div className="lab-create-page"><section className="lab-own-modal"><header><div><h2>{editing?"Edit Lab Order":"Create Lab Order & Bill"}</h2><p>{editing?"Update the existing tests and investigation information.":"Select an existing patient or register a new patient."}</p></div><button onClick={onClose}>×</button></header><div className="lab-own-body">
    {!editing&&<div className="lab-patient-mode"><button className={mode==="existing"?"active":""} onClick={()=>{setMode("existing");setPatient(null)}}>Existing Patient</button><button className={mode==="new"?"active":""} onClick={()=>{setMode("new");setPatient(null)}}>New Patient</button></div>}
    {patient?<div className="lab-selected-patient"><span><b>{patient.patient_name||`${patient.first_name} ${patient.last_name}`}</b><small>{patient.medical_record_number} · {patient.phone||"No phone"} · {patient.sex||"—"}</small></span><div className="lab-selected-patient-actions"><PatientEditButton disabled={saving} onClick={()=>setEditingPatientId(patient.id)}/>{!editing&&<button type="button" onClick={()=>setPatient(null)}>Change</button>}</div></div>:mode==="existing"?<div className="lab-patient-search"><section className="lab-recent-opd"><h3>Recent OPD Appointments</h3>{recentError&&<p role="alert">{recentError}</p>}<div className="lab-recent-opd-list">{recentAppointments.filter(row=>!search||[row.patient_name,row.medical_record_number,row.phone].join(' ').toLowerCase().includes(search.toLowerCase())).map(row=><button type="button" key={row.appointment_id} onClick={()=>{setPatient(row);setReferral(doctors.some(doctor=>doctor.id===row.doctor_id)?row.doctor_id:'');setMatches([]);}}><b>{row.patient_name}</b><small>{row.appointment_date?.slice(0,10)} {String(row.appointment_time).slice(0,5)} | {row.medical_record_number} | {row.doctor_name||'No doctor'}</small></button>)}</div>{!recentAppointments.length&&!recentError&&<p>No recent OPD appointments found.</p>}</section><label>Search by name, phone number or UHID<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Type at least 2 characters..." autoFocus/></label>{searching&&<p><LoaderCircle className="spin"/> Searching patients...</p>}<div>{matches.map(row=><button key={row.id} onClick={()=>{setPatient(row);setMatches([])}}><b>{row.patient_name}</b><small>{row.medical_record_number} · {row.phone||"No phone"} · {row.sex||"—"}</small></button>)}{search.length>=2&&!searching&&!matches.length&&<p>No matching patient found. Choose New Patient to register.</p>}</div></div>:<form className="lab-registration-form" onSubmit={register}><h3>New Patient Registration</h3><div><label>Title<select name="title"><option value="">Select</option>{["Mr","Mrs","Ms","Master","Baby","Dr"].map(x=><option key={x}>{x}</option>)}</select></label><label>First name *<input name="first_name" required/></label><label>Last name *<input name="last_name" required/></label><label>Phone number *<input name="phone" required minLength={5}/></label><label>Age (years) *<input name="age_years" type="number" min="0" max="150" required/></label><label>Age (months)<input name="age_months" type="number" min="0" max="11"/></label><label>Age (days)<input name="age_days" type="number" min="0" max="30"/></label><label>Father's name<input name="father_name"/></label><label>Mother's name<input name="mother_name"/></label><label>State *<input name="state" defaultValue="Assam" required/></label><label>District *<input name="district" defaultValue="Kamrup" required/></label><label>City / Village *<input name="city" required/></label><label>Gender<select name="sex" defaultValue="unknown"><option value="unknown">Unknown</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label><label>Blood group<select name="blood_group"><option value="">Select</option>{["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(x=><option key={x}>{x}</option>)}</select></label><label>Email<input name="email" type="email"/></label><label>Address<input name="address"/></label><label>Emergency contact name<input name="emergency_name"/></label><label>Emergency contact phone<input name="emergency_phone"/></label><label className="wide">Allergies<textarea name="allergies" placeholder="Known allergies or none"/></label></div><button className="primary" disabled={registering}>{registering?"Registering...":"Register & Select Patient"}</button></form>}
    <h3>Investigation information</h3>{optionsError&&<p className="workspace-error">{optionsError}</p>}<div className="lab-own-fields">
      <label><span>Referred By</span><select value={referral} onChange={e=>setReferral(e.target.value)}><option value="">Self</option>{doctors.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label><span>Source</span><select value={investigation.source} onChange={e=>setInvestigation({source:e.target.value})}>{[...new Set(["Self","TV ad","Radio ad","Direct Marketing","News Paper","Social Media",investigation.source])].map(x=><option key={x}>{x}</option>)}</select></label>
      <label><span>Center</span><select value={centerId} disabled={editing||optionsLoading||saving} onChange={e=>{setTests([]);setLoading(true);setCenterId(e.target.value);}}><option value="">Select center</option>{options.centers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span>Select Executive (Referral Partner)</span><select value={partnerId} disabled={optionsLoading} onChange={e=>setPartnerId(e.target.value)}><option value="">Self</option>{options.partners.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span>Collection Done By</span><select value={collectorId} disabled={optionsLoading} onChange={e=>setCollectorId(e.target.value)}><option value="">Select staff member</option>{options.staff.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <ReferPharmacySelect rows={(options.pharmacies||[]) as any} value={pharmacyId} onChange={id=>{setPharmacyId(id);setPharmacyDiscountOverride(null);}} disabled={optionsLoading||saving}/>
    </div>{editing&&<div className="lab-own-fields"><label><span>Clinical note</span><input value={diagnosis} onChange={e=>setDiagnosis(e.target.value)}/></label></div>}<label><input type="checkbox" checked={urgent} onChange={e=>setUrgent(e.target.checked)}/> Urgent</label>
    <h3>Select pathology tests</h3><input className="lab-test-search" placeholder="Search test name" value={testSearch} onChange={e=>setTestSearch(e.target.value)}/>
    {loading?<p>Loading tests...</p>:testSearch.trim()?<div className="lab-own-tests">{tests.filter(test=>test.name.toLowerCase().includes(testSearch.trim().toLowerCase())&&!selected.includes(test.id)).map(test=><label key={test.id}><input type="checkbox" checked={false} onChange={()=>{setSelected(current=>[...current,test.id]);setTestSearch("");}}/><span><b>{test.name}</b><small>INR {Number(test.data?.amount||0).toLocaleString("en-IN")}</small></span></label>)}{!tests.some(test=>test.name.toLowerCase().includes(testSearch.trim().toLowerCase())&&!selected.includes(test.id))&&<p>No matching unselected tests found.</p>}</div>:<p>Search for a test to add it to the bill.</p>}
    <p>{selected.length} tests selected</p>{selected.length>0&&<div className="lab-own-tests">{tests.filter(test=>selected.includes(test.id)).map(test=><label key={test.id}><input type="checkbox" checked onChange={()=>setSelected(current=>current.filter(id=>id!==test.id))}/><span><b>{test.name}</b><small>INR {Number(test.data?.amount||0).toLocaleString("en-IN")}</small></span></label>)}</div>}
    <div className="lab-own-total"><span>Estimated bill total</span><strong>₹{total.toLocaleString("en-IN")}</strong></div>
    <h3>Payment information</h3>{editing&&<p>Recorded payments are retained. Use Open Bill to collect or adjust payments.</p>}{editing&&pharmacyTotals&&Number(paid)>netTotal&&<p className="workspace-error" role="alert">The revised bill total cannot be less than the amount already paid. Adjust the tests or discount before saving.</p>}{pharmacy&&<div className="lab-own-total"><span>Pharmacy discount: {pharmacy.name} ({pharmacyDiscountPercentage}%)</span><strong>− INR {Number(pharmacyTotals?.pharmacy_discount_amount||0).toFixed(2)}</strong></div>}<div className="lab-own-fields">{pharmacy&&<label><span>Pharmacy discount (%)</span><input aria-label="Pharmacy discount (%)" type="number" min="0" max="100" step="0.01" required value={pharmacyDiscountPercentage} onChange={e=>setPharmacyDiscountOverride(e.target.value)}/></label>}<label><span>Additional discount amount (INR)</span><input type="number" min="0" max={total} step="0.01" value={discount} onChange={e=>setDiscount(e.target.value)}/></label><label><span>Additional discount (%)</span><input type="number" min="0" max="100" step="0.01" value={total?Number((Number(discount)/total*100).toFixed(2)):0} onChange={e=>setDiscount(String(Math.round(total*Number(e.target.value))/100))}/></label><label className="lab-payment-highlight"><span>Paid amount (INR)</span><input type="number" min="0" max={netTotal} step="0.01" disabled={editing} value={paid} onChange={e=>setPaid(e.target.value)}/></label><label className="lab-payment-highlight"><span>Payment mode</span><select disabled={editing} value={paymentMode} onChange={e=>setPaymentMode(e.target.value)}>{["Cash","Card","UPI","Bank Transfer","Insurance"].map(x=><option key={x}>{x}</option>)}</select></label></div><div className="lab-own-total"><span>Net bill: INR {netTotal.toFixed(2)}</span><strong>Balance: INR {Math.max(0,netTotal-Number(paid)).toFixed(2)}</strong></div>
    </div><footer><button type="button" onClick={onClose}>Back to orders</button><button className="primary" disabled={saving||loading||optionsLoading||!!optionsError||registering||!patient||!selected.length||!centerId||(editing&&(!pharmacyTotals||Number(paid)>netTotal))} onClick={submit}>{saving?"Saving...":editing?"Save Order Changes":"Save Order & Bill"}</button></footer>
  </section></div></div></>;
}
function parameterRangeStatus(parameter: Row) {
  const value = Number(String(parameter.value ?? "").replaceAll(",", ""));
  const from = Number(String(parameter.reference_from ?? "").replaceAll(",", ""));
  const to = Number(String(parameter.reference_to ?? "").replaceAll(",", ""));
  if (!Number.isFinite(value) || String(parameter.value ?? "").trim() === "") return "neutral";
  const hasFrom = String(parameter.reference_from ?? "").trim() !== "" && Number.isFinite(from);
  const hasTo = String(parameter.reference_to ?? "").trim() !== "" && Number.isFinite(to);
  if (hasFrom && value < from) return "low";
  if (hasTo && value > to) return "high";
  return hasFrom || hasTo ? "normal" : "neutral";
}
export function LabResultModal({ record, report, token, pageMode = false, returnLabel = "Back to Reports", focusTestId, onClose, onSaved }: { record: Row; report: boolean; token: string; pageMode?: boolean; returnLabel?: string; focusTestId?:string; onClose: () => void; onSaved: () => void }) {
  const {permissions}=useLiveAccess();
  const canEnter=permissions===null||permissions.has('lab.result.create');

  const [tests, setTests] = useState<Row[]>(()=>report||record.definition_revision?normalizeLabResultFormats(record.tests??[]):defaultLabNumericResults(normalizeLabResultFormats(record.tests??[]),record.data||{})), [saving, setSaving] = useState(false); const [savedTests,setSavedTests]=useState<Row[]>(record.tests ?? []); const [saveMessage,setSaveMessage]=useState(""); const [collapsed,setCollapsed]=useState<number[]>(()=> (record.tests??[]).flatMap((test:Row,index:number)=> (focusTestId?test.test_id!==focusTestId:labTestComplete(test)&&!record.data?.disapproved_test_ids?.includes(test.test_id))?[index]:[])); const [history,setHistory]=useState<Row[]>(record.data?.result_history??[]); const [updatedAt,setUpdatedAt]=useState<string>(record.updated_at);
  const [definitionRevision,setDefinitionRevision]=useState<string|undefined>(record.definition_revision);
  function change(testIndex: number, parameterIndex: number, key: "value" | "remarks", value: string) {
    setTests((current) => current.map((test, ti) => ti !== testIndex ? test : { ...test, parameters: test.parameters.map((parameter: Row, pi: number) => pi !== parameterIndex ? parameter : { ...parameter, [key]: value }) }));
  }
  async function save(testIndex?:number) {
    if(!canEnter)return;
    setSaving(true);
    try {
      const selected=testIndex===undefined?tests:[tests[testIndex]];
      const saved=await api(`/work-items/${record.id}/lab-results`, token, { method: "PATCH", body: JSON.stringify({ updated_at:updatedAt,definition_revision:definitionRevision, results: (definitionRevision?selected:defaultLabNumericResults(selected,record.data||{})).map((test) => ({ test_id: test.test_id, parameters: test.parameters.map((parameter: Row) => ({ parameter_id: parameter.parameter_id, value: parameter.value, remarks: parameter.remarks || "" })) })) }) });
      const persisted:Row[]=saved.data?.lab_results??[];
      setSavedTests(persisted);
      setUpdatedAt(saved.updated_at);
      setDefinitionRevision(saved.definition_revision);
      setHistory(saved.data?.result_history??[]);
      setCollapsed(current=>Array.from(new Set([...current,...tests.flatMap((test,index)=>(testIndex===undefined||testIndex===index)&&labTestComplete(persisted.find(item=>item.test_id===test.test_id)||{})?[index]:[])])));
      setTests(current=>current.map((test,index)=>testIndex===undefined||index===testIndex?({...test,...persisted.find(item=>item.test_id===test.test_id)}):test));
      setSaveMessage(testIndex===undefined?"All results saved.":`${tests[testIndex].name} saved. ${labTestComplete(persisted.find(item=>item.test_id===tests[testIndex].test_id)||{})?"Test completed.":"Test remains pending until all results are entered."}`);
      if(testIndex===undefined){await Swal.fire("Results saved", "Completed tests are ready for verification. Unfinished tests remain pending.", "success"); onSaved();}
    } catch (e) { Swal.fire("Unable to save results", e instanceof Error ? e.message : "Request failed", "error"); }
    finally { setSaving(false); }
  }
  if(report)return <LabReportActions record={record} tests={tests} token={token} selectionOnly onBack={onClose} backLabel="Close"/>;
  if(!report&&!canEnter)return <section role="alert"><p>Your result entry permission has been revoked. Unsaved results have not been submitted.</p><button onClick={onClose}>Back to results</button></section>;
  return <div className={pageMode ? "lab-report-page" : "workspace-view-back"}><section className="workspace-view lab-result-modal"><header><div><h2>{report ? "Pathology Report" : "Enter Pathology Results"}</h2><p>{record.patient_name} · {record.medical_record_number}</p></div><button onClick={onClose}>{pageMode ? "Back" : "×"}</button></header><div className="lab-result-body">{saveMessage&&<p role="status">{saveMessage}</p>}{record.data?.doctor_approval && <p role="status">Verified tests are locked. You can finish pending tests and submit them for approval.</p>}<p role="status"><strong>Result status: {labResultProgress(savedTests).status}</strong> · {labResultProgress(savedTests).completed.length} of {tests.length} tests completed. Doctor-approved tests with saved results can be printed. The result-entry technician is recorded automatically.</p><div className="lab-result-meta"><span>Patient type: <b>{record.data?.patient_type || record.patient_type || "OPD"}</b></span><span>Collected by: <b>{record.data?.collector || "—"}</b></span><span className="lab-range-legend"><i className="normal" /> In range <i className="high" /> High <i className="low" /> Low</span></div>{tests.map((test, testIndex) => report&&!reportableLabTests([test],record.data||{}).length?null:<section className={`lab-result-test ${isPapSmearTest(test)?"lab-pap-test":""}`} key={test.test_id ?? testIndex}><div className="lab-result-test-toolbar"><h3><button type="button" className="lab-result-toggle" aria-expanded={report||!collapsed.includes(testIndex)} aria-controls={`lab-test-${testIndex}`} disabled={report} onClick={()=>setCollapsed(current=>current.includes(testIndex)?current.filter(index=>index!==testIndex):[...current,testIndex])}>{test.name} - {labTestResultStatus(savedTests.find(item=>item.test_id===test.test_id)||{})}{!report&&<span>{collapsed.includes(testIndex)?"Expand / Edit":"Collapse"}</span>}</button></h3>{!report&&<button className="primary lab-save-test" type="button" disabled={saving||lockedLabTestIds(record.data||{}).includes(test.test_id)} onClick={()=>save(testIndex)}>{saving?"Saving...":"Save test result"}</button>}</div><fieldset id={`lab-test-${testIndex}`} hidden={!report&&collapsed.includes(testIndex)} disabled={saving||(!report&&lockedLabTestIds(record.data||{}).includes(test.test_id))} style={{border:0,padding:0,margin:0}}><div className="lab-result-grid lab-result-head"><span>Parameter</span><span>Result</span><span>Unit</span><span>Reference range</span><span>{report ? "Status / Remarks" : "Remarks"}</span></div>{test.parameters.map((parameter: Row, parameterIndex: number) => { if(!report&&isPapSmearTest(test)&&parameter.result_type_id==='27')return <div className="lab-pap-description" key={parameter.parameter_id??parameterIndex}><label><strong>{parameter.name||'Pap smear report'}</strong><textarea aria-label="Pap smear report description" rows={14} maxLength={20000} placeholder="Type the complete Pap smear report here…" value={parameter.value||''} onChange={event=>change(testIndex,parameterIndex,'value',event.target.value)}/><small>{String(parameter.value||'').length.toLocaleString('en-IN')} / 20,000 characters</small></label><label>Remarks<input placeholder="Optional" value={parameter.remarks||''} onChange={event=>change(testIndex,parameterIndex,'remarks',event.target.value)}/></label></div>; const rangeStatus=report ? parameterRangeStatus(parameter) : "neutral"; return <div className={`lab-result-grid ${rangeStatus}`} key={parameter.parameter_id ?? parameterIndex}><span><b>{parameter.name}</b>{parameter.description && <small>{parameter.description}</small>}</span>{report ? <strong>{parameter.value}</strong> : ["0","5"].includes(parameter.result_type_id) ? <span>Heading</span> : parameter.result_type_id === "2" ? <select value={parameter.value} onChange={e => change(testIndex, parameterIndex, "value", e.target.value)}><option value="">Select result</option>{(parameter.choices || []).map((choice: string) => <option key={choice}>{choice}</option>)}</select> : parameter.result_type_id === "27" ? <textarea value={parameter.value} onChange={e => change(testIndex, parameterIndex, "value", e.target.value)} /> : <input type={parameter.result_type_id === "1" ? "number" : "text"} step="any" value={parameter.value} onChange={(e) => change(testIndex, parameterIndex, "value", e.target.value)} />}<span>{parameter.unit || "—"}</span><span style={{whiteSpace:"pre-line"}}>{parameter.reference_text || (parameter.reference_from || parameter.reference_to ? `${parameter.reference_from || "—"} – ${parameter.reference_to || "—"}` : "—")}</span>{report ? <span><b>{rangeStatus === "normal" ? "In range" : rangeStatus === "high" ? "High" : rangeStatus === "low" ? "Low" : "—"}</b>{parameter.remarks && <small>{parameter.remarks}</small>}</span> : <input value={parameter.remarks || ""} placeholder="Optional" onChange={(e) => change(testIndex, parameterIndex, "remarks", e.target.value)} />}</div>; })}</fieldset></section>)}{!report&&history.length>0&&<details className="lab-result-history"><summary>Result edit history ({history.length} saves)</summary>{[...history].reverse().map((entry,index)=><article key={index}><p><strong>{entry.at?new Date(entry.at).toLocaleString():"Previous save"}</strong> · User: {entry.by||"Unknown"}</p>{entry.changes?.length?<div className="lab-history-scroll"><table><thead><tr><th>Test / Parameter</th><th>Previous result</th><th>Saved result</th><th>Remarks change</th></tr></thead><tbody>{entry.changes.map((change:Row,i:number)=><tr key={i}><td>{change.test_name}<br/>{change.parameter_name}</td><td>{change.previous_value||"(blank)"}</td><td>{change.value||"(blank)"}</td><td>{change.previous_remarks||"(blank)"} → {change.remarks||"(blank)"}</td></tr>)}</tbody></table></div>:<details><summary>Previous saved values</summary>{(entry.results||[]).map((test:Row,i:number)=><div key={i}><strong>{test.name||test.test_name}</strong>{(test.parameters||[]).filter((p:Row)=>!["0","5"].includes(String(p.result_type_id))).map((p:Row,j:number)=><p key={j}>{p.name}: {p.value||"(blank)"}{p.remarks?` · ${p.remarks}`:""}</p>)}</div>)}</details>}</article>)}</details>}</div><footer>{report ? <LabReportActions record={record} tests={tests} token={token} onBack={onClose} backLabel={pageMode ? returnLabel : "Close"}/> : <><button onClick={onClose}>{pageMode ? returnLabel : "Close"}</button><button className="primary" disabled={saving} onClick={()=>save()}>{saving ? "Saving…" : "Save All Results"}</button></>}</footer></section></div>;
}
function CreateWork({
  page,
  patients,
  token,
  reload,
}: {
  page: string;
  patients: Row[];
  token: string;
  reload: () => void;
}) {
  const [patient, setPatient] = useState(""),
    [title, setTitle] = useState(""),
    [details, setDetails] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/work-items", token, {
        method: "POST",
        body: JSON.stringify({
          kind: page,
          title,
          patient_id: patient || null,
          data: { details },
        }),
      });
      setTitle("");
      setDetails("");
      await Swal.fire(
        "Saved",
        `${page} record created successfully.`,
        "success",
      );
      reload();
    } catch (e) {
      Swal.fire(
        "Unable to save",
        e instanceof Error ? e.message : "Request failed",
        "error",
      );
    }
  }
  return (
    <form className="workspace-create" onSubmit={submit}>
      <h2>
        <ClipboardPlus /> Add {page} record
      </h2>
      <select value={patient} onChange={(e) => setPatient(e.target.value)}>
        <option value="">No patient</option>
        {patients.map((p) => (
          <option value={p.id} key={p.id}>
            {p.patient_name} · {p.medical_record_number}
          </option>
        ))}
      </select>
      <input
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`${page} title`}
      />
      <textarea
        required
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Clinical / operational details"
      />
      <button type="submit">
        <Save /> Save record
      </button>
    </form>
  );
}
