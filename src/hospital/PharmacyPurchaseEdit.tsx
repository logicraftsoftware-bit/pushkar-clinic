import { useState, type FormEvent } from "react";
import { Edit3, LoaderCircle, Plus, Trash2, X } from "lucide-react";
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
type R = Record<string, any>;
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
const money = (n: number) =>
  `₹${(Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
async function updatePurchase(id: string, token: string, body: R) {
  const response = await fetch(
      `${API}/api/v1/operations/pharmacy/purchases/${id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    ),
    data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Unable to update purchase");
}
export default function PharmacyPurchaseEdit({
  row,
  token,
  lookups,
  close,
  saved,
}: {
  row: R;
  token: string;
  lookups: R;
  close: () => void;
  saved: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(
      row.items?.length
        ? row.items.map((item: Line) => ({ ...item, expiry_date: String(item.expiry_date || "").slice(0, 7) }))
        : [blank()],
    ),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const update = (i: number, key: keyof Line, value: string) =>
    setLines((x) =>
      x.map((line, n) => (n === i ? { ...line, [key]: value } : line)),
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
    try {
      await updatePurchase(row.id, token, {
        ...Object.fromEntries(new FormData(e.currentTarget)),
        items: lines,
      });
      saved();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to update purchase");
      setSaving(false);
    }
  }
  return (
    <div className="pi-back">
      <form className="pi-modal pi-purchase-modal" onSubmit={submit}>
        <header>
          <div>
            <h2>Edit Purchase {row.record_code}</h2>
            <p>Update invoice details and received medicine batches.</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        {error && <div className="pi-error modal-error">{error}</div>}
        <div className="pi-meta">
          <label>
            <span>Supplier *</span>
            <select
              name="supplier_id"
              required
              defaultValue={row.data?.supplier_id}
            >
              <option value="">Select supplier</option>
              {lookups.suppliers.map((x: R) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Invoice No. *</span>
            <input
              name="invoice_number"
              required
              defaultValue={row.data?.invoice_number}
            />
          </label>
          <label>
            <span>Purchase Date *</span>
            <input
              name="purchase_date"
              type="date"
              required
              defaultValue={String(row.record_date).slice(0, 10)}
            />
          </label>
          <label>
            <span>Branch</span>
            <select name="branch_id" defaultValue={row.branch_id || ""}>
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
            <select
              name="payment_status"
              defaultValue={row.data?.payment_status || "Unpaid"}
            >
              <option>Unpaid</option>
              <option>Partially Paid</option>
              <option>Paid</option>
              <option>Credit</option>
            </select>
          </label>
          <label>
            <span>Notes</span>
            <input name="notes" defaultValue={row.data?.notes || ""} />
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
                    value={line[key] || ""}
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
            {saving ? <LoaderCircle /> : <Edit3 />}
            {saving ? "Saving…" : "Update Purchase"}
          </button>
        </footer>
      </form>
    </div>
  );
}
