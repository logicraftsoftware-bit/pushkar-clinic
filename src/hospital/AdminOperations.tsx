import {useLiveAccess} from './LiveAccess';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Edit3,
  FileUp,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import "./admin-operations.css";
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
type R = any;
async function q(path: string, t: string, o: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1/hospital-admin${path}`, {
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
async function hospitalQ(path: string, t: string, o: RequestInit = {}) {
  const response = await fetch(`${API}/api/v1/hospital-management${path}`, {
    ...o,
    headers: {"Content-Type":"application/json",Authorization:`Bearer ${t}`,...o.headers},
  });
  const text = response.status === 204 ? "" : await response.text();
  let body:R=null;
  if(text) try { body=JSON.parse(text); } catch { throw new Error("Clinic profile service returned an invalid response"); }
  if(!response.ok) throw new Error(body?.error??"Request failed");
  return body;
}
export default function AdminOperations({
  page,
  token,
}: {
  page: string;
  token: string;
}) {
  if (page === "Settings") return <Settings token={token} />;
  return <Records page={page} token={token} />;
}
function Records({ page, token }: { page: string; token: string }) {
  const path =
      page === "Documents"
        ? "/documents"
        : page === "Login Activity"
          ? "/login-activity"
          : "/audit",
    [rows, setRows] = useState<R[]>([]),
    [look, setLook] = useState<R>({}),
    [edit, setEdit] = useState<R | null>(null),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const {permissions}=useLiveAccess();
  const canManageDocuments=permissions===null||permissions.has('documents.manage');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await q(path, token);
      setRows(data);
      if (page === "Documents" && canManageDocuments) setLook(await q("/lookups", token));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load");
    } finally {
      setLoading(false);
    }
  }, [path, page, token,canManageDocuments]);
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
    const body = Object.fromEntries(new FormData(e.currentTarget));
    await q(`/documents${edit?.id ? `/${edit.id}` : ""}`, token, {
      method: edit?.id ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    setEdit(null);
    load();
  }
  return (
    <section className="ao-page">
      <header>
        <div>
          <small>Clinic Administration / {page}</small>
          <h1>{page}</h1>
          <p>
            {page === "Documents"
              ? "Store and control clinic documents."
              : page === "Login Activity"
                ? "Successful and failed staff authentication attempts."
                : "Trace important actions performed inside this tenant."}
          </p>
        </div>
        {page === "Documents" && (
          <button data-permission="documents.manage" onClick={() => setEdit({ access_level: "Hospital" })}>
            <Plus />
            Upload Document
          </button>
        )}
      </header>
      {error && <div className="ao-error">{error}</div>}
      <div className="ao-toolbar">
        <Search />
        <input
          placeholder={`Search ${page.toLowerCase()}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{shown.length} records</span>
      </div>
      <div className="ao-card">
        {loading ? (
          <div className="ao-loading">
            <LoaderCircle />
            Loading…
          </div>
        ) : (
          <Table page={page} rows={shown} edit={setEdit} />
        )}
      </div>
      {edit && (
        <DocumentForm
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
  page,
  rows,
  edit,
}: {
  page: string;
  rows: R[];
  edit: (r: R) => void;
}) {
  const keys =
      page === "Documents"
        ? [
            "name",
            "document_type",
            "related_type",
            "branch_name",
            "issue_date",
            "expiry_date",
            "access_level",
            "uploaded_by_name",
          ]
        : page === "Login Activity"
          ? [
              "user_name",
              "employee_code",
              "role",
              "login_time",
              "logout_time",
              "ip_address",
              "device_browser",
              "branch_name",
              "login_status",
            ]
          : [
              "user_name",
              "role",
              "branch_name",
              "module",
              "action",
              "record_id",
              "created_at",
              "ip_address",
              "device",
            ],
    v = (r: R, k: string) => ["created_at","login_time","logout_time"].includes(k)&&r[k]?new Date(r[k]).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}):r[k],
    label = (k: string) =>
      k.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <table>
      <thead>
        <tr>
          {keys.map((k) => (
            <th>{label(k)}</th>
          ))}
          {page === "Documents" && <th />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {keys.map((k) => (
              <td>
                {["login_time", "logout_time", "created_at"].includes(k) &&
                v(r, k)
                  ? new Date(v(r, k)).toLocaleString()
                  : String(v(r, k) ?? "—")}
              </td>
            ))}
            {page === "Documents" && (
              <td>
                <button data-permission="documents.manage" onClick={() => edit(r)}>
                  <Edit3 />
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function DocumentForm({
  value,
  look,
  save,
  close,
}: {
  value: R;
  look: R;
  save: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const [file, setFile] = useState(String(value.file_data ?? ""));
  return (
    <div className="ao-back">
      <form className="ao-modal" onSubmit={save}>
        <header>
          <div>
            <h2>{value.id ? "Edit Document" : "Upload Document"}</h2>
            <p>Access is controlled inside this clinic.</p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div>
          {[
            ["name", "Document Name", "text"],
            ["document_type", "Document Type", "text"],
            ["issue_date", "Issue Date", "date"],
            ["expiry_date", "Expiry Date", "date"],
            ["description", "Description", "text"],
          ].map(([k, l, t]) => (
            <label>
              <span>{l}</span>
              <input
                name={k}
                type={t}
                required={k === "name" || k === "document_type"}
                defaultValue={value[k] ?? ""}
              />
            </label>
          ))}
          <label>
            <span>Related To</span>
            <select name="related_type" defaultValue={value.related_type ?? ""}>
              <option value="">None</option>
              <option>Patient</option>
              <option>Staff</option>
              <option>Department</option>
            </select>
          </label>
          <label>
            <span>Related Record</span>
            <select name="related_id" defaultValue={value.related_id ?? ""}>
              <option value="">Select record</option>
              {[
                ...(look.patients ?? []),
                ...(look.staff ?? []),
                ...(look.departments ?? []),
              ].map((x: R) => (
                <option value={x.id}>{x.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Branch</span>
            <select name="branch_id" defaultValue={value.branch_id ?? ""}>
              <option value="">All branches</option>
              {(look.branches ?? []).map((x: R) => (
                <option value={x.id}>{x.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Access Level</span>
            <select
              name="access_level"
              defaultValue={value.access_level ?? "Hospital"}
            >
              <option value="Hospital">Clinic</option>
              <option>Branch</option>
              <option>Department</option>
              <option>Private</option>
            </select>
          </label>
          <label className="file">
            <span>File</span>
            <FileUp />
            <input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const r = new FileReader();
                  r.onload = () => setFile(String(r.result));
                  r.readAsDataURL(f);
                }
              }}
            />
            <input type="hidden" name="file_data" value={file} readOnly />
            <small>{file ? "File attached" : "Choose a file"}</small>
          </label>
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary">Save Document</button>
        </footer>
      </form>
    </div>
  );
}
const settingSections = [
  "General Setting",
  "Attendance Setting",
  "Notification Setting",
  "System Notification Setting",
  "SMS Setting",
  "Email Setting",
  "Payment Methods",
  "Prefix Setting",
  "Languages",
];
const attendanceRoles = ["Clinic Admin","Branch Admin","Doctor","Receptionist","Nurse","Accountant","HR Manager","Inventory Manager","Lab Manager","Pharmacy Manager","Radiologist"];
const attendanceTypes = ["Present (P)","Late (L)","Half Day (F)","Half Day Second Shift (SH)"];
const notificationDefaults = [
  ["OPD Patient Registration","Dear {{patient_name}}, your OPD registration for {{appointment_date}} is successful. Patient ID: {{patient_id}}."],
  ["IPD Patient Registration","Dear {{patient_name}}, your IPD registration is successful. Patient ID: {{patient_id}}, IPD No: {{ipd_no}}."],
  ["IPD Patient Discharge","{{patient_name}} has been discharged. Total: {{total_amount}}, Paid: {{paid_amount}}, Balance: {{balance_amount}}."],
  ["Login Credential","Hello {{display_name}}, login URL: {{url}}, username: {{username}}, temporary password: {{password}}."],
  ["Appointment Approved","Dear {{patient_name}}, appointment {{appointment_no}} with {{staff_name}} is confirmed for {{date}}."],
  ["Appointment Reminder","Reminder: appointment {{appointment_no}} is scheduled for {{date}} at {{time}}."],
  ["OPD Patient Discharged","OPD patient {{patient_name}} has been discharged. Balance amount: {{balance_amount}}."],
  ["Forgot Password","A password reset was requested for {{email}}. Use this link: {{reset_password_link}}."],
];
const systemNotificationDefaults = [
  ["Appointment Created","New Appointment Created","Appointment created for {{patient_name}} on {{appointment_date}}.","Dear {{patient_name}}, your appointment with {{doctor_name}} has been created."],
  ["Appointment Approved","Appointment Status","Appointment {{appointment_no}} status is {{appointment_status}}.","Your appointment status is {{appointment_status}} for {{appointment_date}}."],
  ["OPD Visit Created","New OPD Visit Created","OPD visit created for {{patient_name}} with {{doctor_name}}.","Your OPD visit has been created. Symptoms: {{symptoms_description}}."],
  ["OPD Prescription Created","New OPD Prescription Created","Prescription {{prescription_no}} created for {{patient_name}}.","Your OPD prescription {{prescription_no}} is ready."],
  ["OPD Payment Added","Add OPD Payment","Payment {{amount}} received for OPD {{opd_no}}.","Your payment of {{amount}} was received successfully."],
  ["IPD Visit Created","New IPD Visit Created","IPD visit created for {{patient_name}} with {{doctor_name}}.","Your IPD visit {{ipd_no}} has been created."],
  ["IPD Payment Added","Add IPD Payment","Payment {{amount}} received for IPD {{ipd_no}}.","Your IPD payment of {{amount}} was received successfully."],
  ["IPD Discharge","IPD Patient Discharged","{{patient_name}} discharged from IPD {{ipd_no}}.","You have been discharged on {{discharge_date}}."],
  ["Pharmacy Bill Generated","Pharmacy Generate Bill","Pharmacy bill generated for {{patient_name}}.","Your pharmacy bill total is {{total}} and due is {{due_amount}}."],
  ["Pathology Report Ready","Pathology Test Report","Pathology report ready for {{patient_name}}.","Your pathology report {{bill_no}} is ready."],
  ["Radiology Report Ready","Radiology Test Report","Radiology report ready for {{patient_name}}.","Your radiology report {{bill_no}} is ready."],
  ["Staff Leave","Staff Leave","{{staff_name}} applied for leave from {{leave_date}}.",""],
  ["Staff Payroll Generated","Staff Generate Payroll","Payroll generated for {{staff_name}} for {{month}}.",""],
];
function completeSettings(sectionKey:string, value:R) {
  if(sectionKey==="AttendanceSetting"&&!value.roles){const roles:R={};for(const role of attendanceRoles){roles[role]={};for(const type of attendanceTypes)roles[role][type]={from:"10:00:00",upto:"10:15:00",total:"08:30:00"};}return {...value,roles};}
  if(sectionKey==="NotificationSetting"&&!value.events)return {...value,events:notificationDefaults.map(([event,message])=>({event,message,email:true,sms:false,mobile:false,template_id:""}))};
  if(sectionKey==="SystemNotificationSetting"&&!value.events)return {...value,events:systemNotificationDefaults.map(([event,subject,staff_message,patient_message])=>({event,subject,staff_message,patient_message,enabled:false,staff:true,patient:true}))};
  if(sectionKey==="PaymentMethods"&&!value.selected_gateway)return {...value,selected_gateway:"None",gateways:{}};
  if(sectionKey==="PrefixSetting"){const defaults:R={ipd_prefix:"IPDN",opd_prefix:"OPDN",ipd_prescription_prefix:"IPDP",opd_prescription_prefix:"OPDP",appointment_prefix:"APPN",pharmacy_bill_prefix:"PHAB",operation_reference_prefix:"OTRN",blood_bank_bill_prefix:"BLBB",ambulance_bill_prefix:"AMCB",radiology_bill_prefix:"RADB",pathology_bill_prefix:"PATB",opd_checkup_prefix:"OCID",pharmacy_purchase_prefix:"PHPN",transaction_prefix:"TRID",birth_record_prefix:"BRRN",death_record_prefix:"DRRN",uhid_prefix:"UHID",invoice_prefix:"INV",employee_prefix:"EMP"};return {...defaults,...value};}
  if(sectionKey==="Languages"&&!value.languages)return {...value,languages:[{name:"English",code:"en",country_code:"in",enabled:true,is_default:true,rtl:false},{name:"Hindi",code:"hi",country_code:"in",enabled:true,is_default:false,rtl:false},{name:"Bengali",code:"bn",country_code:"in",enabled:false,is_default:false,rtl:false}]};
  return value;
}
function Settings({ token }: { token: string }) {
  const [tab, setTab] = useState(settingSections[0]);
  const [data, setData] = useState<R>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    Promise.all([q("/settings", token), hospitalQ("/profile", token)]).then(([settings, profile]) => setData({
      ...settings,
      GeneralSetting: {
        hospital_name: profile.name, hospital_code: profile.code, hospital_logo: profile.logo_url,
        address: profile.address_line, phone: profile.phone, email: profile.email,
        currency: profile.currency, timezone: profile.timezone, ...(settings.GeneralSetting ?? {}),
      },
    })).catch((e) => setMessage(e.message));
  }, [token]);
  const sectionKey = tab.replaceAll(" ", "");
  const section = data[sectionKey] ?? {};
  const setSection = (value: R) => setData((current: R) => ({...current,[sectionKey]:value}));
  async function saveSection() {
    setSaving(true); setMessage("");
    try {
      const payload=completeSettings(sectionKey,section); setSection(payload);
      await q(`/settings/${sectionKey}`, token, {method:"PUT",body:JSON.stringify(payload)});
      if (tab === "General Setting") await hospitalQ("/profile", token, {method:"PUT",body:JSON.stringify({name:payload.hospital_name,code:payload.hospital_code,logo_url:payload.hospital_logo,email:payload.email,phone:payload.phone,address_line:payload.address,currency:payload.currency,timezone:payload.timezone})});
      setMessage(`${tab} saved successfully.`);
    }
    catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save settings"); }
    finally { setSaving(false); }
  }
  function renderContent() {
    if (tab === "General Setting") return <GeneralSettings value={section} change={setSection} />;
    if (tab === "Attendance Setting") return <AttendanceSettings value={section} change={setSection} />;
    if (tab === "Notification Setting") return <NotificationSettings value={section} change={setSection} />;
    if (tab === "System Notification Setting") return <SystemNotificationSettings value={section} change={setSection} />;
    if (tab === "SMS Setting") return <SmsSettings value={section} change={setSection} />;
    if (tab === "Email Setting") return <EmailSettings value={section} change={setSection} />;
    if (tab === "Payment Methods") return <PaymentSettings value={section} change={setSection} />;
    if (tab === "Prefix Setting") return <PrefixSettings value={section} change={setSection} />;
    if (tab === "Languages") return <LanguageSettings value={section} change={setSection} />;
    return <div className="settings-placeholder"><span>{tab.slice(0,1)}</span><strong>{tab}</strong><p>Tell me which settings should be available in this section.</p></div>;
  }
  return (
    <section className="ao-page settings">
      <header>
        <div>
          <small>Clinic Administration / Settings</small>
          <h1>Settings</h1>
          <p>Configure clinic-wide preferences, communication and system defaults.</p>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-menu" aria-label="Settings sections">
        {settingSections.map((x) => (
          <button
            type="button"
            key={x}
            className={tab === x ? "active" : ""}
            onClick={() => setTab(x)}
          >
            {x}
          </button>
        ))}
        </nav>
        <section className="settings-panel">
          <header><div><small>Clinic Settings</small><h2>{tab}</h2><p>This section is ready. Its settings fields will be added next.</p></div></header>
          {message && <div className="settings-message">{message}</div>}
          {renderContent()}
          <footer className="settings-save"><button type="button" onClick={saveSection} disabled={saving}>{saving ? "Saving..." : `Save ${tab}`}</button></footer>
        </section>
      </div>
    </section>
  );
}

function GeneralSettings({value,change}:{value:R;change:(v:R)=>void}) {
  const field=(key:string,label:string,required=false,type="text")=><label><span>{label}{required&&<em>*</em>}</span><input type={type} value={value[key]??""} onChange={e=>change({...value,[key]:e.target.value})}/></label>;
  return <div className="settings-form general-settings">
    {field("hospital_name","Clinic Name",true)}{field("hospital_code","Clinic Code")}
    <label className="wide"><span>Address<em>*</em></span><input value={value.address??""} onChange={e=>change({...value,address:e.target.value})}/></label>
    {field("phone","Phone",true,"tel")}{field("email","Email",true,"email")}
    <LogoUpload label="Clinic Logo" value={value.hospital_logo} change={logo=>change({...value,hospital_logo:logo})}/><LogoUpload label="Clinic Small Logo" value={value.hospital_small_logo} change={logo=>change({...value,hospital_small_logo:logo})}/>
    <h3>Language</h3><label><span>Language<em>*</em></span><select value={value.language??"English"} onChange={e=>change({...value,language:e.target.value})}><option>English</option><option>Hindi</option><option>Bengali</option></select></label><span/>
    <h3>Date & Time</h3><label><span>Date Format<em>*</em></span><select value={value.date_format??"dd-mm-yyyy"} onChange={e=>change({...value,date_format:e.target.value})}><option>dd-mm-yyyy</option><option>mm-dd-yyyy</option><option>yyyy-mm-dd</option></select></label><label><span>Time Zone<em>*</em></span><select value={value.timezone??"Asia/Kolkata"} onChange={e=>change({...value,timezone:e.target.value})}><option value="Asia/Kolkata">(GMT+05:30) Asia, Kolkata</option><option value="UTC">UTC</option></select></label>
    <h3>Currency</h3><label><span>Currency<em>*</em></span><select value={value.currency??"INR"} onChange={e=>change({...value,currency:e.target.value})}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></label>{field("currency_symbol","Currency Symbol",true)}{field("credit_limit","Credit Limit",true,"number")}<label><span>Time Format<em>*</em></span><select value={value.time_format??"12 Hour"} onChange={e=>change({...value,time_format:e.target.value})}><option>12 Hour</option><option>24 Hour</option></select></label>
  </div>;
}

function LogoUpload({label,value,change}:{label:string;value?:string;change:(v:string)=>void}) {
  const [error,setError]=useState("");
  function pick(file?:File){if(!file)return;if(!file.type.startsWith("image/")){setError("Please select an image file");return;}if(file.size>2*1024*1024){setError("Logo must be 2 MB or smaller");return;}const reader=new FileReader();reader.onload=()=>{change(String(reader.result));setError("");};reader.readAsDataURL(file);}
  return <div className="logo-upload"><span>{label}<em>*</em></span><div>{value?<img src={value} alt={`${label} preview`}/>:<span className="logo-empty"><FileUp/></span>}<label className="logo-upload-button"><FileUp/> Upload Logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={e=>pick(e.target.files?.[0])}/></label>{value&&<button type="button" onClick={()=>change("")}>Remove</button>}</div>{error&&<small>{error}</small>}</div>;
}

function AttendanceSettings({value,change}:{value:R;change:(v:R)=>void}) {
  const roles=value.roles??{}; const update=(role:string,type:string,key:string,v:string)=>change({...value,roles:{...roles,[role]:{...(roles[role]??{}),[type]:{...(roles[role]?.[type]??{}),[key]:v}}}});
  return <div className="attendance-settings">{attendanceRoles.map(role=><section className="attendance-role" key={role}><header><strong>Role: {role}</strong></header><div className="attendance-grid"><b>Attendance Type</b><b>Entry From</b><b>Entry Up To</b><b>Total Hours</b>{attendanceTypes.map(type=><Fragment key={type}><span>{type}</span>{["from","upto","total"].map(key=><input key={key} type="time" step="1" value={roles[role]?.[type]?.[key]??(key==="total"?"08:30:00":key==="from"?"10:00:00":"10:15:00")} onChange={e=>update(role,type,key,e.target.value)}/>)}</Fragment>)}</div></section>)}</div>;
}

function NotificationSettings({value,change}:{value:R;change:(v:R)=>void}) {
  const rows=value.events??notificationDefaults.map(([event,message])=>({event,message,email:true,sms:false,mobile:false,template_id:""})); const update=(i:number,key:string,v:unknown)=>{const next=[...rows];next[i]={...next[i],[key]:v};change({...value,events:next});};
  return <div className="notification-table"><div className="notification-head"><b>Event</b><b>Options</b><b>Template ID</b><b>Sample Message</b></div>{rows.map((row:R,i:number)=><div className="notification-row" key={row.event}><strong>{row.event}</strong><div className="check-options">{[["email","Email"],["sms","SMS"],["mobile","Mobile App"]].map(([key,label])=><label key={key}><input type="checkbox" checked={Boolean(row[key])} onChange={e=>update(i,key,e.target.checked)}/>{label}</label>)}</div><input value={row.template_id??""} onChange={e=>update(i,"template_id",e.target.value)} placeholder="Template ID"/><textarea value={row.message} onChange={e=>update(i,"message",e.target.value)}/></div>)}</div>;
}

function SystemNotificationSettings({value,change}:{value:R;change:(v:R)=>void}) {
  const rows=value.events??systemNotificationDefaults.map(([event,subject,staff_message,patient_message])=>({event,subject,staff_message,patient_message,enabled:false,staff:true,patient:true})); const update=(i:number,key:string,v:unknown)=>{const next=[...rows];next[i]={...next[i],[key]:v};change({...value,events:next});};
  return <div className="system-table"><div className="system-head"><b>Event</b><b>Subject</b><b>Options</b><b>Staff Message</b><b>Patient Message</b></div>{rows.map((row:R,i:number)=><div className="system-row" key={row.event}><strong>{row.event}</strong><input value={row.subject} onChange={e=>update(i,"subject",e.target.value)}/><div className="system-options">{[["enabled","Enabled"],["staff","Staff"],["patient","Patient"]].map(([key,label])=><label key={key}><input type="checkbox" checked={Boolean(row[key])} onChange={e=>update(i,key,e.target.checked)}/>{label}</label>)}</div><textarea value={row.staff_message} onChange={e=>update(i,"staff_message",e.target.value)}/><textarea value={row.patient_message} onChange={e=>update(i,"patient_message",e.target.value)}/></div>)}</div>;
}

const smsGateways=["Clickatell","Twilio","MSG91","Text Local","SMS Country","Bulk SMS","Mobireach","Nexmo","AfricasTalking","Custom SMS Gateway"];
function SmsSettings({value,change}:{value:R;change:(v:R)=>void}) {
  const selected=value.selected_gateway??smsGateways[0], configs=value.gateways??{}, current=configs[selected]??{};
  const update=(key:string,v:unknown)=>change({...value,selected_gateway:selected,gateways:{...configs,[selected]:{...current,[key]:v}}});
  return <div className="gateway-settings"><nav className="gateway-tabs">{smsGateways.map(g=><button type="button" className={selected===g?"active":""} onClick={()=>change({...value,selected_gateway:g})} key={g}>{g}</button>)}</nav><div className="gateway-body"><div className="gateway-fields">{[["username",`${selected} Username`],["password",`${selected} Password`],["api_key",`${selected} API Key`],["sender_id","Sender ID"],["api_url","API URL"]].map(([key,label])=><label key={key}><span>{label}</span><input type={key==="password"?"password":"text"} value={current[key]??""} onChange={e=>update(key,e.target.value)}/></label>)}<label><span>Status</span><select value={current.status??"Disabled"} onChange={e=>update("status",e.target.value)}><option>Enabled</option><option>Disabled</option></select></label></div><aside><strong>{selected}</strong><small>Configure credentials supplied by your SMS gateway provider.</small></aside></div></div>;
}

function EmailSettings({value,change}:{value:R;change:(v:R)=>void}) {
  const field=(key:string,label:string,type="text")=><label><span>{label}</span><input type={type} value={value[key]??""} onChange={e=>change({...value,[key]:e.target.value})}/></label>;
  return <div className="email-settings"><label><span>Email Engine</span><select value={value.engine??"SMTP"} onChange={e=>change({...value,engine:e.target.value})}><option>SMTP</option><option>Sendmail</option><option>Amazon SES</option></select></label>{field("smtp_username","SMTP Username")}{field("smtp_password","SMTP Password","password")}{field("smtp_server","SMTP Server")}{field("smtp_port","SMTP Port","number")}<label><span>SMTP Security</span><select value={value.smtp_security??"TLS"} onChange={e=>change({...value,smtp_security:e.target.value})}><option>TLS</option><option>SSL</option><option>None</option></select></label><label><span>SMTP Authentication</span><select value={value.smtp_auth??"ON"} onChange={e=>change({...value,smtp_auth:e.target.value})}><option>ON</option><option>OFF</option></select></label>{field("from_email","From Email","email")}{field("from_name","From Name")}</div>;
}

function PaymentSettings({value,change}:{value:R;change:(v:R)=>void}) {
  const gateways=["PayPal","Stripe","PayU","CCAvenue","InstaMojo","Paystack","Razorpay","Paytm","Midtrans","Pesapal","Flutter Wave","iPay Africa","JazzCash","Billplz","SSLCommerz","Walkingm","PayHere","OnePay","Mollie","Cashfree","PayFast","ToyyibPay","2Checkout","Skrill","None"];
  const selected=value.selected_gateway??"None", configs=value.gateways??{}, current=configs[selected]??{};const update=(key:string,v:unknown)=>change({...value,gateways:{...configs,[selected]:{...current,[key]:v}}});
  return <div className="payment-settings"><div><nav className="gateway-tabs">{gateways.filter(x=>x!=="None").map(g=><button type="button" className={selected===g?"active":""} onClick={()=>change({...value,selected_gateway:g})} key={g}>{g}</button>)}</nav><div className="payment-config"><h3>{selected} Configuration</h3>{selected==="None"?<p>Select a payment gateway to configure online payments.</p>:<><label><span>Username / Merchant ID</span><input value={current.username??""} onChange={e=>update("username",e.target.value)}/></label><label><span>Password / Secret</span><input type="password" value={current.password??""} onChange={e=>update("password",e.target.value)}/></label><label><span>API Key / Signature</span><input value={current.api_key??""} onChange={e=>update("api_key",e.target.value)}/></label><label><span>Processing Fee Type</span><select value={current.fee_type??"None"} onChange={e=>update("fee_type",e.target.value)}><option>None</option><option>Percentage</option><option>Fixed Amount</option></select></label><label><span>Percentage / Fixed Amount</span><input type="number" min="0" step="0.01" value={current.fee_amount??0} onChange={e=>update("fee_amount",Number(e.target.value))}/></label><label><span>Mode</span><select value={current.mode??"Test"} onChange={e=>update("mode",e.target.value)}><option>Test</option><option>Live</option></select></label></>}</div></div><aside><strong>Select Payment Gateway</strong>{gateways.map(g=><label key={g}><input type="radio" name="gateway" checked={selected===g} onChange={()=>change({...value,selected_gateway:g})}/>{g}</label>)}</aside></div>;
}

function PrefixSettings({value,change}:{value:R;change:(v:R)=>void}) {
  const prefixes=[["ipd_prefix","IPD No","IPDN"],["opd_prefix","OPD No","OPDN"],["ipd_prescription_prefix","IPD Prescription","IPDP"],["opd_prescription_prefix","OPD Prescription","OPDP"],["appointment_prefix","Appointment","APPN"],["pharmacy_bill_prefix","Pharmacy Bill","PHAB"],["operation_reference_prefix","Operation Reference No","OTRN"],["blood_bank_bill_prefix","Blood Bank Bill","BLBB"],["ambulance_bill_prefix","Ambulance Call Bill","AMCB"],["radiology_bill_prefix","Radiology Bill","RADB"],["pathology_bill_prefix","Pathology Bill","PATB"],["opd_checkup_prefix","OPD Checkup ID","OCID"],["pharmacy_purchase_prefix","Pharmacy Purchase No","PHPN"],["transaction_prefix","Transaction ID","TRID"],["birth_record_prefix","Birth Record Reference No","BRRN"],["death_record_prefix","Death Record Reference No","DRRN"],["uhid_prefix","Patient UHID","UHID"],["invoice_prefix","Invoice","INV"],["employee_prefix","Employee","EMP"]];
  return <div className="prefix-list">{prefixes.map(([key,label,fallback])=><label key={key}><span>{label}</span><input value={value[key]??fallback} onChange={e=>change({...value,[key]:e.target.value.toUpperCase()})}/></label>)}</div>;
}

function LanguageSettings({value,change}:{value:R;change:(v:R)=>void}) {
  const [adding,setAdding]=useState(false),[draft,setDraft]=useState({name:"",code:"",country_code:""});const languages=value.languages??[{name:"English",code:"en",country_code:"in",enabled:true,is_default:true,rtl:false},{name:"Hindi",code:"hi",country_code:"in",enabled:true,is_default:false,rtl:false},{name:"Bengali",code:"bn",country_code:"in",enabled:false,is_default:false,rtl:false}];
  const update=(i:number,key:string,v:unknown)=>{let next=languages.map((x:R)=>({...x}));if(key==="is_default"&&v)next=next.map((x:R,j:number)=>({...x,is_default:j===i}));else next[i][key]=v;change({...value,languages:next});};const add=()=>{if(!draft.name||!draft.code||!draft.country_code)return;change({...value,languages:[...languages,{...draft,enabled:true,is_default:false,rtl:false}]});setDraft({name:"",code:"",country_code:""});setAdding(false);};
  return <div className="language-settings"><header><div><strong>Language List</strong><small>Enable languages and select the default panel language.</small></div><button type="button" onClick={()=>setAdding(true)}><Plus/> Add Language</button></header><div className="language-head"><b>#</b><b>Language</b><b>Short Code</b><b>Country Code</b><b>Status</b><b>Active</b><b>RTL</b><b>Action</b></div>{languages.map((language:R,i:number)=><div className="language-item" key={`${language.code}-${i}`}><span>{i+1}</span><strong>{language.name}</strong><span>{language.code}</span><span>{language.country_code}</span><b className={language.enabled?"enabled":"disabled"}>{language.enabled?"Enabled":"Disabled"}</b><input type="radio" name="default_language" checked={Boolean(language.is_default)} onChange={()=>update(i,"is_default",true)}/><input type="checkbox" checked={Boolean(language.rtl)} onChange={e=>update(i,"rtl",e.target.checked)}/><div><label className="switch"><input type="checkbox" checked={Boolean(language.enabled)} onChange={e=>update(i,"enabled",e.target.checked)}/><span/></label><button type="button" onClick={()=>change({...value,languages:languages.filter((_:R,x:number)=>x!==i)})}><Trash2/></button></div></div>)}{adding&&<div className="language-back"><section><header><h3>Add Language</h3><button type="button" onClick={()=>setAdding(false)}><X/></button></header>{[["name","Language"],["code","Short Code"],["country_code","Country Code"]].map(([key,label])=><label key={key}><span>{label}<em>*</em></span><input value={draft[key as keyof typeof draft]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}<footer><button type="button" onClick={()=>setAdding(false)}>Cancel</button><button type="button" className="primary" onClick={add}>Add Language</button></footer></section></div>}</div>;
}
