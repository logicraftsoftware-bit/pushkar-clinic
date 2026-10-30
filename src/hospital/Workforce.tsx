import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Edit3, LoaderCircle, Plus, Search, X } from "lucide-react";
import "./workforce.css";
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
  options?: string[];
};
const defs: Record<string, { kind: string; fields: F[] }> = {
  Attendance: {
    kind: "attendance",
    fields: [
      {
        key: "employee_id",
        label: "Employee",
        lookup: "employees",
        required: true,
      },
      { key: "record_date", label: "Date", type: "date", required: true },
      { key: "data.shift", label: "Shift" },
      { key: "data.check_in", label: "Check-In", type: "time" },
      { key: "data.check_out", label: "Check-Out", type: "time" },
      { key: "data.working_hours", label: "Working Hours", type: "number" },
      {
        key: "status",
        label: "Status",
        options: ["Present", "Absent", "Late", "Half Day", "On Leave"],
      },
    ],
  },
  Shifts: {
    kind: "shifts",
    fields: [
      { key: "data.name", label: "Shift Name", required: true },
      { key: "data.start_time", label: "Start Time", type: "time" },
      { key: "data.end_time", label: "End Time", type: "time" },
      { key: "data.break_time", label: "Break Time (minutes)", type: "number" },
      { key: "branch_id", label: "Branch", lookup: "branches" },
      { key: "status", label: "Status", options: ["Active", "Inactive"] },
    ],
  },
  "Duty Roster": {
    kind: "duty-roster",
    fields: [
      {
        key: "employee_id",
        label: "Employee",
        lookup: "employees",
        required: true,
      },
      { key: "record_date", label: "Duty Date", type: "date" },
      { key: "data.shift", label: "Shift" },
      { key: "branch_id", label: "Branch", lookup: "branches" },
      { key: "data.department", label: "Department / Ward" },
      { key: "data.notes", label: "Notes" },
      { key: "status", label: "Status" },
    ],
  },
  Leave: {
    kind: "leave",
    fields: [
      {
        key: "employee_id",
        label: "Employee",
        lookup: "employees",
        required: true,
      },
      { key: "data.leave_type", label: "Leave Type" },
      { key: "data.from_date", label: "From Date", type: "date" },
      { key: "data.to_date", label: "To Date", type: "date" },
      { key: "data.reason", label: "Reason" },
      {
        key: "status",
        label: "Approval Status",
        options: ["Pending", "Approved", "Rejected", "Cancelled"],
      },
      { key: "data.approved_by", label: "Approved By", lookup: "users" },
    ],
  },
  Payroll: {
    kind: "payroll",
    fields: [
      {
        key: "employee_id",
        label: "Employee",
        lookup: "employees",
        required: true,
      },
      { key: "record_date", label: "Month", type: "month" },
      { key: "data.basic_salary", label: "Basic Salary", type: "number" },
      { key: "data.allowances", label: "Allowances", type: "number" },
      { key: "data.overtime", label: "Overtime", type: "number" },
      { key: "data.deductions", label: "Deductions", type: "number" },
      { key: "data.tax", label: "Tax", type: "number" },
      { key: "amount", label: "Net Salary", type: "number" },
      {
        key: "status",
        label: "Payment Status",
        options: ["Pending", "Processed", "Paid", "Failed"],
      },
    ],
  },
  Holidays: {
    kind: "holidays",
    fields: [
      { key: "data.name", label: "Holiday Name", required: true },
      { key: "record_date", label: "Date", type: "date", required: true },
      { key: "data.type", label: "Holiday Type" },
      { key: "branch_id", label: "Branch", lookup: "branches" },
      { key: "data.description", label: "Description" },
      { key: "status", label: "Status" },
    ],
  },
};
const claimFields: F[] = [
  { key: "patient_id", label: "Patient", lookup: "patients", required: true },
  { key: "insurance_company", label: "Insurance Company", required: true },
  { key: "tpa", label: "TPA" },
  { key: "policy_number", label: "Policy Number" },
  { key: "policy_validity", label: "Policy Validity", type: "date" },
  { key: "reference_type", label: "Invoice / IPD" },
  { key: "reference_number", label: "Reference Number" },
  { key: "claimed_amount", label: "Claimed Amount", type: "number" },
  { key: "approved_amount", label: "Approved Amount", type: "number" },
  { key: "settled_amount", label: "Settled Amount", type: "number" },
  { key: "submission_date", label: "Submission Date", type: "date" },
  {
    key: "status",
    label: "Status",
    options: [
      "Draft",
      "Submitted",
      "Under Review",
      "Approved",
      "Partially Approved",
      "Rejected",
      "Settled",
    ],
  },
  { key: "documents", label: "Documents URL" },
  { key: "remarks", label: "Remarks" },
];
async function q(path: string, t: string, o: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1/workforce${path}`, {
      ...o,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
        ...o.headers,
      },
    }),
    d = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(d?.error ?? "Request failed");
  return d;
}
export default function Workforce({
  page,
  token,
}: {
  page: string;
  token: string;
}) {
  const insurance = page === "Insurance & TPA",
    d = defs[page],
    [rows, setRows] = useState<R[]>([]),
    [look, setLook] = useState<R>({}),
    [edit, setEdit] = useState<R | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        q(insurance ? "/insurance" : `/hr/${d.kind}`, token),
        q("/lookups", token),
      ]);
      setRows(a);
      setLook(b);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load");
    } finally {
      setLoading(false);
    }
  }, [insurance, d, token]);
  useEffect(() => {
    load();
  }, [load]);
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(e.currentTarget)),
      data: R = {},
      body: R = { data };
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith("data.")) data[k.slice(5)] = v;
      else body[k] = v;
    }
    if (page === "Payroll" && /^\d{4}-\d{2}$/.test(body.record_date))
      body.record_date += "-01";
    try {
      await q(
        insurance
          ? `/insurance${edit?.id ? `/${edit.id}` : ""}`
          : `/hr/${d.kind}${edit?.id ? `/${edit.id}` : ""}`,
        token,
        { method: edit?.id ? "PUT" : "POST", body: JSON.stringify(body) },
      );
      setEdit(null);
      load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to save");
    }
  }
  const fields = insurance ? claimFields : d.fields;
  return (
    <section className="wf-page">
      <header>
        <div>
          <small>
            {insurance ? "Insurance & TPA" : `HR & Payroll / ${page}`}
          </small>
          <h1>{page}</h1>
          <p>
            {insurance
              ? "Track policies, claims, approvals and settlements."
              : `Manage ${page.toLowerCase()} for hospital employees.`}
          </p>
        </div>
        <button
          onClick={() =>
            setEdit({
              status: insurance ? "Draft" : "Active",
              record_date: new Date().toISOString().slice(0, 10),
            })
          }
        >
          <Plus />
          Add {insurance ? "Claim" : page.replace(/s$/, "")}
        </button>
      </header>
      {error && <div className="wf-error">{error}</div>}
      <div className="wf-toolbar">
        <Search />
        <input
          placeholder={`Search ${page.toLowerCase()}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{shown.length} records</span>
      </div>
      <div className="wf-card">
        {loading ? (
          <div className="wf-loading">
            <LoaderCircle />
            Loading…
          </div>
        ) : (
          <Table rows={shown} page={page} edit={setEdit} />
        )}
      </div>
      {edit && (
        <Editor
          title={`${edit.id ? "Edit" : "Add"} ${insurance ? "Insurance Claim" : page}`}
          fields={fields}
          value={edit}
          look={look}
          save={save}
          close={() => setEdit(null)}
        />
      )}
    </section>
  );
}
function Table({
  rows,
  page,
  edit,
}: {
  rows: R[];
  page: string;
  edit: (r: R) => void;
}) {
  let keys =
    page === "Insurance & TPA"
      ? [
          "claim_number",
          "patient_name",
          "insurance_company",
          "policy_number",
          "claimed_amount",
          "approved_amount",
          "settled_amount",
          "status",
        ]
      : page === "Attendance"
        ? [
            "record_number",
            "employee_name",
            "record_date",
            "data.shift",
            "data.check_in",
            "data.check_out",
            "data.working_hours",
            "status",
          ]
        : page === "Shifts"
          ? [
              "record_number",
              "data.name",
              "data.start_time",
              "data.end_time",
              "data.break_time",
              "branch_name",
              "status",
            ]
          : page === "Leave"
            ? [
                "record_number",
                "employee_name",
                "data.leave_type",
                "data.from_date",
                "data.to_date",
                "status",
                "data.approved_by",
              ]
            : page === "Payroll"
              ? [
                  "record_number",
                  "employee_name",
                  "record_date",
                  "data.basic_salary",
                  "data.allowances",
                  "data.deductions",
                  "amount",
                  "status",
                ]
              : [
                  "record_number",
                  "employee_name",
                  "record_date",
                  "data.name",
                  "branch_name",
                  "status",
                ];
  const v = (r: R, k: string) => k.split(".").reduce((x, y) => x?.[y], r),
    label = (k: string) =>
      k
        .split(".")
        .pop()!
        .replaceAll("_", " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <table>
      <thead>
        <tr>
          {keys.map((k) => (
            <th>{label(k)}</th>
          ))}
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {keys.map((k) => (
              <td>
                {[
                  "claimed_amount",
                  "approved_amount",
                  "settled_amount",
                  "amount",
                ].includes(k)
                  ? `₹${Number(v(r, k) || 0).toLocaleString()}`
                  : String(v(r, k) ?? "—")}
              </td>
            ))}
            <td>
              <button onClick={() => edit(r)}>
                <Edit3 />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function Editor({
  title,
  fields,
  value,
  look,
  save,
  close,
}: {
  title: string;
  fields: F[];
  value: R;
  look: R;
  save: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const get = (k: string): any => k.split(".").reduce((x, y) => x?.[y], value);
  return (
    <div className="wf-back">
      <form className="wf-modal" onSubmit={save}>
        <header>
          <div>
            <h2>{title}</h2>
            <p>Changes apply only to this hospital.</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div>
          {fields.map((f) => (
            <label>
              <span>{f.label}</span>
              {f.lookup ? (
                <select
                  name={f.key}
                  defaultValue={get(f.key) ?? ""}
                  required={f.required}
                >
                  <option value="">Select {f.label}</option>
                  {(look[f.lookup] ?? []).map((x: R) => (
                    <option value={x.id}>{x.name ?? x.code}</option>
                  ))}
                </select>
              ) : f.options ? (
                <select name={f.key} defaultValue={get(f.key) ?? f.options[0]}>
                  {f.options.map((x) => (
                    <option>{x}</option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.key}
                  type={f.type ?? "text"}
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
          <button className="primary">Save</button>
        </footer>
      </form>
    </div>
  );
}
