import {DIAGNOSTIC_MODULE_NAME} from "./diagnostic-master-labels";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Building2,
  Download,
  Edit3,
  Eye,
  LoaderCircle,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import "./hospital-management.css";
import "./print-template.css";
import PrintImageCrop from "./PrintImageCrop";
import {footerImageHtml} from "./print-image";
import {labCharges} from "./lab-pricing";

type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: string[];
  pattern?: string;
  maxLength?: number;
  inputMode?: "numeric" | "tel";
  title?: string;
  min?: number;
  max?: number;
  step?: string;
};
type RecordRow = Record<string, unknown> & { id?: string };
const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");

const commonStatus = ["Active", "Inactive"];
const definitions: Record<
  string,
  { resource: string; title: string; fields: Field[] }
> = {
  "Refer Pharmacy": {
    resource: "refer-pharmacies",
    title: "Refer Pharmacy",
    fields: [
      { key: "name", label: "Pharmacy Name", required: true },
      { key: "address", label: "Address", required: true },
      { key: "discount_percentage", label: "Discount (%)", type: "number", required: true, min: 0, max: 100, step: "0.01" },
    ],
  },
  "Clinic Profile": {
    resource: "profile",
    title: "Clinic Profile",
    fields: [
      { key: "name", label: "Clinic Name", required: true },
      { key: "code", label: "Clinic Code", required: true },
      { key: "logo_url", label: "Logo", type: "image" },
      { key: "hospital_type", label: "Clinic Type" },
      { key: "registration_number", label: "Registration Number" },
      { key: "establishment_date", label: "Establishment Date", type: "date" },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone" },
      { key: "emergency_phone", label: "Emergency Phone" },
      { key: "website", label: "Website", type: "url" },
      { key: "gstin", label: "GSTIN" },
      { key: "address_line", label: "Address" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "pin_code", label: "PIN" },
      { key: "country", label: "Country" },
      { key: "currency", label: "Currency" },
      { key: "timezone", label: "Time Zone" },
    ],
  },
  Branches: {
    resource: "branches",
    title: "Branches",
    fields: [
      { key: "name", label: "Branch Name", required: true },
      { key: "code", label: "Branch Code", required: true },
      { key: "branch_type", label: "Branch Type" },
      { key: "manager_name", label: "Branch Manager" },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone", type: "tel", pattern: "[0-9]{10}", maxLength: 10, inputMode: "numeric", title: "Enter exactly 10 digits" },
      { key: "emergency_phone", label: "Emergency Phone", type: "tel", pattern: "[0-9]{10}", maxLength: 10, inputMode: "numeric", title: "Enter exactly 10 digits" },
      { key: "address_line", label: "Address" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "pin_code", label: "PIN" },
      { key: "bed_capacity", label: "Bed Capacity", type: "number" },
      { key: "is_active", label: "Status", options: commonStatus },
    ],
  },
  Departments: {
    resource: "departments",
    title: "Departments",
    fields: [
      { key: "name", label: "Department Name", required: true },
      { key: "code", label: "Department Code", required: true },
      { key: "branch_id", label: "Branch", type: "branch" },
      { key: "hod_name", label: "HOD" },
      { key: "location", label: "Floor / Location" },
      { key: "phone_extension", label: "Phone / Extension", type: "tel", pattern: "[0-9]{1,10}", maxLength: 10, inputMode: "numeric", title: "Use numbers only (maximum 10 digits)" },
      { key: "description", label: "Description" },
      { key: "is_active", label: "Status", options: commonStatus },
    ],
  },
  Wards: {
    resource: "wards",
    title: "Wards",
    fields: [
      { key: "name", label: "Ward Name", required: true },
      { key: "code", label: "Ward Code", required: true },
      { key: "branch_id", label: "Branch", type: "branch" },
      { key: "department_id", label: "Department", type: "department" },
      { key: "ward_type", label: "Ward Type" },
      { key: "floor", label: "Floor" },
      { key: "capacity", label: "Capacity", type: "number" },
      { key: "is_active", label: "Status", options: commonStatus },
    ],
  },
  Rooms: {
    resource: "rooms",
    title: "Rooms",
    fields: [
      { key: "room_number", label: "Room Number", required: true },
      { key: "branch_id", label: "Branch", type: "branch" },
      { key: "ward_id", label: "Ward", type: "ward" },
      { key: "room_type", label: "Room Type" },
      { key: "floor", label: "Floor" },
      { key: "daily_charge", label: "Daily Charge", type: "number" },
      { key: "is_active", label: "Status", options: commonStatus },
    ],
  },
  Beds: {
    resource: "beds",
    title: "Beds",
    fields: [
      { key: "bed_number", label: "Bed Number", required: true },
      { key: "branch_id", label: "Branch", type: "branch" },
      { key: "ward_id", label: "Ward", type: "ward" },
      { key: "room_id", label: "Room", type: "room" },
      { key: "bed_type", label: "Bed Type" },
      { key: "daily_charge", label: "Daily Charge", type: "number" },
      {
        key: "status",
        label: "Status",
        options: [
          "Available",
          "Occupied",
          "Reserved",
          "Cleaning",
          "Maintenance",
        ],
      },
    ],
  },
};

