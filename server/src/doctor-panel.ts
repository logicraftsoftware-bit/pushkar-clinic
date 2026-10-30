import {withPrintDoctorDetails} from './doctor-print-profile.js';
import {combinedDiagnosticTests,comparableDiagnosticTests} from "./diagnostic-workflow.js";
import {laboratoryPrice,laboratoryTestAvailable} from './lab-branch-pricing.js';
import {diagnosticClinicalDomain} from "./diagnostic-master-unification.js";
import {consultationData,allergyConflicts,canonicalClinical} from './consultation-validation.js';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";

type Auth = { sub: string; tenantId: string; branchId: string; role: string };
type AuthedRequest = Request & { portalUser?: Auth };
const router = Router();
let ready: Promise<unknown> | null = null;

async function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    req.portalUser = jwt.verify(
      req.header("authorization")?.replace(/^Bearer /i, "") ?? "",
      config.JWT_SECRET,
      { issuer: "careframe-api", audience: "careframe-portal" },
    ) as Auth;
    if (!["doctor", "hospital_admin"].includes(req.portalUser.role)) {
      res.status(403).json({ error: "Doctor workspace access required" });
      return;
    }
    const active = await pool.query(
      `SELECT 1 FROM users u LEFT JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id
       WHERE u.id=$1 AND u.tenant_id=$2 AND u.is_active=true
         AND ($3='hospital_admin' OR (u.role='doctor' AND coalesce(s.status,'Active')='Active'))`,
      [req.portalUser.sub, req.portalUser.tenantId, req.portalUser.role],
    );
    if (!active.rowCount) {
      res.status(403).json({ error: "This staff account is inactive. Contact an administrator." });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Session expired or invalid" });
  }
}

router.use(auth);
router.use(async (_req, _res, next) => {
  try {
    ready ??= pool.query(`CREATE TABLE IF NOT EXISTS doctor_clinical_records(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      doctor_id uuid NOT NULL REFERENCES users(id),patient_id uuid NOT NULL REFERENCES patients(id),
      appointment_id uuid REFERENCES clinical_appointments(id) ON DELETE SET NULL,record_type text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE doctor_clinical_records ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES ipd_admissions(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_doctor_clinical_records_admission ON doctor_clinical_records(tenant_id,admission_id,created_at) WHERE admission_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS role_work_items(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      branch_id uuid REFERENCES branches(id),patient_id uuid REFERENCES patients(id),assigned_user_id uuid REFERENCES users(id),
      created_by uuid REFERENCES users(id),workspace text NOT NULL,kind text NOT NULL,title text NOT NULL,
      status text NOT NULL DEFAULT 'Pending',priority text NOT NULL DEFAULT 'Normal',data jsonb NOT NULL DEFAULT '{}',
      occurred_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());`);
    await ready;
    next();
  } catch (error) {
    ready = null;
    next(error);
  }
});

