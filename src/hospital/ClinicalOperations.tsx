import {doctorWithQualification} from '../../server/src/doctor-print-display';
import {doctorAppointmentCharges} from '../../server/src/doctor-service-fees';
import ListPagination from './ListPagination';
import {hospitalClock,recentRegistrationGroups,currentAvailableSlot} from './opd-workflow';
import {doctorDay,upcomingDoctorSlots} from '../../server/src/doctor-availability';
import {appointmentSelection} from './appointment-selection';
import {openWorkspaceTab} from '../workspace-tab';
import {patientAgeLabel} from "./patient-age";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRightLeft,
  BedDouble,
  Bell,
  CalendarDays,
  Edit3,
  Eye,
  LoaderCircle,
  Plus,
  Printer,
  Search,
  ScanLine,
  Share2,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import Barcode from "react-barcode";
import { QRCodeSVG } from "qrcode.react";
import { PatientForm } from "./Patients";
import SelectedPatientEditor,{PatientEditButton} from './SelectedPatientEditor';
import DoctorMultiFilter from "./DoctorMultiFilter";
import OpdDocuments, {opdDocumentHtml} from "./OpdDocuments";
import "./clinical-operations.css";
import "./move-ipd.css";
import type { CheckInPayment } from "./OpdCheckInPayment";
import OpdAppointmentCalendar, { type CalendarSelection } from "./OpdAppointmentCalendar";
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
type R = Record<string, any>;

const HOSPITAL_TIME_ZONE = "Asia/Kolkata";

function formatDateOnly(value: unknown) {
  const raw = String(value ?? "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return raw || "—";
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: HOSPITAL_TIME_ZONE,
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12)));
}

function formatDateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: HOSPITAL_TIME_ZONE,
  }).format(date);
}

function hospitalToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: HOSPITAL_TIME_ZONE,
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
async function q(path: string, t: string, o: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1/clinical${path}`, {
      ...o,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
        ...o.headers,
      },
    }),
    d = r.status === 204 ? null : await r.json();
  if (!r.ok) {
    const error = new Error(d?.error ?? "Request failed") as Error & { status?: number };
    error.status = r.status;
    throw error;
  }
  return d;
}
const patientDocumentFields = [
  ["aadhar_card", "Aadhaar Card"],
  ["voter_card", "Voter Card"],
  ["old_prescription", "Old Prescription"],
] as const;
async function readPatientDocuments(data:FormData,existing:R={}):Promise<R>{
  const documents:R={...existing};
  for(const [key] of patientDocumentFields){
    const field=`patient_document_${key}`,file=data.get(field);data.delete(field);
    if(!(file instanceof File)||!file.size)continue;
    if(file.size>2*1024*1024)throw new Error(`${file.name} must be 2 MB or smaller`);
    if(!["application/pdf","image/jpeg","image/png","image/webp"].includes(file.type))throw new Error(`${file.name} must be a PDF, JPG, PNG or WebP file`);
    const encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error(`Unable to read ${file.name}`));reader.readAsDataURL(file)});
    documents[key]={name:file.name,type:file.type,data:encoded};
  }
  return documents;
}
const apStatuses = [
  "Booked",
  "Confirmed",
  "Checked In",
  "Waiting",
  "In Consultation",
  "Completed",
  "Cancelled",
  "No Show",
];
export default function ClinicalOperations({
  page,
  token,
  calendar = false,
}: {
  page: string;
  token: string;
  calendar?: boolean;
}) {
  const [calendarSelection, setCalendarSelection] = useState<CalendarSelection>({ month: hospitalToday().slice(0, 7), day: "", doctor: "" });
  const queue = page === "OPD Queue";
  const appointments = page === "Appointments & Queue" || queue;
  const [rows, setRows] = useState<R[]>([]),
    [look, setLook] = useState<R>({
      patients: [],
      branches: [],
      departments: [],
      doctors: [],
      wards: [],
      rooms: [],
      beds: [],
    }),
    [savedAppointment,setSavedAppointment]=useState<R|null>(null),
    [savingAppointment,setSavingAppointment]=useState(false),
    [edit, setEdit] = useState<R | null>(null),
    [viewing, setViewing] = useState<R | null>(null),
    [ipdMove, setIpdMove] = useState<R | null>(null),
    [transfer, setTransfer] = useState<R | null>(null),
    [search, setSearch] = useState(""),
    [queueDoctorIds,setQueueDoctorIds]=useState<string[]>([]),
    [queueDate,setQueueDate]=useState(""),
    [notice,setNotice]=useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const paged=appointments&&!calendar;
  const [listPage,setListPage]=useState(1),[listTotal,setListTotal]=useState(0),[listSearch,setListSearch]=useState('');
  const [listSummary,setListSummary]=useState<R>({}),[availableDates,setAvailableDates]=useState<string[]>([]);
  const [lookLoading,setLookLoading]=useState(true),[lookVersion,setLookVersion]=useState(0);
  const doctorFilter=queueDoctorIds.join(',');
  useEffect(()=>{const timer=setTimeout(()=>{setListPage(1);setListSearch(search.trim());},250);return()=>clearTimeout(timer);},[search]);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try{
      const params=new URLSearchParams({page:String(listPage),page_size:'25',search:listSearch,queue:queue?'1':'0',doctor_ids:queue?doctorFilter:'',date:queue?queueDate:''});
      const data=await q(appointments?`/appointments${paged?'?'+params:''}`:'/ipd',token,{signal});
      if(signal?.aborted)return;
      const items=paged?data.rows:data;
      setRows(items.map((row:R)=>({...row,patient_name:String(row.patient_name||'').toUpperCase()})));
      if(paged){setListTotal(data.total);setListSummary(data.summary||{});setAvailableDates(data.dates||[]);if(listPage>1&&listPage>Math.max(1,Math.ceil(data.total/25)))setListPage(Math.max(1,Math.ceil(data.total/25)));}
    }catch(error){if(!signal?.aborted)setError(error instanceof Error?error.message:'Unable to load');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[appointments,paged,token,listPage,listSearch,queue,doctorFilter,queueDate]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  useEffect(()=>{
    const controller=new AbortController();setLookLoading(true);
    q(appointments?`/lookups?patients=${queue?'recent':'none'}`:'/lookups',token,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setLook({...data,patients:(data.patients||[]).map((patient:R)=>({...patient,name:String(patient.name||'').toUpperCase()}))});})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);})
      .finally(()=>{if(!controller.signal.aborted)setLookLoading(false);});
    return()=>controller.abort();
  },[appointments,queue,token,lookVersion]);
  useEffect(()=>{
    const patientId=ipdMove?.patient_id;
    if(!appointments||!patientId||look.patients.some((patient:R)=>patient.id===patientId))return;
    const controller=new AbortController();
    q(`/patient-search?patient_id=${encodeURIComponent(patientId)}`,token,{signal:controller.signal}).then(rows=>{
      if(controller.signal.aborted)return;
      if(!rows[0]){setError('The selected patient is unavailable.');return;}
      setLook(current=>({...current,patients:[...current.patients,...rows.map((patient:R)=>({...patient,name:String(patient.name||'').toUpperCase()}))]}));
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return()=>controller.abort();
  },[appointments,ipdMove,look.patients,token]);
  const shown=useMemo(()=>paged?rows:rows.filter(row=>JSON.stringify(row).toLowerCase().includes(search.toLowerCase())),[rows,search,paged]);
  const recentPatients=useMemo(()=>recentRegistrationGroups<R & {id:string;created_at?:string}>(look.patients.filter((patient:R)=>`${patient.name} ${patient.medical_record_number} ${patient.phone||''}`.toLowerCase().includes(search.toLowerCase()))),[look.patients,search]);
  const queueDates=useMemo(()=>paged?availableDates:[...new Set(rows.filter(row=>!queueDoctorIds.length||queueDoctorIds.includes(row.doctor_id)).map(row=>String(row.appointment_date).slice(0,10)))].sort(),[paged,availableDates,rows,queueDoctorIds]);
  const queueRows=useMemo(()=>paged?shown:shown.filter(row=>row.status!=="Cancelled"&&(!queueDoctorIds.length||queueDoctorIds.includes(row.doctor_id))&&(!queueDate||String(row.appointment_date).slice(0,10)===queueDate)).sort((a,b)=>{
    const visited=(row:R)=>["Completed","No Show"].includes(row.status)?1:0;
    return visited(a)-visited(b)||Number(a.slot_serial||String(a.token_number||"").match(/(\d+)$/)?.[1]||0)-Number(b.slot_serial||String(b.token_number||"").match(/(\d+)$/)?.[1]||0);
  }),[paged,shown,queueDoctorIds,queueDate]);
  function notifyQueue(row:R,target:"patient"|"doctor"){
    const recipient=target==="patient"?row.patient_name:row.doctor_name||"the assigned doctor";
    const message=`${target==="patient"?"Your appointment":"Patient arrival"}: ${row.patient_name} · Token ${row.token_number||"—"} · ${String(row.appointment_time).slice(0,5)}`;
    if("Notification" in window&&Notification.permission==="granted")new Notification(`Notification for ${recipient}`,{body:message});
    else if("Notification" in window&&Notification.permission==="default")Notification.requestPermission();
    setNotice(`Notification sent to ${recipient}.`);
  }
  async function shareQueue(row:R){
    const text=`Appointment update: ${row.patient_name}, token ${row.token_number||"—"}, ${formatDateOnly(row.appointment_date)} at ${String(row.appointment_time).slice(0,5)} with ${row.doctor_name||"doctor"}.`;
    if(navigator.share){try{await navigator.share({title:"Appointment update",text});return}catch{}}
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,"_blank","noopener,noreferrer");
  }
  async function printPrescription(row:R, appointmentSlip=false){
    const printWindow=window.open("","_blank");
    if(!printWindow){setError("Allow pop-ups to print the OPD prescription.");return}
    printWindow.opener=null;
    try{
      const template=appointmentSlip?await q('/print-template/opd-prescription',token):{};
      const safe=(value:unknown)=>String(value??"—").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]!));
      const details:[string,unknown][]=[
        ["Patient",row.patient_name],["UHID",row.medical_record_number],["Phone",row.patient_phone || row.phone],["Doctor",doctorWithQualification(row.doctor_name,row.doctor_qualification)],["Department",row.department_name],["Branch",row.branch_name],["Appointment date",formatDateOnly(row.appointment_date)],["Slot",String(row.appointment_time).slice(0,5)],["Token",row.token_number],["Visit type",row.visit_type],
      ];
      if(appointmentSlip) details.push(["Appointment number",row.appointment_number],["Status",row.status]);
      const money=(amount:unknown)=>"INR "+Number(amount||0).toFixed(2);
      const extraCharges=(Array.isArray(row.charges)?row.charges:[]).reduce((sum:number,item:R)=>sum+Number(item.amount||0),0);
      const total=Math.max(0,Number(row.consultation_fee||0)+extraCharges-Number(row.discount||0));
      const content=appointmentSlip?`<h2>OPD Appointment Registration</h2><p><b>Consultation fee:</b> ${money(row.consultation_fee)}</p><p><b>Additional charges:</b> ${money(extraCharges)}</p><p><b>Discount:</b> ${money(row.discount)}</p><p><b>Appointment total:</b> ${money(total)}</p><p><b>Paid:</b> ${money(row.paid_amount)}</p><p><b>Balance:</b> ${money(Math.max(0,total-Number(row.paid_amount||0)))}</p><p><b>Payment mode:</b> ${safe(row.payment_mode)}</p>`:"<b>Clinical Prescription</b><p>Prescription details will be added by the consulting doctor.</p>";
      printWindow.document.write(appointmentSlip?`<!doctype html><html><head><title>${appointmentSlip?"OPD Appointment":"OPD Prescription"} - ${safe(row.patient_name)}</title><style>@page{size:A4 portrait;margin:10mm}body{font:11px Arial;color:#172033;margin:0;min-height:277mm;display:flex;flex-direction:column}.header img{width:100%;max-height:135px;object-fit:contain}.details{display:grid;grid-template-columns:repeat(2,1fr);column-gap:34px;row-gap:5px;border-top:1px solid #cfd7e1;border-bottom:1px solid #cfd7e1;margin:10px 0 14px;padding:8px 0}.details div{padding:0;line-height:1.25}.details b{display:inline;font-size:10px;color:#26364e;text-transform:none;margin:0}.details b::after{content:": "}.prescription{min-height:220px;border-top:1px solid #cfd7e1;padding:11px 0;break-inside:avoid}.prescription b{font-size:11px}.prescription p{margin:8px 0}.footer{margin-top:auto;border-top:1px solid #d9e1ec;padding-top:8px;font-size:10px;break-inside:avoid}.footer table{border-collapse:collapse}.footer td{border:1px solid #d9e1ec;padding:4px}@media print{body{print-color-adjust:exact}}</style></head><body>${template.header_image?`<div class="header"><img src="${safe(template.header_image)}" alt="Clinic header"></div>`:""}<section class="details">${details.map(([label,value])=>`<div><b>${label}</b>${safe(value)}</div>`).join("")}</section><section class="prescription">${content}</section>${template.footer_content?`<footer class="footer">${template.footer_content}</footer>`:""}</body></html>`:opdDocumentHtml(row,{},"prescription"));
      printWindow.document.close();
      printWindow.focus();
      await Promise.all(Array.from(printWindow.document.images).map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=resolve;image.onerror=resolve})));
      await printWindow.document.fonts.ready;
      setTimeout(()=>printWindow.print(),100);
    }catch(error){printWindow.close();setError(error instanceof Error?error.message:"Unable to open the OPD prescription.")}
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(savingAppointment)return;
    setError("");
    const data = new FormData(e.currentTarget),
      body: R = Object.fromEntries(data);
    if(edit?.updated_at)body.updated_at=edit.updated_at;
    body.symptoms = data.getAll("symptoms").map(String);
    body.charges = JSON.parse(String(data.get("charges_payload") || "[]"));
    delete body.charges_payload;
    const file = data.get("insurance_document_file");
    delete body.insurance_document_file;
    if (file instanceof File && file.size) {
      if (file.size > 5 * 1024 * 1024) {
        setError("Insurance document must be 5 MB or smaller");
        return;
      }
      body.insurance_document = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("Unable to read insurance document"));
        reader.readAsDataURL(file);
      });
    }
    if(!appointments){try{body.patient_documents=await readPatientDocuments(data,edit?.patient_documents||{})}catch(x){setError(x instanceof Error?x.message:"Unable to read patient documents");return}}
    try {
      const path = appointments
        ? `/appointments${edit?.id ? `/${edit.id}` : ""}`
        : `/ipd${edit?.id ? `/${edit.id}` : ""}`;
      setSavingAppointment(true);
      const saved=await q(path, token, {
        method: edit?.id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      if(appointments&&!edit?.id) {
        const patient=look.patients.find((item:R)=>item.id===body.patient_id);
        setSavedAppointment({...saved,patient_address:patient?.address,patient_date_of_birth:patient?.date_of_birth,patient_name:patient?.name||"",medical_record_number:patient?.medical_record_number||"",doctor_name:look.doctors.find((item:R)=>item.id===body.doctor_id)?.name||"",doctor_qualification:look.doctors.find((item:R)=>item.id===body.doctor_id)?.doctor_qualification||"",department_name:look.departments.find((item:R)=>item.id===body.department_id)?.name||"",branch_name:look.branches.find((item:R)=>item.id===body.branch_id)?.name||""});
      }
      setEdit(null);
      load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to save");
      if(appointments&&(x as Error & {status?:number})?.status===409){
        setEdit(current=>current?{...current,appointment_time:"",_form_key:Date.now()}:current);
        await load();
      }
    } finally {setSavingAppointment(false);}
  }
  async function checkInAppointment(row: R, payment?: CheckInPayment) {
    const result = await q(`/appointments/${row.id}/check-in`, token, {
      method: "PATCH", body: JSON.stringify({ payment }),
    });
    setRows(current => current.map(item => item.id === row.id ? { ...item, ...result.appointment } : item));
    setNotice(result.message);
    setError("");
  }
  async function status(r: R, status: string) {
    if(appointments&&status==="Cancelled"){if(!["Booked","Confirmed"].includes(r.status)){setError("Cancellation requests are blocked after Present, Absent or check-in.");return;}if(!/\/(reception|hospital-admin)\//.test(location.pathname)){setError("Reception must submit a cancellation request for accountant approval.");return;}const url=new URL(location.href);url.pathname=url.pathname.split("/").slice(0,3).join("/")+"/"+(url.pathname.includes("/hospital-admin/")?"reception-cancellation-requests":"cancellation-requests");url.search="";url.searchParams.set("bill",r.appointment_number);openWorkspaceTab(url);return;}
    try {
      if (appointments) {
        const result=await q(`/appointments/${r.id}/status`, token, {
          method: "PATCH",
          body: JSON.stringify({status}),
        });
        setNotice(result.message||`Appointment status changed to ${status}.`);
      }
      else
        await q(`/ipd/${r.id}/status`, token, {
          method: "PUT",
          body: JSON.stringify({ status }),
        });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update status");
    }
  }
  async function saveIpdMove(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data=new FormData(e.currentTarget),body:R=Object.fromEntries(data);
    body.charges=JSON.parse(String(data.get("charges_payload")||"[]"));delete body.charges_payload;
    const file=data.get("insurance_document_file");delete body.insurance_document_file;
    if(file instanceof File&&file.size){if(file.size>5*1024*1024){setError("Insurance document must be 5 MB or smaller");return}body.insurance_document=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Unable to read insurance document"));reader.readAsDataURL(file)})}
    try{body.patient_documents=await readPatientDocuments(data,ipdMove?.patient_documents||{})}catch(x){setError(x instanceof Error?x.message:"Unable to read patient documents");return}
    try{await q("/ipd",token,{method:"POST",body:JSON.stringify(body)});setIpdMove(null);setViewing(null);setNotice(`${ipdMove?.patient_name||"Patient"} moved to IPD successfully.`)}catch(x){setError(x instanceof Error?x.message:"Unable to move patient to IPD")}
  }
  async function removeAppointment(row: R) {
    await status(row,"Cancelled");
  }
  if(savedAppointment)return <section className="co-admission-page"><div className="co-modal co-admission-form"><header><h2>OPD Appointment Registered</h2></header><div className="co-grid"><p>{savedAppointment.patient_name} - {savedAppointment.medical_record_number}</p><p>Appointment: {savedAppointment.appointment_number}</p><p>Token: {savedAppointment.token_number}</p><p>{formatDateOnly(savedAppointment.appointment_date)} at {String(savedAppointment.appointment_time).slice(0,5)}</p>{error&&<p className="co-error">{error}</p>}<p>Print the registration slip or choose Save as PDF in the print dialog to download it.</p></div><footer><button type="button" onClick={()=>setSavedAppointment(null)}>Back to appointments</button></footer><OpdDocuments row={savedAppointment} token={token}/></div></section>;
  if((edit||ipdMove)&&lookLoading)return <section className="co-page" role="status"><LoaderCircle/> Loading appointment options...</section>;
  if(appointments&&ipdMove&&!look.patients.some((patient:R)=>patient.id===ipdMove.patient_id))return <section className="co-page" role="status"><LoaderCircle/> Loading selected patient...{error&&<p role="alert">{error}<button onClick={()=>setIpdMove({...ipdMove})}>Retry</button></p>}<button onClick={()=>setIpdMove(null)}>Back</button></section>;
  if(ipdMove)return <IpdForm value={ipdMove} look={look} token={token} error={error} save={saveIpdMove} close={()=>setIpdMove(null)}/>;
  if (edit)
    return appointments ? (
      <AppointmentForm queue={queue} key={edit._form_key||edit.id||"new"} value={edit} look={look} token={token} error={error} save={save} saving={savingAppointment} onPatientCreated={patient=>setLook(current=>({...current,patients:[{...patient,name:String(patient.name||[patient.first_name,patient.last_name].filter(Boolean).join(" ")).toUpperCase()},...current.patients.filter((item:R)=>item.id!==patient.id)]}))} close={() => setEdit(null)} />
    ) : (
      <IpdForm value={edit} look={look} token={token} error={error} save={save} close={() => setEdit(null)} />
    );
  if(viewing&&appointments)return <AppointmentWorkspace value={viewing} token={token} close={()=>setViewing(null)} onMoveToIpd={()=>setIpdMove({patient_id:viewing.patient_id,patient_name:viewing.patient_name,branch_id:viewing.branch_id,department_id:viewing.department_id,consultant_doctor_id:viewing.doctor_id,consultation_fee:0,reason_diagnosis:viewing.reason||"",registration_amount:viewing.registration_amount||0,registration_fee_amount:viewing.registration_fee_amount||0,registration_addon_amount:viewing.registration_addon_amount||0,registration_discount_amount:viewing.registration_discount_amount||0,status:"Admitted",admission_type:"Emergency",admitted_at:new Date().toISOString().slice(0,16)})} />;
  if(viewing&&!appointments)return <IpdDetails value={viewing} token={token} close={()=>setViewing(null)} edit={()=>{setViewing(null);setEdit(viewing)}} transfer={()=>{setViewing(null);setTransfer(viewing)}}/>;
  if(calendar && appointments && !queue) return <OpdAppointmentCalendar onCheckIn={checkInAppointment} paymentMethods={look.payment_methods ?? ["Cash", "Card", "UPI", "Bank Transfer", "Cheque"]} rows={rows} selection={calendarSelection} onNavigate={setCalendarSelection} loading={loading} error={error} notice={notice} onRetry={load} onNew={()=>setEdit({status:"Booked",visit_type:"New",appointment_type:"OPD",payment_status:"Pending",source:"Reception",appointment_date:calendarSelection.day||hospitalToday(),doctor_id:calendarSelection.doctor||undefined})} onEdit={setEdit} onView={setViewing} onPrint={printPrescription} onStatus={status} onFollowUp={row=>setEdit({patient_id:row.patient_id,branch_id:row.branch_id,department_id:row.department_id,doctor_id:row.doctor_id,appointment_date:hospitalToday(),appointment_time:"",status:"Booked",visit_type:"Follow-Up",appointment_type:"OPD",payment_status:"Pending",source:"Reception"})} />;
  return (
    <section className="co-page">
      <header>
        <div>
          <small>Clinic Workspace / {queue?"Appointments & Queue / OPD Queue":page}</small>
          <h1>{queue?"OPD Queue":page}</h1>
          <p>
            {queue?"Filter by doctor and appointment date to manage the live patient queue.":appointments
              ? "Schedule visits, manage tokens and monitor the live patient queue."
              : "Manage admissions, bed allocation, transfers and discharge monitoring."}
          </p>
        </div>
        <button
          data-permission={appointments?"appointment.create":"ipd.create"}
          disabled={lookLoading}
          onClick={() =>
            setEdit(
              appointments
                ? {
                    status: "Booked",
                    visit_type: "New",
                    appointment_type: "OPD",
                    payment_status: "Pending",
                    source: "Reception",
                    appointment_date: hospitalToday(),
                  }
                : {
                    status: "Admitted",
                    admission_type: "Planned",
                    admitted_at: new Date().toISOString().slice(0, 16),
                  },
            )
          }
        >
          <Plus /> {appointments ? "New Appointment" : "New Admission"}
        </button>
      </header>
      {queue&&<section className="co-recent-registrations"><header><div><h2>Recent Patient Registrations</h2><p>Newest registrations first, grouped by date.</p></div><button data-permission="patient.create" onClick={()=>setEdit({_register:true,status:'Booked',visit_type:'New',appointment_type:'OPD',source:'Reception',appointment_date:hospitalClock().date})}><Plus/> Register New Patient</button></header>{recentPatients.map(group=><section key={group.date}><h3>{formatDateOnly(group.date)}</h3><div className="co-registration-list">{group.patients.map(patient=><button data-permission="appointment.create" key={patient.id} onClick={()=>setEdit({patient_id:patient.id,status:'Booked',visit_type:'New',appointment_type:'OPD',source:'Reception',appointment_date:hospitalClock().date})}><strong>{patient.name}</strong><small>{patient.medical_record_number} | {patient.phone||'No phone'} | {formatDateTime(patient.created_at)}</small><span>Create appointment / token</span></button>)}</div></section>)}{!recentPatients.length&&<p>No recent patient registrations found.</p>}</section>}
      {error && <div className="co-error">{error}<button onClick={()=>{void load();setLookVersion(value=>value+1);}}>Retry</button></div>}
      {notice&&<div className="co-notice">{notice}<button onClick={()=>setNotice("")} aria-label="Dismiss notification">×</button></div>}
      <div className="co-stats">
        {appointments
          ? apStatuses.slice(0, 6).map((s) => (
              <div key={s}>
                <small>{s}</small>
                <strong>{paged?(loading?'...':Number(listSummary[s]||0)):rows.filter((r) => r.status === s).length}</strong>
              </div>
            ))
          : [
              "Admitted",
              "Under Treatment",
              "Discharge Planned",
              "Discharged",
            ].map((s) => (
              <div key={s}>
                <small>{s}</small>
                <strong>{rows.filter((r) => r.status === s).length}</strong>
              </div>
            ))}
      </div>
      {queue&&<div className="co-queue-filters"><DoctorMultiFilter doctors={look.doctors} value={queueDoctorIds} onChange={ids=>{setListPage(1);setQueueDoctorIds(ids);setQueueDate("");}}/><label>Appointment date<select value={queueDate} onChange={event=>{setListPage(1);setQueueDate(event.target.value);}}><option value="">All dates</option>{queueDates.map(date=><option key={date} value={date}>{new Date(`${date}T00:00:00`).toLocaleDateString()}</option>)}</select></label><small>Unvisited patients appear first, followed by visited patients in token order.</small></div>}
      <div className="co-toolbar">
        <Search />
        <input
          maxLength={150}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${appointments ? "appointment, patient, doctor or token" : "IPD number, patient, ward or bed"}…`}
        />
        <span>{paged?listTotal.toLocaleString('en-IN'):shown.length} records</span>
      </div>
      <div className="co-card">
        {loading ? (
          <div className="co-loading">
            <LoaderCircle />
            Loading…
          </div>
        ) : appointments ? (
          <AppointmentTable rows={queue?queueRows:shown} view={setViewing} edit={setEdit} remove={removeAppointment} status={status} queue={queue} notify={notifyQueue} share={shareQueue} print={printPrescription} />
        ) : (
          <IpdTable
            rows={shown}
            view={setViewing}
            transfer={setTransfer}
            edit={setEdit}
            status={status}
          />
        )}
      </div>
      {paged&&<ListPagination label="Appointments" page={listPage} total={listTotal} count={rows.length} busy={loading} onPage={setListPage}/>}
      {transfer && (
        <TransferForm
          value={transfer}
          look={look}
          token={token}
          done={() => {
            setTransfer(null);
            load();
          }}
          close={() => setTransfer(null)}
        />
      )}
    </section>
  );
}
function AppointmentTable({
  rows,
  view,
  edit,
  remove,
  status,
  queue=false,
  notify,
  share,
  print,
}: {
  rows: R[];
  view: (r: R) => void;
  edit: (r: R) => void;
  remove: (r: R) => void;
  status: (r: R, s: string) => void;
  queue?: boolean;
  notify?: (r:R,target:"patient"|"doctor")=>void;
  share?: (r:R)=>void;
  print: (r:R)=>void;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>{queue?"Token":"Appointment"}</th>
          <th>Patient</th>
          <th>Doctor / Department</th>
          <th>Date & Slot</th>
          <th>Type</th>
          <th>Fee / Payment</th>
          <th>Token</th>
          {!queue&&<th>Status</th>}
          <th>{queue?"Notify / Share":""}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <strong>{queue?r.token_number||"—":r.appointment_number}</strong>
              <small>{queue?String(r.appointment_time).slice(0,5):r.source}</small>
            </td>
            <td>
              <strong>{r.patient_name}</strong>
              <small>{r.medical_record_number}</small>
            </td>
            <td>
              <strong>{r.doctor_name || "Unassigned"}</strong>
              <small>{r.department_name || "—"}</small>
            </td>
            <td>
              <strong>
                {formatDateOnly(r.appointment_date)}
              </strong>
              <small>{String(r.appointment_time).slice(0, 5)}</small>
            </td>
            <td>
              {r.appointment_type}
              <small>{r.visit_type}</small>
            </td>
            <td>
              ₹{Number(r.consultation_fee).toLocaleString()}
              <small>{r.payment_status}</small>
            </td>
            <td>
              <b className="co-token">{r.token_number || "—"}</b>
            </td>
            {!queue&&<td>
              <select
                value={r.status}
                disabled={["Discharged","Cancelled"].includes(r.status)}
                onChange={(e) => status(r, e.target.value)}
              >
                {apStatuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </td>}
            <td>
              <div className="co-actions">
                <button title="Download OPD Prescription" aria-label="Download OPD Prescription" onClick={()=>print(r)}><Printer /></button>
                {queue&&<><button title="Notify patient" aria-label="Notify patient" onClick={()=>notify?.(r,"patient")}><Bell /></button><button title="Notify doctor" aria-label="Notify doctor" onClick={()=>notify?.(r,"doctor")}><Stethoscope /></button><button title="Share appointment" aria-label="Share appointment" onClick={()=>share?.(r)}><Share2 /></button></>}
                <button title="View appointment" aria-label="View appointment" onClick={() => view(r)}><Eye /></button>
                <button data-permission="appointment.update" disabled={r.status==="Cancelled"} title="Edit appointment" aria-label="Edit appointment" onClick={() => edit(r)}><Edit3 /></button>
                <button data-permission="appointment.cancel" disabled={!["Booked","Confirmed"].includes(r.status)} title="Request cancellation" aria-label="Request cancellation" onClick={() => remove(r)}><Trash2 /></button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AppointmentView({ value, close }: { value: R; close: () => void }) {
  const details = [
    ["Appointment Number", value.appointment_number], ["Patient", value.patient_name],
    ["UHID", value.medical_record_number], ["Branch", value.branch_name],
    ["Doctor", value.doctor_name || "Unassigned"], ["Department", value.department_name || "—"],
    ["Appointment Date", formatDateOnly(value.appointment_date)], ["Appointment Time", String(value.appointment_time).slice(0, 5)], ["Applied At", formatDateTime(value.created_at)],
    ["Appointment Type", value.appointment_type], ["Visit Type", value.visit_type],
    ["Consultation Fee", `₹${Number(value.consultation_fee || 0).toFixed(2)}`], ["Payment Status", value.payment_status],
    ["Token", value.token_number || "—"], ["Status", value.status], ["Source", value.source],
    ...(value.status==="Cancelled"?[["Cancellation Reason",value.cancellation_reason||"—"],["Refund Paid",`₹${Number(value.refund_amount||0).toFixed(2)} posted to ledger`],["Approved Refund Remaining",`₹${Math.max(0,Number(value.approved_refund_amount||0)-Number(value.refund_amount||0)).toFixed(2)}`]]:[]),
    ["Reason", value.reason || "—"], ["Notes", value.notes || "—"],
  ];
  return <Modal title={`Appointment ${value.appointment_number}`} close={close}>
    <div className="co-view-grid">{details.map(([label, content]) => <div key={label}><small>{label}</small><strong>{content}</strong></div>)}</div>
  </Modal>;
}
export function AppointmentWorkspace({value,close,onMoveToIpd,token}:{value:R;close:()=>void;onMoveToIpd?:()=>void;token?:string}){
  const tabs=["Overview","Nurse Notes","Medication","Prescription","Consultant Register","Lab Investigation","Operations","Charges","Payments"];
  const [tab,setTab]=useState("Overview");
  const appointmentTotal=Math.max(0,Number(value.consultation_fee||0)+(Array.isArray(value.charges)?value.charges.reduce((sum:number,item:R)=>sum+Number(item.amount||0),0):0)-Number(value.discount||0));
  const registrationTotal=Math.max(0,Number(value.registration_amount||0));
  const total=registrationTotal+appointmentTotal;
  const paid=Number(value.paid_amount||0), percent=total?Math.min(100,Math.round(paid/total*100)):0;
  const identity=String(value.medical_record_number||value.patient_name||"PATIENT");
  return <section className="co-workspace co-appointment-details">
    <header className="co-work-head"><button onClick={close}><ArrowLeft/></button><div><small>Patient workspace</small><h1>{value.patient_name}</h1><p>{identity} · Token {value.token_number||"—"} · {value.status}</p></div>{onMoveToIpd&&<button className="co-move-ipd" onClick={onMoveToIpd}><BedDouble/> Move to IPD</button>}<button onClick={close}>Close</button></header>
    <nav className="co-work-tabs">{tabs.map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item}</button>)}</nav>
    <div className="co-work-content">{tab==="Overview"?<main className="co-clinical-overview">
      <section className="co-patient-identity"><header><strong>{String(value.patient_name||"Patient").toUpperCase()}</strong><span><ScanLine/> Scan patient ID</span></header>
        <div className="co-identity-grid"><div className="co-photo-placeholder"><span>♣</span><b>NO IMAGE<br/>AVAILABLE</b></div><dl>{[["Gender",value.gender||"Not recorded"],["Age",value.age||"Not recorded"],["Guardian Name",value.guardian_name||"Not recorded"],["Phone",value.patient_phone||value.phone||"Not recorded"],["TPA",value.tpa||"—"],["TPA ID",value.tpa_id||"—"],["TPA Validity",value.tpa_validity||"—"]].map(([a,b])=><div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl><div className="co-code-stack"><label>Barcode</label><Barcode value={String(value.token_number||identity)} height={34} width={1.1} fontSize={9} margin={0}/><label>QR Code</label><QRCodeSVG value={identity} size={74} level="M"/></div></div>
        <div className="co-case-credit"><dl>{[["Case ID",value.appointment_number||"—"],["OPD No",value.token_number||"—"],["Appointment Date",formatDateOnly(value.appointment_date)],["Doctor",value.doctor_name||"Unassigned"]].map(([a,b])=><div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl><div><div className="co-credit-ring" style={{"--credit":`${percent*3.6}deg`} as any}><span>{percent}.00%</span></div><small>Credit Limit: ₹{total.toFixed(2)}<br/><b>Used Credit: ₹{paid.toFixed(2)}</b><br/>Balance: ₹{Math.max(0,total-paid).toFixed(2)}</small></div></div>
        <details><summary>Known Allergies</summary><p>{value.allergies||"No known allergies recorded."}</p></details><details><summary>Finding</summary><p>{value.finding||value.reason||"No clinical finding recorded."}</p></details>{value.status==="Cancelled"&&<details open><summary>Cancellation & Refund</summary><p><b>Reason:</b> {value.cancellation_reason||"Not recorded"}<br/><b>Refund:</b> {Number(value.refund_amount)>0?`₹${Number(value.refund_amount).toFixed(2)} posted to the finance ledger`:"No refund paid yet"}<br/><b>Approved refund remaining:</b> {Math.max(0,Number(value.approved_refund_amount||0)-Number(value.refund_amount||0)).toFixed(2)}</p></details>}
      </section>
      <section className="co-clinical-sections"><div className="co-billing-grid">{[["OPD PAYMENT/BILLING",paid,total],["PHARMACY PAYMENT/BILLING",0,0],["PATHOLOGY PAYMENT/BILLING",0,0],["RADIOLOGY PAYMENT/BILLING",0,0]].map(([title,p,t])=><article key={String(title)}><strong>{title}</strong><span>{Number(t)?Math.round(Number(p)/Number(t)*100):0}%</span><b>₹{Number(p).toFixed(0)}/₹{Number(t).toFixed(0)}</b></article>)}</div>
        <ClinicalSummary title="MEDICATION" text="No medication recorded"/><ClinicalSummary title="PRESCRIPTION" headings={["Prescription No","Date","Prescribe By","Generated By"]} values={[value.prescription_number||value.appointment_number||"—",formatDateOnly(value.appointment_date),value.doctor_name||"Unassigned","Clinic ERP"]}/><ClinicalSummary title="CONSULTANT REGISTER" headings={["Applied Date","Consultant Doctor","Instruction","Instruction Date"]} values={[formatDateTime(value.created_at),value.doctor_name||"Unassigned",value.reason||"—",formatDateOnly(value.appointment_date)]}/>{[["LAB INVESTIGATION","No lab investigation recorded"],["OPERATION","No operation recorded"],["CHARGES",total?`Registration ₹${registrationTotal.toFixed(2)} + Appointment ₹${appointmentTotal.toFixed(2)} = Total ₹${total.toFixed(2)}`:"No charges recorded"]].map(([title,text])=><ClinicalSummary key={title} title={title} text={text}/>)}</section>
    </main>:<main className="co-work-panel"><h2>{tab}</h2><div className="co-work-empty">No {tab.toLowerCase()} recorded for this appointment.</div></main>}</div>
    {token&&<OpdDocuments row={value} token={token}/>}
  </section>
}
function ClinicalSummary({title,headings,values,text}:{title:string;headings?:string[];values?:any[];text?:string}){return <article className="co-clinical-summary"><h3>{title}</h3>{headings&&values?<div className="co-summary-table">{headings.map((h,i)=><div key={h}><small>{h}</small><span>{values[i]}</span></div>)}</div>:<p>{text}</p>}</article>}
function AppointmentWorkspaceLegacy({value,close}:{value:R;close:()=>void}){
  const tabs=["Overview","Nurse Notes","Medication","Prescription","Consultant Register","Lab Investigation","Operations","Charges","Payments"] as const;
  const [tab,setTab]=useState<typeof tabs[number]>("Overview");
  const [note,setNote]=useState("");
  const [notes,setNotes]=useState<string[]>([]);
  const patientDetails=[["Patient",value.patient_name],["UHID",value.medical_record_number],["Gender",value.gender||"Not recorded"],["Age",value.age||"Not recorded"],["Phone",value.patient_phone||value.phone||"Not recorded"],["Branch",value.branch_name],["Doctor",value.doctor_name||"Unassigned"],["Department",value.department_name||"—"],["Appointment date",formatDateOnly(value.appointment_date)],["Slot",String(value.appointment_time).slice(0,5)],["Token",value.token_number||"—"],["Status",value.status]];
  const chargeTotal=Number(value.consultation_fee||0)+(Array.isArray(value.charges)?value.charges.reduce((sum:number,item:R)=>sum+Number(item.amount||0),0):0)-Number(value.discount||0);
  const empty=(label:string)=><div className="co-work-empty">No {label.toLowerCase()} recorded for this appointment.</div>;
  return <section className="co-workspace"><header className="co-work-head"><button onClick={close} title="Back to appointments"><ArrowLeft/></button><div><small>Patient workspace</small><h1>{value.patient_name}</h1><p>{value.medical_record_number} · Token {value.token_number||"—"} · {value.status}</p></div><button onClick={close}>Close</button></header><nav className="co-work-tabs">{tabs.map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item}</button>)}</nav><div className="co-work-content">{tab==="Overview"?<><aside className="co-work-profile"><div className="co-work-avatar">{String(value.patient_name||"P").slice(0,1).toUpperCase()}</div><h2>{value.patient_name}</h2><p>{value.medical_record_number}</p><span className="co-token">{value.token_number||"No token"}</span></aside><main className="co-work-main"><h2>Patient & Appointment Details</h2><div className="co-work-details">{patientDetails.map(([label,content])=><div key={label}><small>{label}</small><strong>{content}</strong></div>)}</div><div className="co-work-summary"><section><small>Payment status</small><strong>{value.payment_status}</strong><b>₹{chargeTotal.toFixed(2)}</b></section><section><small>Visit</small><strong>{value.visit_type}</strong><b>{value.appointment_type}</b></section><section><small>Reason</small><strong>{value.reason||"Not recorded"}</strong><b>{value.source}</b></section></div></main></>:tab==="Nurse Notes"?<main className="co-work-panel"><h2>Nurse Notes</h2><textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Add a nurse note for this patient"/><button className="primary" onClick={()=>{if(note.trim()){setNotes(items=>[note.trim(),...items]);setNote("")}}}>Add Note</button>{notes.length?notes.map((item,index)=><article key={index}>{item}</article>):empty("nurse notes")}</main>:tab==="Charges"?<main className="co-work-panel"><h2>Charges</h2><div className="co-work-details"><div><small>Consultation fee</small><strong>₹{Number(value.consultation_fee||0).toFixed(2)}</strong></div><div><small>Discount</small><strong>₹{Number(value.discount||0).toFixed(2)}</strong></div><div><small>Total</small><strong>₹{chargeTotal.toFixed(2)}</strong></div></div>{Array.isArray(value.charges)&&value.charges.length?<table><tbody>{value.charges.map((charge:R,index:number)=><tr key={index}><td>{charge.label}</td><td>₹{Number(charge.amount||0).toFixed(2)}</td></tr>)}</tbody></table>:empty("additional charges")}</main>:tab==="Payments"?<main className="co-work-panel"><h2>Payments</h2><div className="co-work-details"><div><small>Payment status</small><strong>{value.payment_status}</strong></div><div><small>Payment mode</small><strong>{value.payment_mode||"Not recorded"}</strong></div><div><small>Payment reference</small><strong>{value.payment_reference||"Not recorded"}</strong></div><div><small>Paid amount</small><strong>₹{Number(value.paid_amount||0).toFixed(2)}</strong></div></div></main>:<main className="co-work-panel"><h2>{tab}</h2>{empty(tab)}</main>}</div></section>}
function IpdTable({
  rows,
  view,
  transfer,
  edit,
  status,
}: {
  rows: R[];
  view: (r:R)=>void;
  transfer: (r: R) => void;
  edit: (r: R) => void;
  status: (r: R, s: string) => void;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>IPD / Patient</th>
          <th>Admission</th>
          <th>Consultant</th>
          <th>Location</th>
          <th>Diagnosis</th>
          <th>Total Amount</th>
          <th>Expected Discharge</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <button className="co-ipd-link" onClick={()=>view(r)}>{r.ipd_number}</button>
              <small>
                {r.patient_name} · {r.medical_record_number}
              </small>
            </td>
            <td>
              {new Date(r.admitted_at).toLocaleString()}
              <small>{r.admission_type}</small>
            </td>
            <td>
              {r.doctor_name || "Unassigned"}
              <small>{r.department_name || "—"}</small>
            </td>
            <td>
              <strong>{r.ward_name || "No ward"}</strong>
              <small>
                Room {r.room_number || "—"} · Bed {r.bed_number || "—"}
              </small>
            </td>
            <td>{r.reason_diagnosis || "—"}</td>
            <td>
              ₹{Number(r.total_amount || 0).toFixed(2)}
              <small>{r.admission_payment_status || "Unpaid"}</small>
            </td>
            <td>
              {r.expected_discharge
                ? new Date(r.expected_discharge).toLocaleDateString()
                : "—"}
            </td>
            <td>
              <select
                value={r.status}
                onChange={(e) => status(r, e.target.value)}
              >
                {[
                  "Admitted",
                  "Under Treatment",
                  "Discharge Planned",
                  ...(r.status==="Discharged"?["Discharged"]:[]),
                  "Cancelled",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </td>
            <td>
              <div className="co-actions">
                <button disabled={["Discharged","Cancelled"].includes(r.status)} onClick={() => edit(r)} title={["Discharged","Cancelled"].includes(r.status)?"Terminal admissions are read-only":"Edit admission"}>
                  <Edit3 />
                </button>
                <button className="co-transfer" disabled={["Discharged","Cancelled"].includes(r.status)} title={["Discharged","Cancelled"].includes(r.status)?"Terminal admissions cannot be transferred":"Transfer patient"} onClick={() => transfer(r)}>
                  <ArrowRightLeft />
                  Transfer
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function IpdDetails({value,token,close,edit,transfer}:{value:R;token:string;close:()=>void;edit:()=>void;transfer:()=>void}){
  const [data,setData]=useState<R|null>(null),[error,setError]=useState("");
  useEffect(()=>{q(`/ipd/${value.id}/details`,token).then(setData).catch((e)=>setError(e instanceof Error?e.message:"Unable to load admission details"))},[value.id,token]);
  if(error)return <section className="co-workspace"><header className="co-work-head"><button onClick={close}><ArrowLeft/></button><div><h1>{value.ipd_number}</h1></div></header><div className="co-error">{error}</div></section>;
  if(!data)return <section className="co-workspace"><div className="co-loading"><LoaderCircle className="spin"/> Loading complete IPD record…</div></section>;
  const a=data.admission||{},p=data.patient||{},attendant=a.attendant||{},charges=Array.isArray(a.charges)?a.charges:[],documents=a.patient_documents||{};
  const terminal=["Discharged","Cancelled"].includes(a.status);
  const display=(content:any):string=>{
    if(content===null||content===undefined||content==="")return "—";
    if(Array.isArray(content))return content.map(display).filter((item)=>item!=="—").join(" · ")||"—";
    if(typeof content==="object")return Object.values(content).map(display).filter((item)=>item!=="—").join(" · ")||"—";
    return String(content);
  };
  const paid=Number(a.paid_amount||0)+Number(a.deposit_amount||0),total=Number(a.total_amount||0),due=Math.max(0,total-paid),credit=Math.max(0,paid-total);
  const paymentPercent=total?Math.min(100,Math.round(paid/total*100)):0;
  const patientIdentity=String(p.medical_record_number||a.ipd_number||"PATIENT");
  const details=[
    ["UHID",p.medical_record_number],["Patient",`${p.first_name||""} ${p.last_name||""}`.trim()],["Age",patientAgeLabel(p)],["Gender",p.sex||"—"],["Blood Group",p.blood_group||"—"],["Phone",p.phone||"—"],["Email",p.email||"—"],["Address",p.address||"—"],["Emergency Contact",p.emergency_contact||"—"],["Allergies",p.allergies||"None recorded"],["Existing Conditions",p.existing_conditions||"None recorded"],["Current Medication",p.current_medication||"None recorded"],
  ];
  const admissionDetails=[["IPD Number",a.ipd_number],["Status",a.status],["Admission",new Date(a.admitted_at).toLocaleString()],["Type",a.admission_type],["Branch",a.branch_name],["Department",a.department_name||"—"],["Consultant",a.doctor_name||"Unassigned"],["Ward",a.ward_name||"—"],["Room",a.room_number||"—"],["Bed",a.bed_number||"—"],["Bed Type",a.bed_type||"—"],["Expected Discharge",a.expected_discharge?new Date(a.expected_discharge).toLocaleDateString():"—"],["Diagnosis / Reason",a.reason_diagnosis||"—"],["Attendant",attendant.name||"—"],["Attendant Phone",attendant.phone||"—"],["Relationship",attendant.relationship||"—"]];
  return <section className="co-workspace co-ipd-details"><header className="co-work-head"><button onClick={close}><ArrowLeft/></button><div><small>IPD patient record</small><h1>{a.ipd_number} · {a.patient_name}</h1><p>{p.medical_record_number} · {a.status}</p></div><button disabled={terminal} title={terminal?"Terminal admissions are read-only":"Edit admission"} onClick={edit}><Edit3/> Edit</button><button disabled={terminal} title={terminal?"Terminal admissions cannot be transferred":"Transfer patient"} onClick={transfer}><ArrowRightLeft/> Transfer</button><button onClick={()=>window.print()}><Printer/> Print</button><button onClick={close}>Close</button></header>
    <div className="co-ipd-detail-body">
      <section className="co-ipd-identity-card"><div className="co-ipd-person"><div className="co-work-avatar">{String(a.patient_name||"P").slice(0,1).toUpperCase()}</div><div><small>IN-PATIENT</small><h2>{a.patient_name}</h2><p>{patientIdentity} · {p.sex||"Gender not recorded"} · {p.blood_group||"Blood group not recorded"}</p><span className="co-token">{a.status}</span></div></div><div className="co-ipd-codes"><div><small>IPD Barcode</small><Barcode value={String(a.ipd_number||patientIdentity)} height={38} width={1.25} fontSize={10} margin={0}/></div><div><small>Patient QR Code</small><QRCodeSVG value={`${a.ipd_number}|${patientIdentity}|${a.patient_name}`} size={82} level="M"/></div></div><div className="co-ipd-chart"><div className="co-ipd-donut" style={{"--paid-angle":`${paymentPercent*3.6}deg`} as any}><span>{paymentPercent}%</span></div><div><small>Payment Progress</small><strong>₹{paid.toFixed(2)} / ₹{total.toFixed(2)}</strong><p>Due ₹{due.toFixed(2)}{credit>0?` · Credit ₹${credit.toFixed(2)}`:""}</p></div></div><div className="co-ipd-case-strip">{[["Case ID",a.id?String(a.id).slice(0,8).toUpperCase():"—"],["IPD No",a.ipd_number],["Admission",new Date(a.admitted_at).toLocaleString()],["Bed",[a.bed_number,a.ward_name,a.room_number].filter(Boolean).join(" · ")||"Not allocated"],["Consultant",a.doctor_name||"Unassigned"]].map(([label,content])=><div key={label}><small>{label}</small><strong>{content}</strong></div>)}</div></section>
      <section><h2>Patient Details</h2><div className="co-work-details">{details.map(([label,content])=><div key={label}><small>{label}</small><strong>{display(content)}</strong></div>)}</div></section>
      <section><h2>Admission Details</h2><div className="co-work-details">{admissionDetails.map(([label,content])=><div key={label}><small>{label}</small><strong>{display(content)}</strong></div>)}</div></section>
      <section><h2>Bed Stay & Charge History</h2>{data.bed_stays?.length?<table className="co-ipd-bill"><thead><tr><th>Bed / Location</th><th>From</th><th>To</th><th>Days</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{data.bed_stays.map((stay:R)=><tr key={stay.id}><td><strong>{stay.bed_number}</strong><br/><small>{[stay.ward_name,stay.room_number].filter(Boolean).join(" / ")||"Configured in Bed Master"}</small></td><td>{new Date(stay.started_at).toLocaleString()}</td><td>{stay.ended_at?new Date(stay.ended_at).toLocaleString():"Ongoing"}</td><td>{stay.days}</td><td>₹{Number(stay.daily_rate||0).toFixed(2)}/day</td><td>₹{Number(stay.amount||0).toFixed(2)}</td></tr>)}</tbody></table>:<p className="co-work-empty">No bed allocated yet.</p>}</section>
      <section><h2>Bill & Payment Summary</h2><div className="co-ipd-money"><article><small>IPD Total</small><strong>₹{total.toFixed(2)}</strong></article><article><small>Patient Deposit</small><strong>₹{Number(a.deposit_amount||0).toFixed(2)}</strong></article><article><small>Other Paid</small><strong>₹{Number(a.paid_amount||0).toFixed(2)}</strong></article><article><small>Balance Due</small><strong>₹{due.toFixed(2)}</strong></article><article><small>Patient Credit</small><strong>₹{credit.toFixed(2)}</strong></article></div>
        <table className="co-ipd-bill"><thead><tr><th>Charge</th><th>Amount</th></tr></thead><tbody>{data.bed_stays?.map((stay:R)=><tr key={stay.id}><td>Bed {stay.bed_number}: {stay.days} day{stay.days===1?"":"s"} × ₹{Number(stay.daily_rate).toFixed(2)}</td><td>₹{Number(stay.amount).toFixed(2)}</td></tr>)}{charges.map((charge:R,index:number)=><tr key={index}><td>{charge.label||"Additional Charge"}</td><td>₹{Number(charge.amount||0).toFixed(2)}</td></tr>)}{Number(a.discount||0)>0&&<tr><td>Admission Discount</td><td>− ₹{Number(a.discount).toFixed(2)}</td></tr>}<tr className="total"><td>Total</td><td>₹{total.toFixed(2)}</td></tr></tbody></table>
      </section>
      <section><h2>Invoices & Payments</h2>{Array.isArray(data.invoices)&&data.invoices.length?data.invoices.map((invoice:R)=><article className="co-ipd-invoice" key={invoice.id}><strong>{invoice.record_number}</strong><span>{invoice.status} · Total ₹{Number(invoice.total||0).toFixed(2)} · Paid ₹{Number(invoice.paid||0).toFixed(2)} · Due ₹{Number(invoice.due||0).toFixed(2)}</span>{Array.isArray(invoice.payments)&&invoice.payments.map((payment:R)=><small key={payment.id}>{payment.record_number} · ₹{Number(payment.amount||0).toFixed(2)} · {new Date(payment.created_at).toLocaleString()}</small>)}</article>):<p className="co-work-empty">No linked invoice generated yet.</p>}</section>
      <section><h2>Insurance</h2><div className="co-work-details"><div><small>Insurance</small><strong>{a.has_insurance?"Yes":"No"}</strong></div><div><small>Company</small><strong>{a.insurance_company||"—"}</strong></div><div><small>Policy Number</small><strong>{a.policy_number||"—"}</strong></div></div></section>
      <section><h2>Patient Documents</h2><div className="co-ipd-documents">{patientDocumentFields.map(([key,label])=>documents[key]?.data?<a key={key} href={documents[key].data} target="_blank" rel="noreferrer"><strong>{label}</strong><small>{documents[key].name}</small></a>:<div key={key}><strong>{label}</strong><small>Not uploaded</small></div>)}</div></section>
      <section><h2>Transfer History</h2>{data.transfers?.length?<table className="co-ipd-bill"><thead><tr><th>Date</th><th>Type</th><th>Notes</th></tr></thead><tbody>{data.transfers.map((item:R)=><tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td>{item.transfer_type}</td><td>{item.notes||"—"}</td></tr>)}</tbody></table>:<p className="co-work-empty">No transfers recorded.</p>}</section>
    </div>
  </section>;
}
const Field = ({
  name,
  label,
  type = "text",
  value = "",
  children,
  required = false,
  disabled = false,
  min,
  onChange,
  className,
}: {
  name: string;
  label: string;
  type?: string;
  value?: any;
  children?: any;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  className?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => void;
}) => (
  <label className={className}>
    <span>{label}</span>
    {children ? (
      <select
        name={name}
        value={onChange ? value : undefined}
        defaultValue={onChange ? undefined : value}
        required={required}
        disabled={disabled}
        onChange={onChange}
      >
        {children}
      </select>
    ) : (
      <input
        name={name}
        type={type}
        value={onChange ? value ?? "" : undefined}
        defaultValue={onChange ? undefined : value ?? ""}
        required={required}
        disabled={disabled}
        min={min}
        onChange={onChange}
      />
    )}
  </label>
);
function AppointmentForm({
  value,
  look,
  token,
  error,
  save,
  close,
  saving,
  onPatientCreated,
  queue=false,
}: {
  value: R;
  look: R;
  token: string;
  error: string;
  save: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
  saving: boolean;
  onPatientCreated: (patient: R) => void;
  queue?:boolean;
}) {
  const [editingPatientId,setEditingPatientId]=useState('');
  const [registeringPatient,setRegisteringPatient]=useState(false),[patientFees,setPatientFees]=useState<R|null>(null),[patientError,setPatientError]=useState(""),[patientSaving,setPatientSaving]=useState(false);
  const [registrationLoading,setRegistrationLoading]=useState(false);
  async function patientApi(path:string,options:RequestInit={}) {
    const response=await fetch(`${API}/api/v1/patients${path}`,{...options,headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`}});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Unable to register patient");
    return data;
  }
  async function startRegistration(){
    if(registrationLoading||patientSaving)return;
    setPatientError("");
    setRegistrationLoading(true);
    try{setPatientFees(await patientApi("/registration-settings"));setRegisteringPatient(true);}catch(error){setPatientError(error instanceof Error?error.message:"Unable to load registration settings");}finally{setRegistrationLoading(false);}
  }
  async function registerPatient(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(patientSaving)return;
    const data=new FormData(event.currentTarget),obj:R=Object.fromEntries(data);
    for(const [key,value] of Object.entries(obj))if(typeof value==="string")obj[key]=value.trim();
    if(typeof obj.registration_addons==="string")obj.registration_addons=JSON.parse(obj.registration_addons);
    const body={...obj,address:{title:obj.title,line:obj.address,city:obj.city,state:obj.state,pin:obj.pin,age_years:obj.age_years,age_months:obj.age_months,age_days:obj.age_days},emergency_contact:{name:obj.emergency_name,phone:obj.emergency_phone,relationship:obj.emergency_relationship}};
    setPatientSaving(true);setPatientError("");
    try{
      const patient=await patientApi("",{method:"POST",body:JSON.stringify(body)});
      onPatientCreated(patient);setPatientId(patient.id);setPatientSearch([patient.first_name,patient.last_name].filter(Boolean).join(" ").toUpperCase()+" - "+patient.medical_record_number);if(patient.branch_id&&patient.branch_id!==branchId){setDepartmentId("");setDoctorId("");setDate("");setAppointmentTime("");setSlots([]);}setBranchId(patient.branch_id||branchId);setPatientSearchOpen(false);setRegisteringPatient(false);
    }catch(error){setPatientError(error instanceof Error?error.message:"Unable to register patient");}finally{setPatientSaving(false);}
  }
  const [branchId,setBranchId]=useState(String(value.branch_id||(look.branches.length===1?look.branches[0].id:"")));
  useEffect(()=>{
    if(look.branches.length===1)setBranchId(current=>current||String(look.branches[0].id));
  },[look.branches]);
  const [departmentId,setDepartmentId]=useState(String(value.department_id??""));
  const [doctorId,setDoctorId]=useState(String(value.doctor_id??""));
  const [patientId,setPatientId]=useState(String(value.patient_id??""));
  const [date,setDate]=useState(value.branch_id&&value.department_id&&value.doctor_id?String(value.appointment_date??hospitalToday()).slice(0,10):"");
  const [appointmentTime,setAppointmentTime]=useState(String(value.appointment_time??"").slice(0,5));
  const [allSlots,setSlots]=useState<R[]>([]);
  const [slotsLoading,setSlotsLoading]=useState(false);
  const [slotsError,setSlotsError]=useState("");
  const [slotClock,setSlotClock]=useState(()=>new Date());
  const slots=upcomingDoctorSlots(allSlots as Array<R & {time:string}>,date,slotClock);
  useEffect(()=>{const timer=window.setInterval(()=>setSlotClock(new Date()),15000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{
    const existing=Boolean(value.id)&&date===String(value.appointment_date).slice(0,10)&&doctorId===value.doctor_id&&appointmentTime===String(value.appointment_time).slice(0,5);
    if(appointmentTime&&!existing&&!upcomingDoctorSlots([{time:appointmentTime}],date,slotClock).length)setAppointmentTime('');
  },[appointmentTime,date,doctorId,slotClock,value.id,value.appointment_date,value.doctor_id,value.appointment_time]);
  const initialPatient=look.patients.find((item:R)=>item.id===patientId);
  const [patientSearch,setPatientSearch]=useState(initialPatient?`${initialPatient.name} · ${initialPatient.medical_record_number}`:"");
  const [patientSearchOpen,setPatientSearchOpen]=useState(false);
  const [patientMatches,setPatientMatches]=useState<R[]>([]),[patientLookupBusy,setPatientLookupBusy]=useState(false);
  useEffect(()=>{
    if(!patientId||initialPatient)return;
    const controller=new AbortController();
    q(`/patient-search?patient_id=${encodeURIComponent(patientId)}`,token,{signal:controller.signal}).then(rows=>{
      if(controller.signal.aborted||!rows[0])return;
      const found={...rows[0],name:String(rows[0].name||'').toUpperCase()};
      onPatientCreated(found);setPatientSearch(`${found.name} · ${found.medical_record_number}`);
    }).catch(error=>{if(!controller.signal.aborted)setPatientError(error.message);});
    return()=>controller.abort();
  },[patientId,Boolean(initialPatient),token]);
  useEffect(()=>{
    setPatientMatches([]);
    if(!patientSearchOpen||!patientSearch.trim()){setPatientLookupBusy(false);return;}
    const controller=new AbortController();setPatientLookupBusy(true);
    const timer=setTimeout(()=>{
      q(`/patient-search?search=${encodeURIComponent(patientSearch.trim())}`,token,{signal:controller.signal})
        .then(rows=>{if(!controller.signal.aborted)setPatientMatches(rows.map((patient:R)=>({...patient,name:String(patient.name||'').toUpperCase()})));})
        .catch(error=>{if(!controller.signal.aborted)setPatientError(error.message);})
        .finally(()=>{if(!controller.signal.aborted)setPatientLookupBusy(false);});
    },250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[patientSearch,patientSearchOpen,token]);
  const [appointmentCharges,setAppointmentCharges]=useState<R[]>(Array.isArray(value.charges)?value.charges:[]);
  const [doctorFeeSelection,setDoctorFeeSelection]=useState({registration_fee:false,maintenance_fee:false});
  const [consultationAmount,setConsultationAmount]=useState(Number(value.consultation_fee??0));
  const [discountAmount,setDiscountAmount]=useState(Number(value.discount??0));
  const [paidOverride,setPaidOverride]=useState<string|null>(value.id?String(value.paid_amount??0):null);
  const [paymentStatusOverride,setPaymentStatusOverride]=useState<string|null>(value.id?String(value.payment_status||'Pending'):null);
  const [selectedSymptoms,setSelectedSymptoms]=useState<string[]>(Array.isArray(value.symptoms)?value.symptoms:[]);
  const [symptomsOpen,setSymptomsOpen]=useState(false);
  const selection=appointmentSelection<R,R>(look.departments,look.doctors,branchId,departmentId,doctorId);
  const {departments,doctors,doctor}=selection;
  useEffect(()=>{
    if(!doctor||date||value.id)return;
    const today=hospitalToday();
    if(doctorDay(doctor.appointment_schedule||[],doctor.appointment_default_schedule,today,doctor.appointment_unavailable_dates||[]))setDate(today);
  },[doctor,date,value.id]);
  const scheduledDates=(Array.isArray(doctor?.appointment_schedule)?doctor.appointment_schedule:[]).map((item:R)=>{const raw=String(item.appointment_date||"");if(/^\d{2}-\d{2}-\d{4}$/.test(raw)){const [day,month,year]=raw.split("-");return `${year}-${month}-${day}`}return raw.slice(0,10)}).filter((item:string)=>Boolean(item)&&(Boolean(value.id)||item>=hospitalToday())).sort();
  const patient=look.patients.find((item:R)=>item.id===patientId);
  const matchingPatients=patientMatches;
  const registrationFee=Number(patient?.registration_fee||0), registrationAddons=Number(patient?.maintenance_fee||0), registrationDeposit=Number(patient?.deposit_amount||0), registrationDiscount=Number(patient?.discount||0);
  const registrationCharges=Array.isArray(patient?.registration_addons)?patient.registration_addons:[];
  const registrationTotal=Number(patient?.total_amount||0);
  const registrationBeforeDiscount=Math.max(0,registrationFee+registrationAddons);
  const consultationFee=doctorId?consultationAmount:0;
  const additionalTotal=appointmentCharges.reduce((sum,item)=>sum+Number(item.amount||0),0);
  const discount=discountAmount;
  const appointmentTotal=Math.max(0,consultationFee+additionalTotal-discount);
  const appointmentPaid=paidOverride??String(Math.round(appointmentTotal*100)/100);
  const appointmentPaymentStatus=paymentStatusOverride??(Number(appointmentPaid)>=appointmentTotal?'Paid':Number(appointmentPaid)>0?'Partially Paid':'Pending');
  const tokenPreview=doctorId&&departmentId&&date&&appointmentTime?`${date.split("-").reverse().join("")}/${String(doctor?.name||"DR").split(/\s+/).filter(Boolean).map((part:string)=>part[0]).join("").toUpperCase()||"DR"}/${String(look.departments.find((item:R)=>item.id===departmentId)?.name||"GEN").replace(/[^a-z0-9]/gi,"").slice(0,5).toUpperCase()||"GEN"}/${String((slots.find(slot=>slot.time===appointmentTime)?.serial)||1).padStart(3,"0")}`:"Select doctor, department, date and slot";
  useEffect(()=>{
    setSlots([]);setSlotsError("");setSlotsLoading(false);if(!doctor||!date)return;
    const controller=new AbortController();
    setSlotsLoading(true);
    q(`/appointment-slots?branch_id=${branchId}&department_id=${departmentId}&doctor_id=${doctorId}&date=${date}${queue?'&slot_interval=5':''}${value.id?'&appointment_id='+value.id:''}`,token,{signal:controller.signal}).then(result=>{if(controller.signal.aborted)return;setSlots(result);if(queue&&!value.id)setAppointmentTime(currentAvailableSlot(result,date));}).catch(error=>{if(!controller.signal.aborted){setSlots([]);setSlotsError(error instanceof Error?error.message:"Unable to load appointment slots. Please select the date again.");}}).finally(()=>{if(!controller.signal.aborted)setSlotsLoading(false);});
    return()=>controller.abort();
  },[branchId,departmentId,doctorId,Boolean(doctor),date,token,value.id,queue]);
  useEffect(()=>{if(queue&&value._register)void startRegistration();},[]);
  useEffect(()=>{if(value.id)return;setConsultationAmount(doctorId?Number(doctor?.consultation_fee||0):0)},[doctorId,doctor?.consultation_fee,value.id]);
  useEffect(()=>{if(!value.id&&doctor)setAppointmentCharges(current=>doctorAppointmentCharges(current,doctor,doctorFeeSelection));},[doctorId,doctor?.registration_fee,doctor?.maintenance_fee,Boolean(doctor),value.id,doctorFeeSelection.registration_fee,doctorFeeSelection.maintenance_fee]);
  if(registeringPatient&&patientFees)return <div aria-busy={patientSaving}><div className="co-patient-registration-actions" aria-label="Patient options"><button type="button" disabled={patientSaving} onClick={()=>setRegisteringPatient(false)}>Existing Patient</button><button type="button" aria-pressed="true" disabled={patientSaving}>New Patient Registration</button></div><PatientForm patient={{branch_id:branchId,status:"Active"}} branches={look.branches} fees={patientFees} close={()=>{if(!patientSaving)setRegisteringPatient(false);}} save={registerPatient} error={patientError} saving={patientSaving} saveLabel="Register & Continue to Appointment" page /></div>;
  return (
    <>
    {editingPatientId&&<SelectedPatientEditor patientId={editingPatientId} token={token} branches={look.branches} onClose={()=>setEditingPatientId('')} onSaved={updated=>{onPatientCreated(updated);setPatientSearch(updated.name+" · "+updated.medical_record_number);setPatientSearchOpen(false);setEditingPatientId('');}}/>}
    <div className="selected-patient-draft" hidden={!!editingPatientId}><section className="co-admission-page">
      <form data-permission={value.id?"appointment.update":"appointment.create"} className="co-modal co-admission-form" onSubmit={save}>
        <header>
          <button type="button" className="co-back-button" onClick={close} aria-label="Back to appointments"><ArrowLeft /></button>
          <div>
            <h2>{value.id ? "Edit Appointment" : "New Appointment"}</h2>
            <p>Schedule the visit and complete the appointment details.</p>
          </div>
        </header>
        {error&&<div className="co-error co-form-error" role="alert">{error}</div>}
        {!value.id&&<div className="co-patient-registration-actions" aria-label="Patient options"><button type="button" aria-pressed="true">Existing Patient</button><button type="button" disabled={registrationLoading||patientSaving} onClick={startRegistration}><Plus/> {registrationLoading?'Loading Registration…':'New Patient Registration'}</button>{patientError&&<p className="co-error">{patientError}</p>}</div>}
        <div className="co-grid">
          <label className="co-patient-search">
            <span>Patient</span>
            <div className="selected-patient-input-row"><input placeholder="Search by name, phone, UHID or email" value={patientSearch} autoComplete="off" onFocus={()=>setPatientSearchOpen(true)} onChange={(event)=>{setPatientSearch(event.target.value);setPatientId("");setPatientSearchOpen(true)}} />{patientId&&<PatientEditButton disabled={saving} onClick={()=>{setPatientSearchOpen(false);setEditingPatientId(patientId);}}/>}</div>
            <input type="hidden" name="patient_id" value={patientId} required />
            {patientSearchOpen&&patientSearch&&<div className="co-patient-results">{patientLookupBusy?<div role="status">Searching patients...</div>:matchingPatients.length?matchingPatients.map((item:R)=><button type="button" key={item.id} onClick={()=>{onPatientCreated(item);setPatientId(item.id);setPatientSearch(`${item.name} · ${item.medical_record_number}`);setPatientSearchOpen(false)}}><strong>{item.name}</strong><small>{item.medical_record_number} · {item.phone||"No phone"}{item.email?` · ${item.email}`:""}</small></button>):<div className="co-no-patients">No matching patients found.</div>}</div>}
          </label>
          <Field
            name="branch_id"
            label="Branch"
            value={branchId}
            required
            onChange={(event)=>{setBranchId(event.target.value);setDepartmentId("");setDoctorId("");setDate("");setAppointmentTime("");setSlots([])}}
          >
            <option value="">Select branch</option>
            {look.branches.map((x: R) => (
              <option value={x.id}>{x.name}</option>
            ))}
          </Field>
          <Field
            name="department_id"
            label="Department"
            value={departmentId}
            required
            disabled={!branchId}
            onChange={(event)=>{setDepartmentId(event.target.value);setDoctorId("");setDate("");setAppointmentTime("");setSlots([])}}
          >
            <option value="">{!branchId?"Select branch first":departments.length?"Select department":"No departments in this branch"}</option>
            {departments.map((x: R) => (
              <option value={x.id}>{x.name}</option>
            ))}
          </Field>
          <Field name="doctor_id" label="Doctor" value={doctor?doctorId:""} required disabled={!selection.department} onChange={(event)=>{setDoctorId(event.target.value);setDate("");setAppointmentTime("");setSlots([])}}>
            <option value="">{!branchId?"Select branch first":!selection.department?"Select department first":doctors.length?"Select doctor":"No doctors in this department"}</option>
            {doctors.map((x: R) => (
              <option value={x.id}>{x.name}</option>
            ))}
          </Field>
          {doctor?.appointment_default_schedule?<label><span>Available Appointment Date</span><input type="date" name="appointment_date" value={date} required max={doctor.appointment_default_schedule.end_date||undefined} min={value.id?undefined:(doctor.appointment_default_schedule.start_date>hospitalToday()?doctor.appointment_default_schedule.start_date:hospitalToday())} onChange={event=>{setDate(event.target.value);setAppointmentTime("")}}/><small>Daily {doctor.appointment_default_schedule.from_time} to {doctor.appointment_default_schedule.to_time} / {doctor.appointment_default_schedule.max_slots} slots</small></label>:<label><span>Available Appointment Date</span><select name="appointment_date" value={doctor?date:""} required disabled={!doctor} onChange={event=>{setDate(event.target.value);setAppointmentTime("")}}><option value="">{doctorId?(scheduledDates.length?"Select scheduled date":"No dates scheduled for this doctor"):"Select doctor first"}</option>{scheduledDates.map((item:string)=><option key={item} value={item}>{new Date(`${item}T00:00:00`).toLocaleDateString(undefined,{day:"2-digit",month:"short",year:"numeric"})}</option>)}</select></label>}

          {queue&&<input type="hidden" name="slot_interval" value="5"/>}
          <label><span>{queue?"Token Time (every 5 minutes)":"Available Doctor Slot"}</span><select name="appointment_time" value={doctor&&date?appointmentTime:""} required disabled={!doctor||!date} onChange={event=>setAppointmentTime(event.target.value)}>
            <option value="">{!doctor?"Select doctor first":!date?"Select appointment date first":slotsLoading?"Loading available slots...":slotsError?"Unable to load slots":slots.length?"Select available slot":"No future slots available for this date"}</option>
            {value.id&&appointmentTime&&!slots.some(slot=>slot.time===appointmentTime)&&<option value={appointmentTime}>{appointmentTime} (existing token)</option>}
            {slots.map(slot=><option value={slot.time} key={slot.time}>{slot.time} · Token {slot.serial}</option>)}
          </select>{slotsError&&<small role="alert">{slotsError}</small>}{date===hospitalToday()&&!slotsLoading&&!slotsError&&<small>Showing available slots after the current time (IST).</small>}</label>
          <Field
            name="appointment_type"
            label="Appointment Type"
            value={value.appointment_type}
          >
            <option>OPD</option>
            <option>Emergency</option>
            <option>Teleconsultation</option>
            <option>Procedure</option>
          </Field>
          <Field name="visit_type" label="Visit" value={value.visit_type}>
            <option>New</option>
            <option>Follow-Up</option>
          </Field>
          <label className="co-symptom-select"><span>Symptoms Type</span><button type="button" onClick={()=>setSymptomsOpen(open=>!open)}>{selectedSymptoms.length?`${selectedSymptoms.length} symptom${selectedSymptoms.length===1?"":"s"} selected`:"Select symptoms"}<b>⌄</b></button>{selectedSymptoms.map(name=><input key={name} type="hidden" name="symptoms" value={name}/>)}{symptomsOpen&&<div className="co-symptom-options">{(look.symptom_types??[]).length?(look.symptom_types??[]).map((item:R)=><label key={item.id}><input type="checkbox" checked={selectedSymptoms.includes(item.name)} onChange={()=>setSelectedSymptoms(items=>items.includes(item.name)?items.filter(name=>name!==item.name):[...items,item.name])}/><span>{item.name}</span></label>):<small>No symptom types configured.</small>}</div>}</label>
          <div className="co-section-title"><strong>Payment Details</strong><span>Previous registration payment and this appointment payment are saved separately.</span></div>
          <div className="co-charge-editor co-previous-charges"><div><strong>Previous Registration Charges</strong><small>Saved with the patient registration — read only.</small></div>{registrationCharges.length?registrationCharges.map((charge:R,index:number)=><div className="co-charge-row" key={charge.id||index}><input readOnly value={`${charge.name} — ₹${Number(charge.price||0).toFixed(2)}`}/><strong>₹{Number(charge.price||0).toFixed(2)}</strong></div>):<small>No prior registration charges.</small>}<div className="co-charge-total"><span>Registration Charges Total</span><strong>₹{registrationAddons.toFixed(2)}</strong></div></div>
          <label><span>Doctor Consultation Fee</span><input name="consultation_fee" type="number" value={consultationFee} readOnly/></label>
          {!value.id&&<fieldset className="co-doctor-service-fees"><legend>Doctor Registration &amp; Maintenance Fees</legend><p>Check the fees to include in this appointment.</p><div>{([{key:'registration_fee',label:'Registration Fee'},{key:'maintenance_fee',label:'Maintenance Fee'}] as const).map(fee=><label key={fee.key}><input type="checkbox" aria-label={`Include ${fee.label}`} checked={doctorFeeSelection[fee.key]} disabled={!doctor} onChange={event=>setDoctorFeeSelection(current=>({...current,[fee.key]:event.target.checked}))}/><span>{fee.label}</span><strong>INR {Number(doctor?.[fee.key]??0).toFixed(2)}</strong></label>)}</div><input type="hidden" name="doctor_fee_selection" value={JSON.stringify(doctorFeeSelection)}/></fieldset>}
          <div className="co-charge-editor"><div><strong>Additional Charges for this Appointment</strong><button type="button" onClick={()=>setAppointmentCharges(current=>[...current,{label:"",amount:0}])}>+ Add Charges</button></div>{appointmentCharges.map((charge,index)=>(!value.id&&charge.doctor_fee)?null:<div className="co-charge-row" key={index}><select disabled={!!charge.doctor_fee} value={charge.label||""} onChange={event=>{const selected=(look.charges??[]).find((item:R)=>item.name===event.target.value);setAppointmentCharges(current=>current.map((item,i)=>i===index?{...item,label:event.target.value,amount:Number(selected?.data?.standard_charge??item.amount??0)}:item))}}><option value="">Select Charge</option>{charge.doctor_fee&&<option value={charge.label}>{charge.label}</option>}{(look.charges??[]).filter((item:R)=>!charge.doctor_fee&&(item.name===charge.label||!appointmentCharges.some(other=>other.label===item.name))).map((item:R)=><option key={item.id} value={item.name}>{item.name} — ₹{Number(item.data?.standard_charge||0).toFixed(2)}</option>)}</select><strong>₹{Number(charge.amount||0).toFixed(2)}</strong><button type="button" disabled={!!charge.doctor_fee} aria-label="Remove charge" onClick={()=>setAppointmentCharges(current=>current.filter((_,i)=>i!==index))}>×</button></div>)}<div className="co-charge-total"><span>Appointment Additional Charges Total</span><strong>₹{additionalTotal.toFixed(2)}</strong></div></div>
          <input type="hidden" name="charges_payload" value={JSON.stringify(appointmentCharges.filter(item=>item.label&&(Number(item.amount)>0||item.doctor_fee)))}/>
          <label><span>Appointment Discount</span><input name="discount" type="number" min="0" step="0.01" value={discountAmount} onChange={event=>setDiscountAmount(Number(event.target.value||0))}/></label>
          <label><span>Paid Amount</span><input name="paid_amount" type="number" min="0" step="0.01" value={appointmentPaid} onChange={event=>{setPaidOverride(event.target.value);setPaymentStatusOverride(null);}}/></label>
          <label><span>Appointment Total</span><input readOnly value={`₹${appointmentTotal.toFixed(2)}`} /></label>
          <div className="co-payment-summary"><strong>Payment Summary</strong><span>Registration Charges <b>₹{registrationBeforeDiscount.toFixed(2)}</b></span><span>Registration Discount <b>− ₹{registrationDiscount.toFixed(2)}</b></span><span>Registration Amount After Discount <b>₹{registrationTotal.toFixed(2)}</b></span><span>Appointment Amount After Discount <b>₹{appointmentTotal.toFixed(2)}</b></span><span className="co-payment-grand-total">All Total <b>₹{(registrationTotal+appointmentTotal).toFixed(2)}</b></span></div>
          <Field name="payment_mode" label="Payment Mode" className="co-payment-highlight" value={value.id?value.payment_mode:'Cash'}><option value="">Select payment mode</option>{Array.from(new Set(['Cash',...(look.payment_methods??["Cash","Card","UPI","Bank Transfer"])] )).map((item:string)=><option key={item}>{item}</option>)}</Field>
          <Field
            name="payment_status"
            label="Payment Status"
            className="co-payment-highlight"
            value={appointmentPaymentStatus}
            onChange={event=>setPaymentStatusOverride(event.target.value)}
          >
            <option>Pending</option>
            <option>Paid</option>
            <option>Partially Paid</option>
            <option>Refunded</option>
          </Field>
          <Field name="source" label="Source" value={value.source}>
            <option>Reception</option>
            <option>Online</option>
            <option>Phone</option>
            <option>Walk-In</option>
          </Field>
          <label><span>Token Number</span><input name="token_number" readOnly value={tokenPreview}/></label>
          {queue?<input type="hidden" name="status" value={value.status||"Booked"}/>:<Field name="status" label="Status" value={value.status}>
            {apStatuses.map((s) => (
              <option>{s}</option>
            ))}
          </Field>
          }
          <Field name="reason" label="Reason" value={value.reason} />
          <Field name="notes" label="Notes" value={value.notes} />
        </div>
        <footer><button type="button" disabled={saving} onClick={close}>Cancel</button><button data-permission={value.id?"appointment.update":"appointment.create"} className="primary" type="submit" disabled={saving||!patientId||!selection.department||!doctor||!date||!appointmentTime}>{saving?"Saving...":"Save Appointment"}</button></footer>{value.id&&<OpdDocuments row={value} token={token}/>}
      </form>
    </section></div></>
  );
}
function IpdForm({
  value,
  look,
  token,
  error,
  save,
  close,
}: {
  value: R;
  look: R;
  token: string;
  error: string;
  save: (e: FormEvent<HTMLFormElement>) => void;
  close: () => void;
}) {
  const [branchId, setBranchId] = useState(value.branch_id || "");
  const [departmentId, setDepartmentId] = useState(value.department_id || "");
  const [consultantDoctorId, setConsultantDoctorId] = useState(value.consultant_doctor_id || "");
  const [wardId, setWardId] = useState(value.ward_id || "");
  const [roomId, setRoomId] = useState(value.room_id || "");
  const [bedId, setBedId] = useState(value.bed_id || "");
  const [deposit, setDeposit] = useState(Number(value.deposit_amount || 0));
  const [discount, setDiscount] = useState(Number(value.discount || 0));
  const [admissionCharges,setAdmissionCharges]=useState<R[]>(Array.isArray(value.charges)?value.charges:[]);
  const [paidAmount,setPaidAmount]=useState(Number(value.paid_amount||0));
  const [insured, setInsured] = useState(Boolean(value.has_insurance));
  const initialPatient = look.patients.find(
    (patient: R) => patient.id === value.patient_id,
  );
  const [patientId, setPatientId] = useState(value.patient_id || "");
  const [patientSearch, setPatientSearch] = useState(
    initialPatient
      ? `${initialPatient.name} · ${initialPatient.medical_record_number}`
      : "",
  );
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const additionalTotal=admissionCharges.reduce((sum,item)=>sum+Number(item.amount||0),0);
  const selectedBed=look.beds.find((bed:R)=>bed.id===bedId);
  const bedDailyCharge=Number(selectedBed?.daily_charge??value.bed_daily_charge??0);
  const admissionTotal=Math.max(0,bedDailyCharge+additionalTotal-discount);
  const total = admissionTotal;
  const collectedAmount=paidAmount+deposit;
  const balanceAmount=Math.max(0,total-collectedAmount);
  const creditAmount=Math.max(0,collectedAmount-total);
  const attendant = value.attendant || {};
  const matchingPatients = look.patients
    .filter((patient: R) =>
      `${patient.name} ${patient.medical_record_number} ${patient.phone || ""} ${patient.email || ""}`
        .toLowerCase()
        .includes(patientSearch.toLowerCase()),
    )
    .slice(0, 10);
  const departmentDoctors=Array.from(new Map(
    look.doctors
      .filter((doctor:R)=>(!branchId||doctor.branch_id===branchId)&&(!departmentId||doctor.department_id===departmentId))
      .map((doctor:R)=>[doctor.id,doctor]),
  ).values()) as R[];
  function selectPatient(id: string) {
    // Registration branch does not determine where this new visit takes place.
    if (!id) return;
    setBranchId((current: string) => look.branches.some((branch: R) => branch.id === current) ? current : look.branches[0]?.id || "");
  }
  useEffect(() => {
    if (value.patient_id) void selectPatient(value.patient_id);
  }, [value.patient_id]);
  return (
    <section className="co-admission-page">
      <form data-permission={value.id?"ipd.update":"ipd.create"} className="co-modal co-admission-form" onSubmit={save}>
        <header>
          <button type="button" className="co-back-button" onClick={close}>
            <ArrowLeft />
          </button>
          <div>
            <h2>{value.id ? "Edit IPD Admission" : "New IPD Admission"}</h2>
            <p>Complete admission, payment and insurance details.</p>
          </div>
        </header>
        {error && <div className="co-error co-form-error">{error}</div>}
        <div className="co-grid">
          <label className="co-patient-search">
            <span>Patient</span>
            <input
              placeholder="Search by name, phone, UHID or email"
              value={patientSearch}
              autoComplete="off"
              onFocus={() => setPatientSearchOpen(true)}
              onChange={(event) => {
                setPatientSearch(event.target.value);
                setPatientId("");
                setBranchId("");
                setWardId("");
                setRoomId("");
                setBedId("");
                setPatientSearchOpen(true);
              }}
            />
            <input type="hidden" name="patient_id" value={patientId} required />
            {patientSearchOpen && patientSearch && (
              <div className="co-patient-results">
                {matchingPatients.length ? (
                  matchingPatients.map((patient: R) => (
                    <button
                      type="button"
                      key={patient.id}
                      onClick={() => {
                        setPatientId(patient.id);
                        setPatientSearch(
                          `${patient.name} · ${patient.medical_record_number}`,
                        );
                        setPatientSearchOpen(false);
                        selectPatient(patient.id);
                      }}
                    >
                      <strong>{patient.name}</strong>
                      <small>
                        {patient.medical_record_number} ·{" "}
                        {patient.phone || "No phone"}{" "}
                        {patient.email ? `· ${patient.email}` : ""}
                      </small>
                    </button>
                  ))
                ) : (
                  <div className="co-no-patients">
                    No matching patients found.
                  </div>
                )}
              </div>
            )}
          </label>
          <label>
            <span>Branch</span>
            <select
              name="branch_id"
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setDepartmentId("");
                setConsultantDoctorId("");
                setWardId("");
                setRoomId("");
                setBedId("");
              }}
              required
            >
              <option value="">Select branch</option>
              {look.branches.map((x: R) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label><span>Admission Date / Time</span><input name="admitted_at" type="datetime-local" defaultValue={String(value.admitted_at||"").slice(0,16)} min={!value.id?`${hospitalToday()}T00:00`:undefined} max={!value.id?`${hospitalToday()}T23:59`:undefined} required readOnly={Boolean(value.id)}/></label>
          <Field
            name="admission_type"
            label="Admission Type"
            value={value.admission_type}
          >
            <option>Planned</option>
            <option>Emergency</option>
            <option>Day Care</option>
            <option>Transfer</option>
          </Field>
          <Field
            name="department_id"
            label="Department"
            value={departmentId}
            onChange={(event)=>{setDepartmentId(event.target.value);setConsultantDoctorId("")}}
          >
            <option value="">Select</option>
            {look.departments.filter((x:R)=>!branchId||x.branch_id===branchId).map((x: R) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Field>
          <Field
            name="consultant_doctor_id"
            label="Consultant Doctor"
            value={consultantDoctorId}
            disabled={!departmentId}
            onChange={(event)=>setConsultantDoctorId(event.target.value)}
          >
            <option value="">{departmentId?"Select":"Select department first"}</option>
            {departmentDoctors.map((x: R) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Field>
          <input type="hidden" name="ward_id" value={wardId}/>
          <input type="hidden" name="room_id" value={roomId}/>
          {value.id?<label><span>Current Bed (use Transfer to change)</span><input readOnly value={selectedBed?[selectedBed.name,look.wards.find((x:R)=>x.id===wardId)?.name,look.rooms.find((x:R)=>x.id===roomId)?.name].filter(Boolean).join(" · "):"Not allocated"}/><input type="hidden" name="bed_id" value={bedId}/></label>:<label><span>Available Bed</span><select name="bed_id" value={bedId} onChange={(event) => {
            const nextBedId = event.target.value;
            setBedId(nextBedId);
            const bed = look.beds.find((x: R) => x.id === nextBedId);
            if (bed) {
              setWardId(bed.ward_id || "");
              setRoomId(bed.room_id || "");
            }
          }}>
            <option value="">Allocate later</option>
            {look.beds.filter((x: R) =>
              (!branchId || x.branch_id === branchId) &&
              (x.status === "Available" || x.id === value.bed_id)
            ).map((x: R) => {
              const ward=look.wards.find((item:R)=>item.id===x.ward_id)?.name;
              const room=look.rooms.find((item:R)=>item.id===x.room_id)?.name;
              return <option key={x.id} value={x.id}>{[x.name,ward,room,x.bed_type].filter(Boolean).join(" · ")} — ₹{Number(x.daily_charge||0).toFixed(2)}/day</option>;
            })}
          </select></label>}
          <label><span>Bed Location</span><input readOnly value={bedId ? [look.wards.find((x:R)=>x.id===wardId)?.name,look.rooms.find((x:R)=>x.id===roomId)?.name].filter(Boolean).join(" / ") || "Configured in Bed Master" : "Select a bed"}/></label>
          <Field
            name="reason_diagnosis"
            label="Reason / Diagnosis"
            value={value.reason_diagnosis}
          />
          <Field
            name="attendant_name"
            label="Attendant Name"
            value={attendant.name}
          />
          <label><span>Attendant Phone</span><input name="attendant_phone" type="tel" inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} defaultValue={attendant.phone||""} placeholder="10-digit mobile number" title="Enter exactly 10 digits" onInput={event=>{event.currentTarget.value=event.currentTarget.value.replace(/\D/g,"").slice(0,10)}}/></label>
          <Field
            name="attendant_relationship"
            label="Attendant Relationship"
            value={attendant.relationship}
          />
          <Field
            name="expected_discharge"
            label="Expected Discharge"
            type="date"
            min={String(value.admitted_at || hospitalToday()).slice(0, 10) < hospitalToday() ? hospitalToday() : String(value.admitted_at || hospitalToday()).slice(0, 10)}
            value={String(value.expected_discharge || "").slice(0, 10)}
          />
          <div className="co-section-title">
            <strong>Payment Details</strong>
            <span>Only charges for this IPD admission are included.</span>
          </div>
          <input type="hidden" name="registration_amount" value="0" />
          <input type="hidden" name="registration_fee_amount" value="0" />
          <input type="hidden" name="registration_addon_amount" value="0" />
          <input type="hidden" name="registration_deposit_amount" value="0" />
          <input type="hidden" name="registration_discount_amount" value="0" />
          <input type="hidden" name="consultation_fee" value="0" />
          <label>
            <span>Patient Deposit / Advance</span>
            <input
              name="deposit_amount"
              type="number"
              min="0"
              step="0.01"
              value={deposit}
              onChange={(e) => setDeposit(Number(e.target.value))}
            />
          </label>
          <label>
            <span>Current Bed Daily Rate</span>
            <input readOnly value={bedId ? `₹${bedDailyCharge.toFixed(2)}${selectedBed?.bed_type ? ` — ${selectedBed.bed_type}` : ""}` : "Allocate a bed to apply charge"} />
          </label>
          <div className="co-charge-editor"><div><strong>Additional Charges for this Admission</strong><button type="button" onClick={()=>setAdmissionCharges(current=>[...current,{label:"",amount:0}])}>+ Add Charges</button></div>{admissionCharges.map((charge,index)=><div className="co-charge-row" key={index}><select value={charge.label||""} onChange={event=>{const selected=(look.charges??[]).find((item:R)=>item.name===event.target.value);setAdmissionCharges(current=>current.map((item,i)=>i===index?{...item,label:event.target.value,amount:Number(selected?.data?.standard_charge??item.amount??0)}:item))}}><option value="">Select Charge</option>{(look.charges??[]).filter((item:R)=>item.name===charge.label||!admissionCharges.some(other=>other.label===item.name)).map((item:R)=><option key={item.id} value={item.name}>{item.name} — ₹{Number(item.data?.standard_charge||0).toFixed(2)}</option>)}</select><strong>₹{Number(charge.amount||0).toFixed(2)}</strong><button type="button" onClick={()=>setAdmissionCharges(current=>current.filter((_,i)=>i!==index))}>×</button></div>)}<div className="co-charge-total"><span>Admission Additional Charges Total</span><strong>₹{additionalTotal.toFixed(2)}</strong></div></div>
          <input type="hidden" name="charges_payload" value={JSON.stringify(admissionCharges.filter(item=>item.label&&Number(item.amount)>0))}/>
          <label><span>Paid Amount</span><input name="paid_amount" type="number" min="0" step="0.01" value={paidAmount} onChange={event=>setPaidAmount(Number(event.target.value))}/></label>
          <Field
            name="payment_mode"
            label="Payment Mode"
            value={value.payment_mode}
          >
            <option value="">Select Payment Mode</option>
            {(look.payment_methods ?? ["Cash","Card","UPI","Bank Transfer","Cheque"]).map((mode:string)=><option key={mode}>{mode}</option>)}
          </Field>
          <Field
            name="payment_reference"
            label="Ref / UTR No."
            value={value.payment_reference}
          />
          <label>
            <span>New Admission Discount</span>
            <input
              name="discount"
              type="number"
              min="0"
              max={bedDailyCharge + additionalTotal}
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
            />
          </label>
          <Field
            name="discount_remarks"
            label="Discount Remarks"
            value={value.discount_remarks}
          />
          <label><span>Payment Status</span><input readOnly value={collectedAmount >= total && total > 0 ? "Paid" : collectedAmount > 0 && total > 0 ? "Partially Paid" : deposit > 0 ? "Deposit Held" : "Unpaid"}/><input type="hidden" name="admission_payment_status" value={collectedAmount >= total && total > 0 ? "Paid" : "Unpaid"}/></label>
          <Field
            name="payment_status_remarks"
            label="Payment Status Remarks"
            value={value.payment_status_remarks}
          />
          <label className="co-total">
            <span>Admission Total</span>
            <input readOnly value={`₹${admissionTotal.toFixed(2)}`} />
            <input type="hidden" name="total_amount" value={total} />
          </label>
          <div className="co-payment-summary"><strong>Payment Summary</strong><span>Current Bed Daily Rate <b>₹{bedDailyCharge.toFixed(2)}</b></span><span>Additional Charges <b>₹{additionalTotal.toFixed(2)}</b></span><span>Patient Deposit <b>₹{deposit.toFixed(2)}</b></span><span>Other Paid Amount <b>₹{paidAmount.toFixed(2)}</b></span><span>Admission Discount <b>− ₹{discount.toFixed(2)}</b></span><span>Balance Due <b>₹{balanceAmount.toFixed(2)}</b></span>{creditAmount>0&&<span>Patient Credit <b>₹{creditAmount.toFixed(2)}</b></span>}<span className="co-payment-grand-total">IPD Total <b>₹{total.toFixed(2)}</b></span></div>
          <div className="co-section-title"><strong>Patient Documents</strong><span>Upload PDF or image files, maximum 2 MB each.</span></div>
          {patientDocumentFields.map(([key,label])=>{const document=value.patient_documents?.[key];return <label key={key}><span>{label}</span><input name={`patient_document_${key}`} type="file" accept="application/pdf,image/jpeg,image/png,image/webp"/>{document?.data&&<a href={document.data} target="_blank" rel="noreferrer">View current {document.name||label}</a>}</label>})}
          <div className="co-section-title">
            <strong>Insurance Details</strong>
          </div>
          <label className="co-insurance-toggle">
            <span>Insurance</span>
            <select
              value={insured ? "Yes" : "No"}
              onChange={(e) => setInsured(e.target.value === "Yes")}
            >
              <option>No</option>
              <option>Yes</option>
            </select>
          </label>
          {insured && (
            <>
              <Field
                name="insurance_company"
                label="Company Name"
                value={value.insurance_company}
                required
              />
              <Field
                name="policy_number"
                label="Policy Number"
                value={value.policy_number}
                required
              />
              <label>
                <span>Insurance Document (max 5 MB)</span>
                <input
                  name="insurance_document_file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                />
                {value.insurance_document && (
                  <a
                    className="co-document"
                    href={value.insurance_document}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View current document
                  </a>
                )}
              </label>
            </>
          )}
          <input
            type="hidden"
            name="has_insurance"
            value={insured ? "Yes" : "No"}
          />
          <input type="hidden" name="insurance_tpa" value="" />
          <input type="hidden" name="advance" value="0" />
          <input
            type="hidden"
            name="status"
            value={value.status || "Admitted"}
          />
        </div>
        <Actions
          close={close}
          label={value.id ? "Save Admission" : "Admit Patient"}
        />
      </form>
    </section>
  );
}
function TransferForm({
  value,
  look,
  token,
  done,
  close,
}: {
  value: R;
  look: R;
  token: string;
  done: () => void;
  close: () => void;
}) {
  const [departmentId,setDepartmentId]=useState(value.department_id||"");
  const [doctorId,setDoctorId]=useState(value.consultant_doctor_id||"");
  const [bedId,setBedId]=useState(value.bed_id||"");
  const [error,setError]=useState("");
  const doctors=Array.from(new Map(look.doctors.filter((x:R)=>x.department_id===departmentId&&(!value.branch_id||x.branch_id===value.branch_id)).map((x:R)=>[x.id,x])).values()) as R[];
  const beds=look.beds.filter((x:R)=>x.branch_id===value.branch_id&&(x.status==="Available"||x.id===value.bed_id));
  async function go(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    try {
      await q(`/ipd/${value.id}/transfer`, token, {method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});
      done();
    } catch(e){setError(e instanceof Error?e.message:"Unable to complete transfer")}
  }
  return (
    <Modal title={`Transfer ${value.ipd_number}`} close={close}>
      <form onSubmit={go}>
        <div className="co-grid">
          <Field name="transfer_type" label="Transfer Type">
            <option>Bed Transfer</option>
            <option>Ward Transfer</option>
            <option>Doctor Transfer</option>
            <option>Department Transfer</option>
          </Field>
          <Field
            name="department_id"
            label="Department"
            value={departmentId}
            onChange={(e)=>{setDepartmentId(e.target.value);setDoctorId("")}}
          >
            <option value="">Select department</option>
            {look.departments.filter((x:R)=>x.branch_id===value.branch_id).map((x: R) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Field>
          <Field
            name="consultant_doctor_id"
            label="Consultant"
            value={doctorId}
            disabled={!departmentId}
            onChange={(e)=>setDoctorId(e.target.value)}
          >
            <option value="">{departmentId?"Select consultant":"Select department first"}</option>
            {doctors.map((x: R) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Field>
          <Field name="bed_id" label="Bed" value={bedId} onChange={(e)=>setBedId(e.target.value)}>
            <option value="">No bed allocated</option>
            {beds.map((x: R) => {
              const ward=look.wards.find((w:R)=>w.id===x.ward_id)?.name,room=look.rooms.find((r:R)=>r.id===x.room_id)?.name;
              return <option key={x.id} value={x.id}>{[x.name,ward,room].filter(Boolean).join(" · ")} — ₹{Number(x.daily_charge||0).toFixed(2)}/day{x.id===value.bed_id?" (current)":""}</option>
            })}
          </Field>
          <Field name="notes" label="Transfer Notes" />
        </div>
        {error&&<div className="co-error">{error}</div>}
        <Actions close={close} label="Complete Transfer" />
      </form>
    </Modal>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: any;
}) {
  return (
    <div className="co-back">
      <section className="co-modal">
        <header>
          <div>
            <h2>{title}</h2>
            <p>All records stay isolated inside this clinic.</p>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Actions({ close, label }: { close: () => void; label: string }) {
  return (
    <footer>
      <button type="button" onClick={close}>
        Cancel
      </button>
      <button className="primary">{label}</button>
    </footer>
  );
}
