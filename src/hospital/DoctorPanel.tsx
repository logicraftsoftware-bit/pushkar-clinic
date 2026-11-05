import {queueRequest,useStaffQueues,timeLabel} from '../queue/useLiveQueue';
import DoctorQueueSettings from '../queue/DoctorQueueSettings';
import '../queue/queue.css';
import {doctorWithQualification} from '../../server/src/doctor-print-display';
import {PRESCRIPTION_PRINT_CSS,prescriptionObservationsHtml} from "./prescription-paper";
import Swal from "sweetalert2";
import {consultationData,allergyConflicts} from '../../server/src/consultation-validation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  RefreshCw,
  CalendarDays,
  ArrowLeft,
  Bell,
  BellRing,
  Plus,
  Printer,
  Trash2,
  FileHeart,
  LoaderCircle,
  Mic,
  MicOff,
  PenLine,
  Save,
  Search,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import "./doctor-panel.css";
import "./doctor-consultation.css";

type Row = Record<string, any>;
const API = import.meta.env.VITE_API_URL ?? "";
async function request(path: string, token: string, options: RequestInit = {}) {
  const response = await fetch(`${API}/api/v1/doctor${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "Unable to load doctor workspace");
  return data;
}

const recordTypes: Record<string, string> = {
  Consultation: "consultation",
  Diagnosis: "diagnosis",
  Prescriptions: "prescription",
  "Clinical Orders": "order",
  "Follow-up": "follow_up",
  "AI Voice": "voice_documentation",
};
const consultationLanguages = [
  ["en-IN", "English"],
  ["hi-IN", "हिन्दी (Hindi)"],
  ["bn-IN", "বাংলা (Bengali)"],
  ["te-IN", "తెలుగు (Telugu)"],
  ["mr-IN", "मराठी (Marathi)"],
  ["ta-IN", "தமிழ் (Tamil)"],
  ["ur-IN", "اردو (Urdu)"],
  ["gu-IN", "ગુજરાતી (Gujarati)"],
  ["kn-IN", "ಕನ್ನಡ (Kannada)"],
  ["ml-IN", "മലയാളം (Malayalam)"],
  ["pa-IN", "ਪੰਜਾਬੀ (Punjabi)"],
  ["or-IN", "ଓଡ଼ିଆ (Odia)"],
  ["as-IN", "অসমীয়া (Assamese)"],
  ["ne-NP", "नेपाली (Nepali)"],
  ["ar-SA", "العربية (Arabic)"],
  ["es-ES", "Español (Spanish)"],
  ["fr-FR", "Français (French)"],
];

export default function DoctorPanel({
  page,
  token,
  onNavigate,
}: {
  page: string;
  token: string;
  onNavigate?: (page: string) => void;
}) {
  const [data, setData] = useState<Row>({ appointments: [], ipdAdmissions: [], metrics: {} });
  const [selected, setSelected] = useState<Row | null>(null);
  const [queueSlot, setQueueSlot] = useState<Row | null>(null);
  const [consulting, setConsulting] = useState(false);
  const [emr, setEmr] = useState<Row | null>(null);
  const [ipdViewing,setIpdViewing]=useState(false);
  const [ipdDischarging,setIpdDischarging]=useState(false);
  const [search, setSearch] = useState("");
  const [slot, setSlot] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request("/overview", token);
      setData(result);
      setSelected((current) => current ?? result.appointments[0] ?? result.completedAppointments?.[0] ?? null);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load doctor workspace",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setEmr(null);
    if (!selected?.patient_id) return;
    const controller=new AbortController();
    request(`/patients/${selected.patient_id}`, token,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setEmr(result);})
      .catch(()=>{if(!controller.signal.aborted)setEmr(null);});
    return()=>controller.abort();
  }, [selected?.patient_id, token]);
  const slots = useMemo(() => {
    const now = Date.now();
    return (Array.isArray(data.slots) ? data.slots : [])
      .map((item: Row) => {
        const raw = String(item.appointment_date || "");
        const date = /^\d{2}-\d{2}-\d{4}$/.test(raw)
          ? raw.split("-").reverse().join("-")
          : raw.slice(0, 10);
        return {
          ...item,
          date,
          key: `${date}|${String(item.from_time).slice(0, 5)}|${String(item.to_time).slice(0, 5)}`,
          startsAt: new Date(
            `${date}T${String(item.from_time).slice(0, 5)}:00`,
          ).getTime(),
        };
      })
      .filter((item: Row) => item.date)
      .sort((a: Row, b: Row) => {
        const af = a.startsAt >= now,
          bf = b.startsAt >= now;
        return af !== bf
          ? af
            ? -1
            : 1
          : af
            ? a.startsAt - b.startsAt
            : b.startsAt - a.startsAt;
      });
  }, [data.slots]);
  useEffect(() => {
    if (slot || !slots.length) return;
    const now = new Date(),
      today = now.toISOString().slice(0, 10),
      time = now.toTimeString().slice(0, 5),
      unfinished = data.appointments || [];
    const next =
      slots.find(
        (item: Row) =>
          (item.date > today ||
            (item.date === today &&
              String(item.to_time).slice(0, 5) >= time)) &&
          unfinished.some(
            (appointment: Row) =>
              String(appointment.appointment_date).slice(0, 10) === item.date &&
              String(appointment.appointment_time).slice(0, 5) >=
                String(item.from_time).slice(0, 5) &&
              String(appointment.appointment_time).slice(0, 5) <
                String(item.to_time).slice(0, 5),
          ),
      ) ||
      slots.find(
        (item: Row) =>
          item.date > today ||
          (item.date === today && String(item.to_time).slice(0, 5) >= time),
      ) ||
      slots[0];
    setSlot(next?.key || "");
  }, [data.appointments, slot, slots]);
  const appointments = useMemo(
    () =>
      data.appointments.filter((item: Row) => {
        const matchesSearch = JSON.stringify(item)
          .toLowerCase()
          .includes(search.toLowerCase());
        if (page !== "OPD Appointments" || !slot) return matchesSearch;
        const [date, from, to] = slot.split("|"),
          appointmentDate = String(item.appointment_date).slice(0, 10),
          appointmentTime = String(item.appointment_time).slice(0, 5);
        return (
          matchesSearch &&
          appointmentDate === date &&
          appointmentTime >= from &&
          appointmentTime < to
        );
      }),
    [data.appointments, page, search, slot],
  );
  if (loading)
    return (
      <div className="doctor-loading">
        <LoaderCircle className="spin" /> Loading doctor workspace…
      </div>
    );
  return (
    <section className="doctor-panel">
      <header>
        <div>
          <small>Doctor Workspace / {page}</small>
          <h1>{page === "Dashboard" ? "Doctor Dashboard" : page}</h1>
          <p>
            Appointments, clinical documentation and longitudinal patient
            records.
          </p>
        </div>
      </header>
      {error && <div className="doctor-error">{error}</div>}
      {page === "Dashboard" ? (
        queueSlot ? (
          <DoctorSlotQueue
            slot={queueSlot}
            rows={data.appointments}
            token={token}
            active={selected}
            emr={emr}
            close={() => {
              setQueueSlot(null);
              setSelected(null);
            }}
            select={setSelected}
            reload={async () => {
              const patientId = selected?.patient_id;
              const [, latestEmr] = await Promise.all([
                load(),
                patientId
                  ? request(`/patients/${patientId}`, token)
                  : Promise.resolve(null),
              ]);
              if (latestEmr) setEmr(latestEmr);
            }}
          />
        ) : (
          <DoctorDashboard
            data={data}
            appointments={appointments}
            slots={slots}
            openSlot={setQueueSlot}
            select={setSelected}
          />
        )
      ) : page === "IPD Appointments" ? (
        (ipdViewing||ipdDischarging)&&selected?<ConsultationWorkspace dischargeMode={ipdDischarging} appointment={selected} emr={emr} token={token} close={()=>{setIpdViewing(false);setIpdDischarging(false)}} reload={async()=>{await load();if(selected?.patient_id)await request(`/patients/${selected.patient_id}`,token).then(setEmr)}}/>:<IpdAppointments rows={data.ipdAdmissions||[]} search={search} setSearch={setSearch} open={(row)=>{setSelected({...row,appointment_date:row.admitted_at,appointment_time:"",token_number:row.ipd_number,reason:row.reason_diagnosis});setIpdViewing(true)}} discharge={(row)=>{setSelected({...row,appointment_date:row.admitted_at,appointment_time:"",token_number:row.ipd_number,reason:row.reason_diagnosis});setIpdDischarging(true)}} undo={async(row)=>{setError("");try{await request(`/ipd/${row.id}/discharge-request`,token,{method:"DELETE"});await load()}catch(error){setError(error instanceof Error?error.message:"Unable to undo discharge")}}}/>
      ) : page === "OPD Appointments" ? (
        consulting && selected ? (
          <ConsultationWorkspace
            appointment={selected}
            emr={emr}
            token={token}
            close={() => setConsulting(false)}
            reload={async()=>{await load();if(selected?.patient_id)await request(`/patients/${selected.patient_id}`,token).then(setEmr);}}
          />
        ) : (
          <Appointments
            rows={appointments}
            slots={slots}
            slot={slot}
            setSlot={setSlot}
            search={search}
            setSearch={setSearch}
            select={(appointment) => {
              setSelected(appointment);
              setConsulting(true);
            }}
          />
        )
      ) : page === "Patient EMR" ? (
        <><label>Patient encounter <select value={selected?.id||''} onChange={event=>{setSelected([...(data.appointments||[]),...(data.completedAppointments||[])].find(row=>row.id===event.target.value)||null);}}><option value="">Select encounter</option>{[...(data.appointments||[]),...(data.completedAppointments||[])].map(row=><option key={row.id} value={row.id}>{row.patient_name} - {row.appointment_date?.slice(0,10)} - {row.status}</option>)}</select></label><EMR key={selected?.patient_id} data={emr?.patient?.id===selected?.patient_id?emr:null} appointment={selected} token={token} reload={async()=>{if(selected?.patient_id)await request(`/patients/${selected.patient_id}`,token).then(setEmr);}} /></>
      ) : (
        <ClinicalForm
          page={page}
          appointment={selected}
          emr={emr}
          token={token}
          reload={() =>
            selected?.patient_id &&
            request(`/patients/${selected.patient_id}`, token).then(setEmr)
          }
        />
      )}
    </section>
  );
}

function IpdAppointments({rows,search,setSearch,open,discharge,undo}:{rows:Row[];search:string;setSearch:(value:string)=>void;open:(row:Row)=>void;discharge:(row:Row)=>void;undo:(row:Row)=>void}){
  const filtered=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
  const wards=Array.from(new Set(filtered.map(row=>row.ward_name||"Bed not allocated")));
  return <div className="doctor-ipd-list">
    <div className="doctor-card doctor-toolbar"><Search/><input placeholder="Search IPD patient, UHID, ward, room or bed" value={search} onChange={event=>setSearch(event.target.value)}/><span>{filtered.length} active patients</span></div>
    {wards.map(ward=><section className="doctor-card doctor-ward" key={ward}><header><div><h2>{ward}</h2><p>Patients currently assigned to you</p></div><strong>{filtered.filter(row=>(row.ward_name||"Bed not allocated")===ward).length}</strong></header><table><thead><tr><th>Patient</th><th>IPD / Admission</th><th>Room & Bed</th><th>Department</th><th>Status</th><th/></tr></thead><tbody>{filtered.filter(row=>(row.ward_name||"Bed not allocated")===ward).map(row=>{const dischargePending=String(row.status).toLowerCase()==="discharge requested";return <tr key={row.id}><td><strong>{row.patient_name}</strong><small>{row.medical_record_number} · {row.phone||"No phone"}</small></td><td><strong>{row.ipd_number}</strong><small>{new Date(row.admitted_at).toLocaleString()}</small></td><td><strong>{row.room_number||"No room"} · {row.bed_number||"No bed"}</strong><small>{row.bed_type||"Bed type not recorded"}</small></td><td>{row.department_name||"—"}</td><td><b>{row.status}</b></td><td><div className="doctor-ipd-actions"><button disabled={dischargePending} title={dischargePending?"Waiting for reception discharge approval":undefined} onClick={()=>open(row)}>Open EMR</button><button className="discharge" onClick={()=>dischargePending?undo(row):discharge(row)}>{dischargePending?"Undo Discharge":"Discharge"}</button></div></td></tr>})}</tbody></table></section>)}
    {!filtered.length&&<div className="doctor-card doctor-empty">No active IPD patients are assigned to you.</div>}
  </div>
}

function DoctorDashboard({
  data,
  appointments,
  slots,
  openSlot,
  select,
}: {
  data: Row;
  appointments: Row[];
  slots: Row[];
  openSlot: (slot: Row) => void;
  select: (row: Row) => void;
}) {
  return (
    <>
      <div className="doctor-metrics">
        {[
          ["Today's appointments", data.metrics.today],
          ["Waiting", data.metrics.waiting],
          ["Completed", data.metrics.completed],
          ["My patients", data.metrics.patients],
        ].map(([label, value]) => (
          <article key={String(label)}>
            <span>{label}</span>
            <strong>{value ?? 0}</strong>
          </article>
        ))}
      </div>
      <div className="doctor-card doctor-slots">
        <header>
          <div>
            <h2>OPD Slots</h2>
            <p>Nearest scheduled slot appears first.</p>
          </div>
          <span>{slots.length} slots</span>
        </header>
        <table>
          <thead>
            <tr>
              <th>Slot Date & Time</th>
              <th>Patients Registered / Total Slot</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {slots.map((item) => {
              const registered = appointments.filter(
                (row) =>
                  String(row.appointment_date).slice(0, 10) === item.date &&
                  String(row.appointment_time).slice(0, 5) >=
                    String(item.from_time).slice(0, 5) &&
                  String(row.appointment_time).slice(0, 5) <
                    String(item.to_time).slice(0, 5),
              ).length;
              return (
                <tr key={item.key}>
                  <td>
                    <strong>
                      {new Date(`${item.date}T00:00:00`).toLocaleDateString(
                        undefined,
                        {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        },
                      )}
                    </strong>
                    <small>
                      {String(item.from_time).slice(0, 5)} –{" "}
                      {String(item.to_time).slice(0, 5)}
                    </small>
                  </td>
                  <td>
                    <b>
                      {registered} / {item.max_slots || "∞"}
                    </b>
                  </td>
                  <td>
                    <button onClick={() => openSlot(item)}>Open</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!slots.length && (
          <div className="doctor-empty">
            No appointment slots scheduled for this doctor.
          </div>
        )}
      </div>
    </>
  );
}

function DoctorSlotQueue({slot,rows,token,active,emr,close,select,reload}:{slot:Row;rows:Row[];token:string;active:Row|null;emr:Row|null;close:()=>void;select:(row:Row|null)=>void;reload:()=>void}) {
  const [filter,setFilter]=useState('All'),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
  const matching=rows.filter(row=>String(row.appointment_date).slice(0,10)===slot.date&&String(row.appointment_time).slice(0,5)>=String(slot.from_time).slice(0,5)&&String(row.appointment_time).slice(0,5)<String(slot.to_time).slice(0,5));
  const [chosenBranch,setChosenBranch]=useState('');
  const branch=chosenBranch||matching[0]?.branch_id||slot.branch_id||rows[0]?.branch_id,doctor=matching[0]?.doctor_id||slot.doctor_id||rows[0]?.doctor_id;
  const branchChoices=Array.from(new Map(rows.filter(row=>String(row.appointment_date).slice(0,10)===slot.date).map(row=>[row.branch_id,row.branch_name||row.branch_id])).entries());
  const params=new URLSearchParams({date:slot.date,from:String(slot.from_time).slice(0,5),to:String(slot.to_time).slice(0,5),...(branch?{branch_id:branch}:{}),...(doctor?{doctor_id:doctor}:{})});
  const live=useStaffQueues('/queue/live?'+params,token),queue=live.data?.queues?.find((row:Row)=>!doctor||row.doctor_id===doctor);
  const shown=(queue?.rows||[]).filter((row:Row)=>filter==='All'||row.status===filter);
  async function status(row:Row,value:'Present'|'Absent'|'Skip'|'Waiting'){
    setBusy(row.id);setNotice('');try{
      const saved=await queueRequest('/doctor/appointments/'+row.id+'/status',token,{method:'PATCH',body:JSON.stringify({status:value})});
      await live.reload();
      if(value==='Present')select({...rows.find(item=>item.id===row.id),...saved,patient_name:row.patient_name,doctor_name:queue.doctor_name,doctor_qualification:queue.doctor_qualification});
      else if(active?.id===row.id)select(null);
    }catch(error){setNotice((error as Error).message);}finally{setBusy('');}
  }
  async function notify(row:Row,target:'patient'|'reception'){
    try{await queueRequest('/doctor/appointments/'+row.id+'/notify',token,{method:'POST',body:JSON.stringify({target})});await live.reload();setNotice(target==='patient'?'Call sent to the live queue and assigned waiting screens.':'Reception notified.');}catch(error){setNotice((error as Error).message);}
  }
  return <section className="live-doctor-queue"><header className="live-pagehead"><div><button onClick={close}><ArrowLeft size={16}/>Sessions</button><h2>Doctor OPD queue</h2><p>{slot.date} | {String(slot.from_time).slice(0,5)} - {String(slot.to_time).slice(0,5)} | {queue?.room||'Room not assigned'}</p></div><div className="queue-actions">{branchChoices.length>1&&<select aria-label="Queue branch" value={branch} onChange={event=>{setChosenBranch(event.target.value);select(null);}}>{branchChoices.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>}{doctor&&branch&&<DoctorQueueSettings doctorId={doctor} branchId={branch} token={token} onSaved={()=>void live.reload()}/>}<button onClick={()=>void live.reload()}><RefreshCw size={16}/>Refresh</button></div></header>
    {(notice||live.error)&&<p className="queue-warning" role="status">{notice||live.error}</p>}
    {queue?<><div className="queue-stats">{Object.entries(queue.counts).map(([label,value])=><div key={label}><span>{label.replace('_',' ')}</span><strong>{String(value)}</strong></div>)}</div><div className="live-queue-summary"><div><small>NOW SERVING ? {queue.status}</small><strong>{queue.current?.serial??'?'}</strong><p>{queue.rows.find((row:Row)=>row.id===queue.current?.id)?.patient_name||'Waiting for the doctor'}</p></div><div><small>NEXT PATIENT</small><strong>{queue.next?.serial??'?'}</strong><p>Estimated {timeLabel(queue.next?.estimated_at)} ? times may change</p></div></div><div className="live-queue-tabs">{['All','Waiting','Awaiting check-in','In Consultation','Completed','Skipped','No Show'].map(value=><button className={filter===value?'active':''} key={value} onClick={()=>setFilter(value)}>{value}</button>)}</div><div className="queue-table-wrap"><table><thead><tr><th>Serial</th><th>Patient</th><th>Booking number</th><th>Scheduled</th><th>Estimated</th><th>Status</th><th>Actions</th></tr></thead><tbody>{shown.map((row:Row)=><tr key={row.id}><td><b>{row.serial}</b></td><td>{row.patient_name}</td><td>{row.appointment_number}</td><td>{row.appointment_time}</td><td>{timeLabel(row.estimated_at)}</td><td>{row.status}</td><td><div className="queue-actions">{!['Completed','Cancelled','No Show'].includes(row.status)&&<><button disabled={Boolean(busy)||!row.checked_in} onClick={()=>status(row,'Present')}>{row.status==='In Consultation'?'View':'Present'}</button><button disabled={Boolean(busy)||!row.checked_in} onClick={()=>status(row,row.status==='Skipped'?'Waiting':'Skip')}>{row.status==='Skipped'?'Return':'Skip'}</button><button disabled={Boolean(busy)||!row.checked_in} onClick={()=>status(row,'Absent')}>Absent</button><button title="Notify reception" onClick={()=>notify(row,'reception')}><Bell size={15}/></button>{row.status==='In Consultation'&&<button title="Announce again" onClick={()=>notify(row,'patient')}><BellRing size={15}/></button>}</>}</div></td></tr>)}</tbody></table></div></>:<p className="queue-empty">{live.error||'Loading live queue?'}</p>}
    {active&&<ConsultationWorkspace appointment={active} emr={emr} token={token} close={()=>select(null)} reload={async()=>{await live.reload();await Promise.resolve(reload());}}/>}
  </section>;
}

function Appointments({
  rows,
  slots,
  slot,
  setSlot,
  search,
  setSearch,
  select,
}: {
  rows: Row[];
  slots?: Row[];
  slot?: string;
  setSlot?: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  select: (r: Row) => void;
}) {
  return (
    <div className="doctor-card">
      <div className="doctor-toolbar">
        <Search />
        <input
          placeholder="Search patient or appointment"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {slots && setSlot && (
          <select
            className="doctor-slot-filter"
            value={slot}
            onChange={(event) => setSlot(event.target.value)}
          >
            <option value="">All unfinished appointments</option>
            {slots.map((item) => (
              <option value={item.key} key={item.key}>
                {new Date(`${item.date}T00:00:00`).toLocaleDateString(
                  undefined,
                  { day: "2-digit", month: "short", year: "numeric" },
                )}{" "}
                · {String(item.from_time).slice(0, 5)}–
                {String(item.to_time).slice(0, 5)}
              </option>
            ))}
          </select>
        )}
        <span>{rows.length} appointments</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Date & Time</th>
            <th>Patient</th>
            <th>Reason</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                {new Date(row.appointment_date).toLocaleDateString()}
                <small>{row.appointment_time}</small>
              </td>
              <td>
                <strong>{row.patient_name}</strong>
                <small>{row.medical_record_number}</small>
              </td>
              <td>{row.reason || "—"}</td>
              <td>
                <b>{row.status}</b>
              </td>
              <td>
                <button type="button" onClick={() => select(row)}>
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="doctor-empty">No appointments found.</div>
      )}
    </div>
  );
}
const consultTabs = [
  "Summary",
  "Symptoms / History",
  "Vitals / Observation",
  "Investigation",
  "Diagnosis",
  "Rx",
  "Advice",
  "Follow Up",
  "Images",
  "Comment",
];
export function ConsultationWorkspace(props:Parameters<typeof LoadedConsultationWorkspace>[0]){
  if(!props.emr||props.emr.patient?.id!==props.appointment.patient_id)return <div role="status">Loading patient history and allergies...</div>;
  return <LoadedConsultationWorkspace key={props.appointment.id+':'+Boolean(props.dischargeMode)+':'+(props.emr.records?.find((r:Row)=>r.appointment_id===props.appointment.id&&r.record_type==='consultation')?.updated_at||'new')} {...props}/>;
}
export function LoadedConsultationWorkspace({
  appointment,
  emr,
  token,
  close,
  reload,
  dischargeMode=false,
}: {
  appointment: Row;
  emr: Row | null;
  token: string;
  close: () => void;
  reload: () => void;
  dischargeMode?:boolean;
}) {
  const previousRecord=emr?.records?.find((record:Row)=>
    (appointment.ipd_number?record.admission_id:record.appointment_id)===appointment.id&&
    record.record_type===(dischargeMode?'discharge_summary':'consultation'));
  const previous=previousRecord?.data||{};
  const [ipdRecordId,setIpdRecordId]=useState<string|undefined>(previousRecord?.id);
  const isIpd=Boolean(appointment.ipd_number),encounterPayload=isIpd?{admission_id:appointment.id}:{appointment_id:appointment.id};
  const encounterDate=appointment.appointment_date||appointment.admitted_at;
  const encounterTime=appointment.appointment_time?String(appointment.appointment_time).slice(0,5):"";
  const ipdVisits=(emr?.records||[]).filter((record:Row)=>record.admission_id===appointment.id);
  const [active, setActive] = useState(dischargeMode?"Summary":"Rx"),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [transcript, setTranscript] = useState(""),
    [listening, setListening] = useState(false),
    [analyzing, setAnalyzing] = useState(false),
    [dictatingField, setDictatingField] = useState(""),
    [readingHandwriting, setReadingHandwriting] = useState(false),
    [writingPad, setWritingPad] = useState<{ key: string; label: string } | null>(
      null,
    ),
    [captureLanguage, setCaptureLanguage] = useState("en-IN"),
    [prescriptionMasters, setPrescriptionMasters] = useState<Row>({
      medicine: [],
      category: [],
      dosage: [],
      interval: [],
      duration: [],
      pathology_test: [],
      radiology_test: [],
    });
  const recognitionRef = useRef<any>(null);
  const sectionRecognitionRef = useRef<any>(null);
  const writingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const writingHasInkRef = useRef(false);
  const [clinical, setClinical] = useState<Row>({
    symptoms: previous.symptoms || appointment.symptoms?.join(", ") || "",
    history: previous.history || "",
    vitals: previous.vitals || {
      temperature: "",
      pulse: "",
      blood_pressure: "",
      spo2: "",
      weight: "",
    },
    investigation: previous.investigation || "",
    lab_tests: Array.isArray(previous.lab_tests) ? previous.lab_tests : [],
    radiology_tests: Array.isArray(previous.radiology_tests)
      ? previous.radiology_tests
      : [],
    handwritten_notes:
      previous.handwritten_notes && typeof previous.handwritten_notes === "object"
        ? previous.handwritten_notes
        : {},
    diagnosis: previous.diagnosis || "",
    advice: previous.advice || "",
    follow_up: previous.follow_up || "",
    images: previous.images || "",
    comment: previous.comment || "",
    discharge_type: previous.discharge_type || "Normal Discharge",
    chief_complaints: previous.chief_complaints || previous.symptoms || "",
    reason_for_admission: previous.reason_for_admission || appointment.reason_diagnosis || "",
    past_history: previous.past_history || "",
    hospital_course: previous.hospital_course || "",
    procedures: previous.procedures || "",
    treatment_given: previous.treatment_given || "",
    condition_at_discharge: previous.condition_at_discharge || "Stable",
    discharge_observations: previous.discharge_observations || "",
    diet_advice: previous.diet_advice || "",
    warning_signs: previous.warning_signs || "High fever, severe pain, difficulty breathing, bleeding, loss of consciousness, seizure, or any sudden deterioration.",
    pending_reports: previous.pending_reports || "",
    follow_up_doctor: previous.follow_up_doctor || appointment.doctor_name || "",
    follow_up_date: previous.follow_up_date || "",
    follow_up_tests: previous.follow_up_tests || "",
    medicines: previous.medicines || [],
    encounter_status: previous.encounter_status || "Draft",
  });
  useEffect(() => {
    request("/prescription-masters", token)
      .then(setPrescriptionMasters)
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load prescription masters",
        ),
      );
  }, [token]);
  const update = (key: string, value: unknown) =>
    setClinical((current: Row) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!writingPad) return;
    const canvas = writingCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3;
    context.strokeStyle = "#172033";
    const saved = clinical.handwritten_notes?.[writingPad.key];
    writingHasInkRef.current = Boolean(saved);
    if (saved) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = saved;
    }
  }, [writingPad]);
  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget,
      bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }
  function startWriting(event: React.PointerEvent<HTMLCanvasElement>) {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    drawingRef.current = true;
    writingHasInkRef.current = true;
  }
  function continueWriting(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = canvasPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }
  function stopWriting() {
    drawingRef.current = false;
  }
  function clearWritingPad() {
    const canvas = writingCanvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    writingHasInkRef.current = false;
  }
  function saveWritingPad() {
    if (!writingPad) return;
    const image = writingHasInkRef.current
      ? writingCanvasRef.current?.toDataURL("image/png") ?? ""
      : "";
    setClinical((current: Row) => ({
      ...current,
      handwritten_notes: {
        ...(current.handwritten_notes || {}),
        [writingPad.key]: image,
      },
    }));
    setWritingPad(null);
  }
  async function convertHandwritingToText() {
    if (!writingPad || !writingHasInkRef.current) {
      setMessage("Write something on the pad before converting it to text.");
      return;
    }
    const image = writingCanvasRef.current?.toDataURL("image/png");
    if (!image) return;
    setReadingHandwriting(true);
    setMessage("");
    try {
      const result = await request("/handwriting", token, {
        method: "POST",
        body: JSON.stringify({ image, section: writingPad.label }),
      });
      setClinical((current: Row) => ({
        ...current,
        [writingPad.key]: `${String(current[writingPad.key] || "").trim()}${current[writingPad.key] ? "\n" : ""}${result.text}`,
        handwritten_notes: {
          ...(current.handwritten_notes || {}),
          [writingPad.key]: image,
        },
      }));
      setMessage("Handwriting converted to text. Please review it before saving.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to read handwriting",
      );
    } finally {
      setReadingHandwriting(false);
    }
  }
  const updateMedicine = (index: number, key: string, value: string) =>
    update(
      "medicines",
      clinical.medicines.map((medicine: Row, i: number) =>
        i === index ? { ...medicine, [key]: value } : medicine,
      ),
    );
  const medicineMaster = (name: string) =>
    prescriptionMasters.medicine?.find(
      (row: Row) =>
        String(row.name).trim().toLowerCase() === name.trim().toLowerCase(),
    );
  const categoryName = (id: unknown) =>
    String(
      prescriptionMasters.category?.find((row: Row) => row.id === id)?.name ??
        "",
    );
  function updateMedicineName(index: number, name: string) {
    const selected = medicineMaster(name),
      categoryId = selected?.data?.category_id,
      matchingDose = prescriptionMasters.dosage?.find(
        (row: Row) => row.data?.category_id === categoryId,
      );
    setClinical((current: Row) => ({
      ...current,
      medicines: current.medicines.map((medicine: Row, i: number) =>
        i === index
          ? {
              ...medicine,
              name,
              medicine_id: selected?.id ?? "",
              type: selected ? categoryName(categoryId) : medicine.type,
              dose:
                selected && matchingDose ? matchingDose.name : medicine.dose,
            }
          : medicine,
      ),
    }));
  }
  const updateLabTest = (index: number, key: string, value: string) =>
    update(
      "lab_tests",
      clinical.lab_tests.map((test: Row, i: number) =>
        i === index ? { ...test, [key]: value } : test,
      ),
    );
  const pathologyTestMaster = (name: string) =>
    prescriptionMasters.pathology_test?.find(
      (row: Row) =>
        String(row.name).trim().toLowerCase() ===
        String(name || "")
          .trim()
          .toLowerCase(),
    );
  function updateLabTestName(index: number, testId: string) {
    const selected = prescriptionMasters.pathology_test?.find(
      (row: Row) => row.id === testId,
    );
    setClinical((current: Row) => ({
      ...current,
      lab_tests: current.lab_tests.map((test: Row, i: number) =>
        i === index
          ? {
              ...test,
              test_id: selected?.id ?? "",
              name: selected?.name ?? "",
              short_name: selected?.data?.short_name ?? "",
              charge_id: selected?.data?.charge_id ?? "",
              amount: selected?.data?.amount ?? 0,
            }
          : test,
      ),
    }));
  }
  const updateRadiologyTest = (index: number, key: string, value: string) =>
    update(
      "radiology_tests",
      clinical.radiology_tests.map((test: Row, i: number) =>
        i === index ? { ...test, [key]: value } : test,
      ),
    );
  const radiologyTestMaster = (name: string) =>
    prescriptionMasters.radiology_test?.find(
      (row: Row) =>
        String(row.name).trim().toLowerCase() ===
        String(name || "").trim().toLowerCase(),
    );
  function updateRadiologyTestName(index: number, testId: string) {
    const selected = prescriptionMasters.radiology_test?.find(
      (row: Row) => row.id === testId,
    );
    setClinical((current: Row) => ({
      ...current,
      radiology_tests: current.radiology_tests.map((test: Row, i: number) =>
        i === index
          ? {
              ...test,
              test_id: selected?.id ?? "",
              name: selected?.name ?? "",
              short_name: selected?.data?.short_name ?? "",
              charge_id: selected?.data?.charge_id ?? "",
              amount: selected?.data?.amount ?? 0,
            }
          : test,
      ),
    }));
  }
  function toggleSoapCapture() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessage(
        "Conversation capture is not supported in this browser. You can paste the transcript instead.",
      );
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = captureLanguage;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event: any) =>
      setTranscript((value) =>
        `${value} ${Array.from(event.results)
          .slice(event.resultIndex)
          .map((result: any) => result[0].transcript)
          .join(" ")}`.trim(),
      );
    recognitionRef.current = recognition;
    recognition.start();
  }
  function toggleSectionDictation(key: string) {
    if (dictatingField === key) {
      sectionRecognitionRef.current?.stop();
      return;
    }
    sectionRecognitionRef.current?.stop();
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessage(
        "Speech-to-text is not supported in this browser. Please use Chrome or Edge.",
      );
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = captureLanguage;
    recognition.onstart = () => setDictatingField(key);
    recognition.onend = () => setDictatingField("");
    recognition.onerror = () => {
      setDictatingField("");
      setMessage("Microphone input stopped. Check browser microphone permission.");
    };
    recognition.onresult = (event: any) => {
      const spoken = Array.from(event.results)
        .slice(event.resultIndex)
        .map((result: any) => result[0].transcript)
        .join(" ")
        .trim();
      if (!spoken) return;
      setClinical((current: Row) => ({
        ...current,
        [key]: `${String(current[key] || "").trim()}${current[key] ? " " : ""}${spoken}`,
      }));
    };
    sectionRecognitionRef.current = recognition;
    recognition.start();
  }
  async function generateSoap() {
    if (transcript.trim().length < 10) {
      setMessage("Record or paste a longer consultation conversation first.");
      return;
    }
    setAnalyzing(true);
    setMessage("");
    try {
      const result = await request("/soap", token, {
          method: "POST",
          body: JSON.stringify({ ...encounterPayload, transcript }),
        }),
        soap = result.soap || {};
      setClinical((current: Row) => ({
        ...current,
        ...soap,
        vitals: { ...current.vitals, ...soap.vitals },
        medicines:
          Array.isArray(soap.medicines) && soap.medicines.length
            ? soap.medicines
            : current.medicines,
        lab_tests: Array.isArray(soap.lab_tests)
          ? soap.lab_tests
          : current.lab_tests,
      }));
      setMessage(
        "SOAP draft applied. Review every tab, then save the consultation.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to generate SOAP draft",
      );
    } finally {
      setAnalyzing(false);
    }
  }
  const savePending=useRef(false);
  const completed=clinical.encounter_status==='Completed';
  const conflicts=allergyConflicts(emr?.patient?.allergies,clinical.medicines||[]);
  async function save(print = false,complete=false) {
    if(savePending.current||completed)return;
    const parsed=consultationData.safeParse({...clinical,encounter_status:complete?'Completed':'Draft'});
    if(!parsed.success){const issue=parsed.error.issues[0];setActive(issue?.path[0]==='medicines'?'Rx':'Investigation');setMessage(`${issue?.path.join('.')}: ${issue?.message||'Check the consultation inputs.'}`);return;}
    if(conflicts.length){setMessage(conflicts.join(' '));return;}
    savePending.current=true;
    setSaving(true);
    setMessage("");
    try {
      const saved=await request("/records", token, {
        method: "POST",
        body: JSON.stringify({
          patient_id: appointment.patient_id,
          ...encounterPayload,
          ...(isIpd&&ipdRecordId?{record_id:ipdRecordId}:{}),
          record_type: "consultation",
          data: parsed.data,
        }),
      });
      if(!saved?.id||saved.patient_id!==appointment.patient_id||(isIpd&&saved.admission_id!==appointment.id))throw new Error('The saved prescription could not be confirmed. Please reload and check the visit before retrying.');
      if(isIpd)setIpdRecordId(saved.id);
      setClinical(current=>({...current,encounter_status:complete?'Completed':'Draft'}));
      setMessage(isIpd?'IPD prescription saved successfully. It remains available in Rx and Visit History.':complete?'Consultation completed successfully':'Consultation draft saved successfully');
      if (print) await printConsultation();
      await Promise.resolve(reload());
      if(complete){window.dispatchEvent(new CustomEvent('app-success',{detail:'OPD consultation completed and closed.'}));close();return;}
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save consultation",
      );
    } finally {
      savePending.current=false;
      setSaving(false);
    }
  }
  async function requestDischarge(){
    if(!isIpd)return;
    if(!String(clinical.diagnosis||"").trim()||!String(clinical.hospital_course||"").trim()||!String(clinical.advice||"").trim()){setMessage("Final diagnosis, clinic course and discharge advice are mandatory.");return}
    setSaving(true);setMessage("");
    try{await request(`/ipd/${appointment.id}/discharge-request`,token,{method:"POST",body:JSON.stringify(clinical)});await Promise.resolve(reload());close()}catch(error){setMessage(error instanceof Error?error.message:"Unable to request discharge")}finally{setSaving(false)}
  }
  async function saveDischargeDraft(){if(!isIpd)return;setSaving(true);setMessage("");try{await request("/records",token,{method:"POST",body:JSON.stringify({patient_id:appointment.patient_id,...encounterPayload,record_type:"discharge_summary",data:{...clinical,document_status:"Draft"}})});setMessage("Discharge summary draft saved. The consultant must review and submit it before discharge.");await Promise.resolve(reload())}catch(error){setMessage(error instanceof Error?error.message:"Unable to save draft")}finally{setSaving(false)}}
  async function printConsultation() {
    const win = window.open("", "_blank");
    if (!win) {
      setMessage("Allow pop-ups to print the prescription.");
      return;
    }
    const safe = (value: unknown) =>
        String(value ?? "").replace(
          /[&<>"']/g,
          (char) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[char]!,
        );
    const tests = (clinical.lab_tests || []).filter((test: Row) => test.name),
      medicines = (clinical.medicines || []).filter(
        (medicine: Row) => medicine.name,
      );
    const testRows = tests.length
      ? tests
          .map(
            (test: Row, index: number) =>
              `<div class="test"><b>${index + 1}. ${safe(test.name)}</b><span>${safe(test.priority || "Routine")}${test.instruction ? ` · ${safe(test.instruction)}` : ""}</span></div>`,
          )
          .join("")
      : `<p class="empty">No tests prescribed.</p>`;
    const medicineRows = medicines.length
      ? medicines
          .map(
            (medicine: Row, index: number) =>
              `<div class="medicine"><b>${index + 1}. ${safe(`${medicine.type || ""} ${medicine.name}`.trim())}</b><div><span>${safe(medicine.dose)}</span><span>${safe(medicine.frequency)}</span><span>${safe(medicine.duration)}</span><span>${safe(medicine.when)}</span><span>${safe(medicine.instruction)}</span></div></div>`,
          )
          .join("")
      : `<p class="empty">No medicines prescribed.</p>`;
    win.document.write(
      `<!doctype html><html><head><title>OPD Prescription</title><style>@page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{font:11px Arial;color:#151515;margin:0;min-height:277mm;display:flex;flex-direction:column}.template-header{display:block;width:100%;margin:0;padding:0}.template-header img{display:block;width:100%!important;max-width:none!important;height:auto!important;max-height:none!important;object-fit:fill}.title{text-align:center;font-size:15px;margin:7px 0}.patient{display:grid;grid-template-columns:1fr 1fr;gap:5px 25px;border-top:1px solid #222;border-bottom:1px solid #222;padding:8px 5px}.patient div{display:grid;grid-template-columns:95px 1fr}.patient b:after{content:":"}.clinical{padding:8px 5px;border-bottom:1px solid #222}.clinical p{margin:3px 0}.rx-grid{display:grid;grid-template-columns:34% 66%;min-height:390px;border-bottom:1px solid #222}.rx-column{padding:0 9px}.rx-column+ .rx-column{border-left:1px solid #222}.rx-column h2{text-align:center;font-size:12px;margin:0 -9px 8px;padding:7px;border-bottom:1px solid #222}.test,.medicine{padding:5px 0;border-bottom:1px dotted #bbb}.test b,.test span,.medicine b,.medicine span{display:block}.test span,.medicine span{color:#4e4e4e;font-size:10px;margin-top:2px}.medicine{display:grid;grid-template-columns:minmax(150px,1fr) 1fr;gap:10px}.instructions{padding:10px 5px}.instructions h3{font-size:11px;margin:0 0 5px}.instructions p{margin:4px 0;white-space:pre-wrap}.template-footer{margin-top:auto;border-top:1px solid #222;padding-top:8px}.empty{color:#777}.printed{text-align:right;color:#777;font-size:9px;margin:4px 0}@media print{body{print-color-adjust:exact}}${PRESCRIPTION_PRINT_CSS}</style></head><body><section class="patient"><div><b>Patient</b><span>${safe(appointment.patient_name)}</span></div><div><b>UHID</b><span>${safe(appointment.medical_record_number)}</span></div><div><b>Gender</b><span>${safe(emr?.patient?.sex || appointment.sex || "—")}</span></div><div><b>Phone</b><span>${safe(emr?.patient?.phone || appointment.patient_phone || appointment.phone || "—")}</span></div><div><b>Appointment</b><span>${safe(new Date(appointment.appointment_date).toLocaleDateString())} ${safe(String(appointment.appointment_time).slice(0, 5))}</span></div><div><b>Doctor</b><span>${safe(doctorWithQualification(appointment.doctor_name,appointment.doctor_qualification))}</span></div><div><b>Token</b><span>${safe(appointment.queue_serial || appointment.slot_serial || appointment.token_number || "—")}</span></div></section>${prescriptionObservationsHtml(clinical.vitals,emr?.patient?.allergies||"")}<h1 class="title">OPD Prescription</h1><section class="clinical"><p><b>Symptoms / History:</b> ${safe([clinical.symptoms, clinical.history].filter(Boolean).join(" · ") || "—")}</p><p><b>Provisional Diagnosis:</b> ${safe(clinical.diagnosis || "—")}</p></section><section class="rx-grid"><div class="rx-column"><h2>Lab Tests</h2>${testRows}</div><div class="rx-column"><h2>Medicines</h2>${medicineRows}</div></section><section class="instructions"><h3>General Instructions</h3>${clinical.investigation ? `<p><b>Investigation:</b> ${safe(clinical.investigation)}</p>` : ""}${clinical.advice ? `<p><b>Advice:</b> ${safe(clinical.advice)}</p>` : ""}${clinical.follow_up ? `<p><b>Next Appointment:</b> ${safe(clinical.follow_up)}</p>` : ""}${clinical.comment ? `<p><b>Notes:</b> ${safe(clinical.comment)}</p>` : ""}</section><p class="printed">Printed ${safe(new Date().toLocaleString())}</p></body></html>`,
    );
    win.document.close();
    win.onload = () => setTimeout(() => win.print(), 250);
  }
  const basicTextArea = (key: string, label: string) => (
    <div className="dc-section">
      <div className="dc-section-heading">
        <h3>{label}</h3>
        <div className="dc-section-tools">
          <button
            type="button"
            title={`Open ${label} writing pad`}
            aria-label={`Open ${label} writing pad`}
            onClick={() => setWritingPad({ key, label })}
          >
            <PenLine />
          </button>
          <button
            type="button"
            className={dictatingField === key ? "recording" : ""}
            title={dictatingField === key ? "Stop recording" : `Record ${label}`}
            aria-label={dictatingField === key ? "Stop recording" : `Record ${label}`}
            onClick={() => toggleSectionDictation(key)}
          >
            {dictatingField === key ? <MicOff /> : <Mic />}
          </button>
        </div>
      </div>
      <textarea
        value={clinical[key]}
        onChange={(event) => update(key, event.target.value)}
        placeholder={`Enter ${label.toLowerCase()}`}
      />
      {clinical.handwritten_notes?.[key] && (
        <button
          type="button"
          className="dc-handwriting-preview"
          onClick={() => setWritingPad({ key, label })}
          title={`Open handwritten ${label}`}
        >
          <img src={clinical.handwritten_notes[key]} alt={`Handwritten ${label}`} />
          <span><PenLine /> Handwritten note</span>
        </button>
      )}
    </div>
  );
  const textArea = (key: string, label: string) =>
    key !== "investigation" ? (
      basicTextArea(key, label)
    ) : (
      <div className="dc-investigation">
        <div className="dc-rx-head">
          <h3>Lab Tests</h3>
          <button
            type="button"
            onClick={() =>
              update("lab_tests", [
                ...clinical.lab_tests,
                { name: "", priority: "Routine", instruction: "" },
              ])
            }
          >
            <Plus /> Add Lab Test
          </button>
        </div>
        {clinical.lab_tests.length ? (
          clinical.lab_tests.map((test: Row, index: number) => (
            <div className="dc-lab-test" key={index}>
              <span>{index + 1}</span>
              <label>
                <small>Test Name</small>
                <select
                  value={
                    test.test_id || pathologyTestMaster(test.name)?.id || ""
                  }
                  onChange={(event) =>
                    updateLabTestName(index, event.target.value)
                  }
                >
                  <option value="">Search and select pathology test</option>
                  {(prescriptionMasters.pathology_test || []).map(
                    (master: Row) => (
                      <option key={master.id} value={master.id}>
                        {master.name}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <small>Priority</small>
                <select
                  value={test.priority}
                  onChange={(event) =>
                    updateLabTest(index, "priority", event.target.value)
                  }
                >
                  <option>Routine</option>
                  <option>Urgent</option>
                  <option>STAT</option>
                </select>
              </label>
              <label>
                <small>Instructions</small>
                <input
                  value={test.instruction}
                  placeholder="Fasting or sample instructions"
                  onChange={(event) =>
                    updateLabTest(index, "instruction", event.target.value)
                  }
                />
              </label>
              <button
                type="button"
                title="Remove lab test"
                onClick={() =>
                  update(
                    "lab_tests",
                    clinical.lab_tests.filter(
                      (_: Row, i: number) => i !== index,
                    ),
                  )
                }
              >
                <Trash2 />
              </button>
            </div>
          ))
        ) : (
          <p className="dc-empty">No lab tests added yet.</p>
        )}
        <div className="dc-rx-head">
          <h3>Radiology Tests</h3>
          <button
            type="button"
            onClick={() =>
              update("radiology_tests", [
                ...clinical.radiology_tests,
                { name: "", priority: "Routine", instruction: "" },
              ])
            }
          >
            <Plus /> Add Radiology Test
          </button>
        </div>
        {clinical.radiology_tests.length ? (
          clinical.radiology_tests.map((test: Row, index: number) => (
            <div className="dc-lab-test" key={index}>
              <span>{index + 1}</span>
              <label>
                <small>Test Name</small>
                <select
                  value={
                    test.test_id || radiologyTestMaster(test.name)?.id || ""
                  }
                  onChange={(event) =>
                    updateRadiologyTestName(index, event.target.value)
                  }
                >
                  <option value="">Search and select radiology test</option>
                  {(prescriptionMasters.radiology_test || []).map(
                    (master: Row) => (
                      <option key={master.id} value={master.id}>
                        {master.name}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <small>Priority</small>
                <select
                  value={test.priority}
                  onChange={(event) =>
                    updateRadiologyTest(index, "priority", event.target.value)
                  }
                >
                  <option>Routine</option>
                  <option>Urgent</option>
                  <option>STAT</option>
                </select>
              </label>
              <label>
                <small>Instructions</small>
                <input
                  value={test.instruction}
                  placeholder="Imaging or preparation instructions"
                  onChange={(event) =>
                    updateRadiologyTest(
                      index,
                      "instruction",
                      event.target.value,
                    )
                  }
                />
              </label>
              <button
                type="button"
                title="Remove radiology test"
                onClick={() =>
                  update(
                    "radiology_tests",
                    clinical.radiology_tests.filter(
                      (_: Row, i: number) => i !== index,
                    ),
                  )
                }
              >
                <Trash2 />
              </button>
            </div>
          ))
        ) : (
          <p className="dc-empty">No radiology tests added yet.</p>
        )}
        {basicTextArea("investigation", "Investigation Notes")}
      </div>
    );
  const soapAi = (
    <div className="dc-soap">
      <header>
        <div>
          <h3>
            <Sparkles /> Multilingual SOAP AI
          </h3>
          <p>
            Choose the spoken language. Groq converts the conversation into
            structured clinical English for doctor review.
          </p>
        </div>
        <label>
          <small>Conversation Language</small>
          <select
            value={captureLanguage}
            disabled={listening}
            onChange={(event) => setCaptureLanguage(event.target.value)}
          >
            {consultationLanguages.map(([code, name]) => (
              <option value={code} key={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          className={listening ? "recording" : ""}
          type="button"
          onClick={toggleSoapCapture}
        >
          {listening ? <MicOff /> : <Mic />}
          {listening ? "Stop Listening" : "Start Listening"}
        </button>
      </header>
      <textarea
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        placeholder="Conversation transcript will appear here in the spoken language…"
      />
      <footer>
        <small>
          {transcript.trim()
            ? `${transcript.trim().split(/\s+/).length} words captured · Output will be English`
            : "No conversation captured"}
        </small>
        <button
          type="button"
          disabled={analyzing || transcript.trim().length < 10}
          onClick={generateSoap}
        >
          <Sparkles />
          {analyzing ? "Translating & Creating SOAP…" : "Translate & Fill SOAP"}
        </button>
      </footer>
    </div>
  );
  return (
    <section className="doctor-consult">
      <header>
        <button onClick={close}>
          <ArrowLeft />
        </button>
        <div>
          <small>{dischargeMode?"IPD Discharge Prescription":"Consultation Workspace"}</small>
          <h2>{appointment.patient_name}</h2>
          <p>
            {appointment.medical_record_number} · {isIpd?`${appointment.ipd_number} · ${appointment.ward_name||"No ward"} · ${appointment.bed_number||"No bed"}`:`${new Date(encounterDate).toLocaleDateString()} ${encounterTime}`}
          </p>
        </div>
        <button
          className="soap-launch"
          type="button"
          title="Open SOAP AI conversation"
          aria-label="Open SOAP AI conversation"
          onClick={() => setActive("SOAP AI")}
        >
          <Mic />
        </button>
        {!dischargeMode&&<button onClick={() => save()} disabled={saving||completed}>
          <Save /> Save Draft
        </button>}
        {isIpd&&!dischargeMode&&<button disabled={saving||!ipdRecordId} onClick={async()=>{
          const result=await Swal.fire({title:'Start a new IPD visit?',text:'Save any changes to the current visit first. Earlier prescriptions remain in Visit History.',showCancelButton:true,confirmButtonText:'New visit'});
          if(!result.isConfirmed)return;
          setIpdRecordId(undefined);setClinical({symptoms:'',history:'',vitals:{temperature:'',pulse:'',blood_pressure:'',spo2:'',weight:''},investigation:'',lab_tests:[],radiology_tests:[],handwritten_notes:{},diagnosis:'',advice:'',follow_up:'',images:'',comment:'',medicines:[],encounter_status:'Draft'});setMessage('New IPD visit. Add and save the prescription.');setActive('Rx');
        }}>New Visit</button>}
        {!isIpd&&!dischargeMode&&<button className="dc-complete" onClick={()=>save(false,true)} disabled={saving||completed}>Complete / Sign</button>}
        {dischargeMode&&<><button onClick={saveDischargeDraft} disabled={saving}><Save/> Save Draft</button><button className="discharge-action" onClick={requestDischarge} disabled={saving}>Finalize & Submit</button></>}
        {!dischargeMode&&<button
          className="primary"
          onClick={() => save(true)}
          disabled={saving||completed}
        >
          <Printer /> Save & Print
        </button>}
      </header>
      <nav>
        {(dischargeMode?["Summary","Clinical History","Diagnosis","Clinic Course","Investigations","Procedures","Treatment Given","Rx","Advice","Warning Signs","Follow Up","Pending Reports"]:[...consultTabs,...(isIpd?["Visit History"]:[])]).map((tab) => (
          <button
            className={active === tab ? "active" : ""}
            onClick={() => setActive(tab)}
            key={tab}
          >
            {tab}
          </button>
        ))}
      </nav>
      <div className="doctor-message" role="status">Encounter: {completed?'Completed':'Draft'} | Allergies: {emr?.patient?.allergies||'None recorded'}</div>
      {conflicts.length>0&&<div role="alert" className="doctor-message">{conflicts.join(' ')}</div>}
      {message && <div className="doctor-message" role="status">{message}</div>}
      <main><fieldset disabled={completed||saving} style={{border:0,padding:0,margin:0,minWidth:0}}>
        {active === "Visit History" ? <div className="dc-visit-history"><h3>IPD Doctor Visits</h3>{ipdVisits.map((visit:Row,index:number)=><article key={visit.id}><header><strong>{visit.record_type==="discharge_summary"?"Discharge Recommendation":`Visit ${ipdVisits.length-index}`}</strong><time>{new Date(visit.created_at).toLocaleString()}</time></header><p><b>Diagnosis:</b> {visit.data?.diagnosis||"—"}</p><p><b>Advice:</b> {visit.data?.advice||visit.data?.comment||"—"}</p><div><span>Medicines: {visit.data?.medicines?.filter((item:Row)=>item.name).map((item:Row)=>item.name).join(", ")||"None"}</span><span>Lab: {visit.data?.lab_tests?.filter((item:Row)=>item.name).map((item:Row)=>item.name).join(", ")||"None"}</span><span>Radiology: {visit.data?.radiology_tests?.filter((item:Row)=>item.name).map((item:Row)=>item.name).join(", ")||"None"}</span></div></article>)}{!ipdVisits.length&&<p>No previous IPD visits saved.</p>}</div> : active === "Summary" ? (
          <div className="dc-summary">
            <article>
              <small>Patient</small>
              <b>{appointment.patient_name}</b>
            </article>
            <article>
              <small>Gender</small>
              <b>{emr?.patient?.sex || "—"}</b>
            </article>
            <article>
              <small>Phone</small>
              <b>{emr?.patient?.phone || "—"}</b>
            </article>
            <article>
              <small>Allergies</small>
              <b>{emr?.patient?.allergies || "None recorded"}</b>
            </article>
            {dischargeMode&&<><label>Discharge type<select value={clinical.discharge_type} onChange={e=>update("discharge_type",e.target.value)}>{["Normal Discharge","DAMA / LAMA","Transfer to Another Hospital","Death","Absconded","Other"].map(x=><option key={x}>{x}</option>)}</select></label><label>Condition at discharge<select value={clinical.condition_at_discharge} onChange={e=>update("condition_at_discharge",e.target.value)}>{["Stable","Improved","Unchanged","Critical","Transferred","Other"].map(x=><option key={x}>{x}</option>)}</select></label></>}
          </div>
        ) : dischargeMode && active === "Clinical History" ? <div className="dc-two">{textArea("chief_complaints","Chief complaints")}{textArea("reason_for_admission","Reason for admission / history of present illness")}{textArea("past_history","Relevant medical, surgical and family history")}{textArea("discharge_observations","Significant examination findings / discharge observations")}</div>
        : dischargeMode && active === "Clinic Course" ? textArea("hospital_course","Consolidated clinic course and treatment response")
        : dischargeMode && active === "Investigations" ? textArea("investigation","Important laboratory and radiology results")
        : dischargeMode && active === "Procedures" ? textArea("procedures","Procedures / surgery details")
        : dischargeMode && active === "Treatment Given" ? textArea("treatment_given","Medicines, IV fluids, injections, oxygen, transfusion and therapies during stay")
        : dischargeMode && active === "Warning Signs" ? textArea("warning_signs","Warning signs / when to seek emergency care")
        : dischargeMode && active === "Pending Reports" ? textArea("pending_reports","Pending investigation reports and delivery method")
        : active === "Symptoms / History" ? (
          <div className="dc-two">
            {textArea("symptoms", "Symptoms")}
            {textArea("history", "Medical History")}
          </div>
        ) : active === "Vitals / Observation" ? (
          <div className="dc-vitals">
            {[
              ["temperature", "Temperature"],
              ["pulse", "Pulse"],
              ["blood_pressure", "Blood Pressure"],
              ["spo2", "SpO₂"],
              ["weight", "Weight"],
            ].map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  value={clinical.vitals[key]}
                  onChange={(event) =>
                    update("vitals", {
                      ...clinical.vitals,
                      [key]: event.target.value,
                    })
                  }
                />
              </label>
            ))}
          </div>
        ) : active === "SOAP AI" ? (
          soapAi
        ) : active === "Investigation" ? (
          textArea("investigation", "Investigation / Clinical Orders")
        ) : active === "Diagnosis" ? (
          textArea("diagnosis", "Diagnosis")
        ) : active === "Advice" ? (
          textArea("advice", "Advice")
        ) : active === "Follow Up" ? (
          textArea("follow_up", "Follow-up Plan")
        ) : active === "Images" ? (
          textArea("images", "Images / Document Links")
        ) : active === "Comment" ? (
          textArea("comment", "Clinical Comment")
        ) : (
          <div className="dc-rx">
            <div className="dc-rx-head">
              <h3>Prescription Medicines</h3>
              <button
                onClick={() =>
                  update("medicines", [
                    ...clinical.medicines,
                    {
                      type: "",
                      name: "",
                      dose: "",
                      time: "",
                      when: "After Food",
                      frequency: "Daily",
                      duration: "",
                      quantity: "",
                      instruction: "",
                    },
                  ])
                }
              >
                <Plus /> Add Medicine
              </button>
            </div>
            {clinical.medicines.map((medicine: Row, index: number) => (
              <div className="dc-medicine" key={index}>
                <span>{index + 1}</span>
                <label>
                  <small>Type</small>
                  <select
                    value={medicine.type || ""}
                    onChange={(event) =>
                      updateMedicine(index, "type", event.target.value)
                    }
                  >
                    <option value="">Select</option>
                    {prescriptionMasters.category?.map((row: Row) => (
                      <option key={row.id} value={row.name}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dc-medicine-name">
                  <small>Medicine Name</small>
                  <select
                    value={
                      medicine.medicine_id ||
                      medicineMaster(medicine.name || "")?.id ||
                      ""
                    }
                    onChange={(event) => {
                      const selected = prescriptionMasters.medicine?.find(
                        (row: Row) => row.id === event.target.value,
                      );
                      updateMedicineName(index, selected?.name || "");
                    }}
                  >
                    <option value="">Search and select medicine</option>
                    {prescriptionMasters.medicine?.map((row: Row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <small>Dose</small>
                  <select
                    value={medicine.dose || ""}
                    onChange={(event) =>
                      updateMedicine(index, "dose", event.target.value)
                    }
                  >
                    <option value="">Select</option>
                    {prescriptionMasters.dosage
                      ?.filter(
                        (row: Row) =>
                          !medicine.type ||
                          categoryName(row.data?.category_id) === medicine.type,
                      )
                      .map((row: Row) => (
                        <option key={row.id} value={row.name}>
                          {row.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <small>Time</small>
                  <input
                    value={medicine.time || ""}
                    onChange={(event) =>
                      updateMedicine(index, "time", event.target.value)
                    }
                  />
                </label>
                <label>
                  <small>When</small>
                  <select
                    value={medicine.when || ""}
                    onChange={(event) =>
                      updateMedicine(index, "when", event.target.value)
                    }
                  >
                    <option value="">Select</option>
                    <option>Before Food</option>
                    <option>After Food</option>
                    <option>With Food</option>
                    <option>As Directed</option>
                  </select>
                </label>
                <label>
                  <small>Frequency</small>
                  <select
                    value={medicine.frequency || ""}
                    onChange={(event) =>
                      updateMedicine(index, "frequency", event.target.value)
                    }
                  >
                    <option value="">Select</option>
                    {prescriptionMasters.interval?.map((row: Row) => (
                      <option key={row.id} value={row.name}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <small>Duration</small>
                  <select
                    value={medicine.duration || ""}
                    onChange={(event) =>
                      updateMedicine(index, "duration", event.target.value)
                    }
                  >
                    <option value="">Select</option>
                    {prescriptionMasters.duration?.map((row: Row) => (
                      <option key={row.id} value={row.name}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <small>Quantity</small>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    step="1"
                    value={medicine.quantity || ""}
                    onChange={(event) =>
                      updateMedicine(index, "quantity", event.target.value)
                    }
                  />
                </label>
                <label className="dc-instruction">
                  <small>Instruction</small>
                  <input
                    value={medicine.instruction || ""}
                    onChange={(event) =>
                      updateMedicine(index, "instruction", event.target.value)
                    }
                  />
                </label>
                <button
                  onClick={() =>
                    update(
                      "medicines",
                      clinical.medicines.filter(
                        (_: Row, i: number) => i !== index,
                      ),
                    )
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        )}
      </fieldset></main>
      {!isIpd&&!dischargeMode&&<footer className="dc-encounter-actions"><div><strong>{completed?'Completed encounter':'Finish OPD consultation'}</strong><small>{completed?'This signed encounter is read-only.':'Save Draft keeps the encounter open. Complete / Sign closes it.'}</small></div>{!completed?<><button disabled={saving} onClick={()=>save()}>Save Draft</button><button className="dc-complete" disabled={saving} onClick={()=>save(false,true)}>{saving?'Saving...':'Complete / Sign'}</button></>:<button onClick={printConsultation}>Print completed encounter</button>}</footer>}
      {writingPad && (
        <div className="dc-writing-pad-back" role="presentation">
          <section className="dc-writing-pad" role="dialog" aria-modal="true">
            <header>
              <div>
                <small>Clinical Writing Pad</small>
                <h2>{writingPad.label}</h2>
              </div>
              <button type="button" onClick={() => setWritingPad(null)}>×</button>
            </header>
            <div className="dc-writing-canvas-wrap">
              <canvas
                ref={writingCanvasRef}
                width={1000}
                height={470}
                onPointerDown={startWriting}
                onPointerMove={continueWriting}
                onPointerUp={stopWriting}
                onPointerCancel={stopWriting}
                onPointerLeave={stopWriting}
              />
              <small>Write with a mouse, touchscreen, or digital pen.</small>
              <textarea
                value={String(clinical[writingPad.key] || "")}
                onChange={(event) => update(writingPad.key, event.target.value)}
                placeholder="Typed or microphone-transcribed notes appear here"
              />
            </div>
            <footer>
              <button type="button" onClick={clearWritingPad}>Clear Pad</button>
              <button
                type="button"
                className={dictatingField === writingPad.key ? "recording" : ""}
                onClick={() => toggleSectionDictation(writingPad.key)}
              >
                {dictatingField === writingPad.key ? <MicOff /> : <Mic />}
                {dictatingField === writingPad.key ? "Stop Recording" : "Record Notes"}
              </button>
              <button
                type="button"
                disabled={readingHandwriting}
                onClick={convertHandwritingToText}
              >
                <PenLine /> {readingHandwriting ? "Reading…" : "Convert to Text"}
              </button>
              <button type="button" className="primary" onClick={saveWritingPad}>
                Save Note
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
function EMR({
  data,
  appointment,
  token,
  reload,
}: {
  data: Row | null;
  appointment: Row | null;
  token:string;
  reload:()=>void;
}) {
  const [opened,setOpened]=useState<Row|null>(null);
  if(opened&&data){const encounter=data.appointments?.find((row:Row)=>row.id===opened.appointment_id);if(encounter)return <ConsultationWorkspace appointment={{...encounter,patient_name:[data.patient.first_name,data.patient.last_name].join(' '),medical_record_number:data.patient.medical_record_number}} emr={data} token={token} close={()=>setOpened(null)} reload={reload}/>;}
  if (!appointment)
    return (
      <div className="doctor-empty">
        Select an appointment to open the patient EMR.
      </div>
    );
  if (!data)
    return (
      <div className="doctor-loading">
        <LoaderCircle className="spin" /> Loading EMR…
      </div>
    );
  const p = data.patient;
  return (
    <div className="emr-grid">
      <article className="doctor-card patient-summary">
        <FileHeart />
        <h2>
          {p.first_name} {p.last_name}
        </h2>
        <p>
          {p.medical_record_number} · {p.sex} · {p.phone || "No mobile"}
        </p>
        <dl>
          <dt>Blood group</dt>
          <dd>{p.blood_group || "—"}</dd>
          <dt>Allergies</dt>
          <dd>{p.allergies || "None recorded"}</dd>
          <dt>Conditions</dt>
          <dd>{p.existing_conditions || "None recorded"}</dd>
          <dt>Medication</dt>
          <dd>{p.current_medication || "None recorded"}</dd>
        </dl>
      </article>
      <article className="doctor-card clinical-timeline">
        <h2>Clinical Timeline</h2>
        {data.records.map((record: Row) => (
          <div key={record.id}>
            <Stethoscope />
            <section>
              <strong>{String(record.record_type).replaceAll("_", " ")}</strong>
              <small>{new Date(record.created_at).toLocaleString()}</small>
              {record.record_type==="consultation"&&record.appointment_id&&<button onClick={()=>setOpened(record)}>Open encounter ({record.data.encounter_status||"Draft"})</button>}
              <p>
                {record.data.notes ||
                  record.data.diagnosis ||
                  record.data.medications ||
                  record.data.order_details ||
                  record.data.transcript}
              </p>
            </section>
          </div>
        ))}
        {!data.records.length && <p>No clinical records yet.</p>}
      </article>
    </div>
  );
}
function ClinicalForm({
  page,
  appointment,
  emr,
  token,
  reload,
}: {
  page: string;
  appointment: Row | null;
  emr: Row | null;
  token: string;
  reload: () => void;
}) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const labels: Record<string, string> = {
    Consultation: "Consultation Notes",
    Diagnosis: "Diagnosis and Clinical Impression",
    Prescriptions: "Medicines, Dosage and Instructions",
    "Clinical Orders": "Laboratory / Radiology Orders",
    "Follow-up": "Follow-up Review Notes",
    "AI Voice": "Voice Transcript",
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!appointment) return;
    const key =
      page === "Diagnosis"
        ? "diagnosis"
        : page === "Prescriptions"
          ? "medications"
          : page === "Clinical Orders"
            ? "order_details"
            : page === "AI Voice"
              ? "transcript"
              : "notes";
    await request("/records", token, {
      method: "POST",
      body: JSON.stringify({
        patient_id: appointment.patient_id,
        appointment_id: appointment.id,
        record_type: recordTypes[page],
        data: { [key]: text },
      }),
    });
    setText("");
    setMessage("Clinical record saved successfully");
    reload();
  }
  function dictate() {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessage("Voice recognition is not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event: any) =>
      setText((value) =>
        `${value} ${Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join(" ")}`.trim(),
      );
    recognition.start();
  }
  if (!appointment)
    return (
      <div className="doctor-empty">
        Open an appointment first, then select this clinical section.
      </div>
    );
  return (
    <div className="doctor-form-layout">
      <aside className="doctor-card">
        <h3>Selected Patient</h3>
        <strong>{appointment.patient_name}</strong>
        <span>{appointment.medical_record_number}</span>
        <small>
          {emr?.patient?.allergies
            ? `Allergies: ${emr.patient.allergies}`
            : "No allergies recorded"}
        </small>
      </aside>
      <form className="doctor-card clinical-form" onSubmit={save}>
        <h2>{labels[page]}</h2>
        <p>
          Documentation will be linked to this patient, appointment and doctor.
        </p>
        {page === "AI Voice" && (
          <button
            className={listening ? "recording" : ""}
            type="button"
            onClick={dictate}
          >
            {listening ? <MicOff /> : <Mic />}
            {listening ? "Listening…" : "Start voice documentation"}
          </button>
        )}
        <textarea
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Enter ${labels[page].toLowerCase()}…`}
        />
        {message && <div className="doctor-message">{message}</div>}
        <button className="save-clinical">
          <Save /> Save {page}
        </button>
      </form>
    </div>
  );
}