router.get("/overview", async (req: AuthedRequest, res) => {
  const a = req.portalUser!;
  const admin = a.role === "hospital_admin";
  const [appointments, schedule, metricRows, ipdAdmissions] = await Promise.all([pool.query(
    `SELECT x.*,concat(p.first_name,' ',p.last_name) patient_name,p.medical_record_number,p.phone,
      p.sex,p.date_of_birth,d.name department_name
     FROM clinical_appointments x JOIN patients p ON p.id=x.patient_id LEFT JOIN departments d ON d.id=x.department_id
     WHERE x.tenant_id=$1 AND ($3::boolean OR x.doctor_id=$2) AND lower(x.status) NOT IN('completed','cancelled','no show','no_show','done')
     ORDER BY x.appointment_date,x.appointment_time LIMIT 200`,
    [a.tenantId, a.sub, admin],
  ), pool.query(
    `SELECT coalesce(s.professional->'appointment_schedule','[]'::jsonb) slots
     FROM users u LEFT JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id
     WHERE u.id=$1 AND u.tenant_id=$2 AND u.role='doctor'`,
    [a.sub, a.tenantId],
  ), pool.query(
    `SELECT count(*) FILTER(WHERE appointment_date=current_date)::int today,
      count(*) FILTER(WHERE appointment_date=current_date AND lower(status) IN('waiting','booked','checked in','checked_in','present'))::int waiting,
      count(*) FILTER(WHERE appointment_date=current_date AND lower(status) IN('completed','done'))::int completed,
      count(DISTINCT patient_id)::int patients FROM clinical_appointments WHERE tenant_id=$1 AND ($3::boolean OR doctor_id=$2)`,
    [a.tenantId,a.sub,admin],
  ), pool.query(
    `SELECT x.*,concat(p.first_name,' ',p.last_name) patient_name,p.medical_record_number,p.phone,p.sex,p.date_of_birth,
      d.name department_name,b.name branch_name,w.name ward_name,r.room_number,bed.bed_number,bt.name bed_type
     FROM ipd_admissions x JOIN patients p ON p.id=x.patient_id JOIN branches b ON b.id=x.branch_id
     LEFT JOIN departments d ON d.id=x.department_id LEFT JOIN wards w ON w.id=x.ward_id
     LEFT JOIN rooms r ON r.id=x.room_id LEFT JOIN beds bed ON bed.id=x.bed_id LEFT JOIN bed_masters bt ON bt.id=bed.bed_type_id
     WHERE x.tenant_id=$1 AND ($3::boolean OR x.consultant_doctor_id=$2) AND lower(trim(x.status)) NOT IN ('discharged','cancelled')
     ORDER BY coalesce(w.name,'Unallocated'),r.room_number,bed.bed_number,x.admitted_at`,
    [a.tenantId,a.sub,admin],
  )]);
  const completed=await pool.query(`SELECT x.*,concat_ws(' ',p.first_name,p.last_name) patient_name,p.medical_record_number FROM clinical_appointments x JOIN patients p ON p.id=x.patient_id WHERE x.tenant_id=$1 AND ($3::boolean OR x.doctor_id=$2) AND lower(x.status)='completed' ORDER BY x.appointment_date DESC LIMIT 200`,[a.tenantId,a.sub,admin]);
  res.json({
    completedAppointments:await withPrintDoctorDetails(completed.rows,a.tenantId),
    appointments: await withPrintDoctorDetails(appointments.rows,a.tenantId),
    slots: schedule.rows[0]?.slots ?? [],
    metrics: metricRows.rows[0],
    ipdAdmissions: await withPrintDoctorDetails(ipdAdmissions.rows,a.tenantId),
  });
});

router.get("/patients/:id", async (req: AuthedRequest, res) => {
  const a = req.portalUser!;
  const [patient, appointments, records] = await Promise.all([
    pool.query(
      `SELECT * FROM patients p WHERE p.id=$1 AND p.tenant_id=$2 AND p.deleted_at IS NULL AND ($3='hospital_admin' OR
       EXISTS(SELECT 1 FROM clinical_appointments ca WHERE ca.patient_id=p.id AND ca.tenant_id=p.tenant_id AND ca.doctor_id=$4) OR
       EXISTS(SELECT 1 FROM ipd_admissions ia WHERE ia.patient_id=p.id AND ia.tenant_id=p.tenant_id AND ia.consultant_doctor_id=$4 AND lower(trim(ia.status)) NOT IN ('discharged','cancelled')))`,
      [req.params.id, a.tenantId,a.role,a.sub],
    ),
    pool.query(
      `SELECT * FROM clinical_appointments WHERE patient_id=$1 AND tenant_id=$2 ORDER BY appointment_date DESC`,
      [req.params.id, a.tenantId],
    ),
    pool.query(
      `SELECT * FROM doctor_clinical_records WHERE patient_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`,
      [req.params.id, a.tenantId],
    ),
  ]);
  if (!patient.rows[0]) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  res.json({
    patient: patient.rows[0],
    appointments: appointments.rows,
    records: records.rows,
  });
});

router.get("/print-template/opd-prescription", async (req: AuthedRequest, res) => {
  const result=await pool.query(`SELECT header_image,footer_content FROM hospital_print_templates WHERE tenant_id=$1 AND document_type='opd-prescription'`,[req.portalUser!.tenantId]);
  res.json(result.rows[0]??{header_image:"",footer_content:""});
});

