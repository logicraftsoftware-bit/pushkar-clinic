import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Check, CalendarDays, Users, CalendarCheck2, CalendarClock, Download, Edit3, Eye, FileText, LoaderCircle, Plus, Printer, Search, Stethoscope, UserX } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import "./opd-appointment-calendar.css";
import DoctorMultiFilter from "./DoctorMultiFilter";
import OpdCheckInPayment, { type CheckInPayment } from "./OpdCheckInPayment";

type Appointment = Record<string, any>;
export type CalendarSelection = { month: string; day: string; doctor: string };
type Props = {
  rows: Appointment[]; selection: CalendarSelection; onNavigate: (value: CalendarSelection) => void;
  loading: boolean; error: string; notice: string; onRetry: () => void; onNew: () => void;
  onEdit: (row: Appointment) => void; onView: (row: Appointment) => void;
  onPrint: (row: Appointment) => void; onFollowUp: (row: Appointment) => void;
  onStatus: (row: Appointment, status: string) => Promise<void>;
  onCheckIn: (row: Appointment, payment?: CheckInPayment) => Promise<void>;
  paymentMethods: string[];
};
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const doctorKey = (row: Appointment) => String(row.doctor_id || "unassigned");
function attendance(row: Appointment) {
  if (["Booked", "Confirmed"].includes(row.status)) return "Awaiting";
  if (["No Show", "Absent"].includes(row.status)) return "Absent";
  return row.status || "Awaiting";
}
const tone = (value: string) => ({ Awaiting: "blue", "Checked In": "green", Present: "green", Paid: "green", Absent: "red", Cancelled: "red", Pending: "amber", Unpaid: "amber", "Partially Paid": "purple" }[value] || "gray");
function timeLabel(value: unknown) {
  const [hour, minute] = String(value || "").split(":");
  return hour && minute ? `${Number(hour) % 12 || 12}:${minute} ${Number(hour) >= 12 ? "pm" : "am"}` : "No time";
}

