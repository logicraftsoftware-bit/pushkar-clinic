import { Router } from "express";
import jwt from "jsonwebtoken";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { patientAgeFields, ageAddress } from "./patient-age.js";
import { configuredPrefix, settingSection } from "./settings-runtime.js";

type RegistrationToken = {
  purpose: string;
  tenantId: string;
  branchId: string;
};
const router = Router();
const validPhone = z.string().trim().regex(/^\d{10}$/, "Mobile number must contain exactly 10 digits");
const optionalPhone = z.string().trim().refine((value) => !value || /^\d{10}$/.test(value), "Mobile number must contain exactly 10 digits");
const validName = z.string().trim().min(1).max(80).regex(/^[\p{L}][\p{L} '\-]*$/u, "Use letters, spaces, hyphens or apostrophes only");
const bodySchema = z.object({
  first_name: validName,
  last_name: validName,
  date_of_birth: z.string().nullable().optional().refine((value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).getTime() <= Date.now()), "Date of birth cannot be in the future"),
  sex: z.enum(["male", "female", "other", "unknown"]).prefault("unknown"),
  blood_group: z.string().trim().max(20).optional().prefault(""),
  phone: validPhone,
  email: z.string().trim().email().or(z.literal("")).optional().prefault(""),
  address: z.object({
    ...patientAgeFields,
    line: z.string().trim().max(300).optional().prefault(""),
    city: z.string().trim().max(100).optional().prefault(""),
    state: z.string().trim().max(100).optional().prefault(""),
    pin: z.string().trim().refine((value) => !value || /^\d{6}$/.test(value), "PIN code must contain exactly 6 digits").optional().prefault(""),
  }),
  emergency_contact: z.object({
    name: z.union([validName, z.literal("")]).optional().prefault(""),
    phone: optionalPhone.optional().prefault(""),
    relationship: z.enum(["Parent","Spouse","Child","Sibling","Guardian","Friend","Other",""]).optional().prefault(""),
  }),
  allergies: z.string().trim().max(1000).optional().prefault(""),
  existing_conditions: z.string().trim().max(1000).optional().prefault(""),
  current_medication: z.string().trim().max(1000).optional().prefault(""),
  registration_type: z.enum(["OPD", "IPD"]),
  department_id: z.string().uuid().optional(),
  doctor_id: z.string().uuid().optional(),
  appointment_date: z.string().optional(),
  appointment_time: z.string().optional(),
  reason: z.string().trim().max(1000).optional().prefault(""),
  razorpay_order_id: z.string().optional(),
  razorpay_payment_id: z.string().optional(),
  razorpay_signature: z.string().optional(),
});

function registrationScope(value: string) {
  const payload = jwt.verify(value, config.JWT_SECRET, {
    issuer: "careframe-api",
    audience: "patient-self-registration",
  }) as RegistrationToken;
  if (payload.purpose !== "patient-self-registration") throw new Error("Invalid registration link");
  return payload;
}

router.get("/:token", async (req, res) => {
  try {
    const scope = registrationScope(req.params.token);
    const result = await pool.query(
      `SELECT h.name hospital_name,h.logo_url,b.name branch_name FROM hospitals h JOIN branches b ON b.tenant_id=h.id WHERE h.id=$1 AND b.id=$2 AND b.is_active=true AND h.deleted_at IS NULL AND h.status IN('active','trial')`,
      [scope.tenantId, scope.branchId],
    );
    if (!result.rows[0]) return void res.status(404).json({ error: "This registration link is no longer available." });
    res.set("Cache-Control", "no-store");
    res.json(result.rows[0]);
  } catch {
    res.status(401).json({ error: "This self-registration QR code is invalid or expired." });
  }
});

router.get("/:token/lookups", async (req, res) => {
  try {
    const scope = registrationScope(req.params.token);
    const [departments, doctors] = await Promise.all([
      pool.query(`SELECT id,name FROM departments WHERE tenant_id=$1 AND branch_id=$2 AND is_active=true ORDER BY name`,[scope.tenantId,scope.branchId]),
      pool.query(`SELECT u.id,concat(s.first_name,' ',s.last_name) name,coalesce(s.department_id,u.department_id) department_id,coalesce(nullif(trim(s.professional->>'consultation_fee'),'')::numeric,0) consultation_fee FROM users u JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id AND s.staff_type='Doctor' AND s.status='Active' LEFT JOIN user_branch_access uba ON uba.user_id=u.id AND uba.tenant_id=u.tenant_id WHERE u.tenant_id=$1 AND coalesce(uba.branch_id,u.branch_id)=$2 AND u.role='doctor' AND u.is_active=true ORDER BY s.first_name`,[scope.tenantId,scope.branchId]),
    ]);
    res.json({ departments: departments.rows, doctors: doctors.rows });
  } catch { res.status(401).json({ error: "This self-registration QR code is invalid or expired." }); }
});

router.get("/:token/slots", async (req, res) => {
  try {
    const scope=registrationScope(req.params.token),doctorId=z.string().uuid().parse(req.query.doctor_id),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);
    const doctor=await pool.query(`SELECT coalesce(s.professional->'appointment_schedule','[]'::jsonb) schedule,coalesce(nullif(trim(s.professional->>'slot_duration'),'')::int,20) duration,coalesce(nullif(trim(s.professional->>'maximum_appointments'),'')::int,0) maximum FROM users u JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id LEFT JOIN user_branch_access uba ON uba.user_id=u.id AND uba.tenant_id=u.tenant_id WHERE u.id=$1 AND u.tenant_id=$2 AND coalesce(uba.branch_id,u.branch_id)=$3 AND u.role='doctor' AND u.is_active=true`,[doctorId,scope.tenantId,scope.branchId]);
    if(!doctor.rows[0])return void res.status(404).json({error:"Doctor not available"});
    const normalize=(value:unknown)=>{const raw=String(value??"");if(/^\d{2}-\d{2}-\d{4}$/.test(raw))return raw.split("-").reverse().join("-");return raw.slice(0,10)};
    const day=(doctor.rows[0].schedule??[]).find((item:any)=>normalize(item.appointment_date)===date);
    if(!day)return void res.json([]);
    const booked=await pool.query(`SELECT appointment_time FROM clinical_appointments WHERE tenant_id=$1 AND doctor_id=$2 AND appointment_date=$3 AND lower(status) NOT IN('cancelled','no show')`,[scope.tenantId,doctorId,date]);
    const used=new Set(booked.rows.map(x=>String(x.appointment_time).slice(0,5))),duration=Math.max(1,Number(doctor.rows[0].duration||20)),limit=Math.max(1,Number(day.max_slots||doctor.rows[0].maximum||0)||9999),slots=[] as {time:string;serial:number}[];
    let cursor=new Date(`1970-01-01T${day.from_time}:00`),end=new Date(`1970-01-01T${day.to_time}:00`),serial=0;
    while(cursor<end&&serial<limit){const time=cursor.toTimeString().slice(0,5);serial++;if(!used.has(time))slots.push({time,serial});cursor=new Date(cursor.getTime()+duration*60000)}
    res.json(slots);
  } catch { res.status(400).json({error:"Unable to load appointment slots"}); }
});