router.get("/prescription-masters", async (req: AuthedRequest, res) => {
  const [result,tests]=await Promise.all([pool.query(`SELECT id,kind,name,data FROM hospital_pharmacy_masters
    WHERE tenant_id=$1 AND kind=ANY($2::text[]) ORDER BY kind,name`,[req.portalUser!.tenantId,["medicine","category","dosage","interval","duration"]]),pool.query(`SELECT id,domain,name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain=ANY($2::text[]) AND kind='test' ORDER BY domain,name`,[req.portalUser!.tenantId,["pathology"]])]);
  const available=tests.rows.filter(test=>laboratoryTestAvailable(test.data,req.portalUser!.branchId)).map(test=>({...test,data:{...test.data,amount:laboratoryPrice(test.data,req.portalUser!.branchId)}}));
  const grouped:Record<string,unknown[]>={medicine:[],category:[],dosage:[],interval:[],duration:[],pathology_test:available.filter(x=>diagnosticClinicalDomain(x)==='pathology'),radiology_test:available.filter(x=>diagnosticClinicalDomain(x)==='radiology')};
  for(const row of result.rows)grouped[row.kind]?.push(row);
  res.json(grouped);
});

const soapSchema = z.object({
  appointment_id: z.string().uuid().optional(),
  admission_id: z.string().uuid().optional(),
  transcript: z.string().trim().min(10).max(30_000),
}).refine(body=>Boolean(body.appointment_id)!==Boolean(body.admission_id),"Select one clinical encounter");

