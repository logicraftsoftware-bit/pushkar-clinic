import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Edit3,
  CalendarDays,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import "./staff-management.css";
import DigitalSignatureField from './DigitalSignatureField';
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
type Row = Record<string, any>;
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  required?: boolean;
  defaultValue?:number;
  wide?: boolean;
  pattern?: string;
  maxLength?: number;
  inputMode?: "numeric";
  title?: string;
};
const phoneField = {
  type: "tel", pattern: "[0-9]{10}", maxLength: 10,
  inputMode: "numeric" as const, title: "Enter exactly 10 digits",
};
function displayedStatus(row: Row): string {
  return row.account_active === false ? "Inactive" : row.status ?? "Active";
}
const staffTypes = [
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
];
const employmentTypes = ["Permanent", "Contract", "Part-Time", "Visiting"];
const personal: Field[] = [
  { key: "first_name", label: "First Name", required: true },
  { key: "middle_name", label: "Middle Name" },
  { key: "last_name", label: "Last Name", required: true },
  { key: "profile_photo", label: "Profile Photo", type: "file" },
  { key: "gender", label: "Gender", options: ["Male", "Female", "Other"] },
  { key: "date_of_birth", label: "Date of Birth", type: "date" },
  {
    key: "blood_group",
    label: "Blood Group",
    options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
  },
  { key: "mobile_number", label: "Mobile Number", ...phoneField },
  { key: "alternate_mobile", label: "Alternate Mobile", ...phoneField },
  { key: "email", label: "Email", type: "email" },
  { key: "address", label: "Address", wide: true },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pin", label: "PIN" },
  { key: "country", label: "Country" },
  { key: "emergency_contact_name", label: "Emergency Contact Name" },
  { key: "emergency_contact_number", label: "Emergency Contact Number", ...phoneField },
  {
    key: "emergency_contact_relationship",
    label: "Emergency Contact Relationship",
  },
];
const employment: Field[] = [
  { key: "branch_ids", label: "Branches", type: "branches", required: true },
  { key: "department_id", label: "Department", type: "department" },
  { key: "designation", label: "Designation" },
  {
    key: "staff_type",
    label: "Staff Type",
    options: staffTypes,
    required: true,
  },
  {
    key: "employment_type",
    label: "Employment Type",
    options: employmentTypes,
  },
  { key: "joining_date", label: "Joining Date", type: "date" },
  { key: "shift", label: "Shift" },
  { key: "reporting_manager", label: "Reporting Manager" },
  { key: "qualification", label: "Qualification" },
  { key: "experience", label: "Experience" },
  {
    key: "status",
    label: "Status",
    options: ["Active", "Inactive", "On Leave"],
  },
];
const account: Field[] = [
  { key: "username", label: "Username", required: true },
  { key: "login_email", label: "Login Email", type: "email", required: true },
  { key: "mobile", label: "Mobile", ...phoneField },
  { key: "password", label: "Temporary Password (minimum 12 characters)", type: "password" },
  { key: "confirm_password", label: "Confirm Password", type: "password" },
  { key: "role", label: "Role", options: staffTypes },
  { key: "panel_access", label: "Panel Access" },
  {
    key: "account_status",
    label: "Account Status",
    options: ["Active", "Inactive"],
  },
  {
    key: "force_password_change",
    label: "Force Password Change on First Login",
    type: "checkbox",
  },
  { key: "two_factor", label: "Two-Factor Authentication", type: "checkbox" },
  { key: "account_expiry", label: "Account Expiry", type: "date" },
  {
    key: "send_activation_link",
    label: "Send Account Activation Link",
    type: "checkbox",
  },
];
const specific: Record<string, Field[]> = {
  Doctor: [
    {
      key: "medical_registration_number",
      label: "Medical Registration Number",
      required: true,
    },
    { key: "specialization", label: "Specialization" },
    { key: "doctor_qualification", label: "Qualification" },
    { key: "doctor_experience", label: "Experience" },
    { key: "consultation_fee", label: "Doctor Fee", type: "number" },
    { key: "registration_fee", label: "Registration Fee (INR)", type: "number", required:true, defaultValue:100 },
    { key: "maintenance_fee", label: "Maintenance Fee (INR)", type: "number", required:true, defaultValue:100 },
    { key: "follow_up_fee", label: "Follow-Up Fee", type: "number" },
    { key: "slot_duration", label: "Slot Duration (minutes)", type: "number" },
    {
      key: "maximum_appointments",
      label: "Maximum Appointments",
      type: "number",
    },
    { key: "room_chamber", label: "Room / Chamber" },
    { key: "digital_signature", label: "Digital Signature", type: "file" },
  ],
  Nurse: [
    {
      key: "nursing_registration_number",
      label: "Nursing Registration Number",
    },
    { key: "nurse_qualification", label: "Qualification" },
    { key: "ward_assignment", label: "Ward Assignment", type: "ward" },
    { key: "nurse_shift", label: "Shift" },
    { key: "nursing_grade", label: "Nursing Grade" },
    { key: "nurse_experience", label: "Experience" },
  ],
  Pathologist: [
    { key: "medical_registration_number", label: "Medical Registration Number", required: true },
    { key: "doctor_qualification", label: "Qualification" },
    { key: "specialization", label: "Specialization" },
    { key: "digital_signature", label: "Digital Signature", type: "file" },
  ],
  "Lab Technician": [
    { key: "lab_qualification", label: "Qualification" },
    { key: "lab_department", label: "Lab Department" },
    { key: "digital_signature", label: "Digital Signature", type: "file" },
  ],
  "Lab Manager": [
    { key: "lab_qualification", label: "Qualification" },
    { key: "lab_department", label: "Lab Department" },
    { key: "technician_type", label: "Technician Type" },
    { key: "authorized_tests", label: "Authorized Tests", wide: true },
    { key: "can_enter_results", label: "Can Enter Results", type: "checkbox" },
    {
      key: "can_verify_results",
      label: "Can Verify Results",
      type: "checkbox",
    },
  ],
  "Pharmacy Manager": [
    {
      key: "pharmacist_registration_number",
      label: "Pharmacist Registration Number",
    },
    { key: "pharmacy_qualification", label: "Qualification" },
    { key: "pharmacy_branch", label: "Pharmacy / Branch" },
    { key: "can_dispense", label: "Can Dispense", type: "checkbox" },
    {
      key: "can_process_returns",
      label: "Can Process Returns",
      type: "checkbox",
    },
    { key: "can_manage_stock", label: "Can Manage Stock", type: "checkbox" },
  ],
};
async function req(path: string, token: string, opt: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1/hospital-management${path}`, {
    ...opt,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...opt.headers,
    },
  });
  const d = r.status === 204 ? null : await r.json();
  if (!r.ok) {
    const label = (field: string) => {
      const key = field.split('.').pop() ?? field;
      return [...personal, ...employment, ...account, ...Object.values(specific).flat()]
        .find(item => item.key === key)?.label ?? key.replace(/_/g, ' ');
    };
    const details = Array.isArray(d?.issues)
      ? d.issues.map((issue: { field: string; message: string }) => `${label(issue.field)}: ${issue.message}`)
      : Array.isArray(d?.fields)
        ? d.fields.map((field: string) => `Check ${label(field)}`)
        : [];
    throw new Error([d?.error ?? "Request failed", ...details].join(' '));
  }
  return d;
}
const pageType: Record<string, string | undefined> = {
  "Branch Admin": "Branch Admin",
  Doctor: "Doctor",
  "HR Manager": "HR Manager",
  "Inventory Manager": "Inventory Manager",
  "Lab Manager": "Lab Manager",
  "Lab Technician": "Lab Technician",
  Pathologist: "Pathologist",
  Nurse: "Nurse",
  "Pharmacy Manager": "Pharmacy Manager",
  Radiologist: "Radiologist",
  Receptionist: "Receptionist",
};
function fileData(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (file.size > 500 * 1024) {
      reject(new Error("Photo and signature files must be below 500 KB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}
export default function StaffManagement({
  page,
  token,
}: {
  page: string;
  token: string;
}) {
  const [customRole,setCustomRole]=useState(()=>page==='All Staff'?new URLSearchParams(location.search).get('staff_role')||'':'');
  useEffect(()=>{const select=(event:Event)=>setCustomRole((event as CustomEvent<string>).detail||'');window.addEventListener('staff-role-selected',select);return()=>window.removeEventListener('staff-role-selected',select);},[]);
  const filter = pageType[page] ?? (page==='All Staff'?customRole||undefined:page),
    [rows, setRows] = useState<Row[]>([]),
    [editing, setEditing] = useState<Row | null>(null),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [branches, setBranches] = useState<Row[]>([]),
    [departments, setDepartments] = useState<Row[]>([]),
    [wards, setWards] = useState<Row[]>([]),
    [roles, setRoles] = useState<Row[]>([]),
    [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]),
    [staffType, setStaffType] = useState("Doctor"),
    [selectedRole, setSelectedRole] = useState("Doctor"),
    [scheduling, setScheduling] = useState<Row | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b, d, w, r] = await Promise.all([
        req(
          `/staff/list${filter ? `?type=${encodeURIComponent(filter)}` : ""}`,
          token,
        ),
        req("/branches", token),
        req("/departments", token),
        req("/wards", token),
        req("/staff/roles", token),
      ]);
      setRows(s);
      setBranches(b);
      setDepartments(d);
      setWards(w);
      setRoles(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load staff");
    } finally {
      setLoading(false);
    }
  }, [filter, token]);
  const roleOptions = useMemo(
    () => [
      ...new Set([
        ...staffTypes,
        ...roles
          .filter((role) => role.status === "Active" && !["Clinic Admin", "Patient"].includes(role.name))
          .map((role) => String(role.name)),
      ]),
    ],
    [roles],
  );
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
  function open(row: Row = {}) {
    setEditing(row);
    setStaffType(row.staff_type ?? filter ?? "Doctor");
    setSelectedRole(row.account?.role ?? row.staff_type ?? filter ?? "Doctor");
    setSelectedBranchIds(
      Array.isArray(row.branch_ids)
        ? row.branch_ids.filter(Boolean)
        : row.branch_id
          ? [row.branch_id]
          : [],
    );
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (fd.get("password") !== fd.get("confirm_password")) {
      setError("Password and confirm password must match.");
      return;
    }
    setSaving(true);
    setError("");
    const pick = (fields: Field[]) =>
      Object.fromEntries(
        fields.map((f) => [
          f.key,
          f.type === "checkbox"
            ? fd.get(f.key) === "on"
            : f.type === "file"
              ? ""
              : (fd.get(f.key)?.toString() ?? ""),
        ]),
      );
    const p = pick(personal),
      em = pick(employment),
      ac = pick(account),
      pro = {...editing?.professional,...pick(specific[staffType] ?? [])};
    // Preserve the explicitly selected login account status independently of employment status.
    try {
      if (["Doctor", "Pathologist"].includes(staffType) && !String(pro.medical_registration_number ?? "").trim()) {
        throw new Error("Medical Registration Number is required for doctors and pathologists.");
      }
      if(staffType==='Doctor'){
        const branchFees={...pro.branch_fees};
        for(const branchId of fd.getAll('branch_ids').map(String)){
          const entry={...branchFees[branchId]};
          for(const key of ['consultation_fee','registration_fee','maintenance_fee']){
            const fee=String(fd.get(`branch_${key}_${branchId}`)??'').trim();
            if(fee==='')delete entry[key];
            else {const amount=Number(fee);if(!Number.isFinite(amount)||amount<0)throw Error('Enter a valid non-negative fee for each branch');entry[key]=Math.round(amount*100)/100;}
          }
          branchFees[branchId]=entry;
        }
        pro.branch_fees=branchFees;
      }
      const photo = fd.get("profile_photo");
      p.profile_photo =
        photo instanceof File && photo.size
          ? await fileData(photo)
          : (editing?.profile_photo ?? "");
      const signature = fd.get("digital_signature");
      if (signature instanceof File && signature.size)
        pro.digital_signature = await fileData(signature);
      else if (editing?.professional?.digital_signature)
        pro.digital_signature = editing.professional.digital_signature;
      await req("/staff/save", token, {
        method: "POST",
        body: JSON.stringify({
          id: editing?.id,
          first_name: p.first_name,
          middle_name: p.middle_name,
          last_name: p.last_name,
          profile_photo: p.profile_photo,
          staff_type: em.staff_type,
          branch_id: fd.getAll("branch_ids")[0] || null,
          branch_ids: fd.getAll("branch_ids"),
          department_id: em.department_id || null,
          designation: em.designation,
          employment_type: em.employment_type,
          joining_date: em.joining_date || null,
          status: em.status,
          personal: p,
          employment: em,
          account: ac,
          professional: pro,
        }),
      });
      setEditing(null);
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to save staff");
    } finally {
      setSaving(false);
    }
  }
  async function remove(r: Row) {
    if (!confirm(`Remove ${r.first_name} ${r.last_name}?`)) return;
    try {
      await req(`/staff/record/${r.id}`, token, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to remove staff");
    }
  }
  return (
    <section className="staff-page">
      <header className="staff-head">
        <div>
          <small>Staff Management / {page}</small>
          <h1>{customRole||page}</h1>
          <p>
            Create staff profiles, professional details and secure user
            accounts.
          </p>
        </div>
        <button onClick={() => open()}>
          <Plus />
          Add Staff
        </button>
      </header>
      {error && <div className="staff-error">{error}</div>}
      <div className="staff-toolbar">
        <Search />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee, ID, role or department…"
        />
        <span>{shown.length} staff</span>
      </div>
      <div className="staff-card">
        {loading ? (
          <div className="staff-loading">
            <LoaderCircle className="spin" />
            Loading…
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Employee ID</th>
                <th>Staff Type</th>
                <th>Branch</th>
                <th>Department</th>
                <th>Status</th>
                <th>Account</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="staff-person">
                      <span>
                        {r.profile_photo ? (
                          <img src={r.profile_photo} />
                        ) : (
                          <UserRound />
                        )}
                      </span>
                      <strong>
                        {r.first_name} {r.last_name}
                        <small>
                          {r.personal?.mobile_number || "No mobile"}
                        </small>
                      </strong>
                    </div>
                  </td>
                  <td>{r.employee_id}</td>
                  <td>{r.staff_type}</td>
                  <td>{r.branch_names?.join(", ") || r.branch_name || "—"}</td>
                  <td>{r.department_name || "—"}</td>
                  <td>
                    <b
                      className={`staff-status ${String(displayedStatus(r)).toLowerCase().replace(" ", "-")}`}
                    >
                      {displayedStatus(r)}
                    </b>
                  </td>
                  <td>{r.username || "Not created"}</td>
                  <td>
                    {r.staff_type === "Doctor" && <button title="Appointment calendar" onClick={() => setScheduling(r)}><CalendarDays /></button>}
                    <button onClick={() => open(r)}>
                      <Edit3 />
                    </button>
                    <button onClick={() => remove(r)}>
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <div className="staff-modal-back">
          <form className="staff-modal" onSubmit={save}>
            {error && <div className="staff-error" role="alert">{error}</div>}
            <header>
              <div>
                <h2>
                  {editing.id ? "Edit Staff Member" : "Create Staff Member"}
                </h2>
                <p>Employee ID is generated automatically after saving.</p>
              </div>
              <button type="button" onClick={() => setEditing(null)}>
                <X />
              </button>
            </header>
            <Section
              title="Personal Information"
              fields={personal}
              values={{ ...editing.personal, ...editing }}
              branches={branches}
              departments={departments}
              wards={wards}
              selectedBranchIds={selectedBranchIds}
            />
            <Section
              title="Employment Information"
              fields={employment.map((field) =>
                field.key === "staff_type" ? { ...field, options: roleOptions } : field,
              )}
              values={{
                ...editing.employment,
                ...editing,
                staff_type: staffType,
              }}
              branches={branches}
              departments={departments}
              wards={wards}
              selectedBranchIds={selectedBranchIds}
              onBranchesChange={setSelectedBranchIds}
              onStaffType={(value) => {
                setStaffType(value);
                setSelectedRole(value);
              }}
            />
            <Section
              title="Login & User Account (Inactive blocks login independently of staff status)"
              fields={account.map((field) =>
                field.key === "role" ? { ...field, options: roleOptions } : field,
              )}
              values={{
                ...editing.account,
                username: editing.username||editing.account?.username||editing.login_email||editing.account?.login_email||'',
                login_email: editing.login_email,
                role: selectedRole,
                force_password_change: editing.account_force_password_change ?? editing.account?.force_password_change ?? false,
                account_status: editing.account_active === false ? "Inactive" : (editing.account?.account_status ?? "Active"),
              }}
              branches={branches}
              departments={departments}
              wards={wards}
              selectedBranchIds={selectedBranchIds}
              onRole={setSelectedRole}
            />
            {specific[staffType] && (
              <>
                <Section
                  title={`${staffType}-Specific Information`}
                  fields={specific[staffType]}
                  values={editing.professional ?? {}}
                  branches={branches}
                  departments={departments}
                  wards={wards}
                  selectedBranchIds={selectedBranchIds}
                />
              </>
            )}
            {staffType==='Doctor'&&<BranchDoctorFees branches={branches} assigned={selectedBranchIds} professional={editing.professional||{}}/>}
            <footer>
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="primary" disabled={saving}>
                {saving ? (
                  <LoaderCircle className="spin" />
                ) : (
                  "Save Staff Member"
                )}
              </button>
            </footer>
          </form>
        </div>
      )}
      {scheduling && <DoctorCalendar doctor={scheduling} token={token} close={()=>setScheduling(null)} />}
    </section>
  );
}

function DoctorCalendar({doctor,token,close}:{doctor:Row;token:string;close:()=>void}) {
  const [defaultSchedule,setDefaultSchedule]=useState<Row|null>(null),[unavailableDates,setUnavailableDates]=useState<string[]>([]);
  const [schedule,setSchedule]=useState<Row[]>([]),[selectedDate,setSelectedDate]=useState<Date|null>(null),[fromTime,setFromTime]=useState("09:00"),[toTime,setToTime]=useState("17:00"),[slotCount,setSlotCount]=useState(1),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const format=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const parse=(value:string)=>{const raw=String(value||"");const [year,month,day]=raw.slice(0,10).split("-").map(Number);return year&&month&&day?new Date(year,month-1,day):null};
  const load=useCallback(async()=>{try{const result=await req(`/staff/${doctor.id}/appointment-schedule`,token);setSchedule(result.schedule||[]);setDefaultSchedule(result.default_schedule??null);setUnavailableDates(result.unavailable_dates??[])}catch(e){setError(e instanceof Error?e.message:"Unable to load schedule")}},[doctor.id,token]);
  useEffect(()=>{load()},[load]);
  const selectedKey=selectedDate?format(selectedDate):"", selected=schedule.find(item=>String(item.appointment_date).slice(0,10)===selectedKey);
  async function saveSlot(){if(!selectedDate)return;setSaving(true);setError("");try{await req(`/staff/${doctor.id}/appointment-schedule`,token,{method:"PUT",body:JSON.stringify({appointment_date:selectedKey,from_time:fromTime,to_time:toTime,max_slots:slotCount})});setSelectedDate(null);await load()}catch(e){setError(e instanceof Error?e.message:"Unable to save schedule")}finally{setSaving(false)}}
  async function removeSlot(date:string){if(!confirm(`Remove availability for ${date}?`))return;setError("");try{await req(`/staff/${doctor.id}/appointment-schedule/${date}`,token,{method:"DELETE"});if(selectedKey===date)setSelectedDate(null);await load()}catch(e){setError(e instanceof Error?e.message:"Unable to remove schedule")}}
  return <div className="staff-modal-back staff-calendar-back"><section className="staff-calendar-modal"><header><div><h2>{doctor.first_name} {doctor.last_name} — Appointment Calendar</h2><p>Select a date to add or update doctor availability. Green dates have a saved schedule.</p></div><button onClick={close}><X/></button></header>{error&&<div className="staff-error">{error}</div>}<div className="staff-calendar-body"><DatePicker inline selected={selectedDate} onChange={(date:Date|null)=>{setSelectedDate(date);const entry=schedule.find(item=>String(item.appointment_date).slice(0,10)===(date?format(date):""));setFromTime(entry?.from_time||defaultSchedule?.from_time||"09:00");setToTime(entry?.to_time||defaultSchedule?.to_time||"17:00");setSlotCount(Number(entry?.max_slots||defaultSchedule?.max_slots||1))}} dayClassName={date=>!unavailableDates.includes(format(date))&&(schedule.some(item=>String(item.appointment_date).slice(0,10)===format(date))||(defaultSchedule&&format(date)>=String(defaultSchedule.start_date||"")))?"staff-scheduled-day":""}/><aside>{defaultSchedule&&<p><strong>Daily availability</strong><br/>{defaultSchedule.from_time} to {defaultSchedule.to_time} / {defaultSchedule.max_slots} slots</p>}<h3>Scheduled dates</h3>{schedule.length?schedule.map(item=><div className="staff-schedule-entry" key={item.appointment_date}><button type="button" onClick={()=>{const date=parse(String(item.appointment_date));setSelectedDate(date);setFromTime(item.from_time);setToTime(item.to_time);setSlotCount(Number(item.max_slots||1))}}><strong>{new Date(`${String(item.appointment_date).slice(0,10)}T00:00:00`).toLocaleDateString(undefined,{day:"2-digit",month:"short",year:"numeric"})}</strong><span>{item.from_time} – {item.to_time} · {item.booked||0}/{item.max_slots||"∞"} patients</span></button><button className="staff-remove-slot" title="Remove slot" onClick={()=>removeSlot(String(item.appointment_date).slice(0,10))}><Trash2/></button></div>):<p>No date-specific overrides saved.</p>}</aside></div>{selectedDate&&<div className="staff-slot-back"><div className="staff-slot-modal"><h3>{selected?"Update":"Add"} availability for {selectedDate.toLocaleDateString()}</h3><label><span>Start time</span><input type="time" value={fromTime} onChange={e=>setFromTime(e.target.value)}/></label><label><span>End time</span><input type="time" value={toTime} onChange={e=>setToTime(e.target.value)}/></label><label><span>Number of Slots / Patients</span><input type="number" min="1" value={slotCount} onChange={e=>setSlotCount(Math.max(1,Number(e.target.value||1)))} /></label><footer><button onClick={()=>setSelectedDate(null)}>Cancel</button>{selected&&<button className="danger" onClick={()=>removeSlot(selectedKey)}>Remove Slot</button>}<button className="primary" disabled={saving} onClick={saveSlot}>{saving?"Saving…":"Save Slot"}</button></footer></div></div>}</section></div>
}

function DoctorSchedule({ values }: { values: Row }) {
  const [schedule, setSchedule] = useState<Row[]>(
    Array.isArray(values.appointment_schedule)
      ? values.appointment_schedule
      : [],
  );
  const update = (index: number, key: string, value: string) =>
    setSchedule((items) =>
      items.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
  const parseDate = (value: string) => {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const formatDate = (value: Date | null) =>
    value
      ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
      : "";
  return (
    <fieldset className="staff-section doctor-schedule">
      <legend>Appointment Schedule</legend>
      <div className="schedule-head">
        <p>Select multiple appointment dates and set the time for each date.</p>
        <button
          type="button"
          onClick={() =>
            setSchedule((items) => [
              ...items,
              { appointment_date: "", from_time: "", to_time: "" },
            ])
          }
        >
          <Plus /> Add Date
        </button>
      </div>
      <div className="schedule-list">
        {schedule.map((item, index) => (
          <div className="schedule-row" key={index}>
            <label>
              <span>Appointment Date</span>
              <DatePicker
                selected={parseDate(item.appointment_date ?? "")}
                onChange={(date: Date | null) =>
                  update(index, "appointment_date", formatDate(date))
                }
                excludeDates={schedule
                  .filter((_, i) => i !== index)
                  .map((entry) => parseDate(entry.appointment_date ?? ""))
                  .filter((date): date is Date => Boolean(date))}
                dateFormat="dd-MM-yyyy"
                placeholderText="Select appointment date"
                required
                showPopperArrow={false}
              />
            </label>
            <label>
              <span>From Time</span>
              <input
                type="time"
                value={item.from_time ?? ""}
                required
                onChange={(e) => update(index, "from_time", e.target.value)}
              />
            </label>
            <label>
              <span>To Time</span>
              <input
                type="time"
                value={item.to_time ?? ""}
                required
                onChange={(e) => update(index, "to_time", e.target.value)}
              />
            </label>
            <button
              type="button"
              title="Remove date"
              onClick={() =>
                setSchedule((items) => items.filter((_, i) => i !== index))
              }
            >
              <Trash2 />
            </button>
          </div>
        ))}
        {!schedule.length && (
          <div className="schedule-empty">No appointment dates added yet.</div>
        )}
      </div>
      <input
        type="hidden"
        name="appointment_schedule"
        value={JSON.stringify(schedule)}
      />
    </fieldset>
  );
}
function Section({
  title,
  fields,
  values,
  branches,
  departments,
  wards,
  selectedBranchIds,
  onBranchesChange,
  onStaffType,
  onRole,
}: {
  title: string;
  fields: Field[];
  values: Row;
  branches: Row[];
  departments: Row[];
  wards: Row[];
  selectedBranchIds: string[];
  onBranchesChange?: (ids: string[]) => void;
  onStaffType?: (v: string) => void;
  onRole?: (v: string) => void;
}) {
  return (
    <fieldset className="staff-section">
      <legend>{title}</legend>
      <div>
        {fields.map((f) => f.key==='digital_signature' ? <DigitalSignatureField key={f.key} value={values[f.key]||''} required={f.required}/> : (
          <label className={f.wide ? "wide" : ""} key={f.key}>
            {f.type === "checkbox" ? (
              <span className="check">
                <input
                  name={f.key}
                  type="checkbox"
                  defaultChecked={Boolean(values[f.key])}
                />
                {f.label}
              </span>
            ) : (
              <>
                <span>
                  {f.label}
                  {f.required && <em>*</em>}
                </span>
                {f.type === "branches" ? (
                  <MultiBranchSelect
                    branches={branches}
                    initial={values.branch_ids ?? (values.branch_id ? [values.branch_id] : [])}
                    required={f.required}
                    onChange={onBranchesChange}
                  />
                ) : f.type === "ward" ? (
                  <select name={f.key} defaultValue={values[f.key] ?? ""}>
                    <option value="">
                      {selectedBranchIds.length ? "Select Ward" : "Select branch first"}
                    </option>
                    {wards
                      .filter((ward) => selectedBranchIds.includes(ward.branch_id))
                      .map((ward) => (
                        <option value={ward.id} key={ward.id}>
                          {ward.name}
                        </option>
                      ))}
                  </select>
                ) : f.type === "branch" || f.type === "department" ? (
                  <select name={f.key} required={f.required} defaultValue={values[f.key] ?? ""}>
                    <option value="">Select {f.label}</option>
                    {(f.type === "branch" ? branches : departments).map((x) => (
                      <option value={x.id} key={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                ) : f.options ? (
                  <select
                    name={f.key}
                    value={["staff_type", "role"].includes(f.key) ? values[f.key] : undefined}
                    defaultValue={
                      ["staff_type", "role"].includes(f.key)
                        ? undefined
                        : (values[f.key] ?? f.options[0])
                    }
                    onChange={
                      f.key === "staff_type"
                        ? (e) => onStaffType?.(e.target.value)
                        : f.key === "role"
                          ? (e) => onRole?.(e.target.value)
                        : undefined
                    }
                  >
                    {f.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={f.key}
                    type={f.type ?? "text"}
                    required={f.required}
                    pattern={f.pattern}
                    maxLength={f.maxLength}
                    inputMode={f.inputMode}
                    title={f.title}
                    min={f.defaultValue!==undefined?0:undefined}
                    step={f.defaultValue!==undefined?"0.01":undefined}
                    defaultValue={
                      f.type === "file" ? "" : (values[f.key] ?? f.defaultValue ?? "")
                    }
                  />
                )}
              </>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MultiBranchSelect({
  branches,
  initial,
  required,
  onChange,
}: {
  branches: Row[];
  initial: string[];
  required?: boolean;
  onChange?: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>(initial.filter(Boolean));
  const shown = branches.filter((branch) =>
    String(branch.name).toLowerCase().includes(search.toLowerCase()),
  );
  const allSelected = branches.length > 0 && selected.length === branches.length;
  const updateSelected = (next: string[]) => {
    setSelected(next);
    onChange?.(next);
  };
  const toggle = (id: string) =>
    updateSelected(
      selected.includes(id)
        ? selected.filter((branchId) => branchId !== id)
        : [...selected, id],
    );
  return (
    <div className={`staff-multi-select ${open ? "open" : ""}`}>
      {selected.map((id) => (
        <input key={id} type="hidden" name="branch_ids" value={id} />
      ))}
      {required && !selected.length && (
        <input className="staff-multi-required" required aria-label="Select at least one branch" />
      )}
      <button type="button" className="staff-multi-trigger" onClick={() => setOpen((value) => !value)}>
        <span>{selected.length ? `${selected.length} ${selected.length === 1 ? "branch" : "branches"} selected` : "Select branches"}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="staff-multi-menu">
          <div className="staff-multi-search">
            <Search />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search branches..." autoFocus />
          </div>
          <label className="staff-multi-option select-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => updateSelected(allSelected ? [] : branches.map((branch) => branch.id))}
            />
            <strong>(Select All)</strong>
          </label>
          <div className="staff-multi-options">
            {shown.map((branch) => (
              <label className="staff-multi-option" key={branch.id}>
                <input type="checkbox" checked={selected.includes(branch.id)} onChange={() => toggle(branch.id)} />
                <span>{branch.name}</span>
              </label>
            ))}
            {!shown.length && <small>No matching branches</small>}
          </div>
        </div>
      )}
    </div>
  );
}

function BranchDoctorFees({branches,assigned,professional}:{branches:Row[];assigned:string[];professional:Row}){
  const fields=[{key:'consultation_fee',label:'Consultation Fee'},{key:'registration_fee',label:'Registration Fee'},{key:'maintenance_fee',label:'Maintenance Fee'}];
  const [fees,setFees]=useState<Record<string,Row>>(()=>Object.fromEntries(Object.entries(professional.branch_fees||{}).map(([id,entry])=>[id,{...(entry as Row)}])));
  return <fieldset className="staff-section staff-branch-fees"><legend>Branch-wise Doctor Fees</legend>
    <p>Set consultation, registration and maintenance fees for each assigned branch. A blank field uses the corresponding default above. These rates apply to new appointments; completed bills keep their saved amounts.</p>
    {!assigned.length?<p>Select the doctor's branches in Employment Information first.</p>:<div>{assigned.map(id=>{
      const branch=branches.find(row=>row.id===id);
      return <section className="staff-branch-fee-card" key={id}><h4>{branch?.name||'Assigned branch'}</h4><div className="staff-branch-fee-fields">{fields.map(field=><label key={field.key}><span>{field.label} (INR)</span><input name={`branch_${field.key}_${id}`} type="number" min="0" step="0.01" value={fees[id]?.[field.key]??''} placeholder="Use default above" onChange={event=>setFees(current=>({...current,[id]:{...current[id],[field.key]:event.target.value}}))}/></label>)}</div></section>;
    })}</div>}
  </fieldset>;
}
