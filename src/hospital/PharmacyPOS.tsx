import {BILL_PRINT_CSS} from "./billing-paper";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Edit3,
  Eye,
  LoaderCircle,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import "./pharmacy-pos.css";
type Row = Record<string, any>;
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
async function api(path: string, token: string, options: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1/operations/pharmacy${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    }),
    d = await r.json();
  if (!r.ok) throw new Error(d?.error || "Request failed");
  return d;
}
const money = (n: unknown) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const safe = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
export default function PharmacyPOS({ token }: { token: string }) {
  const [data, setData] = useState<Row>({ bills: [], medicines: [] }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<Row | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api("/pos", token));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load POS bills");
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);
  const rows = useMemo(
    () =>
      (data.bills || []).filter((x: Row) =>
        JSON.stringify(x).toLowerCase().includes(search.toLowerCase()),
      ),
    [data.bills, search],
  );
  async function printBill(row: Row) {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("Please allow pop-ups to print the pharmacy bill.");
      return;
    }
    printWindow.document.write("<p>Preparing pharmacy bill...</p>");
    try {
      const template = await api("/pos/print-template", token);
      const items = (row.data?.items || [])
        .map(
          (item: Row) => `<tr>
            <td>${safe(`${item.type || ""} ${item.name || ""}`.trim())}</td>
            <td>${safe(item.hsn_code || "—")}</td>
            <td>${safe(item.dose || "—")}</td>
            <td class="number">${safe(item.quantity)}</td>
            <td class="number">${safe(money(item.rate))}</td>
            <td class="number">${safe(`${Number(item.gst_percent || 0)}%`)}</td>
            <td class="number">${safe(money(Number(item.quantity) * Number(item.rate)))}</td>
          </tr>`,
        )
        .join("");
      printWindow.document.open();
      printWindow.document
        .write(`<!doctype html><html><head><title>${safe(row.record_number)}</title>
        <style>
          @page{size:A4;margin:14mm}*{box-sizing:border-box}html,body{min-height:269mm}body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:12px;display:flex;flex-direction:column}
          .header img{display:block;width:100%;max-height:130px;object-fit:contain}.title{text-align:center;margin:18px 0 12px;font-size:22px}
          .details{display:grid;grid-template-columns:1fr 1fr;gap:7px 30px;margin-bottom:18px}.details strong{display:inline-block;min-width:76px}
          .patient-type{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:800;letter-spacing:.3px}.patient-type.opd{background:#e8f1ff;color:#2458b8}.patient-type.ipd{background:#fff0dc;color:#a65300}
          table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd3df;padding:8px;text-align:left}th{background:#f1f4f8}.number{text-align:right}
          .totals{margin:14px 0 24px auto;width:310px}.totals div{display:flex;justify-content:space-between;padding:4px 0}.totals .grand{font-size:16px;font-weight:700;border-top:1px solid #172033;padding-top:8px}
          .footer{margin-top:auto;padding-top:25px;break-inside:avoid}.footer img{max-width:100%}
        ${BILL_PRINT_CSS}</style></head><body>
        ${template.header_image ? `<div class="header"><img src="${safe(template.header_image)}" alt="Pharmacy bill header"></div>` : ""}
        <h1 class="title">Pharmacy Bill</h1>
        <div class="details">
          <div><strong>Bill No:</strong> ${safe(row.record_number)}</div><div><strong>Date:</strong> ${safe(new Date(row.created_at).toLocaleString("en-IN"))}</div>
          <div><strong>Patient:</strong> ${safe(row.patient_name || "—")}</div><div><strong>UHID:</strong> ${safe(row.medical_record_number || "—")}</div>
          <div><strong>Patient Type:</strong> <span class="patient-type ${row.patient_type === "IPD" ? "ipd" : "opd"}">${safe(row.patient_type || "OPD")} PATIENT</span></div>
        </div>
        <table><thead><tr><th>Medicine</th><th>HSN/SAC</th><th>Dose</th><th class="number">Quantity</th><th class="number">Price</th><th class="number">GST</th><th class="number">Amount</th></tr></thead><tbody>${items}</tbody></table>
        <div class="totals">
          <div><span>Subtotal</span><strong>${safe(money(row.data?.subtotal || 0))}</strong></div>
          <div><span>Discount (${safe(Number(row.data?.discount_percent || 0))}%)</span><strong>${safe(money(row.data?.discount || 0))}</strong></div>
          <div><span>GST</span><strong>${safe(money(row.data?.tax || 0))}</strong></div>
          <div class="grand"><span>Grand Total</span><span>${safe(money(row.total))}</span></div>
        </div>
        ${template.footer_content ? `<div class="footer">${template.footer_content}</div>` : ""}
        </body></html>`);
      printWindow.document.close();
      printWindow.onload = () =>
        window.setTimeout(() => printWindow.print(), 250);
      setError("");
    } catch (e) {
      printWindow.close();
      setError(
        e instanceof Error ? e.message : "Unable to print pharmacy bill",
      );
    }
  }
  return (
    <section className="pos-page">
      <header>
        <div>
          <small>Pharmacy / POS</small>
          <h1>Pharmacy Point of Sale</h1>
          <p>
            Accept prescription drafts, edit medicines and generate pharmacy
            bills.
          </p>
        </div>
        <div className="pos-head-actions">
          <button onClick={() => setEditing({ id: "", status: "Draft", record_number: "New Bill", patient_name: "Walk-in Customer", data: { items: [] } })}>
            <Plus /> New Bill
          </button>
          <button onClick={load}><RefreshCw /> Refresh</button>
        </div>
      </header>
      {error && <div className="pos-error">{error}</div>}
      <div className="pos-toolbar">
        <Search />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bill number, patient or status..."
        />
        <span>{rows.length} bills</span>
      </div>
      <div className="pos-table">
        {loading ? (
          <div className="pos-loading">
            <LoaderCircle /> Loading POS...
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Bill Number</th>
                <th>Date</th>
                <th>Patient</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row: Row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.record_number}</b>
                    </td>
                    <td>{new Date(row.created_at).toLocaleString("en-IN")}</td>
                    <td>
                      <b>{row.patient_name || "—"}</b>
                      <small>{row.medical_record_number}</small>
                      <span
                        className={`patient-type ${row.patient_type === "IPD" ? "ipd" : "opd"}`}
                      >
                        {row.patient_type || "OPD"} PATIENT
                      </span>
                    </td>
                    <td>{row.data?.items?.length || 0}</td>
                    <td>
                      <b>{money(row.total)}</b>
                    </td>
                    <td>
                      <Status value={row.status} />
                    </td>
                    <td>
                      <div className="pos-actions">
                        {row.status === "Draft" ? (
                          <button
                            className="accept"
                            onClick={() => setEditing(row)}
                          >
                            <Eye /> View & Accept
                          </button>
                        ) : row.status === "Bill Generated" ? (
                          <>
                            <button onClick={() => setEditing(row)}>
                              <Edit3 /> Edit
                            </button>
                            <button onClick={() => printBill(row)}>
                              <Printer /> Print
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setEditing(row)}>
                            <Eye /> View
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <div className="pos-empty">No POS bills available.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <BillEditor
          row={editing}
          medicines={data.medicines || []}
          token={token}
          close={() => setEditing(null)}
          completed={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </section>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span
      className={`pos-status ${String(value).toLowerCase().replaceAll(" ", "-")}`}
    >
      {value}
    </span>
  );
}
function BillEditor({
  row,
  medicines,
  token,
  close,
  completed,
}: {
  row: Row;
  medicines: Row[];
  token: string;
  close: () => void;
  completed: () => Promise<void>;
}) {
  const [items, setItems] = useState<Row[]>(() =>
      (structuredClone(row.data?.items || []) as Row[]).map((item) => {
        const master =
          medicines.find((medicine) => medicine.id === item.medicine_id) ||
          medicines.find(
            (medicine) =>
              String(medicine.name).toLowerCase() ===
              String(item.name).toLowerCase(),
          );
        return {
          ...item,
          medicine_id: item.medicine_id || master?.id || "",
          rate:
            Number(item.rate) > 0
              ? Number(item.rate)
              : Number(master?.price || 0),
          gst_percent: Number(item.gst_percent ?? master?.data?.tax ?? 0),
          hsn_code: item.hsn_code || master?.data?.hsn_code || "",
        };
      }),
    ),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [discountPercent, setDiscountPercent] = useState(
      Number(row.data?.discount_percent || 0),
    ),
    [availableMedicines, setAvailableMedicines] = useState(medicines),
    [addingMedicine, setAddingMedicine] = useState(false),
    [customerName, setCustomerName] = useState(row.patient_name || "Walk-in Customer");
  const subtotal = items.reduce(
      (n, x) => n + Number(x.quantity || 0) * Number(x.rate || 0),
      0,
    ),
    discount = subtotal * discountPercent / 100,
    taxable = subtotal - discount,
    tax = items.reduce((n, x) => n + Number(x.quantity || 0) * Number(x.rate || 0) * (1 - discountPercent / 100) * Number(x.gst_percent || 0) / 100, 0),
    total = taxable + tax,
    readOnly = row.status === "Rejected";
  function update(index: number, key: string, value: unknown) {
    setItems((x) =>
      x.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    );
  }
  function selectMedicine(index: number, id: string) {
    const selected = availableMedicines.find((x) => x.id === id);
    setItems((x) =>
      x.map((r, i) =>
        i === index
          ? {
              ...r,
              medicine_id: id,
              name: selected?.name || "",
              type: selected?.data?.category_name || r.type || "",
              rate: Number(selected?.price || 0),
              gst_percent: Number(selected?.data?.tax || 0),
              hsn_code: selected?.data?.hsn_code || "",
            }
          : r,
      ),
    );
  }
  async function submit(action: "generate" | "reject") {
    if (action === "generate" && !items.length) {
      setError("Add at least one medicine before generating the bill");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(row.id ? `/pos/${row.id}` : "/pos", token, {
        method: row.id ? "PUT" : "POST",
        body: JSON.stringify({
          action,
          items,
          discount_percent: discountPercent,
          customer_name: customerName,
        }),
      });
      await completed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update bill");
    } finally {
      setSaving(false);
    }
  }
  function navigateGrid(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) return;
    const control = event.currentTarget, cell = control.closest("td"), rowElement = control.closest("tr"), body = rowElement?.parentElement;
    if (!cell || !rowElement || !body) return;
    const rows = Array.from(body.querySelectorAll("tr")), cells = Array.from(rowElement.querySelectorAll("td"));
    let rowIndex = rows.indexOf(rowElement), cellIndex = cells.indexOf(cell);
    if (event.key === "ArrowUp") rowIndex--;
    if (event.key === "ArrowDown" || event.key === "Enter") rowIndex++;
    if (event.key === "ArrowLeft") cellIndex--;
    if (event.key === "ArrowRight") cellIndex++;
    const target = rows[rowIndex]?.querySelectorAll("td")[cellIndex]?.querySelector<HTMLElement>("[data-bill-control]");
    if (target) { event.preventDefault(); target.focus(); if (target instanceof HTMLInputElement) target.select(); }
  }
  return (
    <div className="pos-back">
      <section className="pos-modal">
        <header>
          <div>
            <h2>
              {row.status === "Bill Generated"
                ? "Edit Pharmacy Bill"
                : "View & Accept Bill"}
            </h2>
            <p>
              {row.record_number} · {row.patient_name} ·{" "}
              {row.medical_record_number}
            </p>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        {error && <div className="pos-error modal">{error}</div>}
        {!row.id && <div className="pos-customer"><label>Customer / Patient Name <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></label></div>}
        <div className="pos-lines">
          <div className="pos-line-head">
            <b>Bill Medicines</b>
            {!readOnly && (
              <div className="pos-line-actions"><button type="button" onClick={() => setAddingMedicine(true)}><Plus /> Add New Medicine</button><button
                type="button"
                onClick={() =>
                  setItems((x) => [
                    ...x,
                    {
                      medicine_id: "",
                      name: "",
                      type: "",
                      dose: "",
                      quantity: 1,
                      rate: 0,
                      instruction: "",
                    },
                  ])
                }
              >
                <Plus /> Add Medicine
              </button></div>
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>Medicine</th>
                <th>HSN/SAC</th>
                <th>Dose</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>GST %</th>
                <th>Amount</th>
                <th>Instruction</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={i}>
                  <td>
                    <select
                      disabled={readOnly}
                      value={
                        x.medicine_id ||
                        availableMedicines.find((m) => m.name === x.name)?.id ||
                        ""
                      }
                      onChange={(e) => selectMedicine(i, e.target.value)}
                      onKeyDown={navigateGrid}
                      data-bill-control
                    >
                      <option value="">Select medicine</option>
                      {availableMedicines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td><input disabled={readOnly} value={x.hsn_code || ""} onChange={(e) => update(i, "hsn_code", e.target.value)} onKeyDown={navigateGrid} data-bill-control /></td>
                  <td>
                    <input
                      disabled={readOnly}
                      value={x.dose || ""}
                      onChange={(e) => update(i, "dose", e.target.value)}
                      onKeyDown={navigateGrid} data-bill-control
                    />
                  </td>
                  <td>
                    <input
                      disabled={readOnly}
                      type="number"
                      min="1"
                      value={x.quantity || 1}
                      onChange={(e) => update(i, "quantity", e.target.value)}
                      onKeyDown={navigateGrid} data-bill-control
                    />
                  </td>
                  <td>
                    <input
                      disabled={readOnly}
                      type="number"
                      min="0"
                      step="0.01"
                      value={x.rate || 0}
                      onChange={(e) => update(i, "rate", e.target.value)}
                      onKeyDown={navigateGrid} data-bill-control
                    />
                  </td>
                  <td><input disabled={readOnly} type="number" min="0" max="100" step="0.01" value={x.gst_percent || 0} onChange={(e) => update(i, "gst_percent", e.target.value)} onKeyDown={navigateGrid} data-bill-control /></td>
                  <td>
                    <b>{money(Number(x.quantity) * Number(x.rate))}</b>
                  </td>
                  <td>
                    <input
                      disabled={readOnly}
                      value={x.instruction || ""}
                      onChange={(e) => update(i, "instruction", e.target.value)}
                      onKeyDown={navigateGrid} data-bill-control
                    />
                  </td>
                  <td>
                    {!readOnly && (
                      <button
                        className="remove"
                        onClick={() =>
                          setItems((v) => v.filter((_, n) => n !== i))
                        }
                      >
                        <Trash2 />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pos-total">
          <span>
            Subtotal <b>{money(subtotal)}</b>
          </span>
          <label>
            Total Discount %{" "}
            <input
              disabled={readOnly}
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={discountPercent}
              onChange={(event) =>
                setDiscountPercent(
                  Math.min(100, Math.max(0, Number(event.target.value))),
                )
              }
            />
          </label>
          <span>
            Discount <b>{money(discount)}</b>
          </span>
          <span>GST <b>{money(tax)}</b></span>
          <span>
            Grand Total <b>{money(total)}</b>
          </span>
        </div>
        <footer>
          <button onClick={close}>Close</button>
          {!readOnly && (
            <>
              <button
                className="reject"
                disabled={saving}
                onClick={() => submit("reject")}
              >
                <XCircle /> Rejected
              </button>
              <button
                className="generate"
                disabled={saving}
                onClick={() => submit("generate")}
              >
                <ReceiptText /> Generate Bill
              </button>
            </>
          )}
        </footer>
      </section>
      {addingMedicine && <QuickMedicineModal token={token} close={() => setAddingMedicine(false)} saved={(medicine) => { setAvailableMedicines((current) => [...current, medicine].sort((a,b) => String(a.name).localeCompare(String(b.name)))); setAddingMedicine(false); }} />}
    </div>
  );
}

function QuickMedicineModal({token, close, saved}:{token:string;close:()=>void;saved:(medicine:Row)=>void}) {
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setSaving(true);setError("");const form=Object.fromEntries(new FormData(event.currentTarget));try{saved(await api("/medicines",token,{method:"POST",body:JSON.stringify(form)}))}catch(e){setError(e instanceof Error?e.message:"Unable to add medicine");setSaving(false)}}
  return <div className="pos-back quick-medicine-back"><form className="pos-modal quick-medicine" onSubmit={submit}><header><div><h2>Add New Medicine</h2><p>Create a medicine without leaving the bill.</p></div><button type="button" onClick={close}><X/></button></header>{error&&<div className="pos-error modal">{error}</div>}<div className="pos-quick-grid"><label>Medicine Name *<input name="name" required autoFocus/></label><label>HSN/SAC Code<input name="hsn_code" inputMode="numeric"/></label><label>GST %<input name="tax" type="number" min="0" max="100" step="0.01" defaultValue="0"/></label><label>Packing Type<select name="packing_type"><option>Box</option><option>Strip</option><option>Syrup/Bottle</option><option>Vial</option><option>Ampoule</option><option>Tube</option><option>Loose</option></select></label><label>Medicines per Strip<input name="units_per_strip" type="number" min="1"/></label><label>Volume (ml)<input name="volume_ml" type="number" min="0" step="0.01"/></label></div><footer><button type="button" onClick={close}>Cancel</button><button className="generate" disabled={saving}><Plus/> {saving?"Saving…":"Save Medicine"}</button></footer></form></div>
}
