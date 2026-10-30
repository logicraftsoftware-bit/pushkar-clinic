import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Eye,
  LoaderCircle,
  ReceiptText,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import "./pharmacy-prescription-queue.css";
type Row = Record<string, any>;
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
async function api(path: string, token: string, options: RequestInit = {}) {
  const response = await fetch(`${API}/api/v1/operations/pharmacy${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    }),
    data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Request failed");
  return data;
}
export default function PharmacyPrescriptionQueue({
  token,
  onNavigate,
}: {
  token: string;
  onNavigate: (page: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [viewing, setViewing] = useState<Row | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api("/prescriptions", token));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load prescriptions");
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
  async function cancel(row: Row) {
    if (!confirm(`Cancel prescription for ${row.patient_name}?`)) return;
    try {
      await api(`/prescriptions/${row.id}/cancel`, token, { method: "PATCH" });
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to cancel prescription",
      );
    }
  }
  async function bill(row: Row) {
    if (
      !confirm(
        `Send this prescription to POS as an editable draft bill?`,
      )
    )
      return;
    try {
      await api(`/prescriptions/${row.id}/bill`, token, {
        method: "POST",
      });
      onNavigate("POS");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create bill draft");
    }
  }
  return (
    <section className="ppq-page">
      <header>
        <div>
          <small>Pharmacy / Prescription Queue</small>
          <h1>Prescription Queue</h1>
          <p>
            Review doctor prescriptions and convert approved medicines into
            pharmacy bills.
          </p>
        </div>
        <button onClick={load}>
          <RefreshCw /> Refresh
        </button>
      </header>
      {error && <div className="ppq-error">{error}</div>}
      <div className="ppq-toolbar">
        <Search />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient, UHID, doctor or medicine..."
        />
        <span>{shown.length} prescriptions</span>
      </div>
      <div className="ppq-table">
        {loading ? (
          <div className="ppq-loading">
            <LoaderCircle /> Loading prescription queue...
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Patient</th>
                <th>Doctor</th>
                <th>Medicines</th>
                <th>Status</th>
                <th>Bill</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.occurred_at).toLocaleString("en-IN")}</td>
                    <td>
                      <b>{row.patient_name}</b>
                      <small>{row.medical_record_number}</small>
                    </td>
                    <td>{row.doctor_name || "—"}</td>
                    <td>{row.data?.medicines?.length || 0}</td>
                    <td>
                      <Status value={row.status} />
                    </td>
                    <td>
                      {row.bill_number ? (
                        <>
                          <b>{row.bill_number}</b>
                          <small>
                            ₹
                            {Number(row.bill_total || 0).toLocaleString(
                              "en-IN",
                            )}
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className="ppq-actions">
                        <button onClick={() => setViewing(row)}>
                          <Eye /> View
                        </button>
                        <button
                          className="bill"
                          disabled={row.status !== "Pending"}
                          onClick={() => bill(row)}
                        >
                          <ReceiptText /> Convert Bill
                        </button>
                        <button
                          className="cancel"
                          disabled={row.status !== "Pending"}
                          onClick={() => cancel(row)}
                        >
                          <XCircle /> Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <div className="ppq-empty">
                      No prescriptions in the queue.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {viewing && (
        <PrescriptionView
          row={viewing}
          close={() => setViewing(null)}
          bill={() => {
            setViewing(null);
            bill(viewing);
          }}
          cancel={() => {
            setViewing(null);
            cancel(viewing);
          }}
        />
      )}
    </section>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`ppq-status ${String(value).toLowerCase()}`}>{value}</span>
  );
}
function PrescriptionView({
  row,
  close,
  bill,
  cancel,
}: {
  row: Row;
  close: () => void;
  bill: () => void;
  cancel: () => void;
}) {
  return (
    <div className="ppq-back">
      <section className="ppq-modal">
        <header>
          <div>
            <h2>Prescription Details</h2>
            <p>
              {row.patient_name} · {row.medical_record_number} · Dr.{" "}
              {row.doctor_name || "—"}
            </p>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <div className="ppq-detail">
          {row.data?.diagnosis && (
            <p>
              <b>Diagnosis:</b> {row.data.diagnosis}
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Dose</th>
                <th>Time</th>
                <th>When</th>
                <th>Frequency</th>
                <th>Duration</th>
                <th>Qty</th>
                <th>Instruction</th>
              </tr>
            </thead>
            <tbody>
              {(row.data?.medicines || []).map((x: Row, i: number) => (
                <tr key={i}>
                  <td>
                    <b>
                      {x.type} {x.name}
                    </b>
                  </td>
                  <td>{x.dose || "—"}</td>
                  <td>{x.time || "—"}</td>
                  <td>{x.when || "—"}</td>
                  <td>{x.frequency || "—"}</td>
                  <td>{x.duration || "—"}</td>
                  <td>{x.quantity || "—"}</td>
                  <td>{x.instruction || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {row.data?.advice && (
            <p>
              <b>Advice:</b> {row.data.advice}
            </p>
          )}
        </div>
        <footer>
          <button onClick={close}>Close</button>
          <button
            className="cancel"
            disabled={row.status !== "Pending"}
            onClick={cancel}
          >
            <XCircle /> Cancel
          </button>
          <button
            className="bill"
            disabled={row.status !== "Pending"}
            onClick={bill}
          >
            <ReceiptText /> Convert Bill
          </button>
        </footer>
      </section>
    </div>
  );
}
