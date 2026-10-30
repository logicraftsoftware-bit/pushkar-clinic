import ListPagination from './ListPagination';
import {patientAgeParts,patientAgeLabel} from "./patient-age";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ChevronDown,
  Edit3,
  Eye,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import "./patients.css";
import "./patient-registration.css";
import { indiaLocations, indianStates } from "./india-locations";
import { AppointmentWorkspace } from "./ClinicalOperations";
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
type R = Record<string, any>;
const LOCATION_API = "https://countriesnow.space/api/v0.1/countries";
class ApiError extends Error {
  data: R;
  constructor(data: R) {
    super(data?.error ?? "Request failed");
    this.data = data;
  }
}
const tabs = [
  "Overview",
  "Appointments",
  "OPD",
  "IPD",
  "Prescriptions",
  "Laboratory",
  "Radiology",
  "Billing",
  "Documents",
];
const bloodGroups = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
  "Unknown",
];
const relationships = [
  "Parent",
  "Spouse",
  "Child",
  "Sibling",
  "Guardian",
  "Friend",
  "Other",
];
const commonAllergies = [
  "No known allergies",
  "Penicillin",
  "Sulfonamides",
  "NSAIDs",
  "Latex",
  "Peanuts",
  "Tree nuts",
  "Milk",
  "Eggs",
  "Shellfish",
  "Soy",
  "Wheat",
];
const commonConditions = [
  "None known",
  "Diabetes",
  "Hypertension",
  "Asthma",
  "Cardiac disease",
  "Kidney disease",
  "Thyroid disorder",
  "Epilepsy",
  "Pregnancy",
];
async function q(path: string, t: string, o: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1${path}`, {
    ...o,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${t}`,
      ...o.headers,
    },
  });
  const d = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new ApiError(d ?? {});
  return d;
}
export default function Patients({ token }: { token: string }) {
  const [rows, setRows] = useState<R[]>([]),
    [branches, setBranches] = useState<R[]>([]),
    [fees, setFees] = useState<R>({
      registration_fee: 0,
      registration_charges: [],
    }),
    [edit, setEdit] = useState<R | null>(null),
    [profile, setProfile] = useState<R | null>(null),
    [tab, setTab] = useState("Overview"),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [page,setPage]=useState(1),[total,setTotal]=useState(0),[listSearch,setListSearch]=useState('');
  const [optionsReady,setOptionsReady]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>{setPage(1);setListSearch(search.trim());},250);return()=>clearTimeout(timer);},[search]);
  const load = useCallback(async (signal?:AbortSignal) => {
    setLoading(true);setError('');
    try{
      const data=await q(`/patients?${new URLSearchParams({page:String(page),page_size:'25',search:listSearch})}`,token,{signal});
      if(signal?.aborted)return;
      setRows(data.rows);setTotal(data.total);
      if(page>1&&page>Math.max(1,Math.ceil(data.total/25)))setPage(Math.max(1,Math.ceil(data.total/25)));
    }catch(error){if(!signal?.aborted)setError(error instanceof Error?error.message:'Unable to load patients');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[token,page,listSearch]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  // Registration options belong to the form and must not delay the patient list.
  useEffect(()=>{
    if(!edit||optionsReady)return;const controller=new AbortController();
    Promise.all([q('/patients/branches',token,{signal:controller.signal}),q('/patients/registration-settings',token,{signal:controller.signal})])
      .then(([branches,fees])=>{if(!controller.signal.aborted){setBranches(branches);setFees(fees);setOptionsReady(true);}})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return()=>controller.abort();
  },[edit,optionsReady,token]);
  const shown=rows;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget),
      obj = Object.fromEntries(f);
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") obj[key] = value.trim();
    }
    if (typeof obj.registration_addons === "string")
      obj.registration_addons = JSON.parse(obj.registration_addons);
    const body = {
      ...obj,
      address: {
        title: obj.title,
        line: obj.address,
        city: obj.city,
        state: obj.state,
        pin: obj.pin,
        age_years:obj.age_years,age_months:obj.age_months,age_days:obj.age_days,
      },
      emergency_contact: {
        name: obj.emergency_name,
        phone: obj.emergency_phone,
        relationship: obj.emergency_relationship,
      },
    };
    try {
      await q(`/patients${edit?.id ? `/${edit.id}` : ""}`, token, {
        method: edit?.id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      setEdit(null);
      load();
    } catch (x) {
      if (
        x instanceof ApiError &&
        x.data.code === "POSSIBLE_DUPLICATE_PATIENT"
      ) {
        const matches = (x.data.matches ?? [])
          .map((match: R) =>
            match.restricted
              ? match.medical_record_number
              : `${match.medical_record_number} — ${match.first_name} ${match.last_name}${match.phone ? ` — ${match.phone}` : ""}`,
          )
          .join("\n");
        if (x.data.can_override && fees.can_override_duplicates) {
          const reason = window.prompt(
            `Possible duplicate patient found:\n\n${matches}\n\nTo create a separate UHID, enter an authorized override reason (minimum 10 characters). Select Cancel to use the existing patient.`,
          );
          if (reason?.trim() && reason.trim().length >= 10) {
            try {
              await q("/patients", token, {
                method: "POST",
                body: JSON.stringify({
                  ...body,
                  duplicate_override: true,
                  duplicate_override_reason: reason.trim(),
                }),
              });
              setEdit(null);
              await load();
              return;
            } catch (overrideError) {
              setError(
                overrideError instanceof Error
                  ? overrideError.message
                  : "Unable to override duplicate warning",
              );
              return;
            }
          }
        }
        const existing = (x.data.matches ?? []).find(
          (match: R) => match.id && !match.restricted,
        );
        if (
          existing &&
          window.confirm(
            `Open existing patient ${existing.medical_record_number} instead?`,
          )
        ) {
          setEdit(null);
          await view(existing);
          return;
        }
        setError(
          `Possible duplicate patient found. Review the existing record before registering: ${matches.replaceAll("\n", "; ")}`,
        );
        return;
      }
      setError(x instanceof Error ? x.message : "Unable to save patient");
    }
  }
  async function view(r: R) {
    try {
      setProfile(await q(`/patients/${r.id}`, token));
      setTab("Overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open profile");
    }
  }
  async function remove(r: R) {
    if (confirm(`Delete ${r.first_name} ${r.last_name}?`)) {
      await q(`/patients/${r.id}`, token, { method: "DELETE" });
      load();
    }
  }
  if(edit&&!optionsReady)return <section className="pt-page" role="status"><LoaderCircle/> Loading registration options...{error&&<p role="alert">{error}<button onClick={()=>setEdit({...edit})}>Retry</button></p>}<button onClick={()=>setEdit(null)}>Back to patients</button></section>;
  if (edit) {
    return (
      <PatientForm
        patient={edit}
        branches={branches}
        fees={fees}
        close={() => setEdit(null)}
        save={save}
        error={error}
        page
      />
    );
  }
  if (profile) {
    const patient = profile.patient;
    const latest = profile.appointments?.[0] ?? {};
    const age = patientAgeLabel(patient);
    return (
      <AppointmentWorkspace
        token={token}
        value={{
          ...latest,
          patient_id: patient.id,
          patient_name: `${patient.first_name} ${patient.last_name}`.trim(),
          medical_record_number: patient.medical_record_number,
          gender: patient.sex,
          age,
          patient_phone: patient.phone,
          allergies: patient.allergies,
          finding: patient.existing_conditions,
          current_medication: patient.current_medication,
          branch_name: patient.branch_name,
          registration_amount: patient.total_amount,
          registration_fee_amount: patient.registration_fee,
          registration_addon_amount: patient.maintenance_fee,
          registration_discount_amount: patient.discount,
          registration_charges: patient.registration_addons,
          appointment_number: latest.appointment_number || "No appointment",
          appointment_date: latest.appointment_date || patient.created_at,
          appointment_time: latest.appointment_time || "",
          token_number: latest.token_number || "No OPD visit",
          status: latest.status || patient.status,
          consultation_fee: latest.consultation_fee || 0,
          charges: latest.charges || [],
          discount: latest.discount || 0,
          paid_amount: latest.paid_amount || 0,
        }}
        close={() => setProfile(null)}
      />
    );
  }
  return (
    <section className="patients-page">
      <header>
        <div>
          <small>Patients / Registry</small>
          <h1>Patients</h1>
          <p>Register and manage patient health records for this hospital.</p>
        </div>
        <button data-permission="patient.create" onClick={() => setEdit({ status: "Active", sex: "unknown" })}>
          <Plus />
          Add Patient
        </button>
      </header>
      {error && <div className="pt-error">{error}</div>}
      <div className="pt-toolbar">
        <Search />
        <input
          placeholder="Search UHID, name, mobile or email…"
          maxLength={150}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>{total.toLocaleString('en-IN')} patients</span>
      </div>
      <div className="pt-card">
        {loading ? (
          <div className="pt-loading">
            <LoaderCircle className="spin" />
            Loading…
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>UHID</th>
                <th>Age</th>
                <th>Gender</th>
                <th>Mobile</th>
                <th>Branch</th>
                <th>Registered</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!shown.length&&<tr><td colSpan={9}>No patients match your search.</td></tr>}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="pt-person">
                      <span>
                        {r.photo_url ? (
                          <img src={r.photo_url} />
                        ) : (
                          <UserRound />
                        )}
                      </span>
                      <strong>
                        {r.first_name} {r.last_name}
                        <small>{r.email || "No email"}</small>
                      </strong>
                    </div>
                  </td>
                  <td>{r.medical_record_number}</td>
                  <td>
                    {patientAgeLabel(r)}
                  </td>
                  <td>{r.sex}</td>
                  <td>{r.phone || "—"}</td>
                  <td>{r.branch_name}</td>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>
                    <b>{r.status}</b>
                  </td>
                  <td>
                    <button onClick={() => view(r)}>
                      <Eye />
                    </button>
                    <button data-permission="patient.update" onClick={() => setEdit(r)}>
                      <Edit3 />
                    </button>
                    <button data-permission="patient.delete" onClick={() => remove(r)}>
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ListPagination label="Patients" page={page} total={total} count={rows.length} busy={loading} onPage={setPage}/>
      </div>
    </section>
  );
}
export function PatientForm({
  patient,
  branches,
  fees,
  close,
  save,
  error,
  page,
  saving = false,
  saveLabel = "Save Patient",
  detailsOnly = false,
}: {
  patient: R;
  branches: R[];
  fees: R;
  close: () => void;
  save: (e: FormEvent<HTMLFormElement>) => void;
  error: string;
  page: boolean;
  saving?: boolean;
  saveLabel?: string;
  detailsOnly?: boolean;
}) {
  const a = patient.address ?? {},
    em = patient.emergency_contact ?? {},
    values: R = { ...patient };
  const [selectedCharges, setSelectedCharges] = useState<R[]>(
      patient.registration_addons ?? [],
    ),
    [photo, setPhoto] = useState(String(patient.photo_url ?? "")),
    [photoError, setPhotoError] = useState(""),
    [stateName, setStateName] = useState(String(a.state || (patient.id ? "" : "Assam"))),
    [referralConsent, setReferralConsent] = useState(
      Boolean(patient.referral_consent),
    ),
    [referralPartner, setReferralPartner] = useState(
      String(patient.referral_partner_id ?? ""),
    ),
    [cityName, setCityName] = useState(String(a.city ?? ""));
  const [stateOptions, setStateOptions] = useState(indianStates),
    [cityOptions, setCityOptions] = useState<string[]>(indiaLocations[String(a.state || (patient.id ? "" : "Assam"))] ?? []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${LOCATION_API}/states`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        const india = payload?.data?.find((country: R) => country.name === "India");
        const states = india?.states?.map((item: R) => String(item.name)).filter(Boolean);
        if (states?.length) setStateOptions(states);
      }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!stateName) { setCityOptions([]); return; }
    const fallback = indiaLocations[stateName] ?? [];
    setCityOptions(fallback);
    const controller = new AbortController();
    fetch(`${LOCATION_API}/state/cities`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "India", state: stateName }), signal: controller.signal,
    }).then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => { if (Array.isArray(payload?.data) && payload.data.length) setCityOptions(payload.data.map(String)); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [stateName]);
  const availableCharges: R[] = fees.registration_charges ?? [],
    chargesTotal = selectedCharges.reduce(
      (sum, charge) => sum + Number(charge.price || 0),
      0,
    );
  const [discount, setDiscount] = useState(Number(values.discount || 0));
  const totalAmount = Math.max(0, chargesTotal - discount);
  const ageParts=patientAgeParts(patient);
  const [selectedBranch,setSelectedBranch]=useState(String(patient.branch_id||(branches.length===1?branches[0].id:'')));
  useEffect(()=>{
    if(branches.length===1)setSelectedBranch(current=>current||String(branches[0].id));
  },[branches]);
  return (
    <div className={page ? "pt-registration-page" : "pt-modal-back"}>
      <form
        className={page ? "pt-modal pt-registration-form" : "pt-modal"}
        data-permission={patient.id?"patient.update":"patient.create"}
        onSubmit={save}
      >
        <header>
          {page && (
            <button
              type="button"
              className="pt-back"
              onClick={close}
              aria-label="Back to patients"
            >
              <ArrowLeft />
            </button>
          )}
          <div>
            <h2>{patient.id ? "Edit Patient" : "Register Patient"}</h2>
            <p>{detailsOnly?`UHID: ${patient.medical_record_number} · Save to return to your appointment or order.`:"UHID is generated automatically."}</p>
          </div>
          {!page && (
            <button type="button" onClick={close}>
              <X />
            </button>
          )}
        </header>
        {error && <div className="pt-error pt-form-error" role="alert">{error}</div>}
        <div>
          <div className="payment-section-title">
            <strong>Personal Details</strong>
            <span>Patient identity, contact and branch information</span>
          </div>
          <label><span>Title *</span><select name="title" required={!patient.id} defaultValue={a.title||""}>
            <option value="">Select title</option>
            {["Mr.","Mrs.","Ms.","Miss","Master","Baby","Dr."].map(title=><option key={title}>{title}</option>)}
          </select></label>
          {[
            ["first_name", "First Name *"],
            ["last_name", "Last Name *"],
          ].map(([name, label]) => (
            <label key={name}>
              <span>{label}</span>
              <input
                name={name}
                required
                minLength={1}
                maxLength={80}
                pattern="[\p{L}][\p{L} '\-]*"
                title="Use letters, spaces, hyphens or apostrophes only"
                defaultValue={values[name] ?? ""}
              />
            </label>
          ))}
          <label><span>Age (years) *</span><input name="age_years" type="number" min="0" max="150" step="1" required defaultValue={ageParts?.years??""}/></label>
          <label><span>Age (months)</span><input name="age_months" type="number" min="0" max="11" step="1" defaultValue={ageParts?.months??0}/></label>
          <label><span>Age (days)</span><input name="age_days" type="number" min="0" max="30" step="1" defaultValue={ageParts?.days??0}/></label>
          <label>
            <span>Blood Group</span>
            <select name="blood_group" defaultValue={values.blood_group ?? ""}>
              <option value="">Select blood group</option>
              {bloodGroups.map((group) => (
                <option key={group}>{group}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Mobile</span>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              minLength={10}
              maxLength={10}
              pattern="[0-9]{10}"
              title="Enter exactly 10 digits"
              placeholder="e.g. 9876543210"
              defaultValue={values.phone ?? ""}
            />
          </label>
          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              maxLength={254}
              pattern="[^\\s@]+@[A-Za-z0-9][A-Za-z0-9-]{1,62}(\\.[A-Za-z0-9][A-Za-z0-9-]{1,62})+"
              title="Enter a complete email address, for example name@example.com"
              placeholder="name@domain.com"
              defaultValue={values.email ?? ""}
            />
          </label>
          <details className="pt-clinical-collapse wide"><summary>Allergies<ChevronDown size={17}/></summary><ClinicalMultiField
            name="allergies"
            label="Allergies"
            options={commonAllergies}
            initialValue={values.allergies}
          /></details>
          <details className="pt-clinical-collapse wide"><summary>Existing Conditions<ChevronDown size={17}/></summary><ClinicalMultiField
            name="existing_conditions"
            label="Existing Conditions"
            options={commonConditions}
            initialValue={values.existing_conditions}
          /></details>
          <details className="pt-clinical-collapse wide"><summary>Current Medication<ChevronDown size={17}/></summary><MedicationField medicines={fees.medicines ?? []} initialValue={values.current_medication} /></details>
          <label className="wide">
            <span>Address</span>
            <textarea
              name="address"
              maxLength={500}
              placeholder="House/building, street and locality"
              defaultValue={a.line ?? ""}
            />
          </label>
          <label>
            <span>State</span>
            <select
              name="state"
              value={stateName}
              onChange={(event) => { setStateName(event.target.value); setCityName(""); }}
            >
              <option value="">Select state</option>
              {stateName && !stateOptions.includes(stateName) && <option value={stateName}>{stateName}</option>}
              {stateOptions.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </label>
          <label>
            <span>City</span>
            <select
              name="city"
              disabled={!stateName}
              value={cityName}
              onChange={(event) => setCityName(event.target.value)}
            >
              <option value="">{stateName ? "Select city" : "Select state first"}</option>
              {cityName && !cityOptions.includes(cityName) && <option value={cityName}>{cityName}</option>}
              {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
          </label>
          <label>
            <span>PIN Code</span>
            <input
              name="pin"
              inputMode="numeric"
              minLength={6}
              maxLength={6}
              pattern="[0-9]{6}"
              title="Enter exactly 6 digits"
              defaultValue={a.pin ?? ""}
            />
          </label>
          <label>
            <span>Emergency Contact Name</span>
            <input
              name="emergency_name"
              maxLength={80}
              pattern="[\p{L}][\p{L} '\-]*"
              title="Use letters, spaces, hyphens or apostrophes only"
              defaultValue={em.name ?? ""}
            />
          </label>
          <label>
            <span>Emergency Contact Number</span>
            <input
              name="emergency_phone"
              type="tel"
              minLength={10}
              maxLength={10}
              pattern="[0-9]{10}"
              title="Enter exactly 10 digits"
              defaultValue={em.phone ?? ""}
            />
          </label>
          <label>
            <span>Relationship</span>
            <select
              name="emergency_relationship"
              defaultValue={em.relationship ?? ""}
            >
              <option value="">Select relationship</option>
              {relationships.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className="patient-photo-upload">
            <span>Photo</span>
            <div>
              {photo ? <img src={photo} alt="Patient" /> : <UserRound />}
              <label>
                <Upload /> Upload Photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      if (
                        !["image/jpeg", "image/png", "image/webp"].includes(
                          file.type,
                        )
                      ) {
                        setPhotoError("Use a JPEG, PNG or WebP image.");
                        e.target.value = "";
                        return;
                      }
                      if (file.size > 2 * 1024 * 1024) {
                        setPhotoError("Photo must be 2 MB or smaller.");
                        e.target.value = "";
                        return;
                      }
                      setPhotoError("");
                      const reader = new FileReader();
                      reader.onload = () =>
                        setPhoto(String(reader.result ?? ""));
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
              {photo && (
                <button type="button" onClick={() => setPhoto("")}>
                  Remove
                </button>
              )}
            </div>
            {photoError && (
              <small className="pt-field-error">{photoError}</small>
            )}
            <input type="hidden" name="photo_url" value={photo} />
          </div>
          <label>
            <span>Branch *</span>
            <select
              name="branch_id"
              required
              value={selectedBranch}
              onChange={event=>setSelectedBranch(event.target.value)}
            >
              <option value="">Select Branch</option>
              {branches.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Gender</span>
            <select name="sex" defaultValue={patient.sex ?? "unknown"}>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={patient.status ?? "Active"}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>
          <div className="payment-section-title">
            <strong>Referral</strong>
            <span>
              Tag the referring commercial partner only with patient consent
            </span>
          </div>
          <label>
            <span>Referred By</span>
            <select
              name="referral_partner_id"
              value={referralPartner}
              disabled={!referralConsent}
              onChange={(event) => setReferralPartner(event.target.value)}
            >
              <option value="">No referral partner</option>
              {(fees.referral_partners ?? []).map((partner: R) => (
                <option key={partner.id} value={partner.id}>
                  {partner.partner_code} · {partner.name} · {partner.phone}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Referral Consent</span>
            <select
              name="referral_consent"
              value={String(referralConsent)}
              onChange={(event) => {
                const consent = event.target.value === "true";
                setReferralConsent(consent);
                if (!consent) setReferralPartner("");
              }}
            >
              <option value="false">Not provided</option>
              <option value="true">Patient consent recorded</option>
            </select>
          </label>
          {!detailsOnly&&<><input type="hidden" name="registration_fee" value="0" />
          <div className="patient-charges">
            <div className="patient-charges-head">
              <div>
                <strong>Charges</strong>
                <span>Add one or more configured hospital charges</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSelectedCharges((items) => [
                    ...items,
                    { id: "", name: "", price: 0 },
                  ])
                }
              >
                <Plus /> Add Charges
              </button>
            </div>
            {!selectedCharges.length && (
              <small>No additional charges selected.</small>
            )}
            {selectedCharges.map((selected, index) => (
              <div
                className="patient-charge-row"
                key={`${index}-${selected.id}`}
              >
                <select
                  value={selected.id ?? ""}
                  onChange={(e) => {
                    const charge = availableCharges.find(
                      (x) => x.id === e.target.value,
                    );
                    setSelectedCharges((items) =>
                      items.map((item, i) =>
                        i === index
                          ? charge
                            ? {
                                id: charge.id,
                                name: charge.name,
                                price: Number(charge.price || 0),
                              }
                            : { id: "", name: "", price: 0 }
                          : item,
                      ),
                    );
                  }}
                >
                  <option value="">Select Charge</option>
                  {availableCharges
                    .filter(
                      (charge) =>
                        charge.id === selected.id ||
                        !selectedCharges.some((item) => item.id === charge.id),
                    )
                    .map((charge) => (
                      <option key={charge.id} value={charge.id}>
                        {charge.name} — ₹{Number(charge.price || 0).toFixed(2)}
                      </option>
                    ))}
                </select>
                <strong>₹{Number(selected.price || 0).toFixed(2)}</strong>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCharges((items) =>
                      items.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
            <div className="patient-total">
              <span>Total Amount</span>
              <strong>₹{totalAmount.toFixed(2)}</strong>
            </div>
            <input
              type="hidden"
              name="registration_addons"
              value={JSON.stringify(
                selectedCharges.filter((charge) => charge.id),
              )}
            />
            <input type="hidden" name="maintenance_fee" value={chargesTotal} />
            <input
              type="hidden"
              name="total_amount"
              value={totalAmount.toFixed(2)}
            />
          </div>
          <div className="payment-section-title">
            <strong>Payment Details</strong>
            <span>Registration charges and payment information</span>
          </div>
          <label>
            <span>Payment Mode</span>
            <select
              name="payment_mode"
              defaultValue={patient.payment_mode ?? ""}
            >
              <option value="">Select Payment Mode</option>
              {(
                fees.payment_methods ?? [
                  "Cash",
                  "Card",
                  "UPI",
                  "Bank Transfer",
                  "Cheque",
                ]
              ).map((mode: string) => (
                <option key={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Ref / UTR No.</span>
            <input
              name="payment_reference"
              defaultValue={patient.payment_reference ?? ""}
            />
          </label>
          <label>
            <span>Discount Amount</span>
            <input
              name="discount"
              type="number"
              min="0"
              max={chargesTotal}
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
            />
          </label>
          <label>
            <span>Discount Remarks</span>
            <input
              name="discount_remarks"
              defaultValue={patient.discount_remarks ?? ""}
            />
          </label>
          <label>
            <span>Payment Status</span>
            <select
              name="registration_payment_status"
              defaultValue={patient.registration_payment_status ?? "Unpaid"}
            >
              <option>Paid</option>
              <option>Unpaid</option>
            </select>
          </label>
          <label>
            <span>Payment Status Remarks</span>
            <input
              name="payment_status_remarks"
              defaultValue={patient.payment_status_remarks ?? ""}
            />
          </label>
          </>}
        </div>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button data-permission={patient.id?"patient.update":"patient.create"} className="primary" disabled={saving}>{saving ? "Saving..." : saveLabel}</button>
        </footer>
      </form>
    </div>
  );
}
type MedicationRow = { medicine: string; dosage: string; frequency: string; duration: string };
function MedicationField({ medicines, initialValue }: { medicines: string[]; initialValue?: string }) {
  const parse = (value: string): MedicationRow[] => {
    const rows = value.split(/\s*;\s*|\s*,\s*/).filter(Boolean).map((entry) => {
      const match = entry.match(/^(.*?)\s*\|\s*Dosage:\s*(.*?)\s*\|\s*Frequency:\s*(.*?)\s*\|\s*Duration:\s*(.*)$/i);
      return match
        ? { medicine: match[1].trim(), dosage: match[2].trim(), frequency: match[3].trim(), duration: match[4].trim() }
        : { medicine: entry.trim(), dosage: "", frequency: "", duration: "" };
    });
    return rows.length ? rows : [{ medicine: "", dosage: "", frequency: "", duration: "" }];
  };
  const [rows, setRows] = useState<MedicationRow[]>(parse(String(initialValue ?? "")));
  const change = (index: number, key: keyof MedicationRow, value: string) =>
    setRows((current) => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const serialized = rows.filter((row) => row.medicine.trim()).map((row) =>
    `${row.medicine.trim()} | Dosage: ${row.dosage.trim() || "Not specified"} | Frequency: ${row.frequency.trim() || "Not specified"} | Duration: ${row.duration.trim() || "Not specified"}`,
  ).join("; ");
  return <fieldset className="pt-medications wide">
    <legend>Current Medication</legend>
    <datalist id="medicine-options">{medicines.map((medicine) => <option key={medicine} value={medicine} />)}</datalist>
    {rows.map((row, index) => <div className="pt-medication-row" key={index}>
      <input aria-label="Medicine" list="medicine-options" maxLength={160} placeholder="Search medicine" value={row.medicine} onChange={(e) => change(index, "medicine", e.target.value)} />
      <input aria-label="Dosage" maxLength={80} placeholder="Dosage" value={row.dosage} onChange={(e) => change(index, "dosage", e.target.value)} />
      <input aria-label="Frequency" maxLength={80} placeholder="Frequency" value={row.frequency} onChange={(e) => change(index, "frequency", e.target.value)} />
      <input aria-label="Duration" maxLength={80} placeholder="Duration" value={row.duration} onChange={(e) => change(index, "duration", e.target.value)} />
      <button type="button" aria-label="Remove medication" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}><Trash2 /></button>
    </div>)}
    <button type="button" className="pt-add-medication" onClick={() => setRows((current) => [...current, { medicine: "", dosage: "", frequency: "", duration: "" }])}><Plus /> Add medication</button>
    <input type="hidden" name="current_medication" value={serialized} />
  </fieldset>;
}

function ClinicalMultiField({
  name,
  label,
  options,
  initialValue,
}: {
  name: string;
  label: string;
  options: string[];
  initialValue?: string;
}) {
  const initial = String(initialValue ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    [selected, setSelected] = useState(
      initial.filter((value) => options.includes(value)),
    ),
    [other, setOther] = useState(
      initial.filter((value) => !options.includes(value)).join(", "),
    );
  const value = [...selected, other.trim()].filter(Boolean).join(", ");
  function toggle(option: string, checked: boolean) {
    const emptyChoice = option.startsWith("No ") || option.startsWith("None ");
    setSelected((current) =>
      checked
        ? emptyChoice
          ? [option]
          : [
              ...current.filter(
                (value) =>
                  !value.startsWith("No ") && !value.startsWith("None "),
              ),
              option,
            ]
        : current.filter((value) => value !== option),
    );
    if (checked && emptyChoice) setOther("");
  }
  return (
    <fieldset className="pt-clinical-multi">
      <legend>{label}</legend>
      {options.map((option) => (
        <label key={option}>
          <input
            type="checkbox"
            checked={selected.includes(option)}
            onChange={(event) => toggle(option, event.target.checked)}
          />
          {option}
        </label>
      ))}
      <label className="pt-other">
        Other
        <input
          maxLength={1000}
          value={other}
          onChange={(event) => {
            setOther(event.target.value);
            if (event.target.value)
              setSelected((current) =>
                current.filter(
                  (value) =>
                    !value.startsWith("No ") && !value.startsWith("None "),
                ),
              );
          }}
          placeholder={`Other ${label.toLowerCase()}`}
        />
      </label>
      <input type="hidden" name={name} value={value} />
    </fieldset>
  );
}

function PatientProfile({
  data,
  tab,
  setTab,
  close,
}: {
  data: R;
  tab: string;
  setTab: (x: string) => void;
  close: () => void;
}) {
  const p = data.patient;
  return (
    <div className="pt-profile-back">
      <section className="pt-profile">
        <header>
          <div className="pt-person">
            <span>
              {p.photo_url ? <img src={p.photo_url} /> : <UserRound />}
            </span>
            <strong>
              {p.first_name} {p.last_name}
              <small>
                {p.medical_record_number} · {p.phone || "No mobile"}
              </small>
            </strong>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <nav>
          {tabs.map((t) => (
            <button
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
              key={t}
            >
              {t}
            </button>
          ))}
        </nav>
        <main>
          {tab === "Overview" ? (
            <div className="pt-overview">
              <aside className="pt-summary-card">
                <div className="pt-profile-photo">
                  {p.photo_url ? <img src={p.photo_url} /> : <UserRound />}
                </div>
                <h2>
                  {p.first_name} {p.last_name}
                </h2>
                <p title="System-generated identifier">{p.medical_record_number}</p>
                <small className="pt-uhid-verified">Server-generated UHID · read-only</small>
                <div className="pt-summary-lines">
                  <span>
                    <b>Gender</b>
                    {p.sex || "—"}
                  </span>
                  <span>
                    <b>Age</b>
                    {patientAgeLabel(p)}
                  </span>
                  <span>
                    <b>Phone</b>
                    {p.phone || "—"}
                  </span>
                  <span>
                    <b>Blood Group</b>
                    {p.blood_group || "—"}
                  </span>
                  <span>
                    <b>Allergies</b>
                    {p.allergies || "None recorded"}
                  </span>
                </div>
                <div className="pt-summary-registration">
                  <b>Registration Details</b>
                  <span>Branch: {p.branch_name || "—"}</span>
                  <span>
                    Registered:{" "}
                    {p.created_at
                      ? new Date(p.created_at).toLocaleDateString()
                      : "—"}
                  </span>
                  <span>Payment: {p.registration_payment_status || "—"}</span>
                </div>
              </aside>
              <section className="pt-overview-main">
                <div className="pt-finance-grid">
                  <article>
                    <b>IPD Payment / Billing</b>
                    <strong>₹0 / ₹0</strong>
                    <small>0% paid</small>
                  </article>
                  <article>
                    <b>Pharmacy Payment / Billing</b>
                    <strong>₹0 / ₹0</strong>
                    <small>0% paid</small>
                  </article>
                  <article>
                    <b>Pathology Payment / Billing</b>
                    <strong>₹0 / ₹0</strong>
                    <small>0% paid</small>
                  </article>
                  <article>
                    <b>Radiology Payment / Billing</b>
                    <strong>₹0 / ₹0</strong>
                    <small>0% paid</small>
                  </article>
                </div>
                <section className="pt-clinical-section">
                  <h3>Medication</h3>
                  <p>{p.current_medication || "No medication recorded."}</p>
                </section>
                <section className="pt-clinical-section">
                  <h3>Prescription</h3>
                  {data.appointments.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Appointment</th>
                          <th>Date</th>
                          <th>Doctor</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.appointments.map((appointment: R) => (
                          <tr key={appointment.id}>
                            <td>
                              {appointment.token_number ||
                                appointment.appointment_number}
                            </td>
                            <td>
                              {new Date(
                                appointment.appointment_date,
                              ).toLocaleDateString()}
                            </td>
                            <td>{appointment.doctor_name || "—"}</td>
                            <td>{appointment.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p>No prescription recorded.</p>
                  )}
                </section>
                <section className="pt-clinical-section">
                  <h3>Consultant Register</h3>
                  <p>No consultant instructions recorded.</p>
                </section>
                <section className="pt-clinical-section">
                  <h3>Lab Investigation</h3>
                  <p>No lab investigations recorded.</p>
                </section>
                <section className="pt-clinical-section">
                  <h3>Operations</h3>
                  <p>No operations recorded.</p>
                </section>
                <section className="pt-clinical-section">
                  <h3>Charges</h3>
                  <p>
                    Registration charges: ₹
                    {Number(p.total_amount || 0).toFixed(2)}
                  </p>
                </section>
              </section>
              <div className="pt-overview-legacy">
                {[
                  ["UHID", p.medical_record_number],
                  ["Age", patientAgeLabel(p)],
                  ["Gender", p.sex],
                  ["Blood Group", p.blood_group],
                  ["Mobile", p.phone],
                  ["Email", p.email],
                  ["Branch", p.branch_name],
                  ["Allergies", p.allergies],
                  ["Existing Conditions", p.existing_conditions],
                  ["Current Medication", p.current_medication],
                  ["Emergency Contact", p.emergency_contact?.name],
                  [
                    "Additional Charges",
                    `₹${Number(p.maintenance_fee || 0).toFixed(2)}`,
                  ],
                  [
                    "Selected Charges",
                    (p.registration_addons ?? [])
                      .map(
                        (addon: R) =>
                          `${addon.name} (₹${Number(addon.price || 0).toFixed(2)})`,
                      )
                      .join(", "),
                  ],
                  [
                    "Total Registration Charges",
                    `₹${Number(p.total_amount || 0).toFixed(2)}`,
                  ],
                  ["Payment Mode", p.payment_mode],
                  ["Ref / UTR No.", p.payment_reference],
                  ["Discount", `₹${Number(p.discount || 0).toFixed(2)}`],
                  ["Discount Remarks", p.discount_remarks],
                  ["Payment Status", p.registration_payment_status],
                  ["Payment Status Remarks", p.payment_status_remarks],
                  [
                    "Registration Date",
                    new Date(p.created_at).toLocaleString(),
                  ],
                ].map(([l, v]) => (
                  <div key={l}>
                    <small>{l}</small>
                    <strong>{v || "—"}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : tab === "Appointments" ? (
            <div className="pt-tab-list">
              {data.appointments.length
                ? `${data.appointments.length} appointment records`
                : "No appointment records yet."}
            </div>
          ) : tab === "Billing" ? (
            <div className="pt-tab-list">
              {data.payments.length
                ? `${data.payments.length} billing records`
                : "No billing records yet."}
            </div>
          ) : (
            <div className="pt-tab-list">
              No {tab.toLowerCase()} records yet.
            </div>
          )}
        </main>
      </section>
    </div>
  );
}