export default function OpdAppointmentCalendar(props: Props) {
  const { rows, selection, onNavigate, loading, error, notice } = props;
  const { month, day, doctor } = selection;
  const [search, setSearch] = useState("");
  const [doctorFilters,setDoctorFilters]=useState<string[]>([]);
  const [attendanceFilter, setAttendanceFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [paymentAppointment, setPaymentAppointment] = useState<Appointment | null>(null);
  const [checkInError, setCheckInError] = useState("");
  async function checkIn(row: Appointment) {
    setCheckInError("");
    if (!["paid", "payment not required"].includes(String(row.payment_status).trim().toLowerCase())) {
      setPaymentAppointment(row);
      return;
    }
    setBusy(row.id);
    try { await props.onCheckIn(row); }
    catch (err) { setCheckInError(err instanceof Error ? err.message : "Unable to check in."); }
    finally { setBusy(""); }
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const counts = new Map<string, number>();
  rows.forEach(row => { const key = String(row.appointment_date).slice(0, 10); counts.set(key, (counts.get(key) || 0) + 1); });
  const monthly = rows.filter(row => String(row.appointment_date).slice(0, 7) === month);
  const monthlyDoctors = new Set(monthly.map(row => row.doctor_id).filter(Boolean)).size;
  const bookedDays = new Set(monthly.map(row => String(row.appointment_date).slice(0, 10))).size;
  const daily = rows.filter(row => String(row.appointment_date).slice(0, 10) === day);
  const groups = Array.from(new Set(daily.map(doctorKey))).map(key => {
    const appointments = daily.filter(row => doctorKey(row) === key);
    return { key, appointments, name: String(appointments[0].doctor_name || "").trim() || "Unassigned doctor", departments: [...new Set(appointments.map(row => row.department_name).filter(Boolean))].join(", "), branches: [...new Set(appointments.map(row => row.branch_name).filter(Boolean))].join(", ") };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const filteredGroups=groups.filter(group=>!doctorFilters.length||doctorFilters.includes(group.key));
  const selected = groups.find(group => group.key === doctor);
  const patients = (selected?.appointments || []).filter(row =>
    [row.patient_name, row.medical_record_number, row.patient_phone].join(" ").toLowerCase().includes(search.toLowerCase()) &&
    (!attendanceFilter || attendance(row) === attendanceFilter) && (!paymentFilter || (row.payment_status || "Pending") === paymentFilter)
  ).sort((a, b) => String(a.appointment_time).localeCompare(String(b.appointment_time)) || String(a.patient_name).localeCompare(String(b.patient_name)));
  function navigate(next: CalendarSelection) { if(next.day!==day)setDoctorFilters([]); setSearch(""); setAttendanceFilter(""); setPaymentFilter(""); onNavigate(next); }
  function changeMonth(offset: number) { const date = new Date(`${month}-01T12:00:00`); date.setMonth(date.getMonth() + offset); navigate({ month: dateKey(date).slice(0, 7), day: "", doctor: "" }); }
  async function update(row: Appointment, status: string) { setBusy(row.id); try { await props.onStatus(row, status); } finally { setBusy(""); } }
  function exportList(format: "csv" | "pdf") {
    const headers = ["Time", "Patient", "Patient ID", "Phone", "Attendance", "Payment"];
    const data = patients.map(row => [timeLabel(row.appointment_time), row.patient_name || "", row.medical_record_number || "", row.patient_phone || "", attendance(row), row.payment_status || "Pending"]);
    const filename = `OPD-${day}-${(selected?.name || "patients").replace(/[^a-z0-9-]/gi, "_")}`;
    if (format === "pdf") { const pdf = new jsPDF({ orientation: "landscape" }); pdf.setFontSize(16); pdf.text(selected?.name || "Patient list", 14, 18); pdf.setFontSize(10); pdf.text(`${dayLabel(day)} | ${patients.length} patients`, 14, 26); autoTable(pdf, { head: [headers], body: data, startY: 33 }); pdf.save(`${filename}.pdf`); return; }
    const cell = (value: unknown) => { const text = String(value); return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`; };
    const url = URL.createObjectURL(new Blob(["\uFEFF" + [headers, ...data].map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = `${filename}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const first = new Date(`${month}-01T12:00:00`);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first.getDay() + days) / 7) * 7 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index - first.getDay() + 1, 12));
  return <section className="opd-calendar-page">
    <nav className="opd-steps" aria-label="Appointment navigation">
      <button aria-current={!day ? "step" : undefined} onClick={() => navigate({ ...selection, day: "", doctor: "" })}><span>1</span>Calendar</button><ChevronRight size={14} />
      <button disabled={!day} aria-current={day && !doctor ? "step" : undefined} onClick={() => navigate({ ...selection, doctor: "" })}><span>2</span>Doctors</button><ChevronRight size={14} />
      <span className={doctor ? "current" : ""} aria-current={doctor ? "step" : undefined}><span>3</span>Patients</span>
    </nav>
    {day && <button className="opd-back" onClick={() => navigate({ ...selection, day: doctor ? day : "", doctor: "" })}><ArrowLeft size={17} />Back to {doctor ? "doctors" : "calendar"}</button>}
    <header className="opd-heading"><div><small>{doctor ? "DAILY PATIENT LIST" : day ? "APPOINTMENT ROSTER" : "OPD APPOINTMENTS"}</small><h1>{doctor ? selected?.name || "Doctor patient list" : day ? dayLabel(day) : "OPD Appointment Calendar"}</h1><p>{doctor ? `${dayLabel(day)}${selected?.departments ? ` · ${selected.departments}` : ""}` : day ? `${daily.length} appointments across ${groups.length} doctors.` : "See every doctor appointment across the hospital by date."}</p></div><div className="opd-heading-actions">{doctor ? <><button disabled={loading || !patients.length} onClick={() => exportList("csv")}><Download size={17} />Export CSV</button><button className="opd-primary" disabled={loading || !patients.length} onClick={() => exportList("pdf")}><FileText size={17} />Export PDF</button></> : <button className="opd-primary" onClick={props.onNew}><Plus size={18} />New Appointment</button>}</div></header>
    {error && <div className="opd-error" role="alert">{error}<button onClick={props.onRetry}>Retry</button></div>}
    {checkInError && <div className="opd-error" role="alert">{checkInError}<button onClick={props.onRetry}>Refresh</button></div>}
    {notice && <div className="opd-notice" role="status">{notice}</div>}
    {!day && !loading && !error && <div className="opd-overview" aria-label="Monthly overview">
      <article><span className="opd-overview-icon"><CalendarDays size={20} /></span><div><small>Appointments this month</small><strong>{monthly.length.toLocaleString("en-IN")}</strong></div><span className="opd-overview-note">Scheduled visits</span></article>
      <article><span className="opd-overview-icon violet"><Stethoscope size={20} /></span><div><small>Doctors with appointments</small><strong>{monthlyDoctors}</strong></div></article>
      <article><span className="opd-overview-icon teal"><CalendarCheck2 size={20} /></span><div><small>Days with appointments</small><strong>{bookedDays}<small> / {days} days</small></strong></div></article>
    </div>}
    {day&&!doctor&&<div className="opd-roster-filter"><DoctorMultiFilter doctors={groups.map(group=>({id:group.key,name:group.name}))} value={doctorFilters} onChange={setDoctorFilters}/><span>{filteredGroups.length} of {groups.length} doctors</span></div>}
    {loading ? <div className="opd-empty" role="status"><LoaderCircle size={22} />Loading appointments…</div> : !day ? <div className="opd-month-card"><div className="opd-month-nav"><div className="opd-month-title"><span className="opd-month-icon"><CalendarDays size={21} /></span><div><h2>{first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2><p>Select a date to view doctors and appointments</p></div></div><div className="opd-month-controls"><button className="opd-today-button" onClick={() => navigate({ month: today.slice(0, 7), day: "", doctor: "" })}>Today</button><div><button aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft /></button><button aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight /></button></div></div></div><div className="opd-month-legend"><span><i className="blue" />Appointments scheduled</span><span><i className="opd-today-dot" />Today</span></div><div className="opd-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(label => <span key={label}>{label}</span>)}</div><div className="opd-month-grid">{cells.map(date => { const key = dateKey(date), count = counts.get(key) || 0; return <button key={key} aria-label={`${dayLabel(key)}, ${count} appointments`} aria-current={key === today ? "date" : undefined} className={`${count ? "booked" : ""} ${key.slice(0, 7) !== month ? "outside" : ""} ${key === today ? "today" : ""}`} onClick={() => navigate({ month: key.slice(0, 7), day: key, doctor: "" })}><span className="opd-date-top"><span className="opd-day-number">{date.getDate()}</span>{key === today && <span className="opd-today-label">Today</span>}</span>{count > 0 ? <span className="opd-day-bookings"><Users size={13} /><strong>{count}</strong><span>{count === 1 ? "appointment" : "appointments"}</span><ChevronRight size={13} /></span> : <span className="opd-no-bookings" aria-hidden="true">&ndash;</span>}</button>; })}</div></div> : !doctor ? <div className="opd-doctors">{filteredGroups.length ? filteredGroups.map(group => <button className="opd-doctor" key={group.key} onClick={() => navigate({ ...selection, doctor: group.key })}><span className="opd-doctor-icon"><Stethoscope size={25} /></span><span className="opd-doctor-details"><strong>{group.name}</strong><small>{group.departments || "General Medicine"}</small><small>{group.branches}</small></span><span className="opd-doctor-count"><strong>{group.appointments.length}</strong><small>{group.appointments.length === 1 ? "patient" : "patients"}</small></span><ChevronRight size={18} /></button>) : <div className="opd-empty">No doctors match the selected filters or have appointments on this date.</div>}</div> : <>
      <div className="opd-color-guide"><b>Colour guide:</b>{["Awaiting", "Checked In", "Absent", "Paid", "Pending", "Partially Paid", "Payment not required"].map(label => <span key={label}><i className={tone(label)} />{label === "Pending" ? "Payment pending" : label}</span>)}</div>
      <div className="opd-patient-card"><div className="opd-patient-filters"><label className="opd-search"><Search size={18} /><input aria-label="Search patients" placeholder="Search patient name, ID or phone number" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Filter attendance" value={attendanceFilter} onChange={event => setAttendanceFilter(event.target.value)}><option value="">All attendance</option>{["Awaiting", "Checked In", "Waiting", "In Consultation", "Completed", "Absent", "Cancelled"].map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filter payment status" value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)}><option value="">All payment statuses</option>{[...new Set(["Pending", "Paid", "Partially Paid", "Refunded", ...daily.map(row => row.payment_status).filter(Boolean)])].map(value => <option key={value}>{value}</option>)}</select></div><div className="opd-patient-total">Showing {patients.length} of {selected?.appointments.length || 0} patients</div>
      {patients.map(row => <article key={row.id} className={`opd-patient-row border-${tone(attendance(row))}`}><strong className="opd-time">{timeLabel(row.appointment_time)}</strong><button className="opd-patient-name" onClick={() => props.onView(row)}><strong>{row.patient_name}</strong><small>{row.medical_record_number} · {row.patient_phone || "No phone number"}</small></button><span className={`opd-badge ${tone(attendance(row))}`}>{attendance(row)}</span><button title="Edit appointment payment details" className={`opd-badge opd-payment ${tone(row.payment_status || "Pending")}`} onClick={() => props.onEdit(row)}>{row.payment_status || "Pending"}<Edit3 size={12} /></button><div className="opd-row-actions"><button onClick={() => props.onFollowUp(row)}><CalendarClock size={15} />Follow-up</button><button className="opd-check" disabled={!!busy || !["Booked", "Confirmed"].includes(row.status)} onClick={() => checkIn(row)}><Check size={15} />Check in</button><button className="opd-absent" disabled={!!busy || !["Booked", "Confirmed", "Checked In", "Waiting", "Present"].includes(row.status)} onClick={() => update(row, "No Show")}><UserX size={15} />Absent</button><button title="View patient" aria-label={`View ${row.patient_name}`} onClick={() => props.onView(row)}><Eye size={15} /></button><button title="Print prescription" aria-label={`Print prescription for ${row.patient_name}`} onClick={() => props.onPrint(row)}><Printer size={15} /></button></div></article>)}
      {!patients.length && <div className="opd-empty">No patients match the selected filters.</div>}</div>
    </>}
    {paymentAppointment && <OpdCheckInPayment appointment={paymentAppointment} methods={props.paymentMethods} onClose={() => setPaymentAppointment(null)} onSave={payment => props.onCheckIn(paymentAppointment, payment)} />}
  </section>;
}