async function razorpayConfiguration(tenantId:string){
  const payment=await settingSection(tenantId,"PaymentMethods"),selected=String(payment.selected_gateway??"None"),current=payment.gateways?.[selected]??{};
  if(selected!=="Razorpay"||!current.api_key||!current.password)throw new Error("Online payment is not configured. Please contact reception.");
  return {key:String(current.api_key),secret:String(current.password)};
}
async function doctorFee(scope:RegistrationToken,doctorId:string){
  const result=await pool.query(`SELECT coalesce(nullif(trim(s.professional->>'consultation_fee'),'')::numeric,0) fee FROM users u JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id LEFT JOIN user_branch_access uba ON uba.user_id=u.id AND uba.tenant_id=u.tenant_id WHERE u.id=$1 AND u.tenant_id=$2 AND coalesce(uba.branch_id,u.branch_id)=$3 AND u.role='doctor' AND u.is_active=true`,[doctorId,scope.tenantId,scope.branchId]);
  if(!result.rows[0])throw new Error("Selected doctor is not available");return Number(result.rows[0].fee||0);
}
router.post("/:token/payment-order",async(req,res)=>{
  try{
    const scope=registrationScope(req.params.token),body=z.object({doctor_id:z.string().uuid()}).parse(req.body),fee=await doctorFee(scope,body.doctor_id);
    if(fee<=0)return void res.json({free:true,amount:0});
    const gateway=await razorpayConfiguration(scope.tenantId),response=await fetch("https://api.razorpay.com/v1/orders",{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`${gateway.key}:${gateway.secret}`).toString("base64")}`,"Content-Type":"application/json"},body:JSON.stringify({amount:Math.round(fee*100),currency:"INR",receipt:`SELF-${Date.now()}`}),signal:AbortSignal.timeout(20000)}),payload=await response.json() as Record<string,any>;
    if(!response.ok)throw new Error(payload.error?.description||"Unable to start online payment");
    res.json({free:false,key:gateway.key,order_id:payload.id,amount:payload.amount,currency:payload.currency,fee});
  }catch(error){res.status(400).json({error:error instanceof Error?error.message:"Unable to start online payment"})}
});

router.post("/:token", async (req, res) => {
  let scope: RegistrationToken;
  try { scope = registrationScope(req.params.token); }
  catch { return void res.status(401).json({ error: "This self-registration QR code is invalid or expired." }); }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success)
    return void res.status(400).json({ error: parsed.error.issues[0]?.message || "Please check the registration details." });
  const body = parsed.data;
  if(body.registration_type==="OPD"&&(!body.department_id||!body.doctor_id||!body.appointment_date||!body.appointment_time))return void res.status(400).json({error:"Select department, doctor, date and appointment slot."});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`patient-uhid:${scope.tenantId}`]);
    const valid = await client.query(`SELECT 1 FROM branches b JOIN hospitals h ON h.id=b.tenant_id WHERE b.id=$1 AND b.tenant_id=$2 AND b.is_active=true AND h.deleted_at IS NULL AND h.status IN('active','trial')`,[scope.branchId,scope.tenantId]);
    if (!valid.rowCount) { await client.query("ROLLBACK"); return void res.status(404).json({ error: "This registration link is no longer available." }); }
    const count = await client.query(`SELECT count(*)::int+1 n FROM patients WHERE tenant_id=$1`, [scope.tenantId]);
    const prefix = await configuredPrefix(scope.tenantId, "uhid_prefix", "UHID");
    const uhid = `${prefix}-${String(count.rows[0].n).padStart(6, "0")}`;
    let fee=0,paymentId="";
    if(body.registration_type==="OPD"){
      fee=await doctorFee(scope,body.doctor_id!);
      if(fee>0){
        if(!body.razorpay_order_id||!body.razorpay_payment_id||!body.razorpay_signature){await client.query("ROLLBACK");return void res.status(402).json({error:"Complete online payment before booking the OPD appointment."})}
        const gateway=await razorpayConfiguration(scope.tenantId),expected=createHmac("sha256",gateway.secret).update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`).digest("hex");
        if(expected!==body.razorpay_signature){await client.query("ROLLBACK");return void res.status(400).json({error:"Payment verification failed."})}
        const orderResponse=await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(body.razorpay_order_id)}`,{headers:{Authorization:`Basic ${Buffer.from(`${gateway.key}:${gateway.secret}`).toString("base64")}`},signal:AbortSignal.timeout(20000)}),order=await orderResponse.json() as Record<string,any>;
        if(!orderResponse.ok||order.status!=="paid"||Number(order.amount_paid)!==Math.round(fee*100)){await client.query("ROLLBACK");return void res.status(400).json({error:"Payment has not been confirmed."})}
        paymentId=body.razorpay_payment_id;
      }
      const slotTaken=await client.query(`SELECT 1 FROM clinical_appointments WHERE tenant_id=$1 AND doctor_id=$2 AND appointment_date=$3 AND appointment_time=$4 AND lower(status) NOT IN('cancelled','no show') FOR UPDATE`,[scope.tenantId,body.doctor_id,body.appointment_date,body.appointment_time]);
      if(slotTaken.rowCount){await client.query("ROLLBACK");return void res.status(409).json({error:"This slot was just booked. Please select another slot."})}
    }
    const result = await client.query(
      `INSERT INTO patients(tenant_id,branch_id,medical_record_number,first_name,last_name,date_of_birth,sex,blood_group,phone,email,address,emergency_contact,allergies,existing_conditions,current_medication,status,registration_payment_status,total_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Active','Unpaid',0) RETURNING id,medical_record_number,first_name,last_name`,
      [scope.tenantId,scope.branchId,uhid,body.first_name,body.last_name,body.date_of_birth||null,body.sex,body.blood_group||null,body.phone,body.email||null,ageAddress(body.address),body.emergency_contact,body.allergies,body.existing_conditions,body.current_medication],
    );
    let appointment=null;
    if(body.registration_type==="OPD"){
      const appointmentCount=await client.query(`SELECT count(*)::int+1 n FROM clinical_appointments WHERE tenant_id=$1`,[scope.tenantId]),appointmentPrefix=await configuredPrefix(scope.tenantId,"appointment_prefix","APT"),appointmentNumber=`${appointmentPrefix}-${String(appointmentCount.rows[0].n).padStart(6,"0")}`;
      const info=await client.query(`SELECT concat(u.first_name,' ',u.last_name) doctor_name,d.name department_name,coalesce(s.professional->'appointment_schedule','[]'::jsonb) schedule,coalesce(nullif(trim(s.professional->>'slot_duration'),'')::int,20) duration FROM users u JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id LEFT JOIN departments d ON d.id=$2 WHERE u.id=$1 AND u.tenant_id=$3`,[body.doctor_id,body.department_id,scope.tenantId]);
      const initials=String(info.rows[0]?.doctor_name||"DR").split(/\s+/).filter(Boolean).map((x:string)=>x[0]).join("").toUpperCase()||"DR",department=String(info.rows[0]?.department_name||"GEN").replace(/[^a-z0-9]/gi,"").slice(0,5).toUpperCase()||"GEN",datePart=body.appointment_date!.split("-").reverse().join("");
      const normalize=(value:unknown)=>{const raw=String(value??"");return /^\d{2}-\d{2}-\d{4}$/.test(raw)?raw.split("-").reverse().join("-"):raw.slice(0,10)},day=(info.rows[0]?.schedule??[]).find((x:any)=>normalize(x.appointment_date)===body.appointment_date),minutes=(value:string)=>{const [h=0,m=0]=value.slice(0,5).split(":").map(Number);return h*60+m},serial=day?Math.floor((minutes(body.appointment_time!)-minutes(String(day.from_time)))/Math.max(1,Number(info.rows[0]?.duration||20)))+1:1,tokenNumber=`${datePart}/${initials}/${department}/${String(serial).padStart(3,"0")}`;
      const saved=await client.query(`INSERT INTO clinical_appointments(tenant_id,branch_id,department_id,patient_id,doctor_id,appointment_number,appointment_date,appointment_time,appointment_type,visit_type,reason,consultation_fee,payment_status,source,token_number,status,payment_mode,paid_amount,slot_serial,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'OPD','New',$9,$10,$11,'Self Registration',$12,'Booked',$13,$14,$15,$16) RETURNING *`,[scope.tenantId,scope.branchId,body.department_id,result.rows[0].id,body.doctor_id,appointmentNumber,body.appointment_date,body.appointment_time,body.reason,fee,fee>0?"Paid":"Paid",tokenNumber,fee>0?"Razorpay":"No Charge",fee,serial,paymentId?`Razorpay payment: ${paymentId}`:""]);
      appointment={...saved.rows[0],doctor_name:info.rows[0]?.doctor_name,department_name:info.rows[0]?.department_name};
    }
    await client.query("COMMIT");
    res.status(201).json({...result.rows[0],registration_type:body.registration_type,appointment});
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
});

export default router;
