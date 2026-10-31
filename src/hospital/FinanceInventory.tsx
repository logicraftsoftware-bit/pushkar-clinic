import {doctorWithQualification} from '../../server/src/doctor-print-display';
import {BILL_PRINT_CSS} from "./billing-paper";
import {billLines,createInvoicePdf,createPaymentReceiptPdf} from "./invoice-pdf";
import LabFinanceDownloads,{loadLabFinanceBill} from "./LabFinanceDownloads";
import { readJsonResponse } from "../http-response";
import {downloadLabBillingPdf} from "./lab-billing-pdf";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  BarChart3,
  Download,
  Edit3,
  LoaderCircle,
  Plus,
  Search,
  TriangleAlert,
  ReceiptText,
  X,
} from "lucide-react";
import "./finance-inventory.css";
import "./payments-breakdown.css";
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
type R = any;
type F = {
  key: string;
  label: string;
  type?: string;
  lookup?: string;
  required?: boolean;
};
const finance = [
    "Invoices",
    "Payments",
    "Outstanding",
    "Refunds",
    "Expenses",
    "Finance Reports",
  ],
  inventory = [
    "Items",
    "Categories",
    "Suppliers",
    "Purchase Orders",
    "Purchases",
    "Stock",
    "Stock Transfers",
    "Low Stock",
    "Assets",
    "Inventory Reports",
  ];
const defs: Record<
  string,
  {
    area: "finance" | "inventory";
    kind: string;
    fields: F[];
    readonly?: boolean;
  }
