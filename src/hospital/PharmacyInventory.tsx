import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  Edit3,
  History,
  IndianRupee,
  LoaderCircle,
  PackagePlus,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import "./pharmacy-inventory.css";
import "./pharmacy-suppliers.css";
import PharmacyPurchaseEdit from "./PharmacyPurchaseEdit";
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
type R = Record<string, any>;
async function api(path: string, token: string, options: RequestInit = {}) {
  const response = await fetch(`${API}/api/v1/operations/pharmacy${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    }),
    data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || "Request failed");
  return data;
}
const money = (n: unknown) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const date = (value: string) =>
  value
    ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN")
    : "—";
const expiry = (value: string) =>
  value ? `${value.slice(5, 7)}/${value.slice(2, 4)}` : "—";
export default function PharmacyInventory({
  page,
  token,
}: {
  page: string;
  token: string;
}) {
  const [rows, setRows] = useState<R[]>([]),
    [lookups, setLookups] = useState<R>({
      medicines: [],
      suppliers: [],
      branches: [],
    }),
    [summary, setSummary] = useState<R>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [editingPurchase, setEditingPurchase] = useState<R | null>(null),
    [adjusting, setAdjusting] = useState<R | null>(null),
    [showingLog, setShowingLog] = useState(false);
  const mode = page === "Purchases" ? "purchases" : "batches";
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [records, refs, totals] = await Promise.all([
        api(`/${mode}`, token),
        api("/lookups", token),
        api("/summary", token),
      ]);
      setRows(records);
      setLookups(refs);
      setSummary(totals);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load pharmacy inventory",
      );
    } finally {
      setLoading(false);
    }
  }, [mode, token]);
  useEffect(() => {
    load();
  }, [load]);
  const shown = useMemo(
    () =>
      rows.filter((row) =>
        JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  const title =
    page === "Inventory"
      ? "Pharmacy Inventory"
      : page === "Batch & Expiry"
        ? "Batch & Expiry"
        : "Medicine Purchases";
  async function editPurchase(row: R) {
    try {
      setEditingPurchase(await api(`/purchases/${row.id}`, token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load purchase");
    }
  }
  async function deletePurchase(row: R) {
    if (
      !confirm(
        `Delete purchase ${row.record_code} and remove its received stock?`,
      )
    )
      return;
    try {
      await api(`/purchases/${row.id}`, token, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete purchase");
    }
  }
  return (
    <section className="pi-page">
      <header className="pi-head">
        <div>
          <small>Pharmacy / {page}</small>
          <h1>{title}</h1>
          <p>
            {page === "Purchases"
              ? "Record supplier invoices and receive medicine stock batch by batch."
              : "Live batch-wise medicine stock, valuation and expiry control."}
          </p>
        </div>
        <div className="pi-head-actions">
          {mode === "batches" && (
            <button className="secondary" onClick={() => setShowingLog(true)}>
              <History /> Adjustment Log
            </button>
          )}
          <button onClick={() => setEditingPurchase({})}>
            <PackagePlus /> New Purchase
          </button>
        </div>
      </header>
      {error && <div className="pi-error">{error}</div>}
      <div className="pi-stats">
        <Stat
          icon={<Boxes />}
          label="Stock Units"
          value={Number(summary.units || 0).toLocaleString("en-IN")}
        />
        <Stat
          icon={<IndianRupee />}
          label="Stock Value"
          value={money(summary.stock_value)}
        />
        <Stat
          icon={<CalendarClock />}
          label="Expiring in 90 days"
          value={summary.expiring || 0}
          warn
        />
        <Stat
          icon={<AlertTriangle />}
          label="Expired Batches"
          value={summary.expired || 0}
          danger
        />
      </div>
      <div className="pi-toolbar">
        <Search />
        <input
          placeholder={`Search ${page.toLowerCase()}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{shown.length} records</span>
      </div>
      <div className="pi-table-card">
        {loading ? (
          <div className="pi-loading">
            <LoaderCircle /> Loading pharmacy stock…
          </div>
        ) : mode === "purchases" ? (
          <PurchaseTable
            rows={shown}
            edit={editPurchase}
            remove={deletePurchase}
          />
        ) : (
          <BatchTable rows={shown} adjust={setAdjusting} />
        )}
      </div>
      {editingPurchase &&
        (editingPurchase.id ? (
          <PharmacyPurchaseEdit
            row={editingPurchase}
            token={token}
            lookups={lookups}
            close={() => setEditingPurchase(null)}
            saved={() => {
              setEditingPurchase(null);
              load();
            }}
          />
        ) : (
          <PurchaseModal
            token={token}
            lookups={lookups}
            refreshLookups={load}
            close={() => setEditingPurchase(null)}
            saved={() => {
              setEditingPurchase(null);
              load();
            }}
          />
        ))}
      {adjusting && (
        <AdjustModal
          row={adjusting}
          token={token}
          close={() => setAdjusting(null)}
          saved={() => {
            setAdjusting(null);
            load();
          }}
        />
      )}
      {showingLog && (
        <AdjustmentLog token={token} close={() => setShowingLog(false)} />
      )}
    </section>
  );
}
function Stat({
  icon,
  label,
  value,
  warn,
  danger,
}: {
  icon: ReactNode;
  label: string;
  value: unknown;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <article className={danger ? "danger" : warn ? "warn" : ""}>
      <i>{icon}</i>
      <div>
        <small>{label}</small>
        <strong>{String(value)}</strong>
      </div>
    </article>
  );
}
function Empty() {
  return (
    <tr>
      <td colSpan={12}>
        <div className="pi-empty">
          <Boxes />
          <b>No pharmacy records yet</b>
          <span>Use New Purchase to receive the first medicine batch.</span>
        </div>
      </td>
    </tr>
  );
}
function PurchaseTable({
  rows,
  edit,
  remove,
}: {
  rows: R[];
  edit: (r: R) => void;
  remove: (r: R) => void;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Purchase No.</th>
          <th>Invoice No.</th>
          <th>Supplier</th>
          <th>Date</th>
          <th>Items</th>
          <th>Subtotal</th>
          <th>Tax</th>
          <th>Grand Total</th>
          <th>Payment</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((r) => (
            <tr key={r.id}>
              <td>
                <b>{r.record_code}</b>
              </td>
              <td>{r.data?.invoice_number}</td>
              <td>{r.supplier_name || "—"}</td>
              <td>{date(r.record_date)}</td>
              <td>{r.item_count}</td>
              <td>{money(r.data?.subtotal)}</td>
              <td>{money(r.data?.tax)}</td>
              <td>
                <strong>{money(r.amount)}</strong>
              </td>
              <td>
                <Badge text={r.data?.payment_status || r.status} />
              </td>
              <td>
                <div className="pi-row-actions">
                  <button title="Edit purchase" onClick={() => edit(r)}>
                    <Edit3 />
                  </button>
                  <button
                    className="delete"
                    title="Delete purchase"
                    onClick={() => remove(r)}
                  >
                    <Trash2 />
                  </button>
                </div>
              </td>
            </tr>
          ))
        ) : (
          <Empty />
        )}
      </tbody>
    </table>
  );
}
function Badge({ text }: { text: string }) {
  const key = text.toLowerCase().replaceAll(" ", "-");
  return <span className={`pi-badge ${key}`}>{text}</span>;
}
function BatchTable({ rows, adjust }: { rows: R[]; adjust: (r: R) => void }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Medicine</th>
          <th>Batch No.</th>
          <th>Expiry (MM/YY)</th>
          <th>Available</th>
          <th>Purchase Rate</th>
          <th>MRP</th>
          <th>Stock Value</th>
          <th>Supplier</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((r) => (
            <tr
              key={r.id}
              className={r.batch_status === "Expired" ? "expired-row" : ""}
            >
              <td>
                <b>{r.medicine_name}</b>
                <small className="pi-sub">
                  {r.medicine_data?.generic_name || ""}
                </small>
              </td>
              <td>{r.data?.batch_number}</td>
              <td>{expiry(r.data?.expiry_date)}</td>
              <td>
                <strong>{Number(r.quantity)}</strong>
              </td>
              <td>{money(r.data?.purchase_rate)}</td>
              <td>{money(r.data?.mrp)}</td>
              <td>
                {money(Number(r.quantity) * Number(r.data?.purchase_rate || 0))}
              </td>
              <td>{r.supplier_name || "—"}</td>
              <td>
                <Badge text={r.batch_status} />
              </td>
              <td>
                <button
                  className="pi-icon"
                  title="Adjust stock"
                  onClick={() => adjust(r)}
                >
                  <SlidersHorizontal />
                </button>
              </td>
            </tr>
          ))
        ) : (
          <Empty />
        )}
      </tbody>
    </table>
  );
}
type Line = {
  medicine_id: string;
  batch_number: string;
  manufacturing_date: string;
  expiry_date: string;
  quantity: number | string;
  free_quantity: number | string;
  purchase_rate: number | string;
  mrp: number | string;
  gst_percent: number | string;
  discount_percent: number | string;
};
const blank = (): Line => ({
  medicine_id: "",
  batch_number: "",
  manufacturing_date: "",
  expiry_date: "",
  quantity: 1,
  free_quantity: 0,
  purchase_rate: 0,
  mrp: 0,
  gst_percent: 0,
  discount_percent: 0,
});
function PurchaseModal({
  token,
  lookups,
  refreshLookups,
  close,
  saved,
}: {
  token: string;
  lookups: R;
  refreshLookups: () => Promise<void>;
  close: () => void;
  saved: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([blank()]),
    [addingSupplier, setAddingSupplier] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const update = (i: number, key: keyof Line, value: string) =>
    setLines((rows) =>
      rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)),
    );
  const totals = lines.reduce(
    (a, x) => {
      const base =
        Number(x.quantity) *
        Number(x.purchase_rate) *
        (1 - Number(x.discount_percent) / 100);
      return {
        subtotal: a.subtotal + base,
        tax: a.tax + (base * Number(x.gst_percent)) / 100,
      };
    },
    { subtotal: 0, tax: 0 },
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/purchases", token, {
        method: "POST",
        body: JSON.stringify({ ...raw, items: lines, request_id: requestId }),
      });
      saved();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to save purchase");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="pi-back">
      <form className="pi-modal pi-purchase-modal" onSubmit={submit}>
        <header>
          <div>
            <h2>New Purchase Entry</h2>
            <p>Supplier invoice and batch-wise goods receipt</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        {error && <div className="pi-error modal-error">{error}</div>}
        <div className="pi-meta">
          <label>
            <span>Supplier *</span>
            <select name="supplier_id" required>
              <option value="">Select supplier</option>
              {lookups.suppliers.map((x: R) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button type="button" className="secondary" onClick={() => setAddingSupplier(true)}>
              <Plus /> Add Supplier
            </button>
          </label>
          <label>
            <span>Supplier Invoice No. *</span>
            <input name="invoice_number" required />
          </label>
          <label>
            <span>Purchase Date *</span>
            <input
              name="purchase_date"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <label>
            <span>Branch</span>
            <select name="branch_id">
              <option value="">Main pharmacy</option>
              {lookups.branches.map((x: R) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Payment Status</span>
            <select name="payment_status">
              <option>Unpaid</option>
              <option>Partially Paid</option>
              <option>Paid</option>
              <option>Credit</option>
            </select>
          </label>
          <label>
            <span>Notes</span>
            <input name="notes" placeholder="Optional reference" />
          </label>
        </div>
        <div className="pi-lines">
          <div className="pi-line-head">
            <b>Medicine batches</b>
            <button
              type="button"
              onClick={() => setLines((x) => [...x, blank()])}
            >
              <Plus /> Add Line
            </button>
          </div>
          {lines.map((line, i) => (
            <div className="pi-line" key={i}>
              <span className="pi-line-no">{i + 1}</span>
              <label className="medicine">
                <span>Medicine *</span>
                <select
                  required
                  value={line.medicine_id}
                  onChange={(e) => update(i, "medicine_id", e.target.value)}
                >
                  <option value="">Select medicine</option>
                  {lookups.medicines.map((x: R) => (
                    <option value={x.id} key={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["batch_number", "Batch No.", "text"],
                  ["manufacturing_date", "Mfg. Date", "date"],
                    ["expiry_date", "Expiry (MM/YY) *", "month"],
                  ["quantity", "Qty *", "number"],
                  ["free_quantity", "Free", "number"],
                  ["purchase_rate", "Purchase Rate *", "number"],
                  ["mrp", "MRP *", "number"],
                  ["discount_percent", "Disc. %", "number"],
                  ["gst_percent", "GST %", "number"],
                ] as [keyof Line, string, string][]
              ).map(([key, label, type]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    required={[
                      "batch_number",
                      "expiry_date",
                      "quantity",
                      "purchase_rate",
                      "mrp",
                    ].includes(key)}
                    min={type === "number" ? 0 : undefined}
                    step={type === "number" ? "0.01" : undefined}
                    type={type}
                    value={line[key]}
                    onChange={(e) => update(i, key, e.target.value)}
                  />
                </label>
              ))}
              <button
                type="button"
                className="remove"
                disabled={lines.length === 1}
                onClick={() => setLines((x) => x.filter((_, n) => n !== i))}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
        <div className="pi-total">
          <span>
            Subtotal <b>{money(totals.subtotal)}</b>
          </span>
          <span>
            Tax <b>{money(totals.tax)}</b>
          </span>
          <strong>
            Grand Total <b>{money(totals.subtotal + totals.tax)}</b>
          </strong>
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? <LoaderCircle /> : <PackagePlus />}
            {saving ? "Saving…" : "Save & Receive Stock"}
          </button>
        </footer>
      </form>
      {addingSupplier && (
        <SupplierModal
          row={{ data: { status: "Active" } }}
          token={token}
          close={() => setAddingSupplier(false)}
          saved={async () => {
            setAddingSupplier(false);
            await refreshLookups();
          }}
        />
      )}
    </div>
  );
}
function AdjustModal({
  row,
  token,
  close,
  saved,
}: {
  row: R;
  token: string;
  close: () => void;
  saved: () => void;
}) {
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/batches/${row.id}/adjust`, token, {
        method: "POST",
        body: JSON.stringify({ ...data, request_id: requestId }),
      });
      saved();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to adjust stock");
      setSaving(false);
    }
  }
  return (
    <div className="pi-back">
      <form className="pi-modal pi-adjust" onSubmit={submit}>
        <header>
          <div>
            <h2>Stock Adjustment</h2>
            <p>
              {row.medicine_name} · Batch {row.data?.batch_number} · Current{" "}
              {row.quantity}
            </p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        {error && <div className="pi-error modal-error">{error}</div>}
        <div className="pi-meta">
          <label>
            <span>Adjustment</span>
            <select name="type">
              <option>Add</option>
              <option>Remove</option>
              <option>Set</option>
            </select>
          </label>
          <label>
            <span>Quantity *</span>
            <input name="quantity" required min="0" step="1" type="number" />
          </label>
          <label className="wide">
            <span>Reason *</span>
            <input
              name="reason"
              required
              placeholder="Damage, physical count, return…"
            />
          </label>
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            Save Adjustment
          </button>
        </footer>
      </form>
    </div>
  );
}

function AdjustmentLog({ token, close }: { token: string; close: () => void }) {
  const [rows, setRows] = useState<R[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    api("/adjustments", token)
      .then(setRows)
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Unable to load adjustment log",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);
  return (
    <div className="pi-back">
      <section className="pi-modal pi-log">
        <header>
          <div>
            <h2>Stock Adjustment Log</h2>
            <p>
              Complete history of manual additions, removals and stock
              corrections.
            </p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        {error && <div className="pi-error modal-error">{error}</div>}
        <div className="pi-log-table">
          {loading ? (
            <div className="pi-loading">
              <LoaderCircle /> Loading adjustment history...
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Medicine</th>
                  <th>Batch</th>
                  <th>Action</th>
                  <th>Entered Qty</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Reason</th>
                  <th>Adjusted By</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.created_at).toLocaleString("en-IN")}</td>
                      <td>
                        <b>{r.medicine_name || "—"}</b>
                      </td>
                      <td>{r.batch_number || r.record_code}</td>
                      <td>
                        <Badge text={r.adjustment_type} />
                      </td>
                      <td>{Number(r.requested_quantity)}</td>
                      <td>{Number(r.quantity_before)}</td>
                      <td>
                        <strong>{Number(r.quantity_after)}</strong>
                      </td>
                      <td className="pi-log-reason">{r.reason}</td>
                      <td>{r.adjusted_by || "Unknown user"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9}>
                      <div className="pi-empty">
                        <History />
                        <b>No stock adjustments yet</b>
                        <span>Saved adjustments will appear here.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

export function PharmacySuppliers({ token }: { token: string }) {
  const [rows, setRows] = useState<R[]>([]),
    [editing, setEditing] = useState<R | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api("/suppliers", token));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load suppliers");
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);
  const shown = useMemo(
    () =>
      rows.filter((x) =>
        JSON.stringify(x).toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  async function remove(row: R) {
    if (!confirm(`Delete supplier ${row.name}?`)) return;
    try {
      await api(`/suppliers/${row.id}`, token, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete supplier");
    }
  }
  return (
    <section className="pi-page">
      <header className="pi-head">
        <div>
          <small>Pharmacy / Suppliers</small>
          <h1>Pharmacy Suppliers</h1>
          <p>Manage licensed medicine vendors and purchase contacts.</p>
        </div>
        <button onClick={() => setEditing({ data: { status: "Active" } })}>
          <Plus /> Add Supplier
        </button>
      </header>
      {error && <div className="pi-error">{error}</div>}
      <div className="pi-toolbar">
        <Search />
        <input
          placeholder="Search supplier, GSTIN, phone or license…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{shown.length} records</span>
      </div>
      <div className="pi-table-card">
        {loading ? (
          <div className="pi-loading">
            <LoaderCircle /> Loading suppliers…
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Supplier Name</th>
                <th>Contact Person</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Drug License</th>
                <th>GSTIN</th>
                <th>Address</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.name}</b>
                    </td>
                    <td>
                      {row.data?.contact_person ||
                        row.data?.contact_person_name ||
                        "—"}
                    </td>
                    <td>
                      {row.data?.phone || row.data?.supplier_contact || "—"}
                    </td>
                    <td>{row.data?.email || "—"}</td>
                    <td>{row.data?.drug_license_number || "—"}</td>
                    <td>{row.data?.gstin || "—"}</td>
                    <td>{row.data?.address || "—"}</td>
                    <td>
                      <Badge text={row.data?.status || "Active"} />
                    </td>
                    <td>
                      <div className="pi-row-actions">
                        <button
                          onClick={() => setEditing(row)}
                          title="Edit supplier"
                        >
                          <Edit3 />
                        </button>
                        <button
                          className="delete"
                          onClick={() => remove(row)}
                          title="Delete supplier"
                        >
                          <Trash2 />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <Empty />
              )}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <SupplierModal
          row={editing}
          token={token}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </section>
  );
}
function SupplierModal({
  row,
  token,
  close,
  saved,
}: {
  row: R;
  token: string;
  close: () => void;
  saved: () => void;
}) {
  const d = row.data || {},
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/suppliers${row.id ? `/${row.id}` : ""}`, token, {
        method: row.id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      saved();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to save supplier");
      setSaving(false);
    }
  }
  return (
    <div className="pi-back">
      <form className="pi-modal pi-supplier-modal" onSubmit={submit}>
        <header>
          <div>
            <h2>{row.id ? "Edit" : "Add"} Supplier</h2>
            <p>
              Supplier details will be available in pharmacy purchase entries.
            </p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        {error && <div className="pi-error modal-error">{error}</div>}
        <div className="pi-meta">
          <label>
            <span>Supplier Name *</span>
            <input name="name" required defaultValue={row.name || ""} />
          </label>
          <label>
            <span>Contact Person</span>
            <input
              name="contact_person"
              defaultValue={d.contact_person || d.contact_person_name || ""}
            />
          </label>
          <label>
            <span>Phone</span>
            <input
              name="phone"
              type="tel"
              defaultValue={d.phone || d.supplier_contact || ""}
            />
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" defaultValue={d.email || ""} />
          </label>
          <label>
            <span>Drug License Number</span>
            <input
              name="drug_license_number"
              defaultValue={d.drug_license_number || ""}
            />
          </label>
          <label>
            <span>GSTIN</span>
            <input name="gstin" defaultValue={d.gstin || ""} />
          </label>
          <label className="wide">
            <span>Address</span>
            <input name="address" defaultValue={d.address || ""} />
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={d.status || "Active"}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>
          <label className="wide">
            <span>Notes</span>
            <input name="notes" defaultValue={d.notes || ""} />
          </label>
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? <LoaderCircle /> : row.id ? <Edit3 /> : <Plus />}
            {saving ? "Saving…" : "Save Supplier"}
          </button>
        </footer>
      </form>
    </div>
  );
}