async function request<T>(
  path: string,
  token: string,
  options: RequestInit = {},
) {
  const response = await fetch(`${API_URL}/api/v1/hospital-management${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error ?? "Request failed");
  return data as T;
}

const setupPages = new Set([
  "Clinic Charges",
  "Print Header Footer",
  "Operations",
  "Pharmacy",
  "Pathology",
  "Radiology",
  "Blood Bank",
  "Symptoms",
]);

export default function HospitalManagement(props: {
  page: string;
  token: string;
}) {
  if (
    ["Bed Status", "Bed", "Bed Type", "Bed Group", "Floor"].includes(props.page)
  )
    return <BedSetup page={props.page} token={props.token} />;
  if (setupPages.has(props.page))
    return <HospitalSetupPage page={props.page} token={props.token} />;
  return <HospitalRecords {...props} />;
}

export function PathologyMasters({ token }: { token: string }) {
  return (
    <DiagnosticMasterSetup
      page="Pathology"
      token={token}
      sections={[
        "Test Master",
        "Test Category",
        "Unit",
        "Test Parameter",
        "Specimens",
        "Vaccu Master",
        "Test Methods",
        "Lab Signatories",
      ]}
    />
  );
}

const bedPages = [
  "Bed Status",
  "Bed",
  "Ward",
  "Room",
  "Bed Type",
  "Bed Group",
  "Floor",
] as const;
const masterKind: Record<string, string> = {
  "Bed Type": "type",
  "Bed Group": "group",
  Floor: "floor",
};
const bedStatusColours: Record<string, string> = {
  Available: "#16a34a",
  Occupied: "#dc2626",
  Reserved: "#7c3aed",
  Cleaning: "#f59e0b",
  Maintenance: "#64748b",
};
function BedSetup({ page, token }: { page: string; token: string }) {
  const [active, setActive] = useState(page),
    [rows, setRows] = useState<RecordRow[]>([]),
    [types, setTypes] = useState<RecordRow[]>([]),
    [groups, setGroups] = useState<RecordRow[]>([]),
    [floors, setFloors] = useState<RecordRow[]>([]),
    [branches, setBranches] = useState<RecordRow[]>([]),
    [departments, setDepartments] = useState<RecordRow[]>([]),
    [wards, setWards] = useState<RecordRow[]>([]),
    [rooms, setRooms] = useState<RecordRow[]>([]),
    [editing, setEditing] = useState<RecordRow | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const kind = masterKind[active];
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [t, g, f, b, d, w, r] = await Promise.all([
        request<RecordRow[]>("/bed-setup/type", token),
        request<RecordRow[]>("/bed-setup/group", token),
        request<RecordRow[]>("/bed-setup/floor", token),
        request<RecordRow[]>("/branches", token),
        request<RecordRow[]>("/departments", token),
        request<RecordRow[]>("/wards", token),
        request<RecordRow[]>("/rooms", token),
      ]);
      setTypes(t);
      setGroups(g);
      setFloors(f);
      setBranches(b);
      setDepartments(d);
      setWards(w);
      setRooms(r);
      if (active === "Bed Status")
        setRows(await request<RecordRow[]>("/bed-setup/status", token));
      else if (active === "Bed")
        setRows(await request<RecordRow[]>("/beds", token));
      else if (active === "Ward") setRows(w);
      else if (active === "Room") setRows(r);
      else setRows(active === "Bed Type" ? t : active === "Bed Group" ? g : f);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load bed setup");
    } finally {
      setLoading(false);
    }
  }, [active, token]);
  useEffect(() => {
    load();
  }, [load]);
  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (active === "Bed") {
        const body = {
          bed_number: String(form.get("bed_number") ?? "").trim(),
          branch_id: String(form.get("branch_id") ?? ""),
          ward_id: String(form.get("ward_id") ?? "") || null,
          room_id: String(form.get("room_id") ?? "") || null,
          bed_type_id: String(form.get("bed_type_id") ?? "") || null,
          bed_group_id: String(form.get("bed_group_id") ?? "") || null,
          status: String(form.get("status") ?? "Available"),
          daily_charge: Number(form.get("daily_charge") || 0),
        };
        await request(`/beds${editing?.id ? `/${editing.id}` : ""}`, token, {
          method: editing?.id ? "PUT" : "POST",
          body: JSON.stringify(body),
        });
      } else if (active === "Ward") {
        const body = {
          name: String(form.get("name") ?? "").trim(),
          code: String(form.get("code") ?? "").trim(),
          branch_id: String(form.get("branch_id") ?? ""),
          department_id: String(form.get("department_id") ?? "") || null,
          ward_type: String(form.get("ward_type") ?? ""),
          floor: String(form.get("floor") ?? ""),
          capacity: Number(form.get("capacity") || 0),
          is_active: form.get("is_active") === "Active",
        };
        await request(`/wards${editing?.id ? `/${editing.id}` : ""}`, token, { method: editing?.id ? "PUT" : "POST", body: JSON.stringify(body) });
      } else if (active === "Room") {
        const body = {
          room_number: String(form.get("room_number") ?? "").trim(),
          branch_id: String(form.get("branch_id") ?? ""),
          ward_id: String(form.get("ward_id") ?? "") || null,
          room_type: String(form.get("room_type") ?? ""),
          floor: String(form.get("floor") ?? ""),
          daily_charge: Number(form.get("daily_charge") || 0),
          is_active: form.get("is_active") === "Active",
        };
        await request(`/rooms${editing?.id ? `/${editing.id}` : ""}`, token, { method: editing?.id ? "PUT" : "POST", body: JSON.stringify(body) });
      } else {
        const body = {
          name: String(form.get("name") ?? "").trim(),
          description: String(form.get("description") ?? ""),
          color: String(form.get("color") ?? "") || null,
          floor_id: String(form.get("floor_id") ?? "") || null,
        };
        await request(
          `/bed-setup/${kind}${editing?.id ? `/${editing.id}` : ""}`,
          token,
          { method: editing?.id ? "PUT" : "POST", body: JSON.stringify(body) },
        );
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setSaving(false);
    }
  }
  async function remove(row: RecordRow) {
    if (!row.id || !confirm(`Delete ${active.toLowerCase()} record?`)) return;
    if (active === "Bed" && String(row.status).toLowerCase() === "occupied") {
      setError("Occupied beds cannot be deleted. Transfer or discharge the patient first.");
      return;
    }
    try {
      const path =
        active === "Bed" ? `/beds/${row.id}` : active === "Ward" ? `/wards/${row.id}` : active === "Room" ? `/rooms/${row.id}` : `/bed-setup/${kind}/${row.id}`;
      await request(path, token, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete record");
    }
  }
  const title = active,
    status = active === "Bed Status";
  return (
    <section className="hm-page">
      <header className="hm-head">
        <div>
          <small>Clinic Management / Bed</small>
          <h1>Bed Management</h1>
          <p>Configure floors, groups, types and live bed availability.</p>
        </div>
      </header>
      <div className="hm-settings-layout">
        <nav className="hm-settings-menu" aria-label="Bed setup sections">
          {bedPages.map((item) => (
            <button
              key={item}
              type="button"
              className={active === item ? "active" : ""}
              onClick={() => {
                setActive(item);
                setSearch("");
                setEditing(null);
              }}
            >
              {item}
            </button>
          ))}
        </nav>
        <section className="hm-settings-panel">
          <header className="hm-charge-head">
            <div>
              <small>Bed Management</small>
              <h2>{title}</h2>
              <p>
                {status
                  ? "See real-time bed availability and allocation status."
                  : `Manage ${title.toLowerCase()} for this clinic.`}
              </p>
            </div>
            {!status && (
              <button type="button" onClick={() => setEditing({})}>
                <Plus /> Add {active}
              </button>
            )}
          </header>
          {error && <div className="hm-error">{error}</div>}
          {status && (
            <div className="hm-status-legend">
              {Object.entries(bedStatusColours).map(([label, colour]) => (
                <span key={label}>
                  <i style={{ backgroundColor: colour }} />
                  {label}
                </span>
              ))}
            </div>
          )}
          <div className="hm-charge-search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}...`}
            />
            <span>{filtered.length} records</span>
          </div>
          {loading ? (
            <div className="hm-loading">
              <LoaderCircle className="spin" /> Loading…
            </div>
          ) : (
            <div className="hm-charge-table">
              <table>
                <thead>
                  <tr>
                    {(status
                      ? [
                          "Bed",
                          "Branch",
                          "Ward",
                          "Room",
                          "Bed Type",
                          "Bed Group",
                          "Floor",
                          "Group Colour",
                          "Status",
                        ]
                        : active === "Bed"
                        ? [
                            "Bed",
                            "Branch",
                            "Ward",
                            "Room",
                            "Type",
                            "Group",
                            "Floor",
                            "Colour",
                            "Status",
                            "Daily Charge",
                          ]
                        : active === "Ward"
                          ? ["Ward", "Code", "Branch", "Department", "Floor", "Capacity", "Status"]
                        : active === "Room"
                          ? ["Room", "Branch", "Ward", "Type", "Floor", "Daily Charge", "Status"]
                        : active === "Bed Group"
                          ? ["Name", "Floor", "Color", "Description"]
                          : ["Name", "Description"]
                    ).map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                    {!status && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const group = groups.find(
                      (item) => item.id === row.bed_group_id,
                    );
                    const floor =
                      group?.floor_name ??
                      floors.find((item) => item.id === group?.floor_id)
                        ?.name ??
                      "—";
                    return (
                      <tr
                        key={row.id}
                        className={status ? "hm-status-row" : ""}
                        style={
                          status
                            ? {
                                borderLeftColor:
                                  bedStatusColours[String(row.status)],
                              }
                            : undefined
                        }
                      >
                        {status ? (
                          <>
                            <td>{String(row.bed_number)}</td>
                            <td>{String(row.branch ?? "—")}</td>
                            <td>{String(row.ward ?? "—")}</td>
                            <td>{String(row.room_number ?? "—")}</td>
                            <td>{String(row.bed_type ?? "—")}</td>
                            <td>{String(row.bed_group ?? "—")}</td>
                            <td>{String(row.floor ?? "—")}</td>
                            <td>
                              <span
                                className="hm-color-dot"
                                style={{
                                  backgroundColor: String(
                                    row.bed_group_color ?? "#ffffff",
                                  ),
                                }}
                              />
                            </td>
                            <td>
                              <span
                                className="hm-status-pill"
                                style={{
                                  backgroundColor:
                                    bedStatusColours[String(row.status)],
                                }}
                              >
                                {String(row.status)}
                              </span>
                            </td>
                          </>
                        ) : active === "Bed" ? (
                          <>
                            <td>{String(row.bed_number)}</td>
                            <td>
                              {String(
                                branches.find(
                                  (item) => item.id === row.branch_id,
                                )?.name ?? "—",
                              )}
                            </td>
                            <td>{String(wards.find((item) => item.id === row.ward_id)?.name ?? "—")}</td>
                            <td>{String(rooms.find((item) => item.id === row.room_id)?.room_number ?? "—")}</td>
                            <td>
                              {String(
                                types.find(
                                  (item) => item.id === row.bed_type_id,
                                )?.name ??
                                  row.bed_type ??
                                  "—",
                              )}
                            </td>
                            <td>{String(group?.name ?? "—")}</td>
                            <td>{String(floor)}</td>
                            <td>
                              <span
                                className="hm-color-dot"
                                title={String(group?.color ?? "No colour")}
                                style={{
                                  backgroundColor: String(
                                    group?.color ?? "#ffffff",
                                  ),
                                }}
                              />
                            </td>
                            <td>{String(row.status)}</td>
                            <td>
                              ₹{" "}
                              {Number(row.daily_charge ?? 0).toLocaleString(
                                "en-IN",
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                },
                              )}
                            </td>
                          </>
                        ) : active === "Ward" ? (
                          <>
                            <td>{String(row.name)}</td>
                            <td>{String(row.code)}</td>
                            <td>{String(branches.find((item) => item.id === row.branch_id)?.name ?? "—")}</td>
                            <td>{String(departments.find((item) => item.id === row.department_id)?.name ?? "—")}</td>
                            <td>{String(row.floor ?? "—")}</td>
                            <td>{String(row.capacity ?? 0)}</td>
                            <td>{row.is_active === false ? "Inactive" : "Active"}</td>
                          </>
                        ) : active === "Room" ? (
                          <>
                            <td>{String(row.room_number)}</td>
                            <td>{String(branches.find((item) => item.id === row.branch_id)?.name ?? "—")}</td>
                            <td>{String(wards.find((item) => item.id === row.ward_id)?.name ?? "—")}</td>
                            <td>{String(row.room_type ?? "—")}</td>
                            <td>{String(row.floor ?? "—")}</td>
                            <td>₹{Number(row.daily_charge ?? 0).toFixed(2)}</td>
                            <td>{row.is_active === false ? "Inactive" : "Active"}</td>
                          </>
                        ) : active === "Bed Group" ? (
                          <>
                            <td>{String(row.name)}</td>
                            <td>
                              {String(
                                row.floor_name ??
                                  floors.find(
                                    (item) => item.id === row.floor_id,
                                  )?.name ??
                                  "—",
                              )}
                            </td>
                            <td>
                              <span
                                className="hm-color-dot"
                                style={{
                                  backgroundColor: String(
                                    row.color ?? "#94a3b8",
                                  ),
                                }}
                              />
                            </td>
                            <td>{String(row.description ?? "—")}</td>
                          </>
                        ) : (
                          <>
                            <td>{String(row.name)}</td>
                            <td>{String(row.description ?? "—")}</td>
                          </>
                        )}{" "}
                        {!status && (
                          <td>
                            <button
                              type="button"
                              onClick={() => setEditing(row)}
                            >
                              <Edit3 />
                            </button>
                            <button
                              type="button"
                              className="delete"
                              disabled={active === "Bed" && String(row.status).toLowerCase() === "occupied"}
                              title={active === "Bed" && String(row.status).toLowerCase() === "occupied" ? "Occupied beds cannot be deleted" : `Delete ${active.toLowerCase()}`}
                              onClick={() => remove(row)}
                            >
                              <Trash2 />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filtered.length && (
                <div className="hm-empty">
                  No {title.toLowerCase()} records found.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      {editing && (
        <BedSetupModal
          page={active}
          row={editing}
          types={types}
          groups={groups}
          floors={floors}
          branches={branches}
          departments={departments}
          wards={wards}
          rooms={rooms}
          saving={saving}
          save={save}
          close={() => setEditing(null)}
        />
      )}
    </section>
  );
}
function BedSetupModal({
  page,
  row,
  types,
  groups,
  floors,
  branches,
  departments,
  wards,
  rooms,
  saving,
  save,
  close,
}: {
  page: string;
  row: RecordRow;
  types: RecordRow[];
  groups: RecordRow[];
  floors: RecordRow[];
  branches: RecordRow[];
  departments: RecordRow[];
  wards: RecordRow[];
  rooms: RecordRow[];
  saving: boolean;
  save: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const [groupId, setGroupId] = useState(String(row.bed_group_id ?? ""));
  const [branchId, setBranchId] = useState(String(row.branch_id ?? ""));
  const [wardId, setWardId] = useState(String(row.ward_id ?? ""));
  const [roomId, setRoomId] = useState(String(row.room_id ?? ""));
  const selectedGroup = groups.find((group) => String(group.id) === groupId);
  const selectedFloor =
    selectedGroup?.floor_name ??
    floors.find((floor) => floor.id === selectedGroup?.floor_id)?.name ??
    "—";
  const select = (
    name: string,
    label: string,
    items: RecordRow[],
    value: unknown,
    required = false,
  ) => (
    <label>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <select
        name={name}
        required={required}
        defaultValue={String(value ?? "")}
      >
        <option value="">Select {label}</option>
        {items.map((x) => (
          <option key={x.id} value={String(x.id)}>
            {String(x.name)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="hm-modal-back">
      <form className="hm-modal hm-charge-modal" onSubmit={save}>
        <header>
          <div>
            <h2>
              {row.id ? "Edit" : "Add"} {page}
            </h2>
            <p>Changes apply only to this clinic.</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div className="hm-form-grid">
          {page === "Bed" ? (
            <>
              <label>
                <span>Bed Number *</span>
                <input
                  name="bed_number"
                  required
                  defaultValue={String(row.bed_number ?? "")}
                />
              </label>
              <label>
                <span>Branch *</span>
                <select name="branch_id" required value={branchId} onChange={(event) => { setBranchId(event.target.value); setWardId(""); setRoomId(""); }}>
                  <option value="">Select Branch</option>
                  {branches.map((branch) => <option key={branch.id} value={String(branch.id)}>{String(branch.name)}</option>)}
                </select>
              </label>
              <label>
                <span>Ward *</span>
                <select name="ward_id" required value={wardId} onChange={(event) => { setWardId(event.target.value); setRoomId(""); }}>
                  <option value="">Select Ward</option>
                  {wards.filter((ward) => !branchId || String(ward.branch_id) === branchId).map((ward) => <option key={ward.id} value={String(ward.id)}>{String(ward.name)}</option>)}
                </select>
              </label>
              <label>
                <span>Room *</span>
                <select name="room_id" required value={roomId} disabled={!wardId} onChange={(event) => setRoomId(event.target.value)}>
                  <option value="">Select Room</option>
                  {rooms.filter((room) => (!branchId || String(room.branch_id) === branchId) && (!wardId || String(room.ward_id) === wardId)).map((room) => <option key={room.id} value={String(room.id)}>{String(room.room_number ?? room.name)}</option>)}
                </select>
              </label>
              {select("bed_type_id", "Bed Type", types, row.bed_type_id)}
              <label>
                <span>Bed Group</span>
                <select
                  name="bed_group_id"
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                >
                  <option value="">Select Bed Group</option>
                  {groups.map((group) => (
                    <option key={group.id} value={String(group.id)}>
                      {String(group.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Floor</span>
                <input
                  value={String(selectedFloor)}
                  readOnly
                  placeholder="Select a bed group"
                />
              </label>
              <label>
                <span>Colour</span>
                <div className="hm-bed-colour">
                  <span
                    className="hm-color-dot"
                    style={{
                      backgroundColor: String(
                        selectedGroup?.color ?? "#ffffff",
                      ),
                    }}
                  />
                  <input
                    value={String(selectedGroup?.color ?? "—")}
                    readOnly
                    placeholder="Select a bed group"
                  />
                </div>
              </label>
              <label>
                <span>Daily Charge</span>
                <input
                  name="daily_charge"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={String(row.daily_charge ?? 0)}
                />
              </label>
              <label>
                <span>Status</span>
                <select
                  name="status"
                  defaultValue={String(row.status ?? "Available")}
                >
                  {[
                    "Available",
                    "Occupied",
                    "Reserved",
                    "Cleaning",
                    "Maintenance",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </>
          ) : page === "Ward" ? (
            <>
              <label><span>Ward Name *</span><input name="name" required defaultValue={String(row.name ?? "")}/></label>
              <label><span>Ward Code *</span><input name="code" required defaultValue={String(row.code ?? "")}/></label>
              <label><span>Branch *</span><select name="branch_id" required value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Select Branch</option>{branches.map((branch) => <option key={branch.id} value={String(branch.id)}>{String(branch.name)}</option>)}</select></label>
              <label><span>Department</span><select name="department_id" defaultValue={String(row.department_id ?? "")}><option value="">Select Department</option>{departments.filter((department) => !branchId || String(department.branch_id) === branchId).map((department) => <option key={department.id} value={String(department.id)}>{String(department.name)}</option>)}</select></label>
              <label><span>Ward Type</span><input name="ward_type" defaultValue={String(row.ward_type ?? "")}/></label>
              <label><span>Floor</span><input name="floor" defaultValue={String(row.floor ?? "")}/></label>
              <label><span>Capacity</span><input name="capacity" type="number" min="0" defaultValue={String(row.capacity ?? 0)}/></label>
              <label><span>Status</span><select name="is_active" defaultValue={row.is_active === false ? "Inactive" : "Active"}><option>Active</option><option>Inactive</option></select></label>
            </>
          ) : page === "Room" ? (
            <>
              <label><span>Room Number *</span><input name="room_number" required defaultValue={String(row.room_number ?? "")}/></label>
              <label><span>Branch *</span><select name="branch_id" required value={branchId} onChange={(event) => { setBranchId(event.target.value); setWardId(""); }}><option value="">Select Branch</option>{branches.map((branch) => <option key={branch.id} value={String(branch.id)}>{String(branch.name)}</option>)}</select></label>
              <label><span>Ward *</span><select name="ward_id" required value={wardId} onChange={(event) => setWardId(event.target.value)}><option value="">Select Ward</option>{wards.filter((ward) => !branchId || String(ward.branch_id) === branchId).map((ward) => <option key={ward.id} value={String(ward.id)}>{String(ward.name)}</option>)}</select></label>
              <label><span>Room Type</span><input name="room_type" defaultValue={String(row.room_type ?? "")}/></label>
              <label><span>Floor</span><input name="floor" defaultValue={String(row.floor ?? "")}/></label>
              <label><span>Daily Charge</span><input name="daily_charge" type="number" min="0" step="0.01" defaultValue={String(row.daily_charge ?? 0)}/></label>
              <label><span>Status</span><select name="is_active" defaultValue={row.is_active === false ? "Inactive" : "Active"}><option>Active</option><option>Inactive</option></select></label>
            </>
          ) : (
            <>
              <label>
                <span>Name *</span>
                <input
                  name="name"
                  required
                  defaultValue={String(row.name ?? "")}
                />
              </label>
              {page === "Bed Group" &&
                select("floor_id", "Floor", floors, row.floor_id, true)}
              {page === "Bed Group" && (
                <label>
                  <span>Color</span>
                  <input
                    name="color"
                    type="color"
                    defaultValue={String(row.color ?? "#0ea5e9")}
                  />
                </label>
              )}
              <label className="hm-wide">
                <span>Description</span>
                <textarea
                  name="description"
                  defaultValue={String(row.description ?? "")}
                />
              </label>
            </>
          )}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Save />} Save
          </button>
        </footer>
      </form>
    </div>
  );
}

function HospitalSetupPage({ page, token }: { page: string; token: string }) {
  if (page === "Clinic Charges")
    return <HospitalChargesSetup token={token} />;
  if (page === "Print Header Footer")
    return <PrintHeaderFooterSetup token={token} />;
  if (page === "Operations") return <OperationsSetup token={token} />;
  if (page === "Pharmacy") return <PharmacySetup token={token} />;
  if (page === "Pathology" || page === "Radiology") return <PathologyMasters token={token} />;
  if (page === "Blood Bank")
    return (
      <DiagnosticMasterSetup
        page="Blood Bank"
        token={token}
        sections={["Products"]}
      />
    );
  if (page === "Symptoms")
    return (
      <DiagnosticMasterSetup
        page="Symptoms"
        token={token}
        sections={["Symptoms Head", "Symptoms Type"]}
      />
    );
  return (
    <section className="hm-page">
      <header className="hm-head">
        <div>
          <small>Clinic Management / {page === "Pathology" ? DIAGNOSTIC_MODULE_NAME : page}</small>
          <h1>{page === "Pathology" ? DIAGNOSTIC_MODULE_NAME : page}</h1>
          <p>Configure {page.toLowerCase()} for this clinic.</p>
        </div>
      </header>
      <div className="hm-card">
        <div className="hm-empty">{page} configuration will be added next.</div>
      </div>
    </section>
  );
}

const diagnosticKinds: Record<string, string> = {
  "Test Master": "test",
  "Test Category": "category",
  "Test Parameter": "parameter",
  Specimens: "specimen",
  "Sample Containers": "container",
  "Vaccu Master": "container",
  "Test Methods": "method",
  "Lab Signatories": "approver",
  Unit: "unit",
  Products: "product",
  "Symptoms Type": "type",
  "Symptoms Head": "head",
};
function DiagnosticMasterSetup({
  page,
  sections,
  token,
}: {
  page: string;
  sections: string[];
  token: string;
}) {
  const [priceBranchId, setPriceBranchId] = useState("");
  const [testTypeFilter,setTestTypeFilter]=useState("");
  const [listPage,setListPage]=useState(1);
  const domain = page === "Blood Bank" ? "blood" : page.toLowerCase(),
    sectionKey = sections.join("|"),
    [section, setSection] = useState(sections[0]),
    [all, setAll] = useState<Record<string, RecordRow[]>>({}),
    [editing, setEditing] = useState<RecordRow | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const kind = diagnosticKinds[section],
    rows = all[kind] ?? [];
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const entries: Array<readonly [string, RecordRow[]]> = await Promise.all(
        sections.map(async (label) => {
          const k = diagnosticKinds[label];
          return [
            k,
            await request<RecordRow[]>(
              `/diagnostic-masters/${domain}/${k}`,
              token,
            ),
          ] as const;
        }),
      );
      if (page === "Radiology") {
        const [chargeCategories, charges, taxes] = await Promise.all([
          request<RecordRow[]>("/charge-masters/category", token),
          request<RecordRow[]>("/charge-masters/charge", token),
          request<RecordRow[]>("/charge-masters/tax", token),
        ]);
        entries.push(
          ["charge_category", chargeCategories],
          ["charge", charges],
          ["tax", taxes],
        );
      }
      if (page === "Pathology") {
        const branches = await request<RecordRow[]>("/diagnostic-branches", token);
        entries.push(["branch", branches]);
        setPriceBranchId(current => !current||branches.some(branch => branch.id === current) ? current : "");
      }
      setAll(Object.fromEntries(entries));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : `Unable to load ${page.toLowerCase()} masters`,
      );
    } finally {
      setLoading(false);
    }
  }, [domain, page, sectionKey, token]);
  useEffect(() => {
    load();
  }, [load]);
  const filtered = useMemo(
      () =>
        rows.filter((row) => {
          const data=row.data as Record<string,unknown>|undefined,branches=data?.available_branch_ids;
          const type=['Radiology','Neurology'].includes(String(data?.test_type))?String(data?.test_type):'Pathology';
          return JSON.stringify(row).toLowerCase().includes(search.toLowerCase()) &&
            (kind!=='test'||((!testTypeFilter||type===testTypeFilter)&&(!Array.isArray(branches)||(priceBranchId?branches.includes(priceBranchId):branches.some(id=>all.branch?.some(branch=>branch.id===id))))));
        }),
      [rows, search,kind,priceBranchId,testTypeFilter,all.branch],
    ),
    dataOf = (row: RecordRow) => (row.data ?? {}) as Record<string, unknown>,
    lookup = (k: string, id: unknown) =>
      String(all[k]?.find((x) => x.id === id)?.name ?? "—");
  const paginated=page==='Pathology'&&kind==='test',pageCount=Math.max(1,Math.ceil(filtered.length/50)),currentPage=Math.min(listPage,pageCount);
  const visibleRows=paginated?filtered.slice((currentPage-1)*50,currentPage*50):filtered;
  useEffect(()=>{setListPage(1)},[search,section,page,priceBranchId,testTypeFilter]);
  useEffect(()=>{
    if(page!=='Pathology'||kind!=='test')return;
    const sync=()=>{const id=new URL(location.href).searchParams.get('pathology_test');if(!id){setEditing(null);return;}if(id==='create'){setEditing({});return;}const found=rows.find(row=>row.id===id);if(found)setEditing(found);else if(!loading)setError('Pathology test not found.');};
    sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);
  },[page,kind,all,loading]);
  function openEditor(row:RecordRow){if(page==='Pathology'&&kind==='test'){const url=new URL(location.href);url.searchParams.set('pathology_test',String(row.id||'create'));history.pushState({},'',url);window.scrollTo(0,0);}setEditing(row);}
  function closeEditor(){if(page==='Pathology'&&kind==='test'){const url=new URL(location.href);url.searchParams.delete('pathology_test');history.replaceState({},'',url);}setEditing(null);}
  async function saveMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget),
      data: Record<string, unknown> = { ...((editing?.data ?? {}) as Record<string, unknown>) };
    [
      "reference_from",
      "reference_to",
      "unit_id",
      "description",
      "type",
      "type_id",
      "result_type_id",
      "formula",
      "decimals",
      "designation",
      "qualification",
      "registration_number",
      "signature_name",
      "barcode_suffix",
    ].forEach((key) => {
      const value = String(form.get(key) ?? "");
      if (value) data[key] = value;
    });
    if(form.has("choices"))data.choices=String(form.get("choices")||"").split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
    try {
      await request(
        `/diagnostic-masters/${domain}/${kind}${editing?.id ? `/${editing.id}` : ""}`,
        token,
        {
          method: editing?.id ? "PUT" : "POST",
          body: JSON.stringify({ name: String(form.get("name") ?? ""), data }),
        },
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save record");
    } finally {
      setSaving(false);
    }
  }
  async function saveTest(body: {
    name: string;
    data: Record<string, unknown>;
  }, savedBranchId?: string) {
    setSaving(true);
    setError("");
    try {
      await request(
        `/diagnostic-masters/${domain}/test${editing?.id ? `/${editing.id}` : ""}`,
        token,
        {
          method: editing?.id ? "PUT" : "POST",
          body: JSON.stringify(body),
        },
      );
      if (savedBranchId) setPriceBranchId(savedBranchId);
      closeEditor();
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save pathology test",
      );
    } finally {
      setSaving(false);
    }
  }
  async function removeMaster(row: RecordRow) {
    if (!row.id || !confirm(`Delete ${row.name}?`)) return;
    try {
      await request(`/diagnostic-masters/${domain}/${kind}/${row.id}`, token, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete record");
    }
  }
  if(page==='Pathology'&&kind==='test'&&editing)return <section className="hm-page hm-pathology-editor-page"><button type="button" className="hm-pathology-back" onClick={closeEditor}>Back to Pathology, Radiology & Neurology Tests</button>{error&&<div className="hm-error">{error}</div>}<DiagnosticTestForm key={editing.id??'new'} priceBranchId={priceBranchId} row={editing} all={all} domain={page} saving={saving} save={saveTest} close={closeEditor}/></section>;
  const columns =
    kind === "test"
      ? [
          "Test Name",
          "Type",
          ...(page==='Pathology'?["Branch"]:[]),
          "Short Name",
          "Category",
          "Parameters",
          ...(page==='Pathology'?["Vaccu"]:[]),
          "Report Days",
          ...(page==='Pathology'?[]:["Charge Name"]),
          "Tax (%)",
          "Standard Charge",
          "Amount",
        ]
      : kind === "parameter"
        ? [
            "Parameter Name",
            "Reference From",
            "Reference To",
            "Unit",
            "Description",
          ]
        : kind === "product"
          ? ["Name", "Type"]
          : kind === "head"
            ? ["Symptoms Head", "Symptoms Type", "Description"]
            : [section];
  function cells(row: RecordRow) {
    const d = dataOf(row);
    const applicableBranches=(all.branch??[]).filter(branch=>!Array.isArray(d.available_branch_ids)||d.available_branch_ids.includes(branch.id));
    const prices=priceBranchId?[labCharges(d,priceBranchId)]:applicableBranches.map(branch=>labCharges(d,String(branch.id)));
    const priceText=(field:'tax'|'standard'|'amount')=>{
      if(!prices.length)return '—';
      const values=prices.map(price=>price[field]),minimum=Math.min(...values),maximum=Math.max(...values);
      const format=(value:number)=>field==='tax'?value.toFixed(2):`₹${value.toLocaleString('en-IN',{maximumFractionDigits:2})}`;
      return minimum===maximum?format(minimum):prices.map((price,index)=>`${String(applicableBranches[index].name)}: ${format(price[field])}`).join('; ');
    };
    if (kind === "test")
      return [
        row.name,
        ["Radiology","Neurology"].includes(String(d.test_type)) ? String(d.test_type) : "Pathology",
        ...(page==='Pathology'?[priceBranchId?all.branch?.find(branch => branch.id === priceBranchId)?.name??'Select branch':applicableBranches.map(branch=>branch.name).join(', ')||'No active branches']:[]),
        d.short_name ?? "—",
        lookup("category", d.category_id),
        Array.isArray(d.parameter_ids) ? d.parameter_ids.length : 0,
        ...(page==='Pathology'?[Array.isArray(d.container_ids)&&d.container_ids.length?d.container_ids.map(id=>lookup('container',id)).join(', '):'Not selected']:[]),
        d.report_days ?? 0,
        ...(page==='Pathology'?[]:[lookup("charge", d.charge_id)]),
        page==='Pathology'?priceText('tax'):Number(d.tax_percentage??0).toFixed(2),
        page==='Pathology'?priceText('standard'):`₹${Number(d.standard_charge??0).toLocaleString('en-IN',{maximumFractionDigits:2})}`,
        page==='Pathology'?priceText('amount'):`₹${Number(d.amount??0).toLocaleString('en-IN',{maximumFractionDigits:2})}`,
      ];
    if (kind === "parameter")
      return [
        row.name,
        d.reference_from || (Array.isArray(d.normal_ranges)?d.normal_ranges.map((range:any)=>`${range.sex&&range.sex!=="0"?range.sex+": ":""}${range.normal_range||[range.value_from,range.value_to].join(" – ")}`).join("; "):"") || "—",
        d.reference_to ?? "—",
        lookup("unit", d.unit_id),
        d.description ?? "—",
      ];
    if (kind === "product") return [row.name, d.type ?? "—"];
    if (kind === "head")
      return [row.name, lookup("type", d.type_id), d.description ?? "—"];
    return [row.name];
  }
  return (
    <section className="hm-page">
      <header className="hm-head">
        <div>
          <small>Clinic Management / {page === "Pathology" ? DIAGNOSTIC_MODULE_NAME : page}</small>
          <h1>{page === "Pathology" ? DIAGNOSTIC_MODULE_NAME : page}</h1>
          <p>Configure {page === "Pathology" ? DIAGNOSTIC_MODULE_NAME : page.toLowerCase()} masters for this clinic.</p>
        </div>
      </header>
      <div className="hm-settings-layout">
        <nav className="hm-settings-menu" aria-label={`${page === "Pathology" ? DIAGNOSTIC_MODULE_NAME : page} sections`}>
          {sections.map((item) => (
            <button
              type="button"
              key={item}
              className={section === item ? "active" : ""}
              onClick={() => {
                setSection(item);
                setSearch("");
                setEditing(null);
              }}
            >
              {item}
            </button>
          ))}
        </nav>
        <section className="hm-settings-panel">
          <header className="hm-charge-head">
            <div>
              <small>{page === "Pathology" ? DIAGNOSTIC_MODULE_NAME : page}</small>
              <h2>{section}</h2>
              <p>Manage {section.toLowerCase()} for this clinic.</p>
            </div>
            <button type="button" onClick={() => openEditor({})}>
              <Plus /> Add {section}
            </button>
          </header>
          {error && <div className="hm-error">{error}</div>}
          {page==='Pathology' && kind==='test' && <div className="hm-test-master-filters">
            <label className="hm-branch-price-select"><span>Prices for branch</span><select aria-label="Branch filter" value={priceBranchId} onChange={event=>setPriceBranchId(event.target.value)}><option value="">All Branches</option>{(all.branch??[]).map(branch=><option key={branch.id} value={branch.id}>{String(branch.name)}</option>)}</select></label>
            <label className="hm-branch-price-select" htmlFor="diagnostic-test-type-filter"><span>Test type</span><select id="diagnostic-test-type-filter" aria-label="Test type" value={testTypeFilter} onChange={event=>setTestTypeFilter(event.target.value)}><option value="">All Types</option><option value="Pathology">Pathology</option><option value="Radiology">Radiology</option><option value="Neurology">Neurology</option></select></label>
          </div>}
          <div className="hm-charge-search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${section.toLowerCase()}...`}
            />
            <span>{filtered.length} records</span>
          </div>
          {loading ? (
            <div className="hm-loading">
              <LoaderCircle className="spin" /> Loading…
            </div>
          ) : (
            <div className="hm-charge-table">
              <table>
                <thead>
                  <tr>
                    {columns.map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.id}>
                      {cells(row).map((cell, i) => (
                        <td key={i}>{String(cell)}</td>
                      ))}
                      <td>
                        <button type="button" onClick={() => openEditor(row)}>
                          <Edit3 />
                        </button>
                        <button
                          type="button"
                          className="delete"
                          onClick={() => removeMaster(row)}
                        >
                          <Trash2 />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <div className="hm-empty">
                  No {section.toLowerCase()} added yet.
                </div>
              )}
            </div>
          )}
      {!loading&&paginated&&<nav className="hm-master-pagination" aria-label="Lab test pages"><span>Showing {filtered.length?(currentPage-1)*50+1:0} to {Math.min(currentPage*50,filtered.length)} of {filtered.length} tests</span><div><button type="button" disabled={currentPage===1} onClick={()=>setListPage(currentPage-1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button type="button" disabled={currentPage===pageCount} onClick={()=>setListPage(currentPage+1)}>Next</button></div></nav>}
        </section>
      </div>
      {editing &&
        (kind === "test" ? (
          <DiagnosticTestForm
            key={editing.id ?? "new"}
            row={editing}
            all={all}
            domain={page}
            saving={saving}
            save={saveTest}
            close={() => setEditing(null)}
          />
        ) : (
          <DiagnosticModal
            kind={kind}
            section={section}
            row={editing}
            all={all}
            saving={saving}
            save={saveMaster}
            close={() => setEditing(null)}
          />
        ))}
    </section>
  );
}

function DiagnosticTestForm({
  row,
  all,
  domain,
  saving,
  save,
  close,
  priceBranchId = "",
}: {
  row: RecordRow;
  all: Record<string, RecordRow[]>;
  domain: string;
  saving: boolean;
  save: (body: { name: string; data: Record<string, unknown> }, savedBranchId?: string) => void;
  close: () => void;
  priceBranchId?: string;
}) {
  const initial = (row.data ?? {}) as Record<string, unknown>;
  const branchOptions=(all.branch??[]).filter(branch=>!Array.isArray(initial.available_branch_ids)||initial.available_branch_ids.includes(branch.id));
  const [testType,setTestType]=useState(["Radiology","Neurology"].includes(String(initial.test_type)) ? String(initial.test_type) : "Pathology");
  const [branchId, setBranchId] = useState(branchOptions.some(branch=>branch.id===priceBranchId)?priceBranchId:String(branchOptions.find(branch=>branch.code==='MAIN')?.id??branchOptions[0]?.id??""));
  const [pricing, setPricing] = useState(initial);
  const branchCharges = labCharges(pricing, branchId);
  function changeBranchCharge(field: 'tax' | 'standard', value: string) {
    const next = { ...branchCharges, [field]: Number(value) };
    const amount = Math.round(next.standard * (1 + next.tax / 100) * 100) / 100;
    setPricing(current => ({ ...current,
      branch_prices: { ...(current.branch_prices as Record<string, number> ?? {}), [branchId]: amount },
      branch_tax_percentages: { ...(current.branch_tax_percentages as Record<string, number> ?? {}), [branchId]: next.tax },
      branch_standard_charges: { ...(current.branch_standard_charges as Record<string, number> ?? {}), [branchId]: next.standard },
    }));
  }
  const [containerIds,setContainerIds]=useState<string[]>(Array.isArray(initial.container_ids)?initial.container_ids as string[]:[]);
  const [parameterIds, setParameterIds] = useState<string[]>(
    Array.isArray(initial.parameter_ids)
      ? (initial.parameter_ids as string[])
      : [],
  );
  const [billingCategoryId, setBillingCategoryId] = useState(
    String(initial.billing_category_id ?? ""),
  );
  const [chargeId, setChargeId] = useState(String(initial.charge_id ?? ""));
  const selectedCharge = (all.charge ?? []).find(
    (item) => item.id === chargeId,
  );
  const chargeData = (selectedCharge?.data ?? {}) as Record<string, unknown>;
  const selectedTax = (all.tax ?? []).find(
    (item) => item.id === chargeData.tax_category_id,
  );
  const taxPercentage = domain==='Pathology' ? branchCharges.tax : Number(
    selectedTax?.percentage ?? selectedCharge?.percentage ?? 0,
  );
  const standardCharge = domain==='Pathology' ? branchCharges.standard : Number(chargeData.standard_charge ?? 0);
  const amount = domain==='Pathology' ? branchCharges.amount : standardCharge + (standardCharge * taxPercentage) / 100;
  const available = (all.parameter ?? []).filter(
    (parameter) => !parameterIds.includes(String(parameter.id)),
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({
      name: String(form.get("name") ?? ""),
      data: {
        ...initial,
        short_name: String(form.get("short_name") ?? ""),
        test_type: String(form.get("test_type") ?? ""),
        category_id: String(form.get("category_id") ?? ""),
        sub_category: String(form.get("sub_category") ?? ""),
        method: String(form.get("method") ?? ""),
        report_days: Number(form.get("report_days") ?? 0),
        description: String(form.get("description") ?? ""),
        billing_category_id: billingCategoryId,
        charge_id: chargeId,
        ...(domain==='Pathology' ? {
          branch_prices: { ...(pricing.branch_prices as Record<string, number> ?? {}), [branchId]: amount },
          branch_tax_percentages: { ...(pricing.branch_tax_percentages as Record<string, number> ?? {}), [branchId]: taxPercentage },
          branch_standard_charges: { ...(pricing.branch_standard_charges as Record<string, number> ?? {}), [branchId]: standardCharge },
          ...(row.id ? {} : {tax_percentage: taxPercentage, standard_charge: standardCharge, amount}),
        } : {tax_percentage: taxPercentage, standard_charge: standardCharge, amount}),
        parameter_ids: parameterIds,
        ...(domain==='Pathology'?{container_ids:containerIds}:{}),
      },
    }, domain==='Pathology' ? branchId : undefined);
  }
  return (
    <form className="hm-pathology-test-form" onSubmit={submit}>
      <header>
        <div>
          <small>{domain === "Pathology" ? DIAGNOSTIC_MODULE_NAME : domain}</small>
          <h2>{row.id ? "Edit" : "Add"} {domain === "Pathology" ? DIAGNOSTIC_MODULE_NAME : domain} Test</h2>
          <p>Create a test and attach its reporting parameters.</p>
        </div>
        <button type="button" onClick={close}>
          <X />
        </button>
      </header>
      <div className="hm-form-grid hm-test-fields">
        <label>
          <span>Test Name *</span>
          <input name="name" required defaultValue={String(row.name ?? "")} />
        </label>
        <label>
          <span>Short Name *</span>
          <input
            name="short_name"
            required
            defaultValue={String(initial.short_name ?? "")}
          />
        </label>
        <label>
          <span>Type *</span>
          <select name="test_type" required value={testType} onChange={event=>setTestType(event.target.value)}>
            <option value="Pathology">Pathology</option>
            <option value="Radiology">Radiology</option><option value="Neurology">Neurology</option>
          </select>
        </label>
        <label>
          <span>Category Name *</span>
          <select
            name="category_id"
            required
            defaultValue={String(initial.category_id ?? "")}
          >
            <option value="">Select Category</option>
            {(all.category ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {String(item.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Sub Category</span>
          <input
            name="sub_category"
            defaultValue={String(initial.sub_category ?? "")}
          />
        </label>
        <label>
          <span>Method</span>
          <input name="method" defaultValue={String(initial.method ?? "")} />
        </label>
        <label>
          <span>Report Days *</span>
          <input
            name="report_days"
            type="number"
            min="0"
            required
            defaultValue={String(initial.report_days ?? 0)}
          />
        </label>
        <label className="wide">
          <span>Description</span>
          <input
            name="description"
            defaultValue={String(initial.description ?? "")}
          />
        </label>
        {domain==='Pathology' && <label><span>Branch *</span><select required value={branchId} onChange={event => setBranchId(event.target.value)}><option value="">Select Branch</option>{branchOptions.map(branch => <option key={branch.id} value={branch.id}>{String(branch.name)}</option>)}</select></label>}
        {domain!=='Pathology' && <><label>
          <span>Charge Category *</span>
          <select
            required
            value={billingCategoryId}
            onChange={(event) => {
              setBillingCategoryId(event.target.value);
              setChargeId("");
            }}
          >
            <option value="">Select Charge Category</option>
            {(all.charge_category ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {String(item.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Charge Name *</span>
          <select
            required
            value={chargeId}
            onChange={(event) => setChargeId(event.target.value)}
          >
            <option value="">Select Charge</option>
            {(all.charge ?? [])
              .filter(
                (item) =>
                  String(
                    ((item.data ?? {}) as Record<string, unknown>)
                      .category_id ?? "",
                  ) === billingCategoryId,
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {String(item.name)}
                </option>
              ))}
          </select>
        </label>
        </>}
        <label>
          <span>Tax (%)</span>
          <input type="number" min="0" max="100" step="0.01" required readOnly={domain!=='Pathology'} value={taxPercentage} onChange={event => changeBranchCharge('tax', event.target.value)} />
        </label>
        <label>
          <span>Standard Charge (₹)</span>
          <input type="number" min="0" step="any" required readOnly={domain!=='Pathology'} value={standardCharge} onChange={event => changeBranchCharge('standard', event.target.value)} />
        </label>
        <label>
          <span>Amount (₹)</span>
          <input readOnly value={amount.toFixed(2)} />
        </label>
      </div>
      {domain==='Pathology' && <p className="hm-branch-price-select">Prices apply to the selected branch. Switch branches to review or edit their rates, then save the test.</p>}
      {domain==='Pathology'&&<section className="hm-test-parameters"><h3>Vaccu</h3><p>Select the collection tubes or containers needed for this test.</p><div className="hm-vaccu-options">{(all.container??[]).map(container=><label key={String(container.id)}><input type="checkbox" checked={containerIds.includes(String(container.id))} onChange={event=>setContainerIds(current=>event.target.checked?[...current,String(container.id)]:current.filter(id=>id!==String(container.id)))}/><span>{String(container.name)}</span></label>)}</div>{!(all.container??[]).length&&<p>Add collection tubes in Vaccu Master first.</p>}</section>}
      <section className="hm-test-parameters">
        <div className="hm-test-parameter-head">
          <div>
            <h3>Test Parameters</h3>
            <p>Add multiple parameters to this pathology test.</p>
          </div>
          <select
            defaultValue=""
            onChange={(event) => {
              const id = event.target.value;
              if (id) setParameterIds((current) => [...current, id]);
              event.target.value = "";
            }}
          >
            <option value="">+ Add Parameter</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {String(item.name)}
              </option>
            ))}
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Parameter Name</th>
              <th>Reference Range</th>
              <th>Unit</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {parameterIds.map((id) => {
              const item = (all.parameter ?? []).find((x) => x.id === id);
              const data = (item?.data ?? {}) as Record<string, unknown>;
              const unit = (all.unit ?? []).find((x) => x.id === data.unit_id);
              return (
                <tr key={id}>
                  <td>{String(item?.name ?? "Unknown parameter")}</td>
                  <td>
                    {Array.isArray(data.normal_ranges)&&data.normal_ranges.length?data.normal_ranges.map((range:any)=>`${range.sex&&range.sex!=="0"?range.sex+": ":""}${range.normal_range||[range.value_from,range.value_to].join(" – ")}`).join("; "):`${String(data.reference_from||"—")} – ${String(data.reference_to||"—")}`}
                  </td>
                  <td>{String(unit?.name ?? "—")}</td>
                  <td>
                    <button
                      type="button"
                      className="delete"
                      onClick={() =>
                        setParameterIds((current) =>
                          current.filter((value) => value !== id),
                        )
                      }
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!parameterIds.length && (
          <div className="hm-empty">No parameters added yet.</div>
        )}
      </section>
      <footer>
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={saving || (testType === "Pathology" && !parameterIds.length)}>
          {saving ? <LoaderCircle className="spin" /> : <Save />} Save Test
        </button>
      </footer>
    </form>
  );
}

function DiagnosticModal({
  kind,
  section,
  row,
  all,
  saving,
  save,
  close,
}: {
  kind: string;
  section: string;
  row: RecordRow;
  all: Record<string, RecordRow[]>;
  saving: boolean;
  save: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return (
    <div className="hm-modal-back">
      <form className="hm-modal hm-charge-modal" onSubmit={save}>
        <header>
          <div>
            <h2>
              {row.id ? "Edit" : "Add"} {section}
            </h2>
            <p>Changes apply only to this clinic.</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div className="hm-form-grid">
          <label>
            <span>{kind === "parameter" ? "Parameter Name" : section} *</span>
            <input name="name" required defaultValue={String(row.name ?? "")} />
          </label>
          {kind === "parameter" && (
            <>
              <label>
                <span>Reference Range From</span>
                <input
                  name="reference_from"
                  defaultValue={String(data.reference_from ?? "")}
                />
              </label>
              <label>
                <span>Reference Range To</span>
                <input
                  name="reference_to"
                  defaultValue={String(data.reference_to ?? "")}
                />
              </label>
              <label>
                <span>Unit</span>
                <select
                  name="unit_id"
                  defaultValue={String(data.unit_id ?? "")}
                >
                  <option value="">Select Unit</option>
                  {(all.unit ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {String(x.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="hm-wide">
                <span>Description</span>
                <textarea
                  name="description"
                  defaultValue={String(data.description ?? "")}
                />
              </label>
              <label><span>Result format</span><select name="result_type_id" defaultValue={String(data.result_type_id||"3")}><option value="1">Numeric</option><option value="2">Choices</option><option value="3">Single line text</option><option value="27">Multiline text</option><option value="0">Subheading</option><option value="5">End subheading</option><option value="6">Calculated formula</option><option value="7">Pad</option><option value="8">Sub parameter</option></select></label>
              <label><span>Decimal places</span><input type="number" name="decimals" min="0" max="8" defaultValue={String(data.decimals||"2")}/></label>
              <label className="hm-wide"><span>Result choices (one per line)</span><textarea name="choices" defaultValue={Array.isArray(data.choices)?data.choices.join("\n"):""}/></label>
              <label className="hm-wide"><span>Calculation formula</span><input name="formula" placeholder="p150 - p27 - p40 / 5" defaultValue={String(data.formula||"")}/></label>
              {Array.isArray(data.normal_ranges)&&data.normal_ranges.length>0&&<div className="hm-wide"><strong>Imported reference rules</strong>{data.normal_ranges.map((range:any,index:number)=><p key={index}>{range.sex||"All"} · Age {range.age_from||"0"}–{range.age_to||"Any"} {range.age_type||"days"} · {range.normal_range||`${range.value_from||""}–${range.value_to||""}`}</p>)}</div>}
            </>
          )}
          {kind === "approver" && ["designation","qualification","registration_number","signature_name"].map(key=><label key={key}><span>{key.replaceAll("_"," ")}</span><input name={key} defaultValue={String(data[key]||"")}/></label>)}
          {kind === "container" && <label><span>Barcode suffix</span><input name="barcode_suffix" defaultValue={String(data.barcode_suffix||"")}/></label>}
          {kind === "product" && (
            <label>
              <span>Type *</span>
              <select
                name="type"
                required
                defaultValue={String(data.type ?? "")}
              >
                <option value="">Select Type</option>
                <option>Blood Group</option>
                <option>Component</option>
              </select>
            </label>
          )}
          {kind === "head" && (
            <>
              <label>
                <span>Symptoms Type *</span>
                <select
                  name="type_id"
                  required
                  defaultValue={String(data.type_id ?? "")}
                >
                  <option value="">Select Symptoms Type</option>
                  {(all.type ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {String(x.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="hm-wide">
                <span>Description</span>
                <textarea
                  name="description"
                  defaultValue={String(data.description ?? "")}
                />
              </label>
            </>
          )}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Save />} Save
          </button>
        </footer>
      </form>
    </div>
  );
}

const pharmacySections = [
  "Medicine Category",
  "Medicine Dosage",
  "Dose Interval",
  "Dose Duration",
  "Unit",
  "Company",
  "Medicine Group",
];
const pharmacyKinds: Record<string, string> = {
  "Medicine Category": "category",
  "Medicine Dosage": "dosage",
  "Dose Interval": "interval",
  "Dose Duration": "duration",
  Unit: "unit",
  Company: "company",
  "Medicine Group": "group",
};
function PharmacySetup({ token }: { token: string }) {
  const [section, setSection] = useState(pharmacySections[0]),
    [all, setAll] = useState<Record<string, RecordRow[]>>({}),
    [editing, setEditing] = useState<RecordRow | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const kind = pharmacyKinds[section],
    rows = all[kind] ?? [];
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const entries = await Promise.all(
        Object.values(pharmacyKinds).map(
          async (k) =>
            [
              k,
              await request<RecordRow[]>(`/pharmacy-masters/${k}`, token),
            ] as const,
        ),
      );
      setAll(Object.fromEntries(entries));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load pharmacy masters",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);
  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  async function savePharmacy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget),
      data: Record<string, unknown> = {};
    [
      "supplier_contact",
      "contact_person_name",
      "contact_person_phone",
      "drug_license_number",
      "address",
      "category_id",
      "unit_id",
    ].forEach((key) => {
      const value = String(form.get(key) ?? "");
      if (value) data[key] = value;
    });
    const dosage = String(form.get("dosage") ?? "");
    const name =
      kind === "dosage"
        ? `${dosage} ${String(all.unit?.find((x) => x.id === data.unit_id)?.name ?? "")}`.trim()
        : String(form.get("name") ?? "");
    if (dosage) data.dosage = dosage;
    try {
      await request(
        `/pharmacy-masters/${kind}${editing?.id ? `/${editing.id}` : ""}`,
        token,
        {
          method: editing?.id ? "PUT" : "POST",
          body: JSON.stringify({ name, data }),
        },
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save record");
    } finally {
      setSaving(false);
    }
  }
  async function removePharmacy(row: RecordRow) {
    if (!row.id || !confirm(`Delete ${row.name}?`)) return;
    try {
      await request(`/pharmacy-masters/${kind}/${row.id}`, token, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete record");
    }
  }
  const dataOf = (row: RecordRow) =>
      (row.data ?? {}) as Record<string, unknown>,
    lookup = (k: string, id: unknown) =>
      String(all[k]?.find((x) => x.id === id)?.name ?? "—");
  const columns =
    kind === "supplier"
      ? [
          "Supplier Name",
          "Contact",
          "Contact Person",
          "Phone",
          "Drug License",
          "Address",
        ]
      : kind === "dosage"
        ? ["Medicine Category", "Dosage", "Unit"]
        : [section];
  function cells(row: RecordRow) {
    const d = dataOf(row);
    if (kind === "supplier")
      return [
        row.name,
        d.supplier_contact ?? "—",
        d.contact_person_name ?? "—",
        d.contact_person_phone ?? "—",
        d.drug_license_number ?? "—",
        d.address ?? "—",
      ];
    if (kind === "dosage")
      return [
        lookup("category", d.category_id),
        d.dosage ?? "—",
        lookup("unit", d.unit_id),
      ];
    return [row.name];
  }
  return (
    <section className="hm-page">
      <header className="hm-head">
        <div>
          <small>Clinic Management / Pharmacy</small>
          <h1>Pharmacy</h1>
          <p>Configure pharmacy masters for this clinic.</p>
        </div>
      </header>
      <div className="hm-settings-layout">
        <nav className="hm-settings-menu" aria-label="Pharmacy sections">
          {pharmacySections.map((item) => (
            <button
              type="button"
              key={item}
              className={section === item ? "active" : ""}
              onClick={() => {
                setSection(item);
                setSearch("");
              }}
            >
              {item}
            </button>
          ))}
        </nav>
        <section className="hm-settings-panel">
          <header className="hm-charge-head">
            <div>
              <small>Pharmacy</small>
              <h2>{section}</h2>
              <p>Manage {section.toLowerCase()} for this clinic.</p>
            </div>
            <button type="button" onClick={() => setEditing({})}>
              <Plus /> Add {section}
            </button>
          </header>
          {error && <div className="hm-error">{error}</div>}
          <div className="hm-charge-search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${section.toLowerCase()}...`}
            />
            <span>{filtered.length} records</span>
          </div>
          {loading ? (
            <div className="hm-loading">
              <LoaderCircle className="spin" /> Loading…
            </div>
          ) : (
            <div className="hm-charge-table">
              <table>
                <thead>
                  <tr>
                    {columns.map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      {cells(row).map((cell, i) => (
                        <td key={i}>{String(cell)}</td>
                      ))}
                      <td>
                        <button type="button" onClick={() => setEditing(row)}>
                          <Edit3 />
                        </button>
                        <button
                          type="button"
                          className="delete"
                          onClick={() => removePharmacy(row)}
                        >
                          <Trash2 />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <div className="hm-empty">
                  No {section.toLowerCase()} added yet.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      {editing && (
        <PharmacyModal
          kind={kind}
          section={section}
          row={editing}
          all={all}
          saving={saving}
          save={savePharmacy}
          close={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function PharmacyModal({
  kind,
  section,
  row,
  all,
  saving,
  save,
  close,
}: {
  kind: string;
  section: string;
  row: RecordRow;
  all: Record<string, RecordRow[]>;
  saving: boolean;
  save: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return (
    <div className="hm-modal-back">
      <form className="hm-modal hm-charge-modal" onSubmit={save}>
        <header>
          <div>
            <h2>
              {row.id ? "Edit" : "Add"} {section}
            </h2>
            <p>Changes apply only to this clinic.</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div className="hm-form-grid">
          {kind === "supplier" ? (
            <>
              <label>
                <span>Supplier Name *</span>
                <input
                  name="name"
                  required
                  defaultValue={String(row.name ?? "")}
                />
              </label>
              <label>
                <span>Supplier Contact</span>
                <input
                  name="supplier_contact"
                  defaultValue={String(data.supplier_contact ?? "")}
                />
              </label>
              <label>
                <span>Contact Person Name</span>
                <input
                  name="contact_person_name"
                  defaultValue={String(data.contact_person_name ?? "")}
                />
              </label>
              <label>
                <span>Contact Person Phone</span>
                <input
                  name="contact_person_phone"
                  defaultValue={String(data.contact_person_phone ?? "")}
                />
              </label>
              <label>
                <span>Drug License Number</span>
                <input
                  name="drug_license_number"
                  defaultValue={String(data.drug_license_number ?? "")}
                />
              </label>
              <label>
                <span>Address</span>
                <input
                  name="address"
                  defaultValue={String(data.address ?? "")}
                />
              </label>
            </>
          ) : kind === "dosage" ? (
            <>
              <label>
                <span>Medicine Category *</span>
                <select
                  name="category_id"
                  required
                  defaultValue={String(data.category_id ?? "")}
                >
                  <option value="">Select Category</option>
                  {(all.category ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {String(x.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Dosage *</span>
                <input
                  name="dosage"
                  required
                  defaultValue={String(data.dosage ?? "")}
                />
              </label>
              <label>
                <span>Unit *</span>
                <select
                  name="unit_id"
                  required
                  defaultValue={String(data.unit_id ?? "")}
                >
                  <option value="">Select Unit</option>
                  {(all.unit ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {String(x.name)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              <span>{section} *</span>
              <input
                name="name"
                required
                defaultValue={String(row.name ?? "")}
              />
            </label>
          )}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Save />} Save
          </button>
        </footer>
      </form>
    </div>
  );
}

const medicineMasterKinds = [
  ["category", "Medicine Category"],
  ["dosage", "Medicine Dosage"],
  ["interval", "Dose Interval"],
  ["duration", "Dose Duration"],
  ["unit", "Unit"],
  ["company", "Company"],
  ["group", "Medicine Group"],
] as const;

export function PharmacyMedicines({ token }: { token: string }) {
  const [section, setSection] = useState("Medicines"),
    [medicines, setMedicines] = useState<RecordRow[]>([]),
    [masters, setMasters] = useState<Record<string, RecordRow[]>>({}),
    [editing, setEditing] = useState<RecordRow | null>(null),
    [bulkOpen, setBulkOpen] = useState(false),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [medicineRows, masterEntries] = await Promise.all([
        request<RecordRow[]>("/pharmacy-masters/medicine", token),
        Promise.all(
          medicineMasterKinds.map(
            async ([kind]) =>
              [
                kind,
                await request<RecordRow[]>(`/pharmacy-masters/${kind}`, token),
              ] as const,
          ),
        ),
      ]);
      setMedicines(medicineRows);
      setMasters(Object.fromEntries(masterEntries));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load medicines");
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);
  const activeKind = medicineMasterKinds.find(
    ([, label]) => label === section,
  )?.[0];
  const activeRows = activeKind ? (masters[activeKind] ?? []) : medicines;
  const filtered = useMemo(
    () =>
      activeRows.filter((row) =>
        JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
      ),
    [activeRows, search],
  );
  const lookup = (kind: string, id: unknown) =>
    String(masters[kind]?.find((row) => row.id === id)?.name ?? "—");
  async function saveMedicine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget),
      data: Record<string, unknown> = {
        ...((editing?.data ?? {}) as Record<string, unknown>),
      };
    for (const kind of ["category", "company", "group", "unit"]) {
      const value = String(form.get(`${kind}_id`) ?? "");
      if (value) data[`${kind}_id`] = value;
      else delete data[`${kind}_id`];
    }
    for (const key of [
      "composition",
      "min_level",
      "reorder_level",
      "tax",
      "hsn_code",
      "box_packing",
      "packing_type",
      "units_per_strip",
      "volume_ml",
      "vat_account",
      "rack_number",
      "note",
    ]) {
      const value = String(form.get(key) ?? "").trim();
      if (value) data[key] = value;
      else delete data[key];
    }
    const photo = form.get("photo");
    try {
      if (photo instanceof File && photo.size) {
        if (!["image/jpeg", "image/png"].includes(photo.type))
          throw new Error("Medicine photo must be JPG, JPEG, or PNG");
        if (photo.size > 2 * 1024 * 1024)
          throw new Error("Medicine photo must be 2 MB or smaller");
        data.photo = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () =>
            reject(new Error("Unable to read medicine photo"));
          reader.readAsDataURL(photo);
        });
      }
      await request(
        `/pharmacy-masters/medicine${editing?.id ? `/${editing.id}` : ""}`,
        token,
        {
          method: editing?.id ? "PUT" : "POST",
          body: JSON.stringify({ name: String(form.get("name") ?? ""), data }),
        },
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save medicine");
    } finally {
      setSaving(false);
    }
  }
  async function saveMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeKind) return;
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget),
      data: Record<string, unknown> = {};
    for (const key of ["category_id", "unit_id"]) {
      const value = String(form.get(key) ?? "");
      if (value) data[key] = value;
    }
    const dosage = String(form.get("dosage") ?? "").trim();
    if (dosage) data.dosage = dosage;
    const name =
      activeKind === "dosage"
        ? `${dosage} ${String(masters.unit?.find((row) => row.id === data.unit_id)?.name ?? "")}`.trim()
        : String(form.get("name") ?? "");
    try {
      await request(
        `/pharmacy-masters/${activeKind}${editing?.id ? `/${editing.id}` : ""}`,
        token,
        {
          method: editing?.id ? "PUT" : "POST",
          body: JSON.stringify({ name, data }),
        },
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save pharmacy record",
      );
    } finally {
      setSaving(false);
    }
  }
  async function remove(row: RecordRow) {
    const kind = activeKind ?? "medicine";
    if (!row.id || !confirm(`Delete ${row.name}?`)) return;
    setError("");
    try {
      await request(`/pharmacy-masters/${kind}/${row.id}`, token, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to delete pharmacy record",
      );
    }
  }
  const dataOf = (row: RecordRow) =>
    (row.data ?? {}) as Record<string, unknown>;
  if (section === "Medicines")
    return (
      <section className="hm-page">
        <header className="hm-head">
          <div>
            <small>Pharmacy / Medicines</small>
            <h1>Pharmacy Medicines</h1>
            <p>Manage medicines and pharmacy master data for this clinic.</p>
          </div>
        </header>
        {error && <div className="hm-error">{error}</div>}
        <div className="hm-settings-layout">
          <nav
            className="hm-settings-menu"
            aria-label="Pharmacy medicine sections"
          >
            {[
              "Medicines",
              ...medicineMasterKinds.map(([, label]) => label),
            ].map((item) => (
              <button
                type="button"
                key={item}
                className={section === item ? "active" : ""}
                onClick={() => {
                  setSection(item);
                  setSearch("");
                  setEditing(null);
                }}
              >
                {item}
              </button>
            ))}
          </nav>
          <section className="hm-settings-panel">
            <header className="hm-charge-head">
              <div>
                <small>Pharmacy</small>
                <h2>Medicines</h2>
                <p>Manage medicines for this clinic.</p>
              </div>
              <div className="medicine-head-actions">
                <button type="button" onClick={() => setBulkOpen(true)}>
                  <Upload /> Bulk Add
                </button>
                <button type="button" onClick={() => setEditing({})}>
                  <Plus /> Add Medicine
                </button>
              </div>
            </header>
            <div className="hm-charge-search">
              <Search />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search medicines..."
              />
              <span>{filtered.length} records</span>
            </div>
            {loading ? (
              <div className="hm-loading">
                <LoaderCircle className="spin" /> Loading...
              </div>
            ) : (
              <div className="hm-charge-table medicine-details-table">
                <table>
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Medicine Name</th>
                      <th>Category</th>
                      <th>Company</th>
                      <th>Composition</th>
                      <th>Group</th>
                      <th>Unit</th>
                      <th>Min Level</th>
                      <th>Re-Order Level</th>
                      <th>Tax</th>
                      <th>HSN/SAC</th>
                      <th>Box/Packing</th>
                      <th>Strip / Volume</th>
                      <th>VAT A/C</th>
                      <th>Rack Number</th>
                      <th>Note</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const data = dataOf(row);
                      return (
                        <tr key={row.id}>
                          <td>
                            {data.photo ? (
                              <img
                                className="medicine-photo"
                                src={String(data.photo)}
                                alt={String(row.name)}
                              />
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td>
                            <strong>{String(row.name)}</strong>
                          </td>
                          <td>{lookup("category", data.category_id)}</td>
                          <td>{lookup("company", data.company_id)}</td>
                          <td>{String(data.composition ?? "—")}</td>
                          <td>{lookup("group", data.group_id)}</td>
                          <td>{lookup("unit", data.unit_id)}</td>
                          <td>{String(data.min_level ?? "—")}</td>
                          <td>{String(data.reorder_level ?? "—")}</td>
                          <td>
                            {data.tax !== undefined
                              ? `${String(data.tax)}%`
                              : "—"}
                          </td>
                          <td>{String(data.hsn_code ?? "—")}</td>
                          <td>{String(data.box_packing ?? "—")}</td>
                          <td>{data.packing_type === "Strip" ? `${String(data.units_per_strip ?? "—")} / strip` : data.packing_type === "Syrup/Bottle" ? `${String(data.volume_ml ?? "—")} ml` : String(data.packing_type ?? "—")}</td>
                          <td>{String(data.vat_account ?? "—")}</td>
                          <td>{String(data.rack_number ?? "—")}</td>
                          <td className="medicine-note">
                            {String(data.note ?? "—")}
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => setEditing(row)}
                            >
                              <Edit3 />
                            </button>
                            <button
                              type="button"
                              className="delete"
                              onClick={() => remove(row)}
                            >
                              <Trash2 />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="hm-empty">No medicines added yet.</div>
                )}
              </div>
            )}
          </section>
        </div>
        {editing && (
          <MedicineModal
            row={editing}
            masters={masters}
            saving={saving}
            save={saveMedicine}
            close={() => setEditing(null)}
          />
        )}
        {bulkOpen && (
          <BulkMedicineModal
            token={token}
            masters={masters}
            close={() => setBulkOpen(false)}
            completed={load}
          />
        )}
      </section>
    );
  if (section) {
    const isMedicine = section === "Medicines";
    return (
      <section className="hm-page">
        <header className="hm-head">
          <div>
            <small>Pharmacy / Medicines</small>
            <h1>Pharmacy Medicines</h1>
            <p>Manage medicines and pharmacy master data for this clinic.</p>
          </div>
        </header>
        {error && <div className="hm-error">{error}</div>}
        <div className="hm-settings-layout">
          <nav
            className="hm-settings-menu"
            aria-label="Pharmacy medicine sections"
          >
            {[
              "Medicines",
              ...medicineMasterKinds.map(([, label]) => label),
            ].map((item) => (
              <button
                type="button"
                key={item}
                className={section === item ? "active" : ""}
                onClick={() => {
                  setSection(item);
                  setSearch("");
                  setEditing(null);
                }}
              >
                {item}
              </button>
            ))}
          </nav>
          <section className="hm-settings-panel">
            <header className="hm-charge-head">
              <div>
                <small>Pharmacy</small>
                <h2>{section}</h2>
                <p>Manage {section.toLowerCase()} for this clinic.</p>
              </div>
              <button type="button" onClick={() => setEditing({})}>
                <Plus /> Add {isMedicine ? "Medicine" : section}
              </button>
            </header>
            <div className="hm-charge-search">
              <Search />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${section.toLowerCase()}...`}
              />
              <span>{filtered.length} records</span>
            </div>
            {loading ? (
              <div className="hm-loading">
                <LoaderCircle className="spin" /> Loading...
              </div>
            ) : !isMedicine ? (
              <div className="hm-charge-table">
                <table>
                  <thead>
                    <tr>
                      {activeKind === "dosage" && <th>Medicine Category</th>}
                      <th>{section}</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id}>
                        {activeKind === "dosage" && (
                          <td>{lookup("category", dataOf(row).category_id)}</td>
                        )}
                        <td>{String(row.name)}</td>
                        <td>
                          <button type="button" onClick={() => setEditing(row)}>
                            <Edit3 />
                          </button>
                          <button
                            type="button"
                            className="delete"
                            onClick={() => remove(row)}
                          >
                            <Trash2 />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="hm-empty">
                    No {section.toLowerCase()} configured yet.
                  </div>
                )}
              </div>
            ) : (
              <div className="hm-charge-table">
                <table>
                  <thead>
                    <tr>
                      <th>Medicine Name</th>
                      <th>Generic Name</th>
                      <th>Category</th>
                      <th>Dosage</th>
                      <th>Unit</th>
                      <th>Company</th>
                      <th>Group</th>
                      <th>Interval</th>
                      <th>Duration</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const data = dataOf(row);
                      return (
                        <tr key={row.id}>
                          <td>
                            <strong>{String(row.name)}</strong>
                          </td>
                          <td>{String(data.generic_name ?? "—")}</td>
                          <td>{lookup("category", data.category_id)}</td>
                          <td>{lookup("dosage", data.dosage_id)}</td>
                          <td>{lookup("unit", data.unit_id)}</td>
                          <td>{lookup("company", data.company_id)}</td>
                          <td>{lookup("group", data.group_id)}</td>
                          <td>{lookup("interval", data.interval_id)}</td>
                          <td>{lookup("duration", data.duration_id)}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => setEditing(row)}
                            >
                              <Edit3 />
                            </button>
                            <button
                              type="button"
                              className="delete"
                              onClick={() => remove(row)}
                            >
                              <Trash2 />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="hm-empty">No medicines added yet.</div>
                )}
              </div>
            )}
          </section>
        </div>
        {editing &&
          (isMedicine ? (
            <MedicineModal
              row={editing}
              masters={masters}
              saving={saving}
              save={saveMedicine}
              close={() => setEditing(null)}
            />
          ) : (
            <PharmacyModal
              kind={activeKind!}
              section={section}
              row={editing}
              all={masters}
              saving={saving}
              save={saveMaster}
              close={() => setEditing(null)}
            />
          ))}
      </section>
    );
  }
  return (
    <section className="hm-page">
      <header className="hm-head">
        <div>
          <small>Pharmacy / Medicines</small>
          <h1>Pharmacy Medicines</h1>
          <p>View clinic-configured pharmacy masters and manage medicines.</p>
        </div>
      </header>
      {error && <div className="hm-error">{error}</div>}
      <div className="hm-settings-layout">
        <nav
          className="hm-settings-menu"
          aria-label="Pharmacy medicine sections"
        >
          {["Medicines", ...medicineMasterKinds.map(([, label]) => label)].map(
            (item) => (
              <button
                type="button"
                key={item}
                className={section === item ? "active" : ""}
                onClick={() => {
                  setSection(item);
                  setSearch("");
                }}
              >
                {item}
              </button>
            ),
          )}
        </nav>
        <section className="hm-settings-panel">
          <header className="hm-charge-head">
            <div>
              <small>Pharmacy</small>
              <h2>{section}</h2>
              <p>
                {section === "Medicines"
                  ? "Manage medicines for this clinic."
                  : `Clinic Admin configured ${section.toLowerCase()}.`}
              </p>
            </div>
            {section === "Medicines" && (
              <button type="button" onClick={() => setEditing({})}>
                <Plus /> Add Medicine
              </button>
            )}
          </header>
          <div className="hm-charge-search">
            <Search />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${section.toLowerCase()}...`}
            />
            <span>{filtered.length} records</span>
          </div>
          {loading ? (
            <div className="hm-loading">
              <LoaderCircle className="spin" /> Loading…
            </div>
          ) : section !== "Medicines" ? (
            <div className="hm-charge-table">
              <table>
                <thead>
                  <tr>
                    <th>{section}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>{String(row.name)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <div className="hm-empty">
                  No {section.toLowerCase()} configured yet.
                </div>
              )}
            </div>
          ) : (
            <div className="hm-charge-table">
              <table>
                <thead>
                  <tr>
                    <th>Medicine Name</th>
                    <th>Generic Name</th>
                    <th>Category</th>
                    <th>Dosage</th>
                    <th>Unit</th>
                    <th>Company</th>
                    <th>Group</th>
                    <th>Interval</th>
                    <th>Duration</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const data = dataOf(row);
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{String(row.name)}</strong>
                        </td>
                        <td>{String(data.generic_name ?? "—")}</td>
                        <td>{lookup("category", data.category_id)}</td>
                        <td>{lookup("dosage", data.dosage_id)}</td>
                        <td>{lookup("unit", data.unit_id)}</td>
                        <td>{lookup("company", data.company_id)}</td>
                        <td>{lookup("group", data.group_id)}</td>
                        <td>{lookup("interval", data.interval_id)}</td>
                        <td>{lookup("duration", data.duration_id)}</td>
                        <td>
                          <button type="button" onClick={() => setEditing(row)}>
                            <Edit3 />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filtered.length && (
                <div className="hm-empty">No medicines added yet.</div>
              )}
            </div>
          )}
        </section>
      </div>
      {editing && (
        <MedicineModal
          row={editing}
          masters={masters}
          saving={saving}
          save={saveMedicine}
          close={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function MedicineModal({
  row,
  masters,
  saving,
  save,
  close,
}: {
  row: RecordRow;
  masters: Record<string, RecordRow[]>;
  saving: boolean;
  save: (event: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const data = (row.data ?? {}) as Record<string, unknown>,
    select = (kind: string, label: string, required = false) => (
      <label>
        <span>
          {label}
          {required ? " *" : ""}
        </span>
        <select
          name={`${kind}_id`}
          required={required}
          defaultValue={String(data[`${kind}_id`] ?? "")}
        >
          <option value="">Select</option>
          {(masters[kind] ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {String(option.name)}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <div className="hm-modal-back">
      <form className="hm-modal hm-charge-modal medicine-modal" onSubmit={save}>
        <header>
          <div>
            <h2>{row.id ? "Edit" : "Add"} Medicine</h2>
            <p>Medicine details apply only to this clinic.</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div className="hm-form-grid medicine-form-grid">
          <label>
            <span>Medicine Name *</span>
            <input name="name" required defaultValue={String(row.name ?? "")} />
          </label>
          {select("category", "Medicine Category", true)}
          {select("company", "Medicine Company")}
          <label>
            <span>Medicine Composition</span>
            <input
              name="composition"
              defaultValue={String(data.composition ?? "")}
            />
          </label>
          {select("group", "Medicine Group")}
          {select("unit", "Unit", true)}
          <label>
            <span>Min Level</span>
            <input
              name="min_level"
              type="number"
              min="0"
              defaultValue={String(data.min_level ?? "")}
            />
          </label>
          <label>
            <span>Re-Order Level</span>
            <input
              name="reorder_level"
              type="number"
              min="0"
              defaultValue={String(data.reorder_level ?? "")}
            />
          </label>
          <label>
            <span>Tax (%)</span>
            <input
              name="tax"
              type="number"
              min="0"
              step="0.01"
              defaultValue={String(data.tax ?? "")}
            />
          </label>
          <label>
            <span>Box/Packing *</span>
            <input
              name="box_packing"
              required
              defaultValue={String(data.box_packing ?? "")}
            />
          </label>
          <label>
            <span>Packing Type *</span>
            <select name="packing_type" required defaultValue={String(data.packing_type ?? "Box")}>
              <option>Box</option><option>Strip</option><option>Syrup/Bottle</option><option>Vial</option><option>Ampoule</option><option>Tube</option><option>Sachet</option><option>Loose</option>
            </select>
          </label>
          <label>
            <span>Medicines per Strip</span>
            <input name="units_per_strip" type="number" min="1" step="1" defaultValue={String(data.units_per_strip ?? "")} placeholder="e.g. 10" />
          </label>
          <label>
            <span>Syrup / Bottle Volume (ml)</span>
            <input name="volume_ml" type="number" min="0" step="0.01" defaultValue={String(data.volume_ml ?? "")} placeholder="e.g. 100 or 200" />
          </label>
          <label>
            <span>HSN/SAC Code</span>
            <input name="hsn_code" inputMode="numeric" defaultValue={String(data.hsn_code ?? "")} placeholder="e.g. 300490" />
          </label>
          <label>
            <span>VAT A/C</span>
            <input
              name="vat_account"
              defaultValue={String(data.vat_account ?? "")}
            />
          </label>
          <label>
            <span>Rack Number</span>
            <input
              name="rack_number"
              defaultValue={String(data.rack_number ?? "")}
            />
          </label>
          <label className="hm-wide">
            <span>Note</span>
            <textarea name="note" defaultValue={String(data.note ?? "")} />
          </label>
          <label className="hm-wide">
            <span>Medicine Photo (JPG | JPEG | PNG)</span>
            <input
              name="photo"
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            />
            {Boolean(data.photo) && (
              <small>
                Current photo will be kept unless a new file is selected.
              </small>
            )}
          </label>
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Save />} Save
            Medicine
          </button>
        </footer>
      </form>
    </div>
  );
}

const medicineCsvHeaders = [
  "medicine_name",
  "medicine_category",
  "medicine_company",
  "medicine_composition",
  "medicine_group",
  "unit",
  "min_level",
  "reorder_level",
  "tax",
  "box_packing",
  "vat_account",
  "rack_number",
  "note",
];
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function BulkMedicineModal({
  token,
  masters,
  close,
  completed,
}: {
  token: string;
  masters: Record<string, RecordRow[]>;
  close: () => void;
  completed: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [importing, setImporting] = useState(false),
    [result, setResult] = useState(""),
    [issues, setIssues] = useState<string[]>([]);
  function downloadSample() {
    const sample = [
        medicineCsvHeaders,
        [
          "Paracetamol 500mg",
          "Tablet",
          "MediCare Pharma",
          "Paracetamol 500 mg",
          "Analgesics",
          "Tablet",
          "10",
          "20",
          "5",
          "10 strips x 10 tablets",
          "Input VAT",
          "A-12",
          "Store below 25 C",
        ],
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n"),
      blob = new Blob([sample], { type: "text/csv;charset=utf-8" }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "medicine_bulk_import_sample.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function upload() {
    if (!file) return;
    setImporting(true);
    setResult("");
    setIssues([]);
    try {
      const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
      if (rows.length < 2)
        throw new Error(
          "CSV must contain a header and at least one medicine row",
        );
      const headers = rows[0].map((value) =>
          value
            .toLowerCase()
            .trim()
            .replace(/[\s-]+/g, "_"),
        ),
        missing = medicineCsvHeaders.filter(
          (header) => !headers.includes(header),
        );
      if (missing.length)
        throw new Error(`Missing columns: ${missing.join(", ")}`);
      const index = Object.fromEntries(
          headers.map((header, column) => [header, column]),
        ),
        find = (kind: string, name: string) =>
          masters[kind]?.find(
            (item) =>
              String(item.name).trim().toLowerCase() ===
              name.trim().toLowerCase(),
          )?.id;
      let imported = 0;
      const errors: string[] = [];
      for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex],
          get = (header: string) => String(row[index[header]] ?? "").trim(),
          name = get("medicine_name"),
          category = get("medicine_category"),
          unit = get("unit"),
          boxPacking = get("box_packing");
        if (!name || !category || !unit || !boxPacking) {
          errors.push(
            `Row ${rowIndex + 1}: medicine_name, medicine_category, unit, and box_packing are required`,
          );
          continue;
        }
        const categoryId = find("category", category),
          unitId = find("unit", unit),
          company = get("medicine_company"),
          group = get("medicine_group"),
          companyId = company ? find("company", company) : undefined,
          groupId = group ? find("group", group) : undefined;
        if (
          !categoryId ||
          !unitId ||
          (company && !companyId) ||
          (group && !groupId)
        ) {
          errors.push(
            `Row ${rowIndex + 1}: one or more master names do not match this clinic`,
          );
          continue;
        }
        const data: Record<string, unknown> = {
          category_id: categoryId,
          unit_id: unitId,
          box_packing: boxPacking,
        };
        if (companyId) data.company_id = companyId;
        if (groupId) data.group_id = groupId;
        for (const [header, key] of [
          ["medicine_composition", "composition"],
          ["min_level", "min_level"],
          ["reorder_level", "reorder_level"],
          ["tax", "tax"],
          ["vat_account", "vat_account"],
          ["rack_number", "rack_number"],
          ["note", "note"],
        ] as const) {
          const value = get(header);
          if (value) data[key] = value;
        }
        try {
          await request("/pharmacy-masters/medicine", token, {
            method: "POST",
            body: JSON.stringify({ name, data }),
          });
          imported++;
        } catch (error) {
          errors.push(
            `Row ${rowIndex + 1} (${name}): ${error instanceof Error ? error.message : "Import failed"}`,
          );
        }
      }
      setResult(
        `${imported} medicine${imported === 1 ? "" : "s"} imported successfully.`,
      );
      setIssues(errors);
      if (imported) await completed();
    } catch (error) {
      setIssues([
        error instanceof Error ? error.message : "Unable to import CSV",
      ]);
    } finally {
      setImporting(false);
    }
  }
  return (
    <div className="hm-modal-back">
      <section className="hm-modal bulk-medicine-modal">
        <header>
          <div>
            <h2>Bulk Add Medicines</h2>
            <p>
              Upload medicines from CSV using clinic master names exactly as
              configured.
            </p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div className="bulk-medicine-body">
          <button
            className="bulk-sample"
            type="button"
            onClick={downloadSample}
          >
            <Download /> Download Sample CSV
          </button>
          <label className="bulk-file">
            <Upload />
            <span>{file ? file.name : "Choose a CSV file"}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setResult("");
                setIssues([]);
              }}
            />
          </label>
          <small>
            Required columns: medicine_name, medicine_category, unit,
            box_packing. Category, Company, Group and Unit values must match
            this clinic's master data.
          </small>
          {result && <div className="bulk-success">{result}</div>}
          {issues.length > 0 && (
            <div className="bulk-errors">
              <strong>
                {issues.length} issue{issues.length === 1 ? "" : "s"}
              </strong>
              {issues.slice(0, 20).map((issue, index) => (
                <span key={index}>{issue}</span>
              ))}
              {issues.length > 20 && (
                <span>And {issues.length - 20} more...</span>
              )}
            </div>
          )}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Close
          </button>
          <button
            className="primary"
            type="button"
            disabled={!file || importing}
            onClick={upload}
          >
            {importing ? <LoaderCircle className="spin" /> : <Upload />}
            {importing ? " Importing..." : " Upload & Import"}
          </button>
        </footer>
      </section>
    </div>
  );
}

const operationSections = ["Operation Name", "Category"];
function OperationsSetup({ token }: { token: string }) {
  const [section, setSection] = useState(operationSections[0]),
    [operations, setOperations] = useState<RecordRow[]>([]),
    [categories, setCategories] = useState<RecordRow[]>([]),
    [editing, setEditing] = useState<RecordRow | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const kind = section === "Category" ? "category" : "operation",
    rows = kind === "category" ? categories : operations;
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ops, cats] = await Promise.all([
        request<RecordRow[]>("/operation-masters/operation", token),
        request<RecordRow[]>("/operation-masters/category", token),
      ]);
      setOperations(ops);
      setCategories(cats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load operations");
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);
  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  async function saveOperation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget),
      body = {
        name: String(form.get("name") ?? ""),
        category_id:
          kind === "operation" ? String(form.get("category_id") ?? "") : null,
      };
    try {
      await request(
        `/operation-masters/${kind}${editing?.id ? `/${editing.id}` : ""}`,
        token,
        { method: editing?.id ? "PUT" : "POST", body: JSON.stringify(body) },
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save record");
    } finally {
      setSaving(false);
    }
  }
  async function removeOperation(row: RecordRow) {
    if (!row.id || !confirm(`Delete ${row.name}?`)) return;
    try {
      await request(`/operation-masters/${kind}/${row.id}`, token, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete record");
    }
  }
  return (
    <section className="hm-page">
      <header className="hm-head">
        <div>
          <small>Clinic Management / Operations</small>
          <h1>Operations</h1>
          <p>Manage operation names and categories for this clinic.</p>
        </div>
      </header>
      <div className="hm-settings-layout">
        <nav className="hm-settings-menu" aria-label="Operation sections">
          {operationSections.map((item) => (
            <button
              type="button"
              key={item}
              className={section === item ? "active" : ""}
              onClick={() => {
                setSection(item);
                setSearch("");
              }}
            >
              {item}
            </button>
          ))}
        </nav>
        <section className="hm-settings-panel">
          <header className="hm-charge-head">
            <div>
              <small>Operations</small>
              <h2>{section}</h2>
              <p>Manage {section.toLowerCase()} for this clinic.</p>
            </div>
            <button type="button" onClick={() => setEditing({})}>
              <Plus /> Add {section}
            </button>
          </header>
          {error && <div className="hm-error">{error}</div>}
          <div className="hm-charge-search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${section.toLowerCase()}...`}
            />
            <span>{filtered.length} records</span>
          </div>
          {loading ? (
            <div className="hm-loading">
              <LoaderCircle className="spin" /> Loading…
            </div>
          ) : (
            <div className="hm-charge-table">
              <table>
                <thead>
                  <tr>
                    <th>{section}</th>
                    {kind === "operation" && <th>Category</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>{String(row.name)}</td>
                      {kind === "operation" && (
                        <td>{String(row.category_name ?? "—")}</td>
                      )}
                      <td>
                        <button type="button" onClick={() => setEditing(row)}>
                          <Edit3 />
                        </button>
                        <button
                          type="button"
                          className="delete"
                          onClick={() => removeOperation(row)}
                        >
                          <Trash2 />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <div className="hm-empty">
                  No {section.toLowerCase()} added yet.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      {editing && (
        <div className="hm-modal-back">
          <form className="hm-modal hm-charge-modal" onSubmit={saveOperation}>
            <header>
              <div>
                <h2>
                  {editing.id ? "Edit" : "Add"} {section}
                </h2>
                <p>Changes apply only to this clinic.</p>
              </div>
              <button type="button" onClick={() => setEditing(null)}>
                <X />
              </button>
            </header>
            <div className="hm-form-grid">
              <label>
                <span>{section} *</span>
                <input
                  name="name"
                  required
                  defaultValue={String(editing.name ?? "")}
                />
              </label>
              {kind === "operation" && (
                <label>
                  <span>Category *</span>
                  <select
                    name="category_id"
                    required
                    defaultValue={String(editing.category_id ?? "")}
                  >
                    <option value="">Select Category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {String(category.name)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <footer>
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="primary" disabled={saving}>
                {saving ? <LoaderCircle className="spin" /> : <Save />} Save
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}

const printSections = [
  "Appointment",
  "OPD Prescription",
  "OPD Bill",
  "IPD Prescription",
  "IPD Bill",
  "Bill Summary",
  "Pharmacy Bill",
  "Payslip",
  "Payment Receipt",
  "Birth Record",
  "Death Record",
  "Pathology",
  "Radiology",
  "Blood Bank",
  "Ambulance",
  "Discharge Card",
];
function PrintHeaderFooterSetup({ token }: { token: string }) {
  const [section, setSection] = useState(printSections[0]);
  return (
    <section className="hm-page">
      <header className="hm-head">
        <div>
          <small>Clinic Management / Print Header Footer</small>
          <h1>Print Header Footer</h1>
          <p>Configure document headers and footers for this clinic.</p>
        </div>
      </header>
      <div className="hm-settings-layout">
        <nav
          className="hm-settings-menu hm-print-menu"
          aria-label="Print header footer sections"
        >
          {printSections.map((item) => (
            <button
              type="button"
              key={item}
              className={section === item ? "active" : ""}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <section className="hm-settings-panel">
          <header>
            <small>Print Header Footer</small>
            <h2>{section} Header Footer</h2>
            <p>
              Configure the print header and footer for {section.toLowerCase()}.
            </p>
          </header>
          <PrintTemplateEditor key={section} section={section} token={token} />
        </section>
      </div>
    </section>
  );
}

function PrintTemplateEditor({
  section,
  token,
}: {
  section: string;
  token: string;
}) {
  const documentKey = section.toLowerCase().replaceAll(" ", "-");
  const [headerImage, setHeaderImage] = useState(""),
    [footerMode,setFooterMode]=useState<"text"|"image">("text"),
    [footerImage,setFooterImage]=useState(""),
    [cropping,setCropping]=useState<{source:string;target:"header"|"footer"}|null>(null),
    [footerContent, setFooterContent] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    request<RecordRow>(`/print-templates/${documentKey}`, token)
      .then((row) => {
        if (live) {
          setHeaderImage(String(row.header_image ?? ""));
          setFooterContent(String(row.footer_content ?? ""));
          const footer=document.createElement("div");footer.innerHTML=String(row.footer_content??"");
          const saved=footer.querySelector<HTMLImageElement>('[data-print-footer="image"] img');
          if(saved){setFooterImage(saved.getAttribute("src")||"");setFooterMode("image");setFooterContent("");}
        }
      })
      .catch((e) => {
        if (live)
          setMessage(
            e instanceof Error ? e.message : "Unable to load template",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [documentKey, token]);
  function acceptFile(file?: File,target:"header"|"footer"="header") {
    if (!file) return;
    if (!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>15_000_000) {
      setMessage("Choose a PNG, JPG or WEBP image up to 15 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {setMessage("");setCropping({source:String(reader.result??""),target});};
    reader.onerror=()=>setMessage("Unable to read image. Please try another file.");
    reader.readAsDataURL(file);
  }
  async function saveTemplate() {
    setSaving(true);
    setMessage("");
    try {
      await request(`/print-templates/${documentKey}`, token, {
        method: "PUT",
        body: JSON.stringify({
          header_image: headerImage,
          footer_content: footerMode==="image"?(footerImage?footerImageHtml(footerImage):""):footerContent,
        }),
      });
      setMessage(`${section} header and footer saved.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save template");
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <div className="hm-loading">
        <LoaderCircle className="spin" /> Loading template…
      </div>
    );
  return (
    <div className="hm-print-editor">
      {message && (
        <div className={message.includes("saved") ? "hm-success" : "hm-error"}>
          {message}
        </div>
      )}
      <label className="hm-print-label">
        Header Image <small>{documentKey==='pathology'?'(A5 landscape bills: 196 mm printable width; recommended image width 2315 px at 300 DPI)':'(recommended 2230 x 300 px)'}</small>
      </label>
      <label
        className="hm-print-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          acceptFile(e.dataTransfer.files?.[0]);
        }}
      >
        {headerImage ? (
          <img src={headerImage} alt={`${section} header`} />
        ) : (
          <>
            <Upload />
            <strong>Drop a file here or click to upload</strong>
            <span>PNG, JPG or WEBP</span>
          </>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {acceptFile(e.target.files?.[0]);e.target.value="";}}
        />
      </label>
      {headerImage && (
        <button type="button" onClick={()=>setCropping({source:headerImage,target:"header"})}>Crop header image</button>
      )}
      {headerImage && (
        <button
          type="button"
          className="hm-remove-image"
          onClick={() => setHeaderImage("")}
        >
          <Trash2 /> Remove header image
        </button>
      )}
      <label className="hm-print-label" htmlFor={`footer-${documentKey}`}>
        Footer Content
      </label>
      <div className="hm-footer-mode" role="group" aria-label="Footer type"><button type="button" aria-pressed={footerMode==="text"} onClick={()=>setFooterMode("text")}>Text / rich text</button><button type="button" aria-pressed={footerMode==="image"} onClick={()=>setFooterMode("image")}>Upload image</button></div>
      {footerMode==="image"?<><label className="hm-print-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();acceptFile(e.dataTransfer.files[0],"footer");}}>{footerImage?<img src={footerImage} alt={`${section} footer`}/>:<><Upload/><strong>Upload footer image</strong><span>PNG, JPG or WEBP — crop before saving</span></>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{acceptFile(e.target.files?.[0],"footer");e.target.value="";}}/></label>{footerImage&&<div className="hm-footer-mode"><button type="button" onClick={()=>setCropping({source:footerImage,target:"footer"})}>Crop footer image</button><button type="button" onClick={()=>setFooterImage("")}>Remove footer image</button></div>}</>:<RichTextEditor
        id={`footer-${documentKey}`}
        value={footerContent}
        onChange={setFooterContent}
      />}
      {documentKey==='pathology'&&<p className="hm-print-size-note">Lab bills and receipts print on A5 landscape paper (210 x 148 mm). Header and footer images fill the 196 mm printable width. Their heights follow the image proportions. Upload separate header and footer strips; the remaining space is used for patient and billing details. The same template is also used on pathology reports.</p>}
      {cropping&&<PrintImageCrop printHint={documentKey==='pathology'?`A5 landscape bill: 210 x 148 mm. This ${cropping.target} prints at 196 mm wide, with its height determined by the cropped image proportions. Crop the artwork strip, not a full A5 page.`:undefined} source={cropping.source} onClose={()=>setCropping(null)} onApply={image=>{if(cropping.target==="header")setHeaderImage(image);else setFooterImage(image);setCropping(null);}}/>}
      <div className="hm-print-actions">
        <button type="button" onClick={saveTemplate} disabled={saving||!!cropping}>
          {saving ? <LoaderCircle className="spin" /> : <Save />}{" "}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function RichTextEditor({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    [source, setSource] = useState(false);
  function command(name: string, commandValue?: string) {
    editor.current?.focus();
    document.execCommand(name, false, commandValue);
    onChange(editor.current?.innerHTML ?? "");
  }
  function addLink() {
    const url = prompt("Enter link URL");
    if (url) command("createLink", url);
  }
  function addImage(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => command("insertImage", String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }
  const button = (label: string, cmd: string, val?: string, title?: string) => (
    <button
      type="button"
      title={title ?? label}
      onMouseDown={(e) => {
        e.preventDefault();
        command(cmd, val);
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="hm-rich-editor">
      <div className="hm-rich-toolbar">
        <button
          type="button"
          className={source ? "active" : ""}
          onClick={() => setSource((x) => !x)}
        >
          &lt;/&gt; Source
        </button>
        <select
          aria-label="Style"
          onChange={(e) => command("formatBlock", e.target.value)}
          defaultValue="p"
        >
          <option value="p">Normal</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="blockquote">Quote</option>
        </select>
        <select
          aria-label="Font"
          onChange={(e) => command("fontName", e.target.value)}
          defaultValue="Arial"
        >
          <option>Arial</option>
          <option>Georgia</option>
          <option>Times New Roman</option>
          <option>Verdana</option>
        </select>
        <select
          aria-label="Size"
          onChange={(e) => command("fontSize", e.target.value)}
          defaultValue="3"
        >
          <option value="1">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="7">Extra Large</option>
        </select>
        {button("B", "bold", undefined, "Bold")}
        {button("I", "italic", undefined, "Italic")}
        {button("U", "underline", undefined, "Underline")}
        {button("S", "strikeThrough", undefined, "Strikethrough")}
        {button("x₂", "subscript", undefined, "Subscript")}
        {button("x²", "superscript", undefined, "Superscript")}
        {button("• List", "insertUnorderedList")}
        {button("1. List", "insertOrderedList")}
        {button("←", "outdent", undefined, "Outdent")}
        {button("→", "indent", undefined, "Indent")}
        {button("L", "justifyLeft", undefined, "Align left")}
        {button("C", "justifyCenter", undefined, "Align center")}
        {button("R", "justifyRight", undefined, "Align right")}
        {button("J", "justifyFull", undefined, "Justify")}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            addLink();
          }}
        >
          Link
        </button>
        {button("Unlink", "unlink")}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            imageInput.current?.click();
          }}
        >
          Image
        </button>
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => addImage(e.target.files?.[0])}
        />
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            command(
              "insertHTML",
              "<table><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table>",
            );
          }}
        >
          Table
        </button>
        {button("↶", "undo", undefined, "Undo")}
        {button("↷", "redo", undefined, "Redo")}
        {button("Clear", "removeFormat")}
      </div>
      {source ? (
        <textarea
          id={id}
          className="hm-footer-editor hm-source-editor"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div
          id={id}
          ref={editor}
          className="hm-footer-editor"
          contentEditable
          suppressContentEditableWarning
          dangerouslySetInnerHTML={{ __html: value }}
          onInput={(e) => onChange(e.currentTarget.innerHTML)}
          data-placeholder="Enter footer content shown on printed documents…"
        />
      )}
    </div>
  );
}

const chargeSections = [
  "Charges",
  "Charge Category",
  "Charge Type",
  "Tax Category",
  "Unit Type",
];
const chargeKinds: Record<string, string> = {
  Charges: "charge",
  "Charge Category": "category",
  "Charge Type": "type",
  "Tax Category": "tax",
  "Unit Type": "unit",
};
const chargeModules = [
  "Appointment",
  "OPD",
  "IPD",
  "Pathology",
  "Radiology",
  "Blood Bank",
  "Ambulance",
  "Procedures",
  "Investigations",
  "Supplier",
  "Operations",
  "Others",
];
function HospitalChargesSetup({ token }: { token: string }) {
  const [section, setSection] = useState(chargeSections[0]),
    [rows, setRows] = useState<RecordRow[]>([]),
    [all, setAll] = useState<Record<string, RecordRow[]>>({});
  const [editing, setEditing] = useState<RecordRow | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const kind = chargeKinds[section];
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const entries = await Promise.all(
        Object.values(chargeKinds).map(
          async (k) =>
            [
              k,
              await request<RecordRow[]>(`/charge-masters/${k}`, token),
            ] as const,
        ),
      );
      const values = Object.fromEntries(entries);
      setAll(values);
      setRows(values[kind] ?? []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load clinic charges",
      );
    } finally {
      setLoading(false);
    }
  }, [kind, token]);
  useEffect(() => {
    load();
  }, [load]);
  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget),
      name = String(form.get("name") ?? "").trim();
    const modules = chargeModules.filter((x) =>
      form.getAll("modules").includes(x),
    );
    const data: Record<string, unknown> = {};
    [
      "charge_type_id",
      "category_id",
      "unit_type_id",
      "tax_category_id",
      "standard_charge",
      "description",
    ].forEach((k) => {
      const v = String(form.get(k) ?? "");
      if (v !== "") data[k] = k === "standard_charge" ? Number(v) : v;
    });
    const body = {
      name,
      parent_id:
        kind === "category"
          ? String(form.get("charge_type_id") ?? "") || null
          : null,
      percentage:
        kind === "tax" || kind === "charge"
          ? Number(form.get("percentage") || 0)
          : null,
      modules,
      data,
    };
    try {
      await request(
        `/charge-masters/${kind}${editing?.id ? `/${editing.id}` : ""}`,
        token,
        { method: editing?.id ? "PUT" : "POST", body: JSON.stringify(body) },
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save record");
    } finally {
      setSaving(false);
    }
  }
  async function remove(row: RecordRow) {
    if (!row.id || !confirm(`Delete ${row.name}?`)) return;
    try {
      await request(`/charge-masters/${kind}/${row.id}`, token, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete record");
    }
  }
  const dataOf = (row: RecordRow) =>
    (row.data ?? {}) as Record<string, unknown>;
  const lookup = (k: string, id: unknown) =>
    String(all[k]?.find((x) => x.id === id)?.name ?? "—");
  const columns =
    kind === "charge"
      ? [
          "Charge Name",
          "Category",
          "Charge Type",
          "Unit Type",
          "Tax (%)",
          "Standard Charge",
        ]
      : kind === "category"
        ? ["Name", "Charge Type", "Description"]
        : kind === "type"
          ? ["Charge Type", "Modules"]
          : kind === "tax"
            ? ["Name", "Percentage (%)"]
            : ["Unit Type"];
  function cells(row: RecordRow) {
    const d = dataOf(row);
    if (kind === "charge")
      return [
        row.name,
        lookup("category", d.category_id),
        lookup("type", d.charge_type_id),
        lookup("unit", d.unit_type_id),
        row.percentage ?? 0,
        d.standard_charge ?? 0,
      ];
    if (kind === "category")
      return [row.name, row.parent_name ?? "—", d.description ?? "—"];
    if (kind === "type")
      return [
        row.name,
        Array.isArray(row.modules) ? row.modules.join(", ") : "—",
      ];
    if (kind === "tax") return [row.name, row.percentage ?? 0];
    return [row.name];
  }
  return (
    <section className="hm-page">
      <header className="hm-head">
        <div>
          <small>Clinic Management / Clinic Charges</small>
          <h1>Clinic Charges</h1>
          <p>Configure clinic charge masters and billing classifications.</p>
        </div>
      </header>
      <div className="hm-settings-layout">
        <nav className="hm-settings-menu" aria-label="Clinic charge sections">
          {chargeSections.map((item) => (
            <button
              type="button"
              key={item}
              className={section === item ? "active" : ""}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <section className="hm-settings-panel">
          <header className="hm-charge-head">
            <div>
              <small>Clinic Charges</small>
              <h2>{section}</h2>
              <p>Configure {section.toLowerCase()} for this clinic.</p>
            </div>
            <button type="button" onClick={() => setEditing({})}>
              <Plus /> Add {section.replace(/s$/, "")}
            </button>
          </header>
          {error && <div className="hm-error">{error}</div>}
          <div className="hm-charge-search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${section.toLowerCase()}...`}
            />
            <span>{filtered.length} records</span>
          </div>
          {loading ? (
            <div className="hm-loading">
              <LoaderCircle className="spin" /> Loading…
            </div>
          ) : (
            <div className="hm-charge-table">
              <table>
                <thead>
                  <tr>
                    {columns.map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      {cells(row).map((value, i) => (
                        <td key={i}>{String(value)}</td>
                      ))}
                      <td>
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => setEditing(row)}
                        >
                          <Edit3 />
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          className="delete"
                          onClick={() => remove(row)}
                        >
                          <Trash2 />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <div className="hm-empty">
                  No {section.toLowerCase()} added yet.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      {editing && (
        <ChargeMasterModal
          kind={kind}
          section={section}
          row={editing}
          all={all}
          saving={saving}
          save={save}
          close={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function ChargeMasterModal({
  kind,
  section,
  row,
  all,
  saving,
  save,
  close,
}: {
  kind: string;
  section: string;
  row: RecordRow;
  all: Record<string, RecordRow[]>;
  saving: boolean;
  save: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const data = (row.data ?? {}) as Record<string, unknown>,
    selected = Array.isArray(row.modules) ? (row.modules as string[]) : [];
  const [taxPercentage, setTaxPercentage] = useState(() => {
    const tax = all.tax?.find((x) => x.id === data.tax_category_id);
    return String(tax?.percentage ?? row.percentage ?? 0);
  });
  const select = (
    name: string,
    label: string,
    items: RecordRow[],
    value: unknown,
  ) => (
    <label>
      <span>{label} *</span>
      <select name={name} required defaultValue={String(value ?? "")}>
        <option value="">Select {label}</option>
        {items.map((x) => (
          <option key={x.id} value={x.id}>
            {String(x.name)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="hm-modal-back">
      <form className="hm-modal hm-charge-modal" onSubmit={save}>
        <header>
          <div>
            <h2>
              {row.id ? "Edit" : "Add"} {section.replace(/s$/, "")}
            </h2>
            <p>Changes apply only to this clinic.</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div className="hm-form-grid">
          {kind === "charge" && (
            <>
              {select(
                "charge_type_id",
                "Charge Type",
                all.type ?? [],
                data.charge_type_id,
              )}
              {select(
                "category_id",
                "Charge Category",
                all.category ?? [],
                data.category_id,
              )}
              {select(
                "unit_type_id",
                "Unit Type",
                all.unit ?? [],
                data.unit_type_id,
              )}
              <label>
                <span>Charge Name *</span>
                <input
                  name="name"
                  required
                  defaultValue={String(row.name ?? "")}
                />
              </label>
              <label>
                <span>Tax Category *</span>
                <select
                  name="tax_category_id"
                  required
                  defaultValue={String(data.tax_category_id ?? "")}
                  onChange={(e) =>
                    setTaxPercentage(
                      String(
                        all.tax?.find((x) => x.id === e.target.value)
                          ?.percentage ?? 0,
                      ),
                    )
                  }
                >
                  <option value="">Select Tax Category</option>
                  {(all.tax ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {String(x.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Tax (%)</span>
                <input
                  name="percentage"
                  type="number"
                  readOnly
                  value={taxPercentage}
                />
              </label>
              <label>
                <span>Standard Charge *</span>
                <input
                  name="standard_charge"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={String(data.standard_charge ?? "")}
                />
              </label>
              <label className="hm-wide">
                <span>Description</span>
                <textarea
                  name="description"
                  defaultValue={String(data.description ?? "")}
                />
              </label>
            </>
          )}
          {kind === "category" && (
            <>
              {select(
                "charge_type_id",
                "Charge Type",
                all.type ?? [],
                row.parent_id,
              )}
              <label>
                <span>Name *</span>
                <input
                  name="name"
                  required
                  defaultValue={String(row.name ?? "")}
                />
              </label>
              <label className="hm-wide">
                <span>Description *</span>
                <textarea
                  name="description"
                  required
                  defaultValue={String(data.description ?? "")}
                />
              </label>
            </>
          )}
          {kind === "type" && (
            <>
              <label className="hm-wide">
                <span>Charge Type *</span>
                <input
                  name="name"
                  required
                  defaultValue={String(row.name ?? "")}
                />
              </label>
              <fieldset className="hm-module-list">
                <legend>Modules *</legend>
                {chargeModules.map((x) => (
                  <label key={x}>
                    <input
                      type="checkbox"
                      name="modules"
                      value={x}
                      defaultChecked={selected.includes(x)}
                    />
                    <span>{x}</span>
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {kind === "tax" && (
            <>
              <label>
                <span>Name *</span>
                <input
                  name="name"
                  required
                  defaultValue={String(row.name ?? "")}
                />
              </label>
              <label>
                <span>Percentage *</span>
                <input
                  name="percentage"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  defaultValue={String(row.percentage ?? "")}
                />
              </label>
            </>
          )}
          {kind === "unit" && (
            <label>
              <span>Unit *</span>
              <input
                name="name"
                required
                defaultValue={String(row.name ?? "")}
              />
            </label>
          )}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Save />} Save
          </button>
        </footer>
      </form>
    </div>
  );
}

function BranchOverview({ branch, token, close }: { branch: RecordRow; token: string; close: () => void }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setCounts(null);
    setError("");
    request<{ counts: Record<string, number> }>(`/branches/${branch.id}/overview`, token)
      .then(result => { if (!cancelled) setCounts(result.counts); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load branch overview"); });
    return () => { cancelled = true; };
  }, [branch.id, token, attempt]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  return <div className="hm-modal-back">
    <section className="hm-modal" role="dialog" aria-modal="true" aria-labelledby="branch-overview-title">
      <header><div><h2 id="branch-overview-title">{String(branch.name)} — Branch Overview</h2><p>{String(branch.code)} · {branch.is_active === false ? "Inactive" : "Active"}</p></div><button type="button" onClick={close} aria-label="Close branch overview" autoFocus><X /></button></header>
      {error ? <div className="hm-error" role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div> : !counts ? <div className="hm-loading" role="status"><LoaderCircle className="spin" /> Loading branch overview…</div> : <>
        <p style={{padding: "0 20px"}}>All-time totals. Doctors include primary and additional branch assignments; patients are counted by registration branch.</p>
        <div className="hm-profile">{Object.entries({doctors: "Assigned Doctors", patients: "Registered Patients", lab_orders: "Lab Orders", appointments: "OPD Appointments", admissions: "IPD Admissions", departments: "Departments", beds: "Beds"}).map(([key, label]) => <div key={key}><small>{label}</small><strong>{Number(counts[key] ?? 0).toLocaleString("en-IN")}</strong></div>)}</div>
      </>}
      <footer><button type="button" onClick={close}>Close</button></footer>
    </section>
  </div>;
}

function HospitalRecords({ page, token }: { page: string; token: string }) {
  const definition = definitions[page] ?? definitions["Clinic Profile"];
  const profile = definition.resource === "profile";
  const [viewingBranch, setViewingBranch] = useState<RecordRow | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]),
    [editing, setEditing] = useState<RecordRow | null>(null);
  const [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [lookups, setLookups] = useState<Record<string, RecordRow[]>>({});
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await request<RecordRow[] | RecordRow>(
        `/${definition.resource}${definition.resource === "branches" ? "?include_inactive=true" : ""}`,
        token,
      );
      setRows(profile ? [result as RecordRow] : (result as RecordRow[]));
      const needed = [
        ...new Set(
          definition.fields
            .map((f) => f.type)
            .filter((t) =>
              ["branch", "department", "ward", "room"].includes(t ?? ""),
            ),
        ),
      ] as string[];
      const entries = await Promise.all(
        needed.map(
          async (type) =>
            [
              type,
              await request<RecordRow[]>(
                `/${type === "branch" ? "branches?include_inactive=true" : `${type}s`}`,
                token,
              ),
            ] as const,
        ),
      );
      setLookups(Object.fromEntries(entries));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load records");
    } finally {
      setLoading(false);
    }
  }, [definition, profile, token]);
  useEffect(() => {
    load();
  }, [load]);
  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
      ),
    [rows, search],
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget),
      body: Record<string, unknown> = {};
    definition.fields.forEach((field) => {
      let value: unknown = form.get(field.key)?.toString() ?? "";
      if (field.key === "is_active") value = value === "Active";
      if (field.type === "number") value = Number(value || 0);
      body[field.key] = value;
    });
    try {
      const path = profile
        ? "/profile"
        : `/${definition.resource}${editing?.id ? `/${editing.id}` : ""}`;
      await request(path, token, {
        method: profile || editing?.id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save record");
    } finally {
      setSaving(false);
    }
  }
  async function remove(row: RecordRow) {
    if (!row.id || !confirm("Delete this record?")) return;
    try {
      await request(`/${definition.resource}/${row.id}`, token, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete record");
    }
  }
  function display(field: Field, row: RecordRow) {
    const value = row[field.key];
    if (field.key === "discount_percentage") return `${Number(value ?? 0)}%`;
    if (field.key === "is_active") return value ? "Active" : "Inactive";
    if (["branch", "department", "ward", "room"].includes(field.type ?? ""))
      return String(
        lookups[field.type!]?.find((x) => x.id === value)?.name ??
          lookups[field.type!]?.find((x) => x.id === value)?.room_number ??
          "—",
      );
    return String(value ?? "—");
  }
  const visibleFields = definition.fields
    .filter((f) => f.type !== "image")
    .slice(0, 6);
  if (definition.resource === "branches") visibleFields.push(definition.fields.find(field => field.key === "is_active")!);
  return (
    <section className="hm-page">
      <header className="hm-head">
        <div>
          <small>Clinic Management / {definition.title}</small>
          <h1>{definition.title}</h1>
          <p>Manage {definition.title.toLowerCase()} for this clinic only.</p>
        </div>
        <button onClick={() => setEditing(profile ? (rows[0] ?? {}) : {})}>
          <Plus />{" "}
          {profile
            ? "Edit profile"
            : `Add ${definition.title.replace(/s$/, "")}`}
        </button>
      </header>
      {error && <div className="hm-error">{error}</div>}
      {!profile && (
        <div className="hm-toolbar">
          <Search />
          <input
            placeholder={`Search ${definition.title.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span>{filtered.length} records</span>
        </div>
      )}
      <div className="hm-card">
        {loading ? (
          <div className="hm-loading">
            <LoaderCircle className="spin" />
            Loading…
          </div>
        ) : profile ? (
          <ProfileView row={rows[0] ?? {}} fields={definition.fields} />
        ) : (
          <div className="hm-table-wrap">
            <table>
              <thead>
                <tr>
                  {visibleFields.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    {visibleFields.map((f) => (
                      <td key={f.key}>{display(f, row)}</td>
                    ))}
                    <td>
                      {definition.resource === "branches" && <button type="button" title="View branch overview" aria-label={`View overview for ${String(row.name)}`} onClick={() => setViewingBranch(row)}><Eye /></button>}
                      <button onClick={() => setEditing(row)}>
                        <Edit3 />
                      </button>
                      <button className="delete" onClick={() => remove(row)}>
                        <Trash2 />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <div className="hm-empty">
                No {definition.title.toLowerCase()} added yet.
              </div>
            )}
          </div>
        )}
      </div>
      {viewingBranch && <BranchOverview branch={viewingBranch} token={token} close={() => setViewingBranch(null)} />}
      {editing && (
        <div className="hm-modal-back">
          <form className="hm-modal" onSubmit={save}>
            <header>
              <div>
                <h2>
                  {profile
                    ? "Edit Clinic Profile"
                    : editing.id
                      ? `Edit ${definition.title}`
                      : `Add ${definition.title}`}
                </h2>
                <p>Changes apply only to your clinic workspace.</p>
              </div>
              <button type="button" onClick={() => setEditing(null)}>
                <X />
              </button>
            </header>
            <div className="hm-form-grid">
              {definition.fields.map((field) => (
                <FieldControl
                  key={field.key}
                  field={field}
                  value={editing[field.key]}
                  lookups={lookups}
                />
              ))}
            </div>
            <footer>
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="primary" disabled={saving}>
                {saving ? <LoaderCircle className="spin" /> : <Save />} Save
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}

function FieldControl({
  field,
  value,
  lookups,
}: {
  field: Field;
  value: unknown;
  lookups: Record<string, RecordRow[]>;
}) {
  if (field.type === "image")
    return (
      <label className="hm-logo-field">
        <span>{field.label}</span>
        <div>
          {value ? <img src={String(value)} alt="" /> : <Building2 />}
          <label>
            <Upload /> Upload logo
            <input
              name={`${field.key}_file`}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0],
                  hidden = e.currentTarget.parentElement?.querySelector(
                    "input[type=hidden]",
                  ) as HTMLInputElement | null;
                if (file && hidden) {
                  const reader = new FileReader();
                  reader.onload = () => {
                    hidden.value = String(reader.result);
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
            <input
              type="hidden"
              name={field.key}
              defaultValue={String(value ?? "")}
            />
          </label>
        </div>
      </label>
    );
  if (field.options)
    return (
      <label>
        <span>{field.label}</span>
        <select
          name={field.key}
          defaultValue={
            field.key === "is_active"
              ? value === false
                ? "Inactive"
                : "Active"
              : String(value ?? field.options[0])
          }
        >
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  if (["branch", "department", "ward", "room"].includes(field.type ?? ""))
    return (
      <label>
        <span>{field.label}</span>
        <select name={field.key} defaultValue={String(value ?? "")}>
          <option value="">Select {field.label}</option>
          {lookups[field.type!]?.map((item) => (
            <option key={item.id} value={item.id}>
              {String(item.name ?? item.room_number)}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <label>
      <span>{field.label}</span>
      <input
        name={field.key}
        type={field.type ?? "text"}
        min={field.min}
        max={field.max}
        step={field.step}
        required={field.required}
        pattern={field.pattern}
        maxLength={field.maxLength}
        inputMode={field.inputMode}
        title={field.title}
        onInput={field.inputMode === "numeric" ? (event) => {
          event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, field.maxLength);
        } : undefined}
        defaultValue={String(value ?? "")}
      />
    </label>
  );
}
function ProfileView({ row, fields }: { row: RecordRow; fields: Field[] }) {
  return (
    <div className="hm-profile">
      {fields.map((field) => (
        <div key={field.key}>
          {field.type === "image" ? (
            row[field.key] ? (
              <img src={String(row[field.key])} alt="Clinic logo" />
            ) : (
              <span className="hm-profile-logo">
                <Building2 />
              </span>
            )
          ) : (
            <>
              <small>{field.label}</small>
              <strong>{String(row[field.key] ?? "—")}</strong>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