> = {
  Invoices: {
    area: "finance",
    kind: "invoices",
    fields: [
      {
        key: "patient_id",
        label: "Patient",
        lookup: "patients",
        required: true,
      },
      { key: "data.care_type", label: "OPD / IPD" },
      { key: "data.services", label: "Services" },
      { key: "data.quantity", label: "Quantity", type: "number" },
      { key: "data.rate", label: "Rate", type: "number" },
      { key: "data.discount", label: "Discount", type: "number" },
      { key: "data.tax", label: "Tax", type: "number" },
      { key: "total", label: "Total", type: "number" },
      { key: "paid", label: "Paid", type: "number" },
      { key: "status", label: "Status" },
      { key: "record_date", label: "Invoice Date", type: "date" },
    ],
  },
  Payments: {
    area: "finance",
    kind: "payments",
    fields: [
      {
        key: "invoice_id",
        label: "Invoice",
        lookup: "invoices",
        required: true,
      },
      {
        key: "patient_id",
        label: "Patient",
        lookup: "patients",
        required: true,
      },
      { key: "amount", label: "Amount", type: "number", required: true },
      { key: "data.payment_method", label: "Payment Method" },
      { key: "data.transaction_reference", label: "Transaction Reference" },
      { key: "record_date", label: "Date", type: "date" },
      { key: "data.received_by", label: "Received By" },
    ],
  },
  Outstanding: {
    area: "finance",
    kind: "outstanding",
    readonly: true,
    fields: [],
  },
  Refunds: {
    area: "finance",
    kind: "refunds",
    fields: [
      {
        key: "invoice_id",
        label: "Invoice",
        lookup: "invoices",
        required: true,
      },
      { key: "patient_id", label: "Patient", lookup: "patients" },
      { key: "amount", label: "Refund Amount", type: "number", required: true },
      { key: "data.payment_method", label: "Payment Method" },
      { key: "data.transaction_reference", label: "Reference" },
      { key: "data.reason", label: "Reason" },
      { key: "record_date", label: "Date", type: "date" },
      { key: "status", label: "Status" },
    ],
  },
  Expenses: {
    area: "finance",
    kind: "expenses",
    fields: [
      { key: "data.category", label: "Category" },
      { key: "data.payee", label: "Payee / Vendor" },
      { key: "amount", label: "Amount", type: "number", required: true },
      { key: "record_date", label: "Date", type: "date" },
      { key: "data.payment_method", label: "Payment Method" },
      { key: "data.description", label: "Description" },
      { key: "data.attachment", label: "Attachment URL" },
      { key: "status", label: "Status" },
    ],
  },
  "Finance Reports": {
    area: "finance",
    kind: "reports",
    readonly: true,
    fields: [],
  },
  Items: {
    area: "inventory",
    kind: "items",
    fields: [
      { key: "data.code", label: "Item Code" },
      { key: "data.name", label: "Name", required: true },
      { key: "category_id", label: "Category", lookup: "categories" },
      { key: "data.unit", label: "Unit" },
      { key: "data.purchase_price", label: "Purchase Price", type: "number" },
      { key: "quantity", label: "Current Stock", type: "number" },
      { key: "data.minimum_stock", label: "Minimum Stock", type: "number" },
      { key: "data.reorder_level", label: "Reorder Level", type: "number" },
      { key: "data.storage_location", label: "Storage Location" },
      { key: "supplier_id", label: "Supplier", lookup: "suppliers" },
      { key: "branch_id", label: "Branch", lookup: "branches", required: true },
      { key: "status", label: "Status" },
    ],
  },
  Categories: {
    area: "inventory",
    kind: "categories",
    fields: [
      { key: "data.code", label: "Category Code" },
      { key: "data.name", label: "Category Name", required: true },
      { key: "data.description", label: "Description" },
      { key: "status", label: "Status" },
    ],
  },
  Suppliers: {
    area: "inventory",
    kind: "suppliers",
    fields: [
      { key: "data.code", label: "Supplier Code" },
      { key: "data.name", label: "Name", required: true },
      { key: "data.contact_person", label: "Contact Person" },
      { key: "data.phone", label: "Phone" },
      { key: "data.email", label: "Email", type: "email" },
      { key: "data.gstin", label: "GSTIN" },
      { key: "data.address", label: "Address" },
      { key: "status", label: "Status" },
    ],
  },
  "Purchase Orders": {
    area: "inventory",
    kind: "purchase-orders",
    fields: [
      {
        key: "supplier_id",
        label: "Supplier",
        lookup: "suppliers",
        required: true,
      },
      { key: "record_date", label: "Order Date", type: "date" },
      { key: "item_id", label: "Item", lookup: "items", required: true },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "data.rate", label: "Rate", type: "number" },
      { key: "data.tax", label: "Tax", type: "number" },
      { key: "data.discount", label: "Discount", type: "number" },
      { key: "amount", label: "Total", type: "number" },
      { key: "status", label: "Status" },
    ],
  },
  Purchases: {
    area: "inventory",
    kind: "purchases",
    fields: [
      {
        key: "supplier_id",
        label: "Supplier",
        lookup: "suppliers",
        required: true,
      },
      { key: "record_date", label: "Date", type: "date" },
      { key: "item_id", label: "Item", lookup: "items", required: true },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "data.rate", label: "Rate", type: "number" },
      { key: "data.tax", label: "Tax", type: "number" },
      { key: "data.discount", label: "Discount", type: "number" },
      { key: "amount", label: "Total", type: "number" },
      { key: "data.payment_status", label: "Payment Status" },
    ],
  },
  Stock: { area: "inventory", kind: "stock", readonly: true, fields: [] },
  "Stock Transfers": {
    area: "inventory",
    kind: "stock-transfers",
    fields: [
      { key: "item_id", label: "Item", lookup: "items", required: true },
      {
        key: "branch_id",
        label: "From Branch",
        lookup: "branches",
        required: true,
      },
      { key: "data.to_branch", label: "To Branch", lookup: "branches", required: true },
      { key: "data.destination_item_id", label: "Destination Item", lookup: "items", required: true },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "record_date", label: "Transfer Date", type: "date" },
      { key: "data.notes", label: "Notes" },
      { key: "status", label: "Status" },
    ],
  },
  "Low Stock": {
    area: "inventory",
    kind: "low-stock",
    readonly: true,
    fields: [],
  },
  Assets: {
    area: "inventory", kind: "assets",
    fields: [
      {key:"data.name",label:"Asset Name",required:true},
      {key:"data.serial_number",label:"Serial Number",required:true},
      {key:"category_id",label:"Category",lookup:"categories"},
      {key:"supplier_id",label:"Supplier",lookup:"suppliers"},
      {key:"branch_id",label:"Branch",lookup:"branches",required:true},
      {key:"data.location",label:"Location"},
      {key:"amount",label:"Purchase Value",type:"number"},
      {key:"record_date",label:"Acquisition Date",type:"date"},
      {key:"data.maintenance_due",label:"Maintenance Due",type:"date"},
      {key:"status",label:"Status"},
    ],
  },
  "Inventory Reports": {area:"inventory",kind:"stock",readonly:true,fields:[]},
};
async function q(path: string, t: string, o: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1/operations${path}`, {
      ...o,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
        ...o.headers,
      },
    }),
    d = await readJsonResponse(r);
  if (!r.ok) throw new Error(d?.error ?? "Request failed");
  return d;
}
async function printTemplate(token:string,document="ipd-bill"){
  const response=await fetch(`${API}/api/v1/hospital-management/print-templates/${document}`,{headers:{Authorization:`Bearer ${token}`}});
  return response.ok?response.json():{header_image:"",footer_content:""};
}
export default function FinanceInventory({
  page,
  token,
}: {
  page: string;
  token: string;
}) {
  const d = defs[page],
    [rows, setRows] = useState<R[]>([]),
    [look, setLook] = useState<R>({}),
    [edit, setEdit] = useState<R | null>(null),
    [detail, setDetail] = useState<R | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [lookLoading,setLookLoading]=useState(false),
    [error, setError] = useState("");
  const activeLoad=useRef<AbortController|null>(null);
  const load = useCallback(async () => {
    activeLoad.current?.abort();const controller=new AbortController();activeLoad.current=controller;
    setLoading(true);
    try {
      const a=await q(`/${d.area}/${d.kind}`,token,{signal:controller.signal});
      if(controller.signal.aborted)return;
      setRows(a);
      setError("");
    } catch (e) {
      if(!controller.signal.aborted)setError(e instanceof Error ? e.message : "Unable to load records");
    } finally {
      if(!controller.signal.aborted)setLoading(false);
    }
  }, [d, token]);
  useEffect(() => {
    void load();return()=>activeLoad.current?.abort();
  }, [load]);
  useEffect(()=>{
    if(!edit)return;
    const controller=new AbortController();setLook({});setLookLoading(true);
    const keys=[...new Set(d.fields.flatMap(field=>field.lookup??[]))];
    void q(`/lookups?keys=${encodeURIComponent(keys.join(','))}`,token,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setLook(data);}).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLookLoading(false);});
    return()=>controller.abort();
  },[!!edit,d,token]);
  const shown = useMemo(
    () =>
      rows.filter((x) =>
        JSON.stringify(x).toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving||lookLoading) return;
    setSaving(true);
    const raw = Object.fromEntries(new FormData(e.currentTarget)),
      data: R = {},
      body: R = { data };
    if(edit?.updated_at)body.updated_at=edit.updated_at;
    if(!edit?.id){const requestId=edit?._request_id??crypto.randomUUID();body.request_id=requestId;setEdit(current=>current?{...current,_request_id:requestId}:current);}
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith("data.")) data[k.slice(5)] = v;
      else body[k] = v;
    }
    try {
      await q(`/${d.area}/${d.kind}${edit?.id ? `/${edit.id}` : ""}`, token, {
        method: edit?.id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      setEdit(null);
      load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to save");
    } finally {
      setSaving(false);
    }
  }
  async function openBreakdown(row:R){
    try{
      const all=await q("/finance/payments",token);
      let payments=(all as R[]).filter(payment=>payment.invoice_id===row.id);
      if(!payments.length&&Number(row.paid)>0)payments=[{id:`initial-${row.id}`,record_number:`${row.record_number}-PAY-001`,record_date:row.record_date,created_at:row.created_at,amount:row.paid,data:{payment_method:row.data?.payment_mode||"Recorded at admission",note:"Initial payment"}}];
      setDetail({...row,payments});
    }catch(x){setError(x instanceof Error?x.message:"Unable to load payment breakdown")}
  }
  if (detail) {
    return <InvoiceBreakdown row={detail} token={token} close={() => setDetail(null)} refresh={()=>openBreakdown(detail)} />;
  }
  const report = page === "Finance Reports";
  return (
    <section className="fi-page">
      <header>
        <div>
          <small>
            {d.area === "finance"
              ? "Billing & Finance"
              : "Inventory & Purchase"}{" "}
            / {page}
          </small>
          <h1>{page}</h1>
          <p>
            {report
              ? "Consolidated financial position for this hospital."
              : page === "Low Stock"
                ? "Items at or below their reorder level."
                : `Manage ${page.toLowerCase()} for this hospital.`}
          </p>
        </div>
        {!d.readonly && (
          <button
            data-permission={d.area==="inventory"?"inventory.manage":page==="Refunds"?"billing.refund":"billing.create"}
            onClick={() =>
              setEdit({
                status: "Active",
                record_date: new Date().toISOString().slice(0, 10),
              })
            }
          >
            <Plus /> Add {page.replace(/s$/, "")}
          </button>
        )}
      </header>
      {error && <div className="fi-error" role="alert">{error}</div>}
      {page === "Inventory Reports" && !loading && <div className="fi-toolbar">
        <span>Items: {shown.length}</span>
        <span>Stock value: ₹{shown.reduce((sum, row) => sum + Number(row.quantity) * Number(row.data?.purchase_price || 0), 0).toLocaleString("en-IN")}</span>
        <span>Below reorder level: {shown.filter(row => Number(row.quantity) <= Number(row.data?.reorder_level || 0)).length}</span>
        <button onClick={() => {
          const csv = [["Item", "Branch", "Unit", "Quantity", "Reorder Level"], ...shown.map(row => [row.data?.name, row.branch_name, row.data?.unit, row.quantity, row.data?.reorder_level])]
            .map(row => row.map(value => '"' + String(value ?? "").replace(/^[=+@-]/, "'").replaceAll('"', '""') + '"').join(",")).join("\r\n");
          const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
          const anchor = document.createElement("a");anchor.href=url;anchor.download="inventory-stock.csv";anchor.click();URL.revokeObjectURL(url);
        }}><Download/> Export stock</button>
      </div>}
      {report ? (
        <Reports row={rows[0] ?? {}} />
      ) : (
        <>
          <div className="fi-toolbar">
            {page === "Low Stock" ? <TriangleAlert /> : <Search />}
            <input
              placeholder={`Search ${page.toLowerCase()}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span>{shown.length} records</span>
          </div>
          <div className="fi-card">
            {loading ? (
              <div className="fi-loading">
                <LoaderCircle />
                Loading…
              </div>
            ) : (
              <Grid
                rows={shown}
                page={page}
                token={token}
                editPermission={d.area==="inventory"?"inventory.manage":"billing.update"}
                edit={d.readonly || ["purchases","stock-transfers"].includes(d.kind) ? undefined : setEdit}
                breakdown={
                  page === "Invoices" || page === "Outstanding"
                    ? openBreakdown
                    : undefined
                }
              />
            )}
          </div>
        </>
      )}
      {edit && (
        <Form
          saving={saving||lookLoading}
          error={error}
          permission={d.area==="inventory"?"inventory.manage":page==="Refunds"?"billing.refund":edit.id?"billing.update":"billing.create"}
          title={`${edit.id ? "Edit" : "Add"} ${page}`}
          value={edit}
          fields={d.fields}
          look={look}
          save={save}
          close={() => setEdit(null)}
        />
      )}
    </section>
  );
}
function Grid({
  editPermission,
  rows,
  page,
  token,
  edit,
  breakdown,
}: {
  rows: R[];
  page: string;
  token: string;
  editPermission?:string;
  edit?: (r: R) => void;
  breakdown?: (r: R) => void;
}) {
  const invoice = [
      "record_number",
      "patient_name",
      "data.services",
      "total",
      "paid",
      "due",
      "status",
    ],
    payment = [
      "record_number",
      "invoice_number",
      "patient_name",
      "amount",
      "data.payment_method",
      "record_date",
    ],
    expense = [
      "record_number",
      "data.category",
      "data.payee",
      "amount",
      "record_date",
      "status",
    ],
    item = [
      "record_code",
      "data.name",
      "category_name",
      "data.unit",
      "quantity",
      "data.reorder_level",
      "branch_name",
      "status",
    ],
    supplier = [
      "record_code",
      "data.name",
      "data.contact_person",
      "data.phone",
      "data.gstin",
      "status",
    ],
    purchase = [
      "record_code",
      "supplier_name",
      "item_name",
      "quantity",
      "amount",
      "record_date",
      "status",
    ];
  let keys =
    page === "Invoices" || page === "Outstanding"
      ? invoice
      : page === "Payments" || page === "Refunds"
        ? payment
        : page === "Expenses"
          ? expense
          : ["Items", "Stock", "Low Stock", "Inventory Reports"].includes(page)
            ? item
            : page === "Suppliers"
              ? supplier
              : page === "Assets"
                ? ["record_code","data.name","data.serial_number","branch_name","data.location","amount","status"]
              : page === "Stock Transfers"
                ? ["record_code","item_name","branch_name","destination_branch_name","quantity","record_date","status"]
              : page === "Categories"
                ? ["record_code", "data.name", "data.description", "status"]
                : purchase;
  const label = (k: string) =>
      k
        .split(".")
        .pop()!
        .replaceAll("_", " ")
        .replace(/\b\w/g, (x) => x.toUpperCase()),
    val = (r: R, k: string) => k.split(".").reduce((x, y) => x?.[y], r);
  return (
    <table>
      <thead>
        <tr>
          {keys.map((k) => (
            <th>{label(k)}</th>
          ))}
          {(edit || breakdown) && <th>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {keys.map((k) => (
              <td>
                {["amount", "total", "paid", "due"].includes(k)
                  ? `₹${Number(val(r, k) || 0).toLocaleString()}`
                  : String(val(r, k) ?? "—")}
              </td>
            ))}
            {(edit || breakdown) && (
              <td>
                <div className="fi-actions">
                  {breakdown && (
                    <button
                      className="fi-action-text"
                      onClick={() => breakdown(r)}
                    >
                      <ReceiptText /> Breakdown
                    </button>
                  )}
                  {breakdown && (
                    <button
                      className="fi-action-text"
                      onClick={() => downloadInvoice(r,token)}
                    >
                      <Download /> {r.data?.lab_order_id?'Full Bill (Customer)':'Invoice'}
                    </button>
                  )}
                  {breakdown&&r.data?.lab_order_id&&<button className="fi-action-text" onClick={()=>downloadInvoice(r,token,'pharmacy')}><Download/>Pharmacy Bill</button>}
                  {edit && (
                    <button data-permission={editPermission} onClick={() => edit(r)}>
                      <Edit3 />
                    </button>
                  )}
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function Form({
  saving,
  error,
  permission,
  title,
  value,
  fields,
  look,
  save,
  close,
}: {
  saving: boolean;
  error: string;
  permission:string;
  title: string;
  value: R;
  fields: F[];
  look: R;
  save: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const get = (k: string) => k.split(".").reduce((x, y) => x?.[y], value);
  return (
    <div className="fi-back">
      <form data-permission={permission} className="fi-modal" onSubmit={save}>
        {error && <p className="fi-error" role="alert">{error}</p>}
        <header>
          <div>
            <h2>{title}</h2>
            <p>Saved inside the current hospital workspace.</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div>
          {fields.map((f) => (
            <label>
              <span>{f.label}</span>
              {f.key === "data.payment_method" ? (
                <select name={f.key} defaultValue={get(f.key) ?? ""} required={f.required}>
                  <option value="">Select Payment Method</option>
                  {(look.payment_methods ?? ["Cash","Card","UPI","Bank Transfer","Cheque"]).map((mode:string)=><option key={mode}>{mode}</option>)}
                </select>
              ) : f.lookup ? (
                <select
                  name={f.key}
                  defaultValue={get(f.key) ?? ""}
                  required={f.required}
                >
                  <option value="">Select {f.label}</option>
                  {(look[f.lookup] ?? []).map((x: R) => (
                    <option key={x.id} value={x.id}>{x.name ?? x.code}{x.branch_name ? ` (${x.branch_name})` : ""}</option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.key}
                  type={f.type ?? "text"}
                  min={f.type === "number" ? 0 : undefined}
                  step={f.type === "number" ? "any" : undefined}
                  required={f.required}
                  defaultValue={get(f.key) ?? ""}
                />
              )}
            </label>
          ))}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={saving} data-permission={permission} className="primary">{saving ? "Saving…" : "Save"}</button>
        </footer>
      </form>
    </div>
  );
}
const money = (value: unknown) => `₹${Number(value || 0).toFixed(2)}`;
const safe = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
const formatBillDate = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString() : "—";
function invoiceMarkup(row: R) {
  const data = row.data ?? {};
  const lines = billLines(data);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safe(row.record_number)}</title><style>body{font:12px Arial;color:#17233b;margin:28px}.center{text-align:center}.top{display:flex;justify-content:space-between}.info{display:grid;grid-template-columns:1fr 1fr;border:1px solid #777;margin:18px 0}.info div{padding:5px 10px}.info b{display:inline-block;width:110px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border:1px solid #888;text-align:left}th:nth-child(n+3),td:nth-child(n+3){text-align:right}.group{font-weight:bold;background:#edf1f5}.summary{width:45%;margin:20px 0 0 auto}.summary div{display:flex;justify-content:space-between;padding:5px}.summary .payable{font-size:14px;font-weight:bold;border-top:1px solid #555}.foot{text-align:center;margin-top:35px}@media print{body{margin:12mm}}${BILL_PRINT_CSS}</style></head><body><h2 class="center">${safe(row.hospital_name || "Hospital")}</h2><p class="center"><b>Interim Patient Bill</b></p><div class="top"><b>Bill No: ${safe(row.record_number)}</b><b>Bill Date: ${safe(row.record_date)}</b></div><div class="info"><div><p><b>Patient ID</b>: ${safe(row.medical_record_number)}</p><p><b>Patient Name</b>: ${safe(row.patient_name)}</p><p><b>Ward / Bed</b>: ${safe(data.ward_name || "—")} / ${safe(data.bed_number || "—")}</p><p><b>IPD No</b>: ${safe(data.ipd_number)}</p></div><div><p><b>Admission Date</b>: ${safe(formatBillDate(data.admitted_at))}</p><p><b>Admitting Doctor</b>: ${safe(doctorWithQualification(data.doctor_name,row.doctor_qualification||data.doctor_qualification) || "—")}</p><p><b>Specialty</b>: ${safe(data.department_name || "—")}</p><p><b>Payer</b>: ${safe(data.payer || "Self")}</p></div></div><table><thead><tr><th>Service Name</th><th>Date / Time</th><th>Rate</th><th>Qty</th><th>Total (₹)</th></tr></thead><tbody>${lines.map((line) => `<tr class="${line.group ? "group" : ""}"><td>${safe(line.name)}</td><td>${line.group ? "" : safe(formatBillDate(data.admitted_at))}</td><td>${line.group ? "" : money(line.amount)}</td><td>${line.group ? "" : "1.00"}</td><td>${line.group ? money(line.amount) : money(line.amount)}</td></tr>`).join("")}</tbody></table><div class="summary"><div><b>Total</b><b>${money(row.total)}</b></div><div>Discount <span>${money(Number(data.registration_discount || 0) + Number(data.admission_discount || 0))}</span></div><div>Patient Deposit Received <span>${money(Number(data.registration_deposit || 0) + Number(data.admission_deposit || 0))}</span></div><div class="payable">Net Payable <span>${money(row.due)}</span></div></div><p class="foot">If you have any queries regarding the contents of this bill, kindly contact the Billing Department.</p></body></html>`;
}
async function downloadInvoice(row:R,token?:string,copy:'customer'|'pharmacy'='customer'){
  if(row.data?.lab_order_id){await downloadLabBillingPdf(token?await loadLabFinanceBill(row.id,token):{...row,tests:row.data.tests},copy);return;}
  createInvoicePdf(row,token?await printTemplate(token):{}).save(`${row.record_number||"invoice"}.pdf`);
}
function printInvoice(row: R) {
  const pdf = createInvoicePdf(row);
  pdf.autoPrint();
  window.open(pdf.output("bloburl"), "_blank");
}
async function downloadPaymentReceipt(payment:R,invoice:R,token:string){
  createPaymentReceiptPdf(payment,invoice,await printTemplate(token)).save(`${payment.record_number||"payment-receipt"}.pdf`);
}
function InvoiceBreakdown({row,token,close,refresh}:{row:R;token:string;close:()=>void;refresh:()=>void}){
  const payments:R[]=row.payments||[],total=payments.reduce((sum,item)=>sum+Number(item.amount||0),0);
  const [adding,setAdding]=useState(false),[paymentError,setPaymentError]=useState("");
  async function addPayment(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);try{await q("/finance/payments",token,{method:"POST",body:JSON.stringify({invoice_id:row.id,patient_id:row.patient_id,branch_id:row.branch_id,amount:form.get("amount"),record_date:form.get("record_date"),status:"Active",data:{payment_method:form.get("payment_method"),transaction_reference:form.get("note")}})});setAdding(false);refresh()}catch(x){setPaymentError(x instanceof Error?x.message:"Unable to add payment")}}
  return <section className="fi-breakdown-page"><header><button onClick={close}><ArrowLeft/></button><div><small>Billing / Invoice / Payments</small><h1>Payments</h1><p>{row.record_number} · {row.patient_name} · {row.medical_record_number}</p></div><div className="fi-breakdown-actions"><button onClick={()=>downloadInvoice(row,token)}><Download/> Full Invoice</button><button data-permission="billing.create" className="primary" onClick={()=>setAdding(true)}><Plus/> Add Payment</button></div></header>{row.data?.lab_order_id&&<LabFinanceDownloads row={row} token={token}/>}<article className="fi-payment-breakdown"><div className="fi-payment-toolbar"><Search/><span>{payments.length} payment transaction{payments.length===1?"":"s"}</span></div><div className="fi-payment-table"><table><thead><tr><th>Transaction ID</th><th>Date</th><th>Note</th><th>Payment Mode</th><th>Paid Amount (₹)</th><th>Action</th></tr></thead><tbody>{payments.length?payments.map(payment=><tr key={payment.id}><td><strong>{payment.record_number}</strong></td><td>{formatBillDate(payment.created_at||payment.record_date)}</td><td>{payment.data?.note||payment.data?.notes||payment.data?.transaction_reference||"—"}</td><td>{payment.data?.payment_method||"—"}</td><td>{Number(payment.amount||0).toFixed(2)}</td><td><button title="Download payment receipt" onClick={()=>downloadPaymentReceipt(payment,row,token)}><Download/> Receipt</button></td></tr>):<tr><td colSpan={6} className="fi-no-payments">No payment transactions recorded for this invoice.</td></tr>}</tbody><tfoot><tr><td colSpan={4}>Total</td><td>₹{total.toFixed(2)}</td><td/></tr></tfoot></table></div></article>{adding&&<div className="fi-back"><form data-permission="billing.create" className="fi-modal" onSubmit={addPayment}><header><h2>Add Payment</h2><button type="button" onClick={()=>setAdding(false)}><X/></button></header>{paymentError&&<div className="fi-error">{paymentError}</div>}<div><label><span>Amount</span><input name="amount" type="number" min="0.01" max={row.due||row.total} step="0.01" required/></label><label><span>Payment Mode</span><select name="payment_method" required><option value="">Select</option><option>Cash</option><option>Card</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select></label><label><span>Date</span><input name="record_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} required/></label><label><span>Note / Reference</span><input name="note"/></label></div><footer><button type="button" onClick={()=>setAdding(false)}>Cancel</button><button type="submit" data-permission="billing.create" className="primary">Save Payment</button></footer></form></div>}</section>
}
function InvoiceBreakdownLegacy({ row, close }: { row: R; close: () => void }) {
  const data = row.data ?? {};
  const lines = billLines(data);
  return (
    <section className="fi-breakdown-page">
      <header>
        <button onClick={close}>
          <ArrowLeft />
        </button>
        <div>
          <small>Billing / Interim Bill</small>
          <h1>{row.record_number}</h1>
          <p>
            {row.patient_name} · {row.medical_record_number} · {data.ipd_number}
          </p>
        </div>
        <div className="fi-breakdown-actions">
          <button onClick={() => downloadInvoice(row)}>
            <Download /> Download Invoice
          </button>
          <button className="primary" onClick={() => printInvoice(row)}>
            <ReceiptText /> Print / Save PDF
          </button>
        </div>
      </header>
      <article className="fi-interim-bill">
        <div className="fi-bill-heading">
          <h2>{row.hospital_name || "Hospital"}</h2>
          <strong>Interim Bill</strong>
          <span>{new Date().toLocaleString()}</span>
        </div>
        <div className="fi-bill-meta">
          <div>
            <p>
              <b>Bill No</b>
              <span>{row.record_number}</span>
            </p>
            <p>
              <b>Patient ID</b>
              <span>{row.medical_record_number}</span>
            </p>
            <p>
              <b>Patient Name</b>
              <span>{row.patient_name}</span>
            </p>
            <p>
              <b>Ward / Room / Bed</b>
              <span>
                {data.ward_name || "—"} / {data.room_number || "—"} /{" "}
                {data.bed_number || "—"}
              </span>
            </p>
            <p>
              <b>IPD No</b>
              <span>{data.ipd_number}</span>
            </p>
          </div>
          <div>
            <p>
              <b>Bill Date</b>
              <span>{row.record_date}</span>
            </p>
            <p>
              <b>Admission Date</b>
              <span>{formatBillDate(data.admitted_at)}</span>
            </p>
            <p>
              <b>Admitting Doctor</b>
              <span>{data.doctor_name || "—"}</span>
            </p>
            <p>
              <b>Specialty</b>
              <span>{data.department_name || "—"}</span>
            </p>
            <p>
              <b>Payer</b>
              <span>{data.payer || "Self"}</span>
            </p>
          </div>
        </div>
        <div className="fi-service-table">
          <div className="head">
            <b>Service Name</b>
            <b>Date / Time</b>
            <b>Rate</b>
            <b>Qty</b>
            <b>Total (₹)</b>
          </div>
          {lines.map((line) => (
            <div key={line.name} className={line.group ? "subtotal" : ""}>
              <span>{line.name}</span>
              <span>{line.group ? "" : formatBillDate(data.admitted_at)}</span>
              <span>{line.group ? "" : money(line.amount)}</span>
              <span>{line.group ? "" : "1.00"}</span>
              <strong>{money(line.amount)}</strong>
            </div>
          ))}
        </div>
        <div className="fi-bill-summary">
          <p>
            <b>Total</b>
            <strong>{money(row.total)}</strong>
          </p>
          <p>
            <b>Discounts</b>
            <span>
              {money(
                Number(data.registration_discount || 0) +
                  Number(data.admission_discount || 0),
              )}
            </span>
          </p>
          <p>
            <b>Patient Deposit Received</b>
            <span>
              {money(
                Number(data.registration_deposit || 0) +
                  Number(data.admission_deposit || 0),
              )}
            </span>
          </p>
          <p className="net">
            <b>Net Payable</b>
            <strong>{money(row.due)}</strong>
          </p>
        </div>
        <footer>
          If you have any queries regarding the contents of this bill, kindly
          contact the Billing Department.
        </footer>
      </article>
    </section>
  );
}
function Reports({ row }: { row: R }) {
  return (
    <div className="fi-reports">
      {[
        ["Total Invoiced", row.invoiced],
        ["Payments Collected", row.collected],
        ["Outstanding", row.outstanding],
        ["Refunds", row.refunds],
        ["Expenses", row.expenses],
        [
          "Net Collection",
          Number(row.collected || 0) -
            Number(row.refunds || 0) -
            Number(row.expenses || 0),
        ],
      ].map(([l, v]) => (
        <div>
          <BarChart3 />
          <small>{l}</small>
          <strong>₹{Number(v || 0).toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}
export { finance, inventory };
