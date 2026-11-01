import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChefHat,
  RefreshCw,
  Search,
  Plus,
  Utensils,
  Users,
  Clock3,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import Swal from "sweetalert2";
import "./dietary-management.css";
type Row = Record<string, any>;
const API = import.meta.env.VITE_API_URL ?? "";
async function api(path: string, token: string, options: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1/dietary${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    }),
    d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Request failed");
  return d;
}
const money = (v: any) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);
export default function DietaryManagement({ token }: { token: string }) {
  const [data, setData] = useState<Row>({
      patients: [],
      menu: [],
      orders: [],
      rules: [],
      audits: [],
      schedules: [],
      metrics: {},
    }),
    [tab, setTab] = useState("Kitchen Dashboard"),
    [search, setSearch] = useState(""),
    [dialog, setDialog] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api("/overview", token));
    } catch (e) {
      Swal.fire(
        "Unable to load",
        e instanceof Error ? e.message : "Request failed",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);
  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return (
      tab === "Diet Census"
        ? data.patients
        : tab === "Menu & Rates"
          ? data.menu
          : tab === "Meal Schedules"
            ? data.schedules
            : tab === "Package Rules"
              ? data.rules
              : tab === "Audit Trail"
                ? data.audits
                : data.orders
    ).filter((x: Row) => JSON.stringify(x).toLowerCase().includes(s));
  }, [tab, data, search]);
  async function status(o: Row, value: string) {
    try {
      let remarks = "";
      let received_by = "";
      if (value === "Delivered") {
        const answer = await Swal.fire({
          title: "Confirm delivery",
          input: "text",
          inputLabel: "Received by",
          inputPlaceholder: "Nurse, patient, or attendant name",
          showCancelButton: true,
          inputValidator: (name) =>
            name?.trim() ? undefined : "Receiver name is required",
        });
        if (!answer.isConfirmed) return;
        received_by = answer.value.trim();
      }
      if (value === "Cancelled") {
        const answer = await Swal.fire({
          title:
            o.delivery_status === "Delivered"
              ? "Reverse delivered order?"
              : "Cancel order?",
          input: "textarea",
          inputLabel: "Reason",
          showCancelButton: true,
          inputValidator: (reason) =>
            reason?.trim() ? undefined : "A reason is required",
        });
        if (!answer.isConfirmed) return;
        remarks = answer.value.trim();
      }
      await api(`/orders/${o.id}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status: value, remarks, received_by }),
      });
      await load();
    } catch (error) {
      await Swal.fire(
        "Unable to update order",
        error instanceof Error ? error.message : "Request failed",
        "error",
      );
      await load();
    }
  }
  async function patientAction(
    patient: Row,
    action: "confirm" | "hold" | "resume",
  ) {
    try {
      let path = `/diets/${patient.admission_id}/confirm`;
      let body: Row = {};
      if (action === "hold") {
        const answer = await Swal.fire({
          title: "Stop automatic meals",
          input: "textarea",
          inputLabel: "Reason",
          showCancelButton: true,
          inputValidator: (value) =>
            value?.trim() ? undefined : "A reason is required",
        });
        if (!answer.isConfirmed) return;
        path = "/holds";
        body = {
          admission_id: patient.admission_id,
          reason: answer.value.trim(),
        };
      } else if (action === "resume")
        path = `/holds/${patient.admission_id}/resume`;
      await api(path, token, { method: "POST", body: JSON.stringify(body) });
      await load();
    } catch (error) {
      await Swal.fire(
        "Unable to update meals",
        error instanceof Error ? error.message : "Request failed",
        "error",
      );
    }
  }
  async function generate(mealType: string) {
    try {
      const result = await api("/generate", token, {
        method: "POST",
        body: JSON.stringify({
          meal_type: mealType,
          meal_date: new Date().toISOString().slice(0, 10),
        }),
      });
      await Swal.fire(
        "Meal list generated",
        `${result.created} created; ${result.duplicates} duplicates skipped.`,
        "success",
      );
      await load();
    } catch (error) {
      await Swal.fire(
        "Unable to generate meals",
        error instanceof Error ? error.message : "Request failed",
        "error",
      );
    }
  }
  if (loading)
    return (
      <div className="diet-loading">
        <RefreshCw /> Loading dietary operations…
      </div>
    );
  return (
    <section className="diet-page">
      <header>
        <div>
          <small>HOSPITAL ADMIN / FOOD & DIETARY MANAGEMENT</small>
          <h1>
            <ChefHat /> Food Bill & Dietary Management
          </h1>
          <p>
            Diet census, kitchen production, delivery tracking and automatic IPD
            food billing.
          </p>
        </div>
        <button onClick={load}>
          <RefreshCw />
          Refresh
        </button>
      </header>
      <nav>
        {[
          "Kitchen Dashboard",
          "Diet Census",
          "Food Orders",
          "Menu & Rates",
          "Meal Schedules",
          "Package Rules",
          "Reports",
          "Audit Trail",
        ].map((x) => (
          <button
            className={tab === x ? "active" : ""}
            onClick={() => setTab(x)}
            key={x}
          >
            {x}
          </button>
        ))}
      </nav>
      {tab === "Kitchen Dashboard" && (
        <>
          <div className="diet-kpis">
            {[
              ["Admitted patients", data.metrics.patients, Users],
              ["Meals", data.metrics.meals, Utensils],
              ["New orders", data.metrics.pending, Clock3],
              ["Accepted", data.metrics.accepted, CheckCircle2],
              ["Preparing", data.metrics.preparing, ChefHat],
              ["Ready", data.metrics.ready, CheckCircle2],
              ["Out for delivery", data.metrics.outForDelivery, Clock3],
              ["Delivered", data.metrics.delivered, CheckCircle2],
              ["Cancelled", data.metrics.cancelled, AlertTriangle],
              ["Breakfast pending", data.metrics.breakfastPending, Clock3],
              ["Lunch pending", data.metrics.lunchPending, Clock3],
              ["Dinner pending", data.metrics.dinnerPending, Clock3],
              ["Special diets", data.metrics.special, AlertTriangle],
              ["NPO patients", data.metrics.npo, AlertTriangle],
            ].map(([x, v, I]: any) => (
              <article key={x}>
                <I />
                <span>{x}</span>
                <strong>{v || 0}</strong>
              </article>
            ))}
          </div>
          <div className="diet-tools diet-schedule-actions">
            <Clock3 />
            <strong>Generate today&apos;s meal list</strong>
            {data.schedules
              .filter((schedule: Row) => schedule.active)
              .map((schedule: Row) => (
                <button
                  key={schedule.id}
                  onClick={() => generate(schedule.meal_type)}
                >
                  {schedule.meal_type} ·{" "}
                  {String(schedule.service_time).slice(0, 5)}
                </button>
              ))}
            {!data.schedules.length && (
              <span>Add meal schedules to enable automatic generation.</span>
            )}
          </div>
          <div className="diet-breakdowns">
            <article>
              <h3>Diet-wise patient count</h3>
              {(data.metrics.dietWise || []).map((item: Row) => (
                <span key={item.name}>
                  {item.name}
                  <b>{item.count}</b>
                </span>
              ))}
            </article>
            <article>
              <h3>Ward-wise meal count</h3>
              {(data.metrics.wardWise || []).map((item: Row) => (
                <span key={item.name}>
                  {item.name}
                  <b>{item.count}</b>
                </span>
              ))}
            </article>
          </div>
          <Board orders={data.orders} status={status} />
        </>
      )}
      {tab !== "Kitchen Dashboard" && (
        <>
          <div className="diet-tools">
            <Search />
            <input
              placeholder={`Search ${tab.toLowerCase()}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {[
              "Diet Census",
              "Food Orders",
              "Menu & Rates",
              "Package Rules",
              "Meal Schedules",
            ].includes(tab) && (
              <button
                onClick={() => {
                  setSelected(null);
                  setDialog(tab);
                }}
              >
                <Plus /> Add{" "}
                {tab === "Diet Census"
                  ? "diet"
                  : tab === "Food Orders"
                    ? "order"
                    : tab === "Menu & Rates"
                      ? "item"
                      : tab === "Meal Schedules"
                        ? "schedule"
                        : "rule"}
              </button>
            )}
          </div>
          {tab === "Reports" ? (
            <Reports orders={data.orders} patients={data.patients} />
          ) : (
            <Table
              tab={tab}
              rows={rows}
              status={status}
              patientAction={patientAction}
              edit={(x) => {
                setSelected(x);
                setDialog(tab);
              }}
            />
          )}
        </>
      )}
      {dialog && (
        <Form
          type={dialog}
          data={data}
          selected={selected}
          token={token}
          close={() => setDialog("")}
          saved={() => {
            setDialog("");
            load();
          }}
        />
      )}
    </section>
  );
}
function Board({
  orders,
  status,
}: {
  orders: Row[];
  status: (o: Row, s: string) => void;
}) {
  return (
    <div className="diet-board">
      {[
        "Order Placed",
        "Kitchen Accepted",
        "Preparing",
        "Ready",
        "Out for Delivery",
        "Delivered",
      ].map((stage) => (
        <section key={stage}>
          <h3>
            {stage}
            <b>{orders.filter((x) => x.kitchen_status === stage).length}</b>
          </h3>
          {orders
            .filter((x) => x.kitchen_status === stage)
            .slice(0, 20)
            .map((o) => (
              <article key={o.id}>
                <strong>
                  {o.item_name} × {o.quantity}
                </strong>
                <span>{o.patient_name || o.order_type}</span>
                <small>
                  {o.ward_name || ""} {o.room_number || ""} · {money(o.amount)}
                </small>
                {stage !== "Delivered" && (
                  <button
                    onClick={() =>
                      status(
                        o,
                        {
                          "Order Placed": "Kitchen Accepted",
                          "Kitchen Accepted": "Preparing",
                          Preparing: "Ready",
                          Ready: "Out for Delivery",
                          "Out for Delivery": "Delivered",
                        }[stage]!,
                      )
                    }
                  >
                    Advance →
                  </button>
                )}
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}
function Table({
  tab,
  rows,
  status,
  patientAction,
}: {
  tab: string;
  rows: Row[];
  status: (o: Row, s: string) => void;
  patientAction: (patient: Row, action: "confirm" | "hold" | "resume") => void;
  edit: (x: Row) => void;
}) {
  return (
    <div className="diet-table">
      <table>
        <thead>
          <tr>
            {tab === "Diet Census" ? (
              <>
                <th>Patient / UHID</th>
                <th>IPD / Location</th>
                <th>Doctor</th>
                <th>Current diet</th>
                <th>Instructions</th>
                <th>Meal control</th>
              </>
            ) : tab === "Menu & Rates" ? (
              <>
                <th>Code / Item</th>
                <th>Meal</th>
                <th>Allergens</th>
                <th>Patient</th>
                <th>Attendant</th>
                <th>Guest</th>
                <th>Status</th>
              </>
            ) : tab === "Meal Schedules" ? (
              <>
                <th>Meal</th>
                <th>Service time</th>
                <th>Generation lead</th>
                <th>Status</th>
              </>
            ) : tab === "Package Rules" ? (
              <>
                <th>Package</th>
                <th>Meal</th>
                <th>Order type</th>
                <th>Rule</th>
              </>
            ) : tab === "Audit Trail" ? (
              <>
                <th>Date</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Remarks</th>
              </>
            ) : (
              <>
                <th>Order / Date</th>
                <th>Patient / Location</th>
                <th>Item</th>
                <th>Billing</th>
                <th>Kitchen</th>
                <th>Action</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((x: Row) =>
            tab === "Diet Census" ? (
              <tr key={x.admission_id}>
                <td>
                  <b>{x.patient_name}</b>
                  <small>{x.medical_record_number}</small>
                </td>
                <td>
                  {x.ipd_number}
                  <small>
                    {x.ward_name} · {x.room_number}/{x.bed_number}
                  </small>
                </td>
                <td>{x.doctor_name}</td>
                <td>
                  <b>{x.diet_type}</b>
                </td>
                <td>{x.diet_instructions || "—"}</td>
                <td>
                  {!x.confirmed_at && x.diet_type !== "Not Assigned" && (
                    <button onClick={() => patientAction(x, "confirm")}>
                      Confirm diet
                    </button>
                  )}
                  {x.meals_held ? (
                    <button onClick={() => patientAction(x, "resume")}>
                      Resume meals
                    </button>
                  ) : (
                    <button onClick={() => patientAction(x, "hold")}>
                      Stop meals
                    </button>
                  )}
                  {x.meals_held && <small>{x.hold_reason}</small>}
                </td>
              </tr>
            ) : tab === "Menu & Rates" ? (
              <tr key={x.id}>
                <td>
                  <b>{x.item_name}</b>
                  <small>{x.item_code}</small>
                </td>
                <td>{x.meal_type}</td>
                <td>{x.allergens?.join(", ") || "None declared"}</td>
                <td>{money(x.patient_rate)}</td>
                <td>{money(x.attendant_rate)}</td>
                <td>{money(x.guest_rate)}</td>
                <td>{x.active ? "Active" : "Inactive"}</td>
              </tr>
            ) : tab === "Meal Schedules" ? (
              <tr key={x.id}>
                <td>
                  <b>{x.meal_type}</b>
                </td>
                <td>{String(x.service_time).slice(0, 5)}</td>
                <td>{x.generation_lead_minutes} minutes</td>
                <td>{x.active ? "Active" : "Inactive"}</td>
              </tr>
            ) : tab === "Package Rules" ? (
              <tr key={x.id}>
                <td>{x.package_name}</td>
                <td>{x.meal_type}</td>
                <td>{x.order_type}</td>
                <td>{x.included ? "Included" : "Chargeable"}</td>
              </tr>
            ) : tab === "Audit Trail" ? (
              <tr key={x.id}>
                <td>{new Date(x.created_at).toLocaleString()}</td>
                <td>{x.user_name || "Admin"}</td>
                <td>
                  <b>{x.action}</b>
                </td>
                <td>{x.entity_type}</td>
                <td>{x.remarks || "—"}</td>
              </tr>
            ) : (
              <tr key={x.id}>
                <td>
                  <b>{x.order_number}</b>
                  <small>{new Date(x.created_at).toLocaleString()}</small>
                </td>
                <td>
                  {x.patient_name || x.order_type}
                  <small>
                    {x.ipd_number || ""} · {x.ward_name || ""}
                  </small>
                </td>
                <td>
                  {x.item_name} × {x.quantity}
                </td>
                <td>
                  {x.billing_class}
                  <small>
                    {money(x.amount)} {x.ledger_posted ? "· Posted" : ""}
                  </small>
                </td>
                <td>
                  {x.kitchen_status}
                  {x.received_by && <small>Received by {x.received_by}</small>}
                </td>
                <td>
                  <select
                    value={x.kitchen_status}
                    onChange={(e) => status(x, e.target.value)}
                  >
                    {[
                      "Order Placed",
                      "Kitchen Accepted",
                      "Preparing",
                      "Ready",
                      "Out for Delivery",
                      "Delivered",
                      "Cancelled",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {!rows.length && <p className="diet-empty">No records found.</p>}
    </div>
  );
}
function Reports({ orders, patients }: { orders: Row[]; patients: Row[] }) {
  const delivered = orders.filter((x) => x.delivery_status === "Delivered"),
    revenue = delivered.reduce((n, x) => n + Number(x.amount), 0);
  return (
    <div className="diet-reports">
      <article>
        <span>Delivered food revenue</span>
        <strong>{money(revenue)}</strong>
      </article>
      <article>
        <span>Chargeable orders</span>
        <strong>{orders.filter((x) => Number(x.amount) > 0).length}</strong>
      </article>
      <article>
        <span>Complimentary / included</span>
        <strong>{orders.filter((x) => !Number(x.amount)).length}</strong>
      </article>
      <article>
        <span>Daily diet census</span>
        <strong>{patients.length}</strong>
      </article>
      {[
        "Daily Food Billing Report",
        "Patient-wise Food Bill",
        "IPD-wise Food Bill",
        "Room-wise Food Consumption",
        "Ward-wise Consumption",
        "Attendant Food Bill",
        "Guest Food Bill",
        "Complimentary Food Report",
        "Package-Included Meals",
        "Diet-wise Meal Report",
        "Kitchen Sales",
        "Item-wise Sales",
        "Meal-wise Sales Report",
        "Cancelled Orders",
        "Pending Delivery",
        "Staff Meal Report",
        "Doctor Meal Report",
        "Monthly Food Revenue Report",
        "Daily Diet Census",
        "NPO Patient Report",
        "Special Diet Report",
        "Food Collection vs Consumption Report",
      ].map((x) => (
        <button
          key={x}
          onClick={() => exportDietaryReport(x, orders, patients)}
        >
          {x}
          <span>CSV ↓</span>
        </button>
      ))}
    </div>
  );
}

function exportDietaryReport(name: string, orders: Row[], patients: Row[]) {
  const patientReport = [
    "Daily Diet Census",
    "NPO Patient Report",
    "Special Diet Report",
  ].includes(name);
  let source = patientReport ? patients : orders;
  if (name.includes("Cancelled"))
    source = orders.filter((row) => row.kitchen_status === "Cancelled");
  else if (name.includes("Pending Delivery"))
    source = orders.filter(
      (row) => !["Delivered", "Cancelled"].includes(row.kitchen_status),
    );
  else if (name.includes("Attendant"))
    source = orders.filter((row) => row.order_type === "Attendant Meal");
  else if (name.includes("Guest"))
    source = orders.filter((row) => row.order_type === "Guest Meal");
  else if (name.includes("Staff"))
    source = orders.filter((row) => row.order_type === "Staff Meal");
  else if (name.includes("Doctor"))
    source = orders.filter((row) => row.order_type === "Doctor Meal");
  else if (name.includes("Complimentary"))
    source = orders.filter((row) =>
      row.billing_class?.includes("Complimentary"),
    );
  else if (name.includes("Package-Included"))
    source = orders.filter((row) => row.billing_class?.includes("Included"));
  else if (name === "NPO Patient Report")
    source = patients.filter((row) => row.diet_type === "NPO / Nil by Mouth");
  else if (name === "Special Diet Report")
    source = patients.filter(
      (row) =>
        !["Normal Diet", "Not Assigned", "NPO / Nil by Mouth"].includes(
          row.diet_type,
        ),
    );
  const columns = patientReport
    ? [
        "medical_record_number",
        "patient_name",
        "ipd_number",
        "ward_name",
        "room_number",
        "bed_number",
        "diet_type",
        "diet_instructions",
        "allergies",
        "meals_held",
      ]
    : [
        "order_number",
        "created_at",
        "medical_record_number",
        "patient_name",
        "ipd_number",
        "ward_name",
        "room_number",
        "bed_number",
        "meal_type",
        "order_type",
        "item_name",
        "quantity",
        "rate",
        "amount",
        "billing_class",
        "kitchen_status",
        "delivery_status",
        "received_by",
        "ledger_posted",
      ];
  const quote = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    columns.map(quote).join(","),
    ...source.map((row: Row) =>
      columns.map((column) => quote(row[column])).join(","),
    ),
  ].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  link.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
function Form({
  type,
  data,
  selected,
  token,
  close,
  saved,
}: {
  type: string;
  data: Row;
  selected: Row | null;
  token: string;
  close: () => void;
  saved: () => void;
}) {
  const [f, setF] = useState<Row>(
    type === "Diet Census"
      ? {
          admission_id:
            selected?.admission_id || data.patients[0]?.admission_id || "",
          diet_type: selected?.diet_type || "Normal Diet",
          instructions: "",
          reason: "",
        }
      : type === "Food Orders"
        ? {
            admission_id: data.patients[0]?.admission_id || null,
            menu_id: data.menu[0]?.id || "",
            order_type: "Patient Meal",
            quantity: 1,
            billing_class: "Chargeable",
            remarks: "",
          }
        : type === "Menu & Rates"
          ? {
              item_code: "",
              item_name: "",
              category: "Meals",
              meal_type: "Breakfast",
              patient_rate: 0,
              attendant_rate: 0,
              guest_rate: 0,
              staff_rate: 0,
              tax: 0,
              package_eligible: false,
              complimentary_eligible: false,
              allergens_text: "",
            }
          : type === "Meal Schedules"
            ? {
                meal_type: "Breakfast",
                service_time: "08:00",
                generation_lead_minutes: 120,
                active: true,
              }
            : {
                package_name: "General Ward",
                meal_type: "Breakfast",
                order_type: "Patient Meal",
                included: true,
              },
  );
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload =
        type === "Menu & Rates"
          ? {
              ...f,
              allergens: String(f.allergens_text || "")
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            }
          : f;
      await api(
        type === "Diet Census"
          ? "/diets"
          : type === "Food Orders"
            ? "/orders"
            : type === "Menu & Rates"
              ? "/menu"
              : type === "Meal Schedules"
                ? "/schedules"
                : "/rules",
        token,
        { method: "POST", body: JSON.stringify(payload) },
      );
      saved();
    } catch (e) {
      Swal.fire(
        "Unable to save",
        e instanceof Error ? e.message : "Request failed",
        "error",
      );
    }
  }
  return (
    <div className="diet-modal">
      <form onSubmit={save}>
        <header>
          <h2>{type}</h2>
          <button type="button" onClick={close}>
            ×
          </button>
        </header>
        {type === "Diet Census" ? (
          <>
            <label>
              Patient
              <select
                value={f.admission_id}
                onChange={(e) => set("admission_id", e.target.value)}
              >
                {data.patients.map((p: Row) => (
                  <option value={p.admission_id}>
                    {p.patient_name} · {p.ipd_number}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Diet
              <select
                value={f.diet_type}
                onChange={(e) => set("diet_type", e.target.value)}
              >
                {[
                  "Normal Diet",
                  "Soft Diet",
                  "Liquid Diet",
                  "Diabetic Diet",
                  "Low-Salt Diet",
                  "Renal Diet",
                  "Cardiac Diet",
                  "High-Protein Diet",
                  "Pediatric Diet",
                  "NPO / Nil by Mouth",
                  "Custom Diet",
                ].map((x) => (
                  <option>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Instructions
              <textarea
                value={f.instructions}
                onChange={(e) => set("instructions", e.target.value)}
              />
            </label>
            <label>
              Reason
              <input
                value={f.reason}
                onChange={(e) => set("reason", e.target.value)}
              />
            </label>
          </>
        ) : type === "Food Orders" ? (
          <>
            <label>
              Patient
              <select
                value={f.admission_id || ""}
                onChange={(e) => set("admission_id", e.target.value || null)}
              >
                <option value="">Non-patient order</option>
                {data.patients.map((p: Row) => (
                  <option value={p.admission_id}>
                    {p.patient_name} · {p.ipd_number}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Menu item
              <select
                value={f.menu_id}
                onChange={(e) => set("menu_id", e.target.value)}
              >
                {data.menu.map((m: Row) => (
                  <option value={m.id}>{m.item_name}</option>
                ))}
              </select>
            </label>
            {[
              [
                "order_type",
                [
                  "Patient Meal",
                  "Attendant Meal",
                  "Guest Meal",
                  "Extra Patient Meal",
                  "À La Carte Order",
                  "Staff Meal",
                  "Doctor Meal",
                ],
              ],
              [
                "billing_class",
                [
                  "Chargeable",
                  "Complimentary",
                  "Included in Room Package",
                  "Included in Clinic Package",
                  "Discounted",
                  "Staff Meal",
                  "Doctor Meal",
                  "Management Complimentary",
                ],
              ],
            ].map(([k, opts]: any) => (
              <label>
                {k.replace("_", " ")}
                <select value={f[k]} onChange={(e) => set(k, e.target.value)}>
                  {opts.map((x: string) => (
                    <option>{x}</option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Quantity
              <input
                type="number"
                min="1"
                value={f.quantity}
                onChange={(e) => set("quantity", Number(e.target.value))}
              />
            </label>
          </>
        ) : type === "Menu & Rates" ? (
          <>
            {[
              "item_code",
              "item_name",
              "category",
              "meal_type",
              "patient_rate",
              "attendant_rate",
              "guest_rate",
              "staff_rate",
              "tax",
              "allergens_text",
            ].map((k) => (
              <label>
                {k.replaceAll("_", " ")}
                <input
                  required={k !== "allergens_text"}
                  value={f[k]}
                  type={k.includes("rate") || k === "tax" ? "number" : "text"}
                  onChange={(e) =>
                    set(
                      k,
                      k.includes("rate") || k === "tax"
                        ? Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              </label>
            ))}
            <label>
              <input
                type="checkbox"
                checked={Boolean(f.package_eligible)}
                onChange={(e) => set("package_eligible", e.target.checked)}
              />{" "}
              Eligible for package inclusion
            </label>
            <label>
              <input
                type="checkbox"
                checked={Boolean(f.complimentary_eligible)}
                onChange={(e) =>
                  set("complimentary_eligible", e.target.checked)
                }
              />{" "}
              Eligible for complimentary issue
            </label>
          </>
        ) : type === "Meal Schedules" ? (
          <>
            <label>
              Meal type
              <select
                value={f.meal_type}
                onChange={(e) => set("meal_type", e.target.value)}
              >
                {[
                  "Early Morning Drink",
                  "Breakfast",
                  "Mid-Morning Snack",
                  "Lunch",
                  "Evening Tea / Snacks",
                  "Dinner",
                  "Bedtime Milk / Snack",
                ].map((meal) => (
                  <option key={meal}>{meal}</option>
                ))}
              </select>
            </label>
            <label>
              Service time
              <input
                type="time"
                required
                value={f.service_time}
                onChange={(e) => set("service_time", e.target.value)}
              />
            </label>
            <label>
              Generate minutes before service
              <input
                type="number"
                min="0"
                max="1440"
                required
                value={f.generation_lead_minutes}
                onChange={(e) =>
                  set("generation_lead_minutes", Number(e.target.value))
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={Boolean(f.active)}
                onChange={(e) => set("active", e.target.checked)}
              />{" "}
              Active
            </label>
          </>
        ) : (
          <>
            {["package_name", "meal_type", "order_type"].map((k) => (
              <label>
                {k.replaceAll("_", " ")}
                <input value={f[k]} onChange={(e) => set(k, e.target.value)} />
              </label>
            ))}
            <label>
              <input
                type="checkbox"
                checked={f.included}
                onChange={(e) => set("included", e.target.checked)}
              />{" "}
              Included in package
            </label>
          </>
        )}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button>Save</button>
        </footer>
      </form>
    </div>
  );
}