router.post("/soap", async (req: AuthedRequest, res) => {
  if (!config.GROQ_API_KEY) return void res.status(503).json({ error: "SOAP AI is not configured on the server." });
  const body = soapSchema.parse(req.body), a = req.portalUser!;
  const appointment = body.appointment_id?await pool.query(
    `SELECT x.id,x.reason,p.sex,p.date_of_birth,p.allergies,p.existing_conditions,p.current_medication FROM clinical_appointments x JOIN patients p ON p.id=x.patient_id WHERE x.id=$1 AND x.tenant_id=$2 AND ($4='hospital_admin' OR x.doctor_id=$3)`,
    [body.appointment_id,a.tenantId,a.sub,a.role],
  ):await pool.query(
    `SELECT x.id,x.reason_diagnosis reason,p.sex,p.date_of_birth,p.allergies,p.existing_conditions,p.current_medication FROM ipd_admissions x JOIN patients p ON p.id=x.patient_id WHERE x.id=$1 AND x.tenant_id=$2 AND ($4='hospital_admin' OR x.consultant_doctor_id=$3) AND lower(trim(x.status)) NOT IN ('discharged','cancelled')`,
    [body.admission_id,a.tenantId,a.sub,a.role],
  );
  if (!appointment.rows[0]) return void res.status(404).json({ error: "Appointment not found in your workspace." });
  const shape = { symptoms:"", history:"", vitals:{temperature:"",pulse:"",blood_pressure:"",spo2:"",weight:""}, investigation:"", diagnosis:"", advice:"", follow_up:"", comment:"", medicines:[], lab_tests:[] };
  const system = `You are a multilingual clinical documentation assistant. The supplied doctor-patient conversation may be in any language, may switch languages, and may contain English medical terms. Understand it in its original language, then translate and normalize every output field into clear clinical English. Do not transliterate non-English speech; translate its meaning. Convert the conversation into structured SOAP documentation. Extract only facts explicitly present; never invent diagnoses, medicines, dosages, vitals, tests, or plans. Preserve clinically meaningful negations and do not change drug or test names. Put subjective complaints in symptoms/history, objective measurements in vitals, assessment in diagnosis, and plan in advice/follow_up/medicines/lab_tests/investigation. Medicines must use {type,name,dose,time,when,frequency,duration,quantity,instruction}. Lab tests must use {name,priority,instruction}, with priority Routine unless explicitly urgent or STAT. Return ONLY valid English JSON matching this shape: ${JSON.stringify(shape)}. Existing patient context is reference-only and must not be copied unless discussed: ${JSON.stringify(appointment.rows[0])}`;
  const ai = await fetch("https://api.groq.com/openai/v1/chat/completions", { method:"POST", headers:{ Authorization:`Bearer ${config.GROQ_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify({ model:config.GROQ_MODEL, temperature:0, max_completion_tokens:1800, response_format:{type:"json_object"}, messages:[{role:"system",content:system},{role:"user",content:body.transcript}] }), signal:AbortSignal.timeout(30_000) });
  const payload = await ai.json() as { choices?:Array<{message?:{content?:string}}> };
  if (!ai.ok) return void res.status(502).json({ error: "SOAP AI could not process this conversation. Please try again." });
  try {
    const result = JSON.parse(payload.choices?.[0]?.message?.content?.trim() || "");
    res.set("Cache-Control", "no-store");
    res.json({ soap: result });
  } catch { res.status(502).json({ error: "SOAP AI returned an invalid clinical draft. Please try again." }); }
});

router.post("/handwriting", async (req: AuthedRequest, res) => {
  if (!config.GROQ_API_KEY)
    return void res.status(503).json({ error: "Handwriting recognition is not configured on the server." });
  const body = z.object({
    image: z.string().startsWith("data:image/png;base64,").max(7_500_000),
    section: z.string().trim().min(1).max(100),
  }).parse(req.body);
  const ai = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.GROQ_VISION_MODEL,
      temperature: 0.7,
      top_p: 0.8,
      reasoning_effort: "none",
      reasoning_format: "hidden",
      max_completion_tokens: 500,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Transcribe only the handwritten clinical text in this ${body.section} note. Preserve medical terms, abbreviations, numbers, units, punctuation, and line breaks exactly where readable. Never add diagnoses or words that are not visible. Mark an unreadable word as [?]. Return only the transcription without commentary or markdown.`,
          },
          { type: "image_url", image_url: { url: body.image } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await ai.json() as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!ai.ok)
    return void res.status(502).json({ error: payload.error?.message || "Unable to read this handwriting." });
  const raw = payload.choices?.[0]?.message?.content?.trim() || "";
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^(?:transcription|handwriting|text)\s*:\s*/i, "")
    .trim();
  if (!text) return void res.status(422).json({ error: "No readable handwriting was found." });
  res.json({ text });
});

router.patch("/appointments/:id/status", async (req: AuthedRequest, res) => {
  const body=z.object({status:z.enum(["Present","Absent","Waiting"])}).parse(req.body),a=req.portalUser!;
  const result=await pool.query(`UPDATE clinical_appointments SET status=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND ($5='hospital_admin' OR doctor_id=$4) AND lower(status) NOT IN('completed','cancelled') RETURNING *`,[body.status,req.params.id,a.tenantId,a.sub,a.role]);
  if(!result.rows[0])return void res.status(404).json({error:"Appointment not found in your queue."});
  res.json(result.rows[0]);
});

router.post("/appointments/:id/notify", async (req: AuthedRequest, res) => {
  const body=z.object({target:z.enum(["reception","patient"])}).parse(req.body),a=req.portalUser!;
  const appointment=await pool.query(`SELECT x.*,concat(p.first_name,' ',p.last_name) patient_name FROM clinical_appointments x JOIN patients p ON p.id=x.patient_id WHERE x.id=$1 AND x.tenant_id=$2 AND ($4='hospital_admin' OR x.doctor_id=$3)`,[req.params.id,a.tenantId,a.sub,a.role]);
  const row=appointment.rows[0];if(!row)return void res.status(404).json({error:"Appointment not found in your queue."});
  const title=body.target==="patient"?`Doctor is calling token ${row.token_number||row.appointment_number}`:`Doctor called ${row.patient_name} (Token ${row.token_number||row.appointment_number})`;
  const result=await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,created_by,workspace,kind,title,priority,data) VALUES($1,$2,$3,$4,$5,'notification',$6,'High',$7) RETURNING *`,[a.tenantId,row.branch_id,row.patient_id,a.sub,body.target,title,{appointment_id:row.id,token_number:row.token_number,appointment_time:row.appointment_time}]);
  res.status(201).json(result.rows[0]);
});

router.post("/records", async (req: AuthedRequest, res) => {
  const body = z
    .object({
      patient_id: z.string().uuid(),
      appointment_id: z.string().uuid().nullable().optional(),
      admission_id: z.string().uuid().nullable().optional(),
      record_id: z.string().uuid().optional(),
      record_type: z.enum([
        "consultation",
        "discharge_summary",
        "diagnosis",
        "prescription",
        "order",
        "voice_documentation",
      ]),
      data: z.record(z.string(), z.unknown()),
    })
    .refine(body=>Boolean(body.appointment_id)!==Boolean(body.admission_id),"Select one clinical encounter").parse(req.body);
  const a = req.portalUser!;
  if(body.record_id&&(!body.admission_id||body.record_type!=='consultation'))return void res.status(400).json({error:'A saved visit can only be selected for an IPD consultation.'});
  const patient = await pool.query(
    `SELECT id,allergies,concat(first_name,' ',last_name) patient_name,medical_record_number FROM patients WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
    [body.patient_id, a.tenantId],
  );
  if (!patient.rowCount) {
    res.status(400).json({ error: "Invalid patient" });
    return;
  }
  const encounter=body.appointment_id?await pool.query(`SELECT id,branch_id,doctor_id FROM clinical_appointments WHERE id=$1 AND tenant_id=$2 AND ($5='hospital_admin' OR doctor_id=$3) AND patient_id=$4`,[body.appointment_id,a.tenantId,a.sub,body.patient_id,a.role]):await pool.query(`SELECT id,branch_id,consultant_doctor_id doctor_id FROM ipd_admissions WHERE id=$1 AND tenant_id=$2 AND ($5='hospital_admin' OR consultant_doctor_id=$3) AND patient_id=$4 AND lower(trim(status)) NOT IN ('discharged','cancelled')`,[body.admission_id,a.tenantId,a.sub,body.patient_id,a.role]);
  if(!encounter.rows[0])return void res.status(403).json({error:"This patient encounter is not assigned to you."});
  {
    const parsed=consultationData.safeParse(body.data);
    if(!parsed.success)return void res.status(400).json({error:parsed.error.issues[0]?.message,field:parsed.error.issues[0]?.path.join('.')});
    body.data=parsed.data;
  }
  const conflicts=allergyConflicts(patient.rows[0].allergies,Array.isArray(body.data.medicines)?body.data.medicines:[]);
  if(conflicts.length)return void res.status(422).json({code:'DRUG_ALLERGY_CONFLICT',error:conflicts.join(' ')});
  const contextData={appointment_id:body.appointment_id||undefined,admission_id:body.admission_id||undefined};
  const c=await pool.connect();
  try{await c.query("BEGIN");
    const isOpd=body.record_type==='consultation'&&!!body.appointment_id;
    let previous:any;
    if(body.admission_id){
      const locked=await c.query(`SELECT id FROM ipd_admissions WHERE id=$1 AND tenant_id=$2 AND patient_id=$3 AND ($5='hospital_admin' OR consultant_doctor_id=$4) AND lower(trim(status)) NOT IN ('discharged','cancelled') FOR UPDATE`,[body.admission_id,a.tenantId,body.patient_id,a.sub,a.role]);
      if(!locked.rows[0])throw Object.assign(Error('This admission is no longer available or assigned to you.'),{status:403});
      if(body.record_id){
        previous=(await c.query(`SELECT * FROM doctor_clinical_records WHERE id=$1 AND tenant_id=$2 AND patient_id=$3 AND admission_id=$4 AND record_type='consultation' FOR UPDATE`,[body.record_id,a.tenantId,body.patient_id,body.admission_id])).rows[0];
        if(!previous)throw Object.assign(Error('Saved IPD visit not found for this admission.'),{status:404});
        body.data={...previous.data,...body.data};
      }
    }
    if(isOpd){
      // Serialize all saves for this encounter, including requests from other API processes.
      const locked=await c.query(`SELECT id,status FROM clinical_appointments WHERE id=$1 AND tenant_id=$2 AND patient_id=$3 AND ($5='hospital_admin' OR doctor_id=$4) FOR UPDATE`,[body.appointment_id,a.tenantId,body.patient_id,a.sub,a.role]);
      if(!locked.rows[0])throw Object.assign(Error('This encounter is not assigned to you.'),{status:403});
      if(['cancelled','no show','no_show'].includes(String(locked.rows[0].status).toLowerCase()))throw Object.assign(Error('This encounter is cancelled or unavailable.'),{status:409});
      const existing=await c.query(`SELECT * FROM doctor_clinical_records WHERE tenant_id=$1 AND appointment_id=$2 AND record_type='consultation' ORDER BY updated_at DESC,created_at DESC LIMIT 1 FOR UPDATE`,[a.tenantId,body.appointment_id]);
      previous=existing.rows[0];
      if(String(locked.rows[0].status).toLowerCase()==='completed'||previous?.data?.encounter_status==='Completed'){
        if(previous&&canonicalClinical({...previous.data,completed_at:undefined,completed_by:undefined})===canonicalClinical({...previous.data,...body.data,completed_at:undefined,completed_by:undefined})){await c.query('COMMIT');return void res.json(previous);}
        throw Object.assign(Error('This consultation is completed and cannot be silently overwritten.'),{status:409});
      }
      body.data={...previous?.data,...body.data,encounter_status:body.data.encounter_status||'Draft',...(body.data.encounter_status==='Completed'?{completed_at:new Date().toISOString(),completed_by:a.sub}:{})};
    }
    const mergedValidation=consultationData.safeParse(body.data);
    if(!mergedValidation.success)throw Object.assign(Error(mergedValidation.error.issues[0]?.message||'Invalid consultation.'),{status:400});
    const mergedConflicts=allergyConflicts(patient.rows[0].allergies,Array.isArray(body.data.medicines)?body.data.medicines:[]);
    if(mergedConflicts.length)throw Object.assign(Error(mergedConflicts.join(' ')),{status:422});
    const result = previous ? await c.query(`UPDATE doctor_clinical_records SET data=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING *`,[body.data,previous.id,a.tenantId]) : await c.query(
      `INSERT INTO doctor_clinical_records(tenant_id,doctor_id,patient_id,appointment_id,admission_id,record_type,data)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [a.tenantId,encounter.rows[0].doctor_id||a.sub,body.patient_id,body.appointment_id||null,body.admission_id||null,body.record_type,body.data],
    );
    const syncOrder=async(workspace:string,kind:string,title:string,priority:string,data:Record<string,unknown>)=>{
      const existing=await c.query(`SELECT id,status,kind,data FROM role_work_items WHERE tenant_id=$1 AND workspace=$2 AND (data->>'consultation_record_id'=$3 OR data->>'visit_id'=$3) AND NOT (data ? 'merged_into_order_id') ORDER BY created_at,id FOR UPDATE`,[a.tenantId,workspace,result.rows[0].id]);
      const old=existing.rows[0];
      if(workspace==='laboratory'&&existing.rows.length>1){
        if(existing.rows.some(row=>!['Pending','Cancelled'].includes(row.status)||row.data?.bill_id||row.data?.collected_at)){
          const previousTests=existing.rows.flatMap(row=>row.data?.tests||[]);
          if(canonicalClinical(comparableDiagnosticTests(previousTests))!==canonicalClinical(comparableDiagnosticTests(data.tests as Record<string,any>[])))throw Object.assign(Error('Diagnostic orders are already being processed. Change them through Laboratory.'),{status:409});
          return;
        }
        for(const duplicate of existing.rows.slice(1))await c.query("UPDATE role_work_items SET status='Cancelled',data=data||jsonb_build_object('merged_into_order_id',$1::text),updated_at=now() WHERE id=$2 AND tenant_id=$3",[old.id,duplicate.id,a.tenantId]);
      }
      if(old){
        if(!['Pending','Cancelled'].includes(old.status)){
          const previousItems=old.data.tests??old.data.medicines,nextItems=data.tests??data.medicines;
          if(canonicalClinical(workspace==='laboratory'?comparableDiagnosticTests(previousItems||[]):previousItems)!==canonicalClinical(workspace==='laboratory'?comparableDiagnosticTests((nextItems||[]) as Record<string,any>[]):nextItems))throw Object.assign(Error('An order is already being processed. Change it through the receiving department.'),{status:409});
          return;
        }
        await c.query(`UPDATE role_work_items SET status=CASE WHEN status='Cancelled' THEN 'Pending' ELSE status END,data=data||$1::jsonb,priority=$2,updated_at=now() WHERE id=$3 AND tenant_id=$4`,[JSON.stringify(data),priority,old.id,a.tenantId]);
      }else await c.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,$5,$6,$7,'Pending',$8,$9)`,[a.tenantId,encounter.rows[0].branch_id||a.branchId||null,body.patient_id,a.sub,workspace,kind,title,priority,data]);
    };
    const medicines=Array.isArray(body.data.medicines)?body.data.medicines.filter((x:unknown)=>x&&typeof x==="object"&&String((x as Record<string,unknown>).name||"").trim()):[];
    const labTests=Array.isArray(body.data.lab_tests)?body.data.lab_tests.filter((x:unknown)=>x&&typeof x==="object"&&String((x as Record<string,unknown>).name||"").trim()):[];
    const radiologyTests=Array.isArray(body.data.radiology_tests)?body.data.radiology_tests.filter((x:unknown)=>x&&typeof x==="object"&&String((x as Record<string,unknown>).name||"").trim()):[];
    if(body.record_type==="consultation"&&medicines.length){
      const queueData={...contextData,consultation_record_id:result.rows[0].id,visit_id:result.rows[0].id,visit_at:result.rows[0].created_at,doctor_id:encounter.rows[0].doctor_id||a.sub,medical_record_number:patient.rows[0].medical_record_number,medicines,diagnosis:body.data.diagnosis||"",advice:body.data.advice||""};
      await syncOrder("pharmacy","prescription",`Prescription - ${patient.rows[0].patient_name}`,"Normal",queueData);
    }
    const diagnosticTests=combinedDiagnosticTests(labTests,radiologyTests);
    if(body.record_type==="consultation"&&diagnosticTests.length){
      const ids=diagnosticTests.map(test=>test.test_id).filter((id:unknown)=>z.string().uuid().safeParse(id).success);
      if(ids.length){
        const masters=await c.query("SELECT id,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='test' AND id=ANY($2::uuid[])",[a.tenantId,ids]);
        for(const master of masters.rows){
          if(!laboratoryTestAvailable(master.data,encounter.rows[0].branch_id||a.branchId))throw Object.assign(new Error('This test is not available at the selected branch'),{status:400});
        }
      }
      const priority=diagnosticTests.some((test:Record<string,unknown>)=>['urgent','stat'].includes(String(test.priority||'').toLowerCase()))?'High':'Normal';
      const orderData={...contextData,consultation_record_id:result.rows[0].id,visit_id:result.rows[0].id,visit_at:result.rows[0].created_at,doctor_id:encounter.rows[0].doctor_id||a.sub,medical_record_number:patient.rows[0].medical_record_number,tests:diagnosticTests,diagnosis:body.data.diagnosis||"",investigation:body.data.investigation||""};
      await syncOrder("laboratory","orders",`Lab Order - ${patient.rows[0].patient_name}`,priority,orderData);
    }
    if(body.record_type==='consultation'){
      // Removing an unsent order cancels it; a processed order cannot disappear silently.
      for(const [workspace,items] of [['pharmacy',medicines],['laboratory',diagnosticTests]] as const){
        if(items.length)continue;
        const removed=await c.query(`SELECT id,status FROM role_work_items WHERE tenant_id=$1 AND workspace=$2 AND (data->>'consultation_record_id'=$3 OR data->>'visit_id'=$3) FOR UPDATE`,[a.tenantId,workspace,result.rows[0].id]);
        if(removed.rows.some(row=>!['Pending','Cancelled'].includes(row.status)))throw Object.assign(Error('Cannot remove an order that is already being processed.'),{status:409});
        await c.query(`UPDATE role_work_items SET status='Cancelled',updated_at=now() WHERE tenant_id=$1 AND workspace=$2 AND (data->>'consultation_record_id'=$3 OR data->>'visit_id'=$3) AND status='Pending'`,[a.tenantId,workspace,result.rows[0].id]);
      }
      if(isOpd)await c.query(`UPDATE clinical_appointments SET status=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3`,[body.data.encounter_status==='Completed'?'Completed':'In Progress',body.appointment_id,a.tenantId]);
    }
    await c.query("COMMIT");res.status(201).json(result.rows[0]);
  }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
});

