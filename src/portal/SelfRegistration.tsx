import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, LoaderCircle, UserRoundPlus } from "lucide-react";
import "./self-registration.css";
import { indiaLocations, indianStates } from "../hospital/india-locations";

type Row = Record<string, any>;
const API = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:4000");
const LOCATION_API = "https://countriesnow.space/api/v0.1/countries";

export default function SelfRegistration() {
  const token = decodeURIComponent(window.location.pathname.split("/self-registration/")[1] || "");
  const [hospital, setHospital] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [registered, setRegistered] = useState<Row | null>(null);
  const [lookups, setLookups] = useState<Row>({ departments: [], doctors: [] });
  const [registrationType, setRegistrationType] = useState("OPD");
  const [departmentId, setDepartmentId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [slots, setSlots] = useState<Row[]>([]);
  const [stateName,setStateName]=useState(""),[cityName,setCityName]=useState(""),[stateOptions,setStateOptions]=useState(indianStates),[cityOptions,setCityOptions]=useState<string[]>([]);
  useEffect(() => {
    fetch(`${API}/api/v1/self-registration/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to open registration");
        setHospital(data);
        return fetch(`${API}/api/v1/self-registration/${encodeURIComponent(token)}/lookups`);
      })
      .then(async response => { if(!response)return;const data=await response.json();if(response.ok)setLookups(data); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to open registration"));
  }, [token]);
  useEffect(()=>{
    if(registrationType!=="OPD"||!doctorId||!appointmentDate){setSlots([]);return;}
    fetch(`${API}/api/v1/self-registration/${encodeURIComponent(token)}/slots?doctor_id=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(appointmentDate)}`)
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||"Unable to load slots");setSlots(data)})
      .catch(reason=>setError(reason instanceof Error?reason.message:"Unable to load slots"));
  },[token,registrationType,doctorId,appointmentDate]);
  useEffect(()=>{const controller=new AbortController();fetch(`${LOCATION_API}/states`,{signal:controller.signal}).then(r=>r.ok?r.json():Promise.reject()).then(payload=>{const india=payload?.data?.find((country:Row)=>country.name==="India"),states=india?.states?.map((item:Row)=>String(item.name)).filter(Boolean);if(states?.length)setStateOptions(states)}).catch(()=>undefined);return()=>controller.abort()},[]);
  useEffect(()=>{if(!stateName){setCityOptions([]);return}setCityOptions(indiaLocations[stateName]??[]);const controller=new AbortController();fetch(`${LOCATION_API}/state/cities`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({country:"India",state:stateName}),signal:controller.signal}).then(r=>r.ok?r.json():Promise.reject()).then(payload=>{if(Array.isArray(payload?.data)&&payload.data.length)setCityOptions(payload.data.map(String))}).catch(()=>undefined);return()=>controller.abort()},[stateName]);
  const doctors=(lookups.doctors||[]).filter((doctor:Row)=>!departmentId||doctor.department_id===departmentId),selectedDoctor=(lookups.doctors||[]).find((doctor:Row)=>doctor.id===doctorId),fee=Number(selectedDoctor?.consultation_fee||0);
  function registrationPayload(form:FormData){return {
    first_name: form.get("first_name"), last_name: form.get("last_name"), sex: form.get("sex"), blood_group: form.get("blood_group"), phone: form.get("phone"), email: form.get("email"),
    address: { age_years:form.get("age_years"),age_months:form.get("age_months"),age_days:form.get("age_days"), line: form.get("address"), city: form.get("city"), state: form.get("state"), pin: form.get("pin") }, emergency_contact: { name: form.get("emergency_name"), phone: form.get("emergency_phone"), relationship: form.get("emergency_relationship") }, allergies: form.get("allergies"), existing_conditions: form.get("existing_conditions"), current_medication: form.get("current_medication"),
    registration_type:registrationType,department_id:departmentId||undefined,doctor_id:doctorId||undefined,appointment_date:appointmentDate||undefined,appointment_time:form.get("appointment_time")||undefined,reason:form.get("reason")||"",
  }}
  async function finishRegistration(body:Row){const response=await fetch(`${API}/api/v1/self-registration/${encodeURIComponent(token)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),data=await response.json();if(!response.ok)throw new Error(data.error||"Unable to register patient");setRegistered(data)}
  async function loadRazorpay(){if((window as any).Razorpay)return true;return await new Promise<boolean>(resolve=>{const script=document.createElement("script");script.src="https://checkout.razorpay.com/v1/checkout.js";script.onload=()=>resolve(true);script.onerror=()=>resolve(false);document.head.appendChild(script)})}
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const body=registrationPayload(form);
      if(registrationType==="IPD"||fee<=0){await finishRegistration(body);return;}
      const orderResponse=await fetch(`${API}/api/v1/self-registration/${encodeURIComponent(token)}/payment-order`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({doctor_id:doctorId})}),order=await orderResponse.json();
      if(!orderResponse.ok)throw new Error(order.error||"Unable to start payment");
      if(order.free){await finishRegistration(body);return;}
      if(!await loadRazorpay())throw new Error("Unable to load the secure payment window.");
      const checkout=new (window as any).Razorpay({key:order.key,amount:order.amount,currency:order.currency,name:hospital?.hospital_name||"Hospital",description:"OPD Consultation Fee",order_id:order.order_id,prefill:{name:`${body.first_name} ${body.last_name}`,contact:body.phone,email:body.email},handler:async(payment:Row)=>{try{await finishRegistration({...body,razorpay_order_id:payment.razorpay_order_id,razorpay_payment_id:payment.razorpay_payment_id,razorpay_signature:payment.razorpay_signature})}catch(reason){setError(reason instanceof Error?reason.message:"Unable to complete booking")}finally{setSaving(false)}}});
      checkout.on("payment.failed",(response:Row)=>{setError(response.error?.description||"Payment failed. No appointment was booked.");setSaving(false)});checkout.open();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to register patient");
    } finally { setSaving(false); }
  }
  if (registered) return <main className="self-reg-shell"><section className="self-reg-success"><CheckCircle2 /><h1>{registered.registration_type==="OPD"?"OPD appointment confirmed":"Registration completed"}</h1><p>Your patient number is</p><strong>{registered.medical_record_number}</strong>{registered.appointment?<div className="self-reg-confirmation"><p><b>Doctor:</b> {registered.appointment.doctor_name}</p><p><b>Date:</b> {new Date(registered.appointment.appointment_date).toLocaleDateString()}</p><p><b>Time:</b> {String(registered.appointment.appointment_time).slice(0,5)}</p><p><b>Amount paid:</b> ₹{Number(registered.appointment.paid_amount||0).toFixed(2)}</p><span>Token Number</span><strong>{registered.appointment.token_number}</strong><em>Please take a screenshot of this confirmation and show it at reception.</em></div>:<small>Your UHID has been generated. Please contact the receptionist to complete IPD admission.</small>}<button onClick={()=>window.print()}>Print / Save Confirmation</button></section></main>;
  return <main className="self-reg-shell"><section className="self-reg-card">
    <header>{hospital?.logo_url ? <img src={hospital.logo_url} alt="" /> : <UserRoundPlus />}<div><small>{hospital?.branch_name || "Patient Self Registration"}</small><h1>{hospital?.hospital_name || "Register Patient"}</h1><p>Enter your details to create your hospital patient record.</p></div></header>
    {error && <div className="self-reg-error">{error}</div>}
    {hospital ? <form onSubmit={submit}>
      <h2>Registration Type</h2><div className="self-reg-type"><button type="button" className={registrationType==="OPD"?"active":""} onClick={()=>setRegistrationType("OPD")}>OPD Appointment</button><button type="button" className={registrationType==="IPD"?"active":""} onClick={()=>setRegistrationType("IPD")}>IPD Registration</button></div>
      <h2>Personal Details</h2><div className="self-reg-grid">
        <label><span>First Name *</span><input name="first_name" required maxLength={80} pattern="[\p{L}][\p{L} '\-]*" title="Use letters, spaces, hyphens or apostrophes only" /></label>
        <label><span>Last Name *</span><input name="last_name" required maxLength={80} pattern="[\p{L}][\p{L} '\-]*" title="Use letters, spaces, hyphens or apostrophes only" /></label>
        <label><span>Age (years) *</span><input name="age_years" type="number" min="0" max="150" step="1" required /></label><label><span>Age (months)</span><input name="age_months" type="number" min="0" max="11" defaultValue="0" /></label><label><span>Age (days)</span><input name="age_days" type="number" min="0" max="30" defaultValue="0" /></label>
        <label><span>Gender</span><select name="sex" defaultValue="unknown"><option value="unknown">Prefer not to say</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>
        <label><span>Blood Group</span><select name="blood_group" defaultValue=""><option value="">Select blood group</option>{["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(x=><option key={x}>{x}</option>)}</select></label>
        <label><span>Mobile Number *</span><input name="phone" type="tel" inputMode="numeric" required minLength={10} maxLength={10} pattern="[0-9]{10}" title="Enter exactly 10 digits" /></label>
        <label><span>Email</span><input name="email" type="email" maxLength={254} /></label>
      </div>
      <h2>Address</h2><div className="self-reg-grid">
        <label className="wide"><span>Address</span><input name="address" /></label>
        <label><span>State</span><select name="state" value={stateName} onChange={event=>{setStateName(event.target.value);setCityName("")}}><option value="">Select state</option>{stateOptions.map(state=><option key={state} value={state}>{state}</option>)}</select></label><label><span>City</span><select name="city" value={cityName} onChange={event=>setCityName(event.target.value)} disabled={!stateName}><option value="">{stateName?"Select city":"Select state first"}</option>{cityOptions.map(city=><option key={city} value={city}>{city}</option>)}</select></label><label><span>PIN</span><input name="pin" inputMode="numeric" minLength={6} maxLength={6} pattern="[0-9]{6}" title="Enter exactly 6 digits" /></label>
      </div>
      <h2>Emergency Contact</h2><div className="self-reg-grid">
        <label><span>Contact Name</span><input name="emergency_name" maxLength={80} pattern="[\p{L}][\p{L} '\-]*" /></label><label><span>Contact Number</span><input name="emergency_phone" type="tel" inputMode="numeric" minLength={10} maxLength={10} pattern="[0-9]{10}" title="Enter exactly 10 digits" /></label><label><span>Relationship</span><select name="emergency_relationship" defaultValue=""><option value="">Select relationship</option>{["Parent","Spouse","Child","Sibling","Guardian","Friend","Other"].map(value=><option key={value}>{value}</option>)}</select></label>
      </div>
      <h2>Medical Information</h2><div className="self-reg-grid">
        <label><span>Allergies</span><textarea name="allergies" /></label><label><span>Existing Conditions</span><textarea name="existing_conditions" /></label><label><span>Current Medication</span><textarea name="current_medication" /></label>
      </div>
      {registrationType==="OPD"&&<><h2>OPD Appointment</h2><div className="self-reg-grid">
        <label><span>Department *</span><select required value={departmentId} onChange={event=>{setDepartmentId(event.target.value);setDoctorId("");setSlots([])}}><option value="">Select department</option>{(lookups.departments||[]).map((item:Row)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Doctor *</span><select required value={doctorId} onChange={event=>{setDoctorId(event.target.value);setSlots([])}}><option value="">Select doctor</option>{doctors.map((item:Row)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Consultation Fee</span><input readOnly value={`₹${fee.toFixed(2)}`} /></label>
        <label><span>Appointment Date *</span><input required type="date" min={new Date().toISOString().slice(0,10)} value={appointmentDate} onChange={event=>setAppointmentDate(event.target.value)} /></label>
        <label><span>Available Slot *</span><select name="appointment_time" required><option value="">Select time</option>{slots.map(item=><option key={item.time} value={item.time}>{item.time}</option>)}</select></label>
        <label className="wide"><span>Reason for Visit</span><input name="reason" /></label>
      </div><div className="self-reg-payment-note">{fee>0?<>₹{fee.toFixed(2)} will be collected securely through Razorpay before your token is generated.</>:<>No consultation fee is configured. Your appointment will be booked without payment.</>}</div></>}
      <button className="self-reg-submit" disabled={saving}>{saving ? <><LoaderCircle className="spin" /> Registering…</> : "Complete Registration"}</button>
    </form> : !error && <div className="self-reg-loading"><LoaderCircle className="spin" /> Opening secure registration…</div>}
  </section></main>;
}