router.post("/ipd/:id/discharge-request", async (req: AuthedRequest, res) => {
  const data=z.record(z.string(),z.unknown()).parse(req.body),a=req.portalUser!,c=await pool.connect();
  data.document_status="Finalized";data.finalized_at=new Date().toISOString();data.verification_number=`DS-${Date.now().toString(36).toUpperCase()}`;data.signed_by=a.sub;
  try{
    await c.query("BEGIN");
    const admission=await c.query(`SELECT x.*,concat(p.first_name,' ',p.last_name) patient_name,p.medical_record_number FROM ipd_admissions x JOIN patients p ON p.id=x.patient_id WHERE x.id=$1 AND x.tenant_id=$2 AND ($4='hospital_admin' OR x.consultant_doctor_id=$3) AND lower(trim(x.status)) NOT IN ('discharged','cancelled') FOR UPDATE OF x`,[req.params.id,a.tenantId,a.sub,a.role]);
    const row=admission.rows[0];if(!row)throw new Error("Active IPD admission not found in your workspace");
    const existing=await c.query(`SELECT id FROM role_work_items WHERE tenant_id=$1 AND workspace='reception' AND kind='ipd_discharge' AND data->>'admission_id'=$2 AND status='Pending'`,[a.tenantId,row.id]);
    if(existing.rowCount)throw new Error("A discharge recommendation is already waiting for reception approval");
    const record=await c.query(`INSERT INTO doctor_clinical_records(tenant_id,doctor_id,patient_id,admission_id,record_type,data) VALUES($1,$2,$3,$4,'discharge_summary',$5) RETURNING *`,[a.tenantId,a.sub,row.patient_id,row.id,data]);
    const medicines=Array.isArray(data.medicines)?data.medicines.filter((item:unknown)=>item&&typeof item==='object'&&String((item as Record<string,unknown>).name||'').trim()):[];
    if(medicines.length)await c.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,'pharmacy','prescription',$5,'Pending','High',$6)`,[a.tenantId,row.branch_id,row.patient_id,a.sub,`Discharge Prescription · ${row.patient_name}`,{admission_id:row.id,visit_id:record.rows[0].id,visit_at:record.rows[0].created_at,discharge_prescription:true,doctor_id:a.sub,medical_record_number:row.medical_record_number,medicines,diagnosis:data.diagnosis||'',advice:data.advice||''}]);
    await c.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,'reception','ipd_discharge',$5,'Pending','High',$6)`,[a.tenantId,row.branch_id,row.patient_id,a.sub,`IPD Discharge · ${row.patient_name}`,{admission_id:row.id,ipd_number:row.ipd_number,discharge_record_id:record.rows[0].id,instructions:data.advice||data.comment||'',medicines}]);
    await c.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,'nurse','discharge-clearance',$5,'Pending','High',$6)`,[a.tenantId,row.branch_id,row.patient_id,a.sub,`Nursing discharge clearance · ${row.patient_name}`,{admission_id:row.id,ipd_number:row.ipd_number,discharge_record_id:record.rows[0].id}]);
    await c.query(`UPDATE ipd_admissions SET status='Discharge Requested',updated_at=now() WHERE id=$1`,[row.id]);
    await c.query("COMMIT");res.status(201).json(record.rows[0]);
  }catch(error){await c.query("ROLLBACK");res.status(400).json({error:error instanceof Error?error.message:"Unable to request discharge"})}finally{c.release()}
});
router.delete("/ipd/:id/discharge-request",async(req:AuthedRequest,res)=>{
  const a=req.portalUser!,c=await pool.connect();
  try{await c.query("BEGIN");
    const admission=await c.query(`SELECT id,status FROM ipd_admissions WHERE id=$1 AND tenant_id=$2 AND ($4='hospital_admin' OR consultant_doctor_id=$3) FOR UPDATE`,[req.params.id,a.tenantId,a.sub,a.role]);
    if(!admission.rows[0])throw new Error("IPD admission not found in your workspace");
    const pending=await c.query(`SELECT id FROM role_work_items WHERE tenant_id=$1 AND workspace='reception' AND kind='ipd_discharge' AND data->>'admission_id'=$2 AND status='Pending' FOR UPDATE`,[a.tenantId,req.params.id]);
    if(!pending.rowCount)throw new Error("No pending discharge request is available to undo");
    const processed=await c.query(`SELECT id FROM role_work_items WHERE tenant_id=$1 AND workspace='pharmacy' AND kind='prescription' AND data->>'admission_id'=$2 AND data->>'discharge_prescription'='true' AND status NOT IN ('Pending','Cancelled') LIMIT 1`,[a.tenantId,req.params.id]);
    if(processed.rowCount)throw new Error("Discharge medicines are already being processed. Reception or pharmacy must cancel them first.");
    await c.query(`UPDATE role_work_items SET status='Cancelled',data=data||jsonb_build_object('cancelled_by',$1::text,'cancelled_at',now(),'cancel_reason','Doctor withdrew discharge'),updated_at=now() WHERE tenant_id=$2 AND ((workspace='reception' AND kind='ipd_discharge') OR (workspace='pharmacy' AND kind='prescription' AND data->>'discharge_prescription'='true')) AND data->>'admission_id'=$3 AND status='Pending'`,[a.sub,a.tenantId,req.params.id]);
    await c.query(`UPDATE ipd_admissions SET status='Admitted',updated_at=now() WHERE id=$1`,[req.params.id]);
    await c.query("COMMIT");res.status(204).end();
  }catch(error){await c.query("ROLLBACK");res.status(400).json({error:error instanceof Error?error.message:"Unable to undo discharge"})}finally{c.release()}
});

export default router;
