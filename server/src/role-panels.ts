import {withPrintDoctorDetails} from './doctor-print-profile.js';
import {savedPrintableKeys} from "./lab-report-print-model.js";
import {reportPrintEvents,confirmReportPrint} from "./lab-report-prints.js";
import {reportPrintRevisionSql} from "./lab-report-print-model.js";
import {labListCountPlan,labNavigationIndexesSql,labOrderFastSummarySql} from "./lab-list-query.js";
import {awaitingLabSample,labSampleQueueSql,sampleCollectionRow} from "./lab-sample-queue.js";
import {diagnosticClinicalDomain} from "./diagnostic-master-unification.js";
import {labDoctorLookupSql} from './clinical-doctors.js';
import {nursingVitals,medicationScheduleError,hasClinicalTimestamp} from './nursing-validation.js';
import {accessibleBranchIds} from './branch-access.js';
import {receptionReportAllowed,labCollectionTotals} from "./reception-lab.js";
import {randomUUID} from "node:crypto";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
const parsePhoneNumberFromString = (value: string, _country?: string) => ({
  isValid: () => /^\d{10}$/.test(value),
});
import { config } from "./config.js";
import { pool } from "./db.js";
import { configuredPrefix } from "./settings-runtime.js";
import { labPharmacyBilling } from "./lab-billing.js";
import {labPaymentHistory} from "./lab-payment-history.js";
import laboratoryRouter from "./laboratory.js";
import { laboratoryReference } from "./lab-clinical.js";
import { ageAddress, patientAgeDays } from "./patient-age.js";
import { laboratoryPrice,laboratoryTestAvailable } from "./lab-branch-pricing.js";
import { labSearchPatterns, labSearchSql } from "./lab-search.js";
import {labOrderFilterSql,labOrderTypes,labOrderStatuses,labBillingStatuses,labPaymentStatusSql,labBillingSummarySql} from './lab-order-list.js';
import {reportSignatories} from "./lab-signatories.js";
import {labResultProgress} from "./lab-result-completion.js";
import {prepareLabResults,labResultChanges,attributeLabResults} from "./lab-result-entry.js";
import {normalizeLabResultFormats} from './lab-result-format.js';
import {editLabOrder} from "./lab-order-edit.js";
import {hasPermission} from './access-control.js';
import {decodeReportPdf,ensureReportShares,newReportShareToken,shareTokenHash} from "./lab-report-sharing.js";

type Auth = {
  sub: string;
  tenantId: string;
  branchId: string;
  role: string;
  portal?: string;
};
type Authed = Request & { portalUser?: Auth };
const router = Router();
const allowed = [
  "receptionist",
  "nurse",
  "laboratory",
  "radiology",
  "pharmacist",
  "patient",
  "hospital_admin",
  "accountant",
  "hr",
];
let ready: Promise<unknown> | null = null;

function auth(req: Authed, res: Response, next: NextFunction) {
  try {
    const value = jwt.verify(
      req.header("authorization")?.replace(/^Bearer /i, "") ?? "",
      config.JWT_SECRET,
      {
        issuer: "careframe-api",
        audience: "careframe-portal",
      },
    ) as Auth;
    if (!allowed.includes(value.role))
      return void res.status(403).json({ error: "Workspace access denied" });
    req.portalUser = value;
    next();
  } catch {
    res.status(401).json({ error: "Session expired or invalid" });
  }
}

router.use(auth);
router.use(async(req:Authed,res,next)=>{
  const a=req.portalUser!,path=req.path,write=!['GET','HEAD','OPTIONS'].includes(req.method);
  let permission:string|undefined;
  if(path==='/lab-recent-appointments')permission=a.role==='receptionist'?'billing.view':'lab.order.view';
  else if(path.includes('/lab-report-print'))permission=a.role==='receptionist'?'billing.view':'lab.order.view';
  else if(path.includes('/lab-results'))permission=write?'lab.result.create':a.role==='receptionist'?'billing.view':'lab.order.view';
  else if(path.includes('/lab-bill'))permission=write?(['laboratory','radiology'].includes(a.role)?'lab.order.view':'billing.update'):(['laboratory','radiology'].includes(a.role)?'lab.order.view':'billing.view');
  else if(path==='/lab-orders'||path==='/lab-own-orders'||path.includes('/lab-order')||path.includes('/lab-action')||path.includes('/sample-action'))permission=a.role==='receptionist'?(write?'billing.create':'billing.view'):'lab.order.view';
  if(permission&&!(await hasPermission(a.sub,a.tenantId,permission)))return void res.status(403).json({code:'PERMISSION_REQUIRED',permission,error:`Your role no longer allows this action. Required permission: ${permission}. Contact your hospital administrator.`});
  next();
});
router.use(async (_req, _res, next) => {
  try {
    ready ??= pool.query(`CREATE TABLE IF NOT EXISTS role_work_items(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      branch_id uuid REFERENCES branches(id), patient_id uuid REFERENCES patients(id), assigned_user_id uuid REFERENCES users(id),
      created_by uuid REFERENCES users(id), workspace text NOT NULL, kind text NOT NULL, title text NOT NULL,
      status text NOT NULL DEFAULT 'Pending', priority text NOT NULL DEFAULT 'Normal', data jsonb NOT NULL DEFAULT '{}',
      occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS lab_orders_tenant_date ON role_work_items(tenant_id,occurred_at DESC,id DESC) WHERE workspace='laboratory'; ${labNavigationIndexesSql}`);
    await ready;
    next();
  } catch (e) {
    ready = null;
    next(e);
  }
});

router.use("/lab", laboratoryRouter);

const workspaceFor: Record<string, string> = {
  receptionist: "reception",
  nurse: "nurse",
  laboratory: "laboratory",
  radiology: "laboratory",
  pharmacist: "pharmacy",
  patient: "patient",
  hospital_admin: "all",
  accountant: "accounting",
  hr: "hr",
};

function workspace(a: Auth) {
  return (
    (
      {
        branch_admin: "branch",
        inventory_manager: "inventory",
        accountant: "accounting",
        hr_manager: "hr",
        radiologist: "laboratory",
      } as Record<string, string>
    )[a.portal ?? ""] ??
    workspaceFor[a.role] ??
    "all"
  );
}

function labCommercialAccess(a:Auth){return a.role==="receptionist"?Boolean(a.branchId):["laboratory","all"].includes(workspace(a));}

router.get("/overview", async (req: Authed, res) => {
  const a = req.portalUser!,
    activeWorkspace = workspace(a);
  const user = await pool.query(
    `SELECT email,phone FROM users WHERE id=$1 AND tenant_id=$2`,
    [a.sub, a.tenantId],
  );
  let patientId: string | null = null;
  if (a.role === "patient") {
    const p = await pool.query(
      `SELECT id FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL AND (lower(email::text)=lower($2) OR phone=$3) LIMIT 1`,
      [a.tenantId, user.rows[0]?.email ?? "", user.rows[0]?.phone ?? ""],
    );
    patientId = p.rows[0]?.id ?? null;
  }
  const patientFilter = patientId
    ? ` AND p.id=$3`
    : activeWorkspace === "branch"
      ? ` AND p.branch_id=$2`
      : "";
  const [patients, appointments, admissions, finances, inventory, work] =
    await Promise.all([
      pool.query(
        `SELECT p.id,p.medical_record_number,concat(p.first_name,' ',p.last_name) patient_name,p.phone,p.blood_group,p.status FROM patients p WHERE p.tenant_id=$1 AND p.deleted_at IS NULL${patientFilter} ORDER BY p.created_at DESC LIMIT 100`,
        patientId
          ? [a.tenantId, a.branchId, patientId]
          : activeWorkspace === "branch"
            ? [a.tenantId, a.branchId]
            : [a.tenantId],
      ),
      pool.query(
        `SELECT x.*,concat(p.first_name,' ',p.last_name) patient_name,p.medical_record_number FROM clinical_appointments x JOIN patients p ON p.id=x.patient_id WHERE x.tenant_id=$1${patientId ? " AND x.patient_id=$3" : activeWorkspace === "branch" ? " AND x.branch_id=$2" : ""} ORDER BY x.appointment_date DESC,x.appointment_time DESC LIMIT 100`,
        patientId
          ? [a.tenantId, a.branchId, patientId]
          : activeWorkspace === "branch" ? [a.tenantId, a.branchId] : [a.tenantId],
      ),
      pool.query(
        `SELECT x.*,concat(p.first_name,' ',p.last_name) patient_name,p.medical_record_number FROM ipd_admissions x JOIN patients p ON p.id=x.patient_id WHERE x.tenant_id=$1${patientId ? " AND x.patient_id=$3" : activeWorkspace === "branch" ? " AND x.branch_id=$2" : ""} ORDER BY x.admitted_at DESC LIMIT 100`,
        patientId
          ? [a.tenantId, a.branchId, patientId]
          : activeWorkspace === "branch" ? [a.tenantId, a.branchId] : [a.tenantId],
      ),
      pool.query(
        `SELECT f.*,concat(p.first_name,' ',p.last_name) patient_name FROM finance_records f LEFT JOIN patients p ON p.id=f.patient_id WHERE f.tenant_id=$1${patientId ? " AND f.patient_id=$3" : activeWorkspace === "branch" ? " AND f.branch_id=$2" : ""} ORDER BY f.created_at DESC LIMIT 100`,
        patientId
          ? [a.tenantId, a.branchId, patientId]
          : activeWorkspace === "branch"
            ? [a.tenantId, a.branchId]
            : [a.tenantId],
      ),
      a.role === "patient"
        ? Promise.resolve({ rows: [] })
        : pool.query(
            `SELECT id,record_code,data,quantity,amount,status,record_date FROM inventory_records WHERE tenant_id=$1${activeWorkspace === "branch" ? " AND branch_id=$2" : ""} ORDER BY updated_at DESC LIMIT 100`,
            activeWorkspace === "branch"
              ? [a.tenantId, a.branchId]
              : [a.tenantId],
          ),
      pool.query(
        `SELECT w.*,concat_ws(' ',ordering_doctor.first_name,ordering_doctor.last_name) ordering_doctor_name,coalesce(nullif(trim(concat(p.first_name,' ',p.last_name)),''),w.data->>'customer_name') patient_name,
          coalesce(p.medical_record_number,w.data->>'medical_record_number') medical_record_number,
          CASE
            WHEN w.data->>'patient_type'='Lab Own' THEN 'Lab Own'
            WHEN upper(coalesce(w.data->>'care_type',''))='IPD'
              OR nullif(w.data->>'admission_id','') IS NOT NULL
              OR nullif(w.data->>'ipd_number','') IS NOT NULL
            THEN 'IPD' ELSE 'OPD'
          END patient_type
         FROM role_work_items w LEFT JOIN patients p ON p.id=w.patient_id LEFT JOIN users ordering_doctor ON ordering_doctor.id::text=coalesce(w.data->>'doctor_id',w.created_by::text) AND ordering_doctor.tenant_id=w.tenant_id
         WHERE w.tenant_id=$1 AND ($2='all' OR w.workspace=$2 OR ($2='branch' AND w.branch_id=$4) OR ($2='patient' AND w.patient_id=$3))
         ORDER BY w.occurred_at DESC LIMIT 150`,
        [a.tenantId, activeWorkspace, patientId, a.branchId],
      ),
    ]);
  const today = new Date().toISOString().slice(0, 10);
  let workItems = work.rows;
  if (a.role === "patient" && patientId) {
    try {
      const clinical = await pool.query(
        `SELECT id,record_type kind,initcap(replace(record_type,'_',' ')) title,'Published' status,data,created_at occurred_at FROM doctor_clinical_records WHERE tenant_id=$1 AND patient_id=$2 ORDER BY created_at DESC`,
        [a.tenantId, patientId],
      );
      workItems = [...clinical.rows, ...workItems];
    } catch {
      /* Doctor records table is initialized on first doctor workspace use. */
    }
  }
  res.json({
    workspace: activeWorkspace,
    patientLinked: a.role !== "patient" || !!patientId,
    patients: patients.rows,
    appointments: appointments.rows,
    admissions: admissions.rows,
    finances: finances.rows,
    inventory: inventory.rows,
    workItems,
    metrics: {
      patients: patients.rowCount,
      appointments: appointments.rows.filter(
        (x) => String(x.appointment_date).slice(0, 10) === today,
      ).length,
      waiting: appointments.rows.filter((x) =>
        ["waiting", "booked", "checked in"].includes(
          String(x.status).toLowerCase(),
        ),
      ).length,
      admissions: admissions.rows.filter(
        (x) => String(x.status).toLowerCase() !== "discharged",
      ).length,
      pending: work.rows.filter(
        (x) =>
          !["completed", "verified", "dispensed"].includes(
            String(x.status).toLowerCase(),
          ),
      ).length,
    },
  });
});

function nurseOnly(req: Authed, res: Response) {
  if (!req.portalUser || !["nurse", "hospital_admin"].includes(req.portalUser.role)) {
    res.status(403).json({ error: "Nursing workspace access required" });
    return false;
  }
  return true;
}

async function nursePatientAccess(a: Auth, patientId: string, admissionId: string) {
  return (await pool.query(
    `SELECT x.branch_id FROM ipd_admissions x
     WHERE x.id=$2 AND x.patient_id=$3 AND x.tenant_id=$4
       AND ($5='hospital_admin' OR EXISTS(SELECT 1 FROM staff_members s WHERE s.user_id=$1 AND s.tenant_id=x.tenant_id AND s.staff_type='Nurse' AND x.ward_id=nullif(s.professional->>'ward_assignment','')::uuid))
       AND lower(trim(x.status)) NOT IN ('discharged','cancelled')`,
    [a.sub, admissionId, patientId, a.tenantId, a.role],
  )).rows[0];
}

router.get("/nursing-station", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;
  const a = req.portalUser!;
  const admin = a.role === "hospital_admin";
  const staff = await pool.query(
    `SELECT s.id,s.professional,w.id ward_id,w.name ward_name
       FROM staff_members s
       LEFT JOIN wards w ON w.id=nullif(s.professional->>'ward_assignment','')::uuid AND w.tenant_id=s.tenant_id
      WHERE s.tenant_id=$1 AND s.user_id=$2 AND s.staff_type='Nurse' LIMIT 1`,
    [a.tenantId, a.sub],
  );
  const ward = admin ? { ward_id: null, ward_name: "All wards" } : staff.rows[0];
  if (!admin && !ward?.ward_id) return void res.json({ ward: null, patients: [], diagnostics: [] });
  const patients = await pool.query(
    `SELECT a.id admission_id,a.patient_id,a.ipd_number,a.admitted_at,a.reason_diagnosis,a.status,
            p.medical_record_number,p.first_name,p.last_name,p.sex,p.date_of_birth,p.blood_group,p.allergies,p.existing_conditions,p.current_medication,
            w.name ward_name,r.room_number,b.bed_number,concat_ws(' ',d.first_name,d.last_name) doctor_name
       FROM ipd_admissions a JOIN patients p ON p.id=a.patient_id
       LEFT JOIN wards w ON w.id=a.ward_id LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN beds b ON b.id=a.bed_id
       LEFT JOIN users d ON d.id=a.consultant_doctor_id
      WHERE a.tenant_id=$1 AND ($3::boolean OR a.ward_id=$2) AND lower(trim(a.status)) NOT IN ('discharged','cancelled')
      ORDER BY r.room_number NULLS LAST,b.bed_number NULLS LAST,p.first_name`,
    [a.tenantId, ward.ward_id, admin],
  );
  const patientIds = patients.rows.map((x) => x.patient_id);
  let prescriptions: unknown[] = [];
  if (patientIds.length) {
      prescriptions = (await pool.query(
        `SELECT c.id,c.patient_id,c.admission_id,c.record_type,c.data,c.created_at,concat_ws(' ',u.first_name,u.last_name) doctor_name
           FROM doctor_clinical_records c LEFT JOIN users u ON u.id=c.doctor_id
          WHERE c.tenant_id=$1 AND c.patient_id=ANY($2::uuid[]) AND c.admission_id=ANY($3::uuid[]) AND c.record_type IN ('consultation','prescription','discharge_summary')
          ORDER BY c.created_at DESC`, [a.tenantId, patientIds,patients.rows.map(x=>x.admission_id)],
      )).rows;
  }
  const nursing = patientIds.length ? (await pool.query(
    `SELECT n.*,
      coalesce((SELECT p.status FROM role_work_items p WHERE p.tenant_id=n.tenant_id AND p.workspace='pharmacy' AND p.data->>'nurse_request_id'=n.id::text ORDER BY p.updated_at DESC LIMIT 1),n.status) effective_status
      FROM role_work_items n WHERE n.tenant_id=$1 AND n.workspace='nurse' AND n.patient_id=ANY($2::uuid[])
      AND kind=ANY($3::text[]) ORDER BY occurred_at DESC`,
    [a.tenantId, patientIds, ["medication-plan", "medication-administration", "nursing-note", "pharmacy-request", "pharmacy-return", "clinical-chart", "care-plan", "shift-handover", "discharge-clearance"]],
  )).rows : [];
  const diagnostics = patientIds.length ? (await pool.query(
    `SELECT w.id,w.patient_id,w.workspace,w.kind,w.title,w.status,w.priority,w.data,w.occurred_at,w.created_at,w.updated_at,
            concat_ws(' ',u.first_name,u.last_name) ordered_by
       FROM role_work_items w LEFT JOIN users u ON u.id=w.created_by
      WHERE w.tenant_id=$1 AND w.patient_id=ANY($2::uuid[])
        AND w.workspace IN ('laboratory','radiology')
      ORDER BY w.created_at DESC`,
    [a.tenantId, patientIds],
  )).rows : [];
  const medicines = (await pool.query(
    `SELECT m.id,m.name,m.data,
       coalesce((SELECT sum(i.quantity) FROM inventory_records i
         WHERE i.tenant_id=m.tenant_id AND i.kind='pharmacy-batch'
           AND i.data->>'medicine_id'=m.id::text AND i.quantity>0
           AND ($3::boolean OR i.branch_id=$2 OR i.branch_id IS NULL)),0)::numeric current_stock
       FROM hospital_pharmacy_masters m
      WHERE m.tenant_id=$1 AND m.kind='medicine'
        AND lower(coalesce(m.data->>'status','Active'))='active'
      ORDER BY m.name`, [a.tenantId, a.branchId, admin],
  )).rows;
  const diagnosticMasters = (await pool.query(
    `SELECT id,name,domain,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='test' ORDER BY name`,
    [a.tenantId],
  )).rows;
  res.json({ ward: { id: ward.ward_id, name: ward.ward_name }, patients: patients.rows, prescriptions, nursing, medicines, diagnostics, diagnostic_masters: diagnosticMasters.filter(test=>laboratoryTestAvailable(test.data,a.branchId)).map(test=>({...test,domain:diagnosticClinicalDomain(test)})) });
});

router.post("/nursing-station/diagnostic-orders", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;
  const body=z.object({patient_id:z.string().uuid(),admission_id:z.string().uuid(),domain:z.enum(["pathology","radiology"]),test_ids:z.array(z.string().uuid()).min(1),priority:z.enum(["Routine","Urgent","STAT"]).default("Routine"),instruction:z.string().trim().max(1000).default(""),clinical_note:z.string().trim().max(2000).default("")}).parse(req.body),a=req.portalUser!;
  if(!await nursePatientAccess(a,body.patient_id,body.admission_id))return void res.status(403).json({error:"Patient is not in your assigned ward"});
  const ids=[...new Set(body.test_ids)],found=await pool.query(`SELECT id,name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain=$2 AND kind='test' AND id=ANY($3::uuid[]) ORDER BY name`,[a.tenantId,'pathology',ids]);
  if(found.rowCount!==ids.length)return void res.status(400).json({error:"One or more selected tests are unavailable"});
  const patient=await pool.query(`SELECT concat_ws(' ',first_name,last_name) name,medical_record_number FROM patients WHERE id=$1 AND tenant_id=$2`,[body.patient_id,a.tenantId]);
  if(!patient.rows[0])return void res.status(400).json({error:"Patient not found"});
  const target="laboratory",label=body.domain==="pathology"?"Lab":"Radiology",queuePriority=body.priority==="Routine"?"Normal":"High",tests=found.rows.map(test=>({test_id:test.id,name:test.name,test_type:test.data?.test_type||"Pathology",priority:body.priority,instruction:body.instruction,amount:laboratoryPrice(test.data,a.branchId)})),data={admission_id:body.admission_id,medical_record_number:patient.rows[0].medical_record_number,tests,diagnosis:body.clinical_note,investigation:body.instruction,requested_by_nurse:true,nurse_id:a.sub,request_source:"Nursing Station"};
  const result=await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,$5,'orders',$6,'Pending',$7,$8) RETURNING *`,[a.tenantId,a.branchId,body.patient_id,a.sub,target,`Nurse ${label} Order · ${patient.rows[0].name} · ${new Date().toISOString()}`,queuePriority,data]);
  res.status(201).json(result.rows[0]);
});

router.post("/nursing-station/medications", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;
  if(hasClinicalTimestamp(req.body))return void res.status(400).json({error:'Clinical entry times are recorded by the server and cannot be overridden.'});
  const b = z.object({ patient_id:z.string().uuid(), admission_id:z.string().uuid(), name:z.string().min(1), dose:z.string().min(1), route:z.string().default("Oral"), schedule:z.string().min(1), first_due_at:z.string().min(1), instructions:z.string().default(""), start_date:z.string().optional(), end_date:z.string().optional(), prn:z.boolean().default(false), indication:z.string().default(""), double_check:z.boolean().default(false) }).parse(req.body);
  const a=req.portalUser!;
  const allowedPatient=await nursePatientAccess(a,b.patient_id,b.admission_id);
  if(!allowedPatient)return void res.status(403).json({error:"Patient is not in your assigned ward"});
  const timingError=medicationScheduleError(b);
  if(timingError)return void res.status(400).json({error:timingError});
  const result=await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,assigned_user_id,created_by,workspace,kind,title,status,priority,data,occurred_at) VALUES($1,$2,$3,$4,$4,'nurse','medication-plan',$5,'Active','Normal',$6,$7) RETURNING *`,[a.tenantId,a.branchId,b.patient_id,a.sub,`Previous medicine · ${b.name}`,b,b.first_due_at]);
  res.status(201).json(result.rows[0]);
});

router.post("/nursing-station/medications/:id/administer", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;
  if(hasClinicalTimestamp(req.body))return void res.status(400).json({error:'Administration time is recorded by the server and cannot be overridden.'});
  const body=z.object({outcome:z.enum(["Given","Missed","Refused","Held"]),notes:z.string().default("")}).parse(req.body),a=req.portalUser!;
  const plan=await pool.query(`SELECT n.* FROM role_work_items n JOIN ipd_admissions x ON x.id=nullif(n.data->>'admission_id','')::uuid WHERE n.id=$1 AND n.tenant_id=$2 AND n.workspace='nurse' AND n.kind='medication-plan' AND ($4='hospital_admin' OR EXISTS(SELECT 1 FROM staff_members s WHERE s.user_id=$3 AND s.tenant_id=x.tenant_id AND x.ward_id=nullif(s.professional->>'ward_assignment','')::uuid))`,[req.params.id,a.tenantId,a.sub,a.role]);
  if(!plan.rowCount)return void res.status(404).json({error:"Medication plan not found"});
  const row=plan.rows[0], data={plan_id:row.id,admission_id:row.data.admission_id,medicine:row.data.name,dose:row.data.dose,route:row.data.route,scheduled_at:row.occurred_at,outcome:body.outcome,notes:body.notes,administered_at:new Date().toISOString()};
  const result=await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,assigned_user_id,created_by,workspace,kind,title,status,data) VALUES($1,$2,$3,$4,$4,'nurse','medication-administration',$5,$6,$7) RETURNING *`,[a.tenantId,row.branch_id,row.patient_id,a.sub,`${body.outcome} · ${row.data.name}`,body.outcome,data]);
  await pool.query(`UPDATE role_work_items SET occurred_at=CASE WHEN data->>'schedule'='Once' THEN occurred_at ELSE occurred_at + CASE data->>'schedule' WHEN 'Every 4 hours' THEN interval '4 hours' WHEN 'Every 6 hours' THEN interval '6 hours' WHEN 'Every 8 hours' THEN interval '8 hours' WHEN 'Every 12 hours' THEN interval '12 hours' ELSE interval '24 hours' END END,status=CASE WHEN data->>'schedule'='Once' THEN 'Completed' ELSE status END,updated_at=now() WHERE id=$1`,[row.id]);
  res.status(201).json(result.rows[0]);
});

router.post("/nursing-station/notes", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;
  const b=z.object({patient_id:z.string().uuid(),admission_id:z.string().uuid(),text:z.string().min(1),input_mode:z.enum(["written","voice"]).default("written")}).parse(req.body),a=req.portalUser!;
  if(!await nursePatientAccess(a,b.patient_id,b.admission_id))return void res.status(403).json({error:"Patient is not in your assigned ward"});
  const result=await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,assigned_user_id,created_by,workspace,kind,title,status,data) VALUES($1,$2,$3,$4,$4,'nurse','nursing-note','Nursing instruction','Recorded',$5) RETURNING *`,[a.tenantId,a.branchId,b.patient_id,a.sub,b]);
  res.status(201).json(result.rows[0]);
});

router.post("/nursing-station/pharmacy", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;
  const b=z.object({patient_id:z.string().uuid(),admission_id:z.string().uuid(),action:z.enum(["request","return"]),medicine:z.string().min(1),quantity:z.number().positive(),reason:z.string().default("")}).parse(req.body),a=req.portalUser!;
  if(!await nursePatientAccess(a,b.patient_id,b.admission_id))return void res.status(403).json({error:"Patient is not in your assigned ward"});
  const kind=b.action==='request'?'pharmacy-request':'pharmacy-return', title=`Nurse ${b.action} · ${b.medicine}`;
  const nurseItem=await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,assigned_user_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,$4,'nurse',$5,$6,'Pending','High',$7) RETURNING *`,[a.tenantId,a.branchId,b.patient_id,a.sub,kind,title,b]);
  await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,'pharmacy',$5,$6,'Pending','High',$7)`,[a.tenantId,a.branchId,b.patient_id,a.sub,kind,title,{...b,nurse_request_id:nurseItem.rows[0].id}]);
  res.status(201).json(nurseItem.rows[0]);
});

router.post("/nursing-station/clinical", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;
  const b=z.object({patient_id:z.string().uuid(),admission_id:z.string().uuid(),type:z.enum(["vitals","intake-output","assessment"]),data:z.record(z.string(),z.unknown())}).parse(req.body),a=req.portalUser!;
  if(!await nursePatientAccess(a,b.patient_id,b.admission_id))return void res.status(403).json({error:"Patient is not in your assigned ward"});
  if(hasClinicalTimestamp(req.body)||hasClinicalTimestamp(b.data))return void res.status(400).json({error:'Clinical entry time is recorded by the server and cannot be overridden.'});
  if(b.type==='vitals'){
    const parsed=nursingVitals.safeParse(b.data);
    if(!parsed.success)return void res.status(400).json({error:parsed.error.issues[0]?.message,field:parsed.error.issues[0]?.path.join('.')});
    b.data=parsed.data;
  }
  const alerts:string[]=[];if(b.type==='vitals'){const d=b.data,n=(v:unknown)=>Number(v);if(n(d.spo2)>0&&n(d.spo2)<94)alerts.push('Low SpO₂');if(n(d.temperature)>38)alerts.push('Fever');if(n(d.pulse)>120||n(d.pulse)<50)alerts.push('Abnormal pulse');if(n(d.systolic)>180||n(d.systolic)<90)alerts.push('Abnormal blood pressure');}
  const data={...b.data,admission_id:b.admission_id,chart_type:b.type,alerts};
  const result=await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,assigned_user_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,$4,'nurse','clinical-chart',$5,'Recorded',$6,$7) RETURNING *`,[a.tenantId,a.branchId,b.patient_id,a.sub,`Clinical chart · ${b.type}`,alerts.length?'High':'Normal',data]);res.status(201).json(result.rows[0]);
});

router.post("/nursing-station/care-plans", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;const b=z.object({patient_id:z.string().uuid(),admission_id:z.string().uuid(),problem:z.string().min(1),goal:z.string().min(1),intervention:z.string().min(1),due_at:z.string().min(1),priority:z.enum(['Low','Normal','High','Critical']).default('Normal')}).parse(req.body),a=req.portalUser!;
  if(!await nursePatientAccess(a,b.patient_id,b.admission_id))return void res.status(403).json({error:"Patient is not in your assigned ward"});
  const result=await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,assigned_user_id,created_by,workspace,kind,title,status,priority,data,occurred_at) VALUES($1,$2,$3,$4,$4,'nurse','care-plan',$5,'Pending',$6,$7,$8) RETURNING *`,[a.tenantId,a.branchId,b.patient_id,a.sub,`Care plan · ${b.problem}`,b.priority,b,b.due_at]);res.status(201).json(result.rows[0]);
});

router.patch("/nursing-station/tasks/:id", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;const b=z.object({status:z.enum(['Completed','Acknowledged','Discontinued']),note:z.string().default('')}).parse(req.body),a=req.portalUser!;
  const result=await pool.query(`UPDATE role_work_items n SET status=$1,data=n.data||jsonb_build_object('action_note',$2::text,'action_by',$3::text,'action_at',now()),updated_at=now() FROM ipd_admissions x WHERE n.id=$4 AND n.tenant_id=$5 AND x.id=nullif(n.data->>'admission_id','')::uuid AND ($6='hospital_admin' OR EXISTS(SELECT 1 FROM staff_members s WHERE s.user_id=$3 AND s.tenant_id=n.tenant_id AND x.ward_id=nullif(s.professional->>'ward_assignment','')::uuid)) RETURNING n.*`,[b.status,b.note,a.sub,req.params.id,a.tenantId,a.role]);if(!result.rowCount)return void res.status(404).json({error:'Record not found in your ward'});res.json(result.rows[0]);
});

router.post("/nursing-station/handover", async (req: Authed, res) => {
  if (!nurseOnly(req, res)) return;const b=z.object({patient_id:z.string().uuid(),admission_id:z.string().uuid(),shift:z.enum(['Morning','Evening','Night']),situation:z.string().min(1),background:z.string().default(''),assessment:z.string().default(''),recommendation:z.string().min(1)}).parse(req.body),a=req.portalUser!;
  if(!await nursePatientAccess(a,b.patient_id,b.admission_id))return void res.status(403).json({error:"Patient is not in your assigned ward"});
  const result=await pool.query(`INSERT INTO role_work_items(tenant_id,branch_id,patient_id,assigned_user_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,$4,'nurse','shift-handover',$5,'Pending','High',$6) RETURNING *`,[a.tenantId,a.branchId,b.patient_id,a.sub,`${b.shift} shift handover`,b]);res.status(201).json(result.rows[0]);
});

router.post("/self-registration-link", async (req: Authed, res) => {
  const a = req.portalUser!, activeWorkspace = workspace(a);
  if (activeWorkspace !== "reception")
    return void res.status(403).json({ error: "Reception access required" });
  const token = jwt.sign(
    { purpose: "patient-self-registration", tenantId: a.tenantId, branchId: a.branchId },
    config.JWT_SECRET,
    { issuer: "careframe-api", audience: "patient-self-registration", expiresIn: "365d" },
  );
  res.json({ token, expires_in_days: 365 });
});

router.post("/work-items", async (req: Authed, res) => {
  const body = z
    .object({
      kind: z.string().min(1),
      title: z.string().min(1),
      patient_id: z.string().uuid().nullable().optional(),
      status: z.string().default("Pending"),
      priority: z.string().default("Normal"),
      data: z.record(z.string(), z.unknown()).default({}),
    })
    .parse(req.body);
  const a = req.portalUser!,
    activeWorkspace = workspace(a);
  if(activeWorkspace==='nurse')return void res.status(403).json({error:'Use Nursing Station actions to create ward-scoped clinical records.'});
  if (["patient", "all"].includes(activeWorkspace))
    return void res
      .status(403)
      .json({ error: "This workspace cannot create clinical work items" });
  const result = await pool.query(
    `INSERT INTO role_work_items(tenant_id,branch_id,patient_id,assigned_user_id,created_by,workspace,kind,title,status,priority,data) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      a.tenantId,
      a.branchId,
      body.patient_id || null,
      a.sub,
      activeWorkspace,
      body.kind,
      body.title,
      body.status,
      body.priority,
      body.data,
    ],
  );
  res.status(201).json(result.rows[0]);
});

router.get("/lab-tests", async (req: Authed, res) => {
  const a = req.portalUser!, activeWorkspace = workspace(a);
  if (!labCommercialAccess(a))
    return void res.status(403).json({ error: "Laboratory access required" });
  const priceBranch=req.query.center_id?z.string().uuid().parse(req.query.center_id):a.branchId;
  if(priceBranch){const branch=await pool.query(`SELECT id FROM branches WHERE id=$1 AND tenant_id=$2 AND is_active=true`,[priceBranch,a.tenantId]);if(!branch.rowCount)return void res.status(400).json({error:"Select an active hospital branch"});}
  const result = await pool.query(
    `SELECT id,name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='test' ORDER BY name`,
    [a.tenantId],
  );
  res.json(result.rows.filter(test=>laboratoryTestAvailable(test.data,priceBranch)).map(test=>({...test,data:{...test.data,amount:laboratoryPrice(test.data,priceBranch)}})));
});

router.get("/lab-patients",async(req:Authed,res)=>{const a=req.portalUser!,activeWorkspace=workspace(a);if(!labCommercialAccess(a))return void res.status(403).json({error:"Laboratory access required"});const search=String(req.query.search||"").trim();if(search.length<2)return void res.json([]);const result=await pool.query(`SELECT id,medical_record_number,first_name,last_name,concat_ws(' ',first_name,last_name) patient_name,phone,date_of_birth,sex,blood_group,email FROM patients WHERE tenant_id=$1 AND deleted_at IS NULL AND (medical_record_number::text ILIKE $2 OR phone ILIKE $2 OR concat_ws(' ',first_name,last_name) ILIKE $2) ORDER BY created_at DESC LIMIT 25`,[a.tenantId,`%${search}%`]);res.json(result.rows)});

router.post("/lab-patients",async(req:Authed,res)=>{const a=req.portalUser!,activeWorkspace=workspace(a);if(!labCommercialAccess(a))return void res.status(403).json({error:"Laboratory access required"});const name=z.string().trim().min(1).max(80).regex(/^[\p{L}][\p{L} '\-]*$/u,"Use letters, spaces, hyphens or apostrophes only"),phone=z.string().trim().max(16).refine(value=>parsePhoneNumberFromString(value,"IN")?.isValid()===true,"Enter a valid phone number");const body=z.object({first_name:name,last_name:name,phone,date_of_birth:z.string().nullable().optional().refine(value=>!value||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).getTime()<=Date.now()),"Date of birth cannot be in the future"),sex:z.enum(["male","female","other","unknown"]).default("unknown"),blood_group:z.enum(["A+","A-","B+","B-","AB+","AB-","O+","O-",""]).default(""),email:z.string().trim().email().or(z.literal("")).default(""),title:z.string().trim().max(20).default(""),father_name:z.string().trim().max(150).default(""),mother_name:z.string().trim().max(150).default(""),state:z.string().trim().max(100).default(""),district:z.string().trim().max(100).default(""),city:z.string().trim().max(150).default(""),age_years:z.coerce.number().int().min(0).max(150).default(0),age_months:z.coerce.number().int().min(0).max(11).default(0),age_days:z.coerce.number().int().min(0).max(30).default(0),address:z.string().trim().max(1000).default(""),emergency_name:z.union([name,z.literal("")]).default(""),emergency_phone:z.string().trim().max(16).refine(value=>!value||parsePhoneNumberFromString(value,"IN")?.isValid()===true,"Enter a valid emergency phone number").default(""),allergies:z.string().trim().max(2000).default("")}).parse(req.body);const duplicate=await pool.query(`SELECT id,medical_record_number FROM patients WHERE tenant_id=$1 AND phone=$2 AND deleted_at IS NULL AND regexp_replace(lower(trim(concat_ws(' ',first_name,last_name))),'\\s+',' ','g')=$3 LIMIT 1`,[a.tenantId,body.phone,`${body.first_name} ${body.last_name}`.toLowerCase().replace(/\s+/g,' ').trim()]);if(duplicate.rows[0])return void res.status(409).json({error:`A patient with the same name and phone number already exists (${duplicate.rows[0].medical_record_number}). Use Existing Patient search.`});const count=await pool.query(`SELECT count(*)::int+1 n FROM patients WHERE tenant_id=$1`,[a.tenantId]),prefix=await configuredPrefix(a.tenantId,"uhid_prefix","UHID"),uhid=`${prefix}-${String(count.rows[0].n).padStart(6,"0")}`;const result=await pool.query(`INSERT INTO patients(tenant_id,branch_id,medical_record_number,first_name,last_name,date_of_birth,sex,blood_group,phone,email,address,emergency_contact,allergies,existing_conditions,current_medication,registration_fee,maintenance_fee,registration_addons,payment_mode,payment_reference,discount,discount_remarks,registration_payment_status,payment_status_remarks,total_amount,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'','',0,0,'[]','','',0,'','Unpaid','',0,'Active') RETURNING id,medical_record_number,first_name,last_name,concat_ws(' ',first_name,last_name) patient_name,phone,date_of_birth,sex,blood_group,email`,[a.tenantId,a.branchId,uhid,body.first_name,body.last_name,body.date_of_birth||null,body.sex,body.blood_group||null,body.phone,body.email||null,{line:body.address,title:body.title,father_name:body.father_name,mother_name:body.mother_name,state:body.state,district:body.district,city:body.city,...ageAddress({age_years:body.age_years,age_months:body.age_months,age_days:body.age_days})},{name:body.emergency_name,phone:body.emergency_phone},body.allergies]);res.status(201).json(result.rows[0])});

router.get("/lab-orders", async (req: Authed, res) => {
  const a=req.portalUser!;
  if (!labCommercialAccess(a) && !(await hasPermission(a.sub,a.tenantId,"lab.order.view"))) return void res.status(403).json({error:"Laboratory access required"});
  const page=z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
  const stage=z.enum(["Orders","Sample Collection","Lab Billing","Results","Reports","Verification"]).default("Orders").parse(req.query.stage);
  const search=z.string().trim().max(150).default("").parse(req.query.search);
  const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).default('');
  const from=day.parse(req.query.from),to=day.parse(req.query.to);
  if(from&&to&&from>to)return void res.status(400).json({error:'From Date must be on or before To Date'});
  const billing=z.enum(['0','1']).default('0').parse(req.query.billing)==='1';
  const status=z.enum([...labOrderStatuses,...labBillingStatuses,'']).default('').parse(req.query.status);
  const orderType=z.enum([...labOrderTypes,'']).default('').parse(req.query.order_type);
  const detailFilters=z.object({bill_id:z.string().trim().max(150).default(''),uhid:z.string().trim().max(150).default(''),name:z.string().trim().max(150).default(''),barcode:z.string().trim().max(150).default(''),department:z.string().trim().max(150).default(''),test_id:z.string().trim().max(150).default(''),result_status:z.enum(['','Pending','In Progress','Partially Completed','Completed']).default('')}).parse(req.query);
const hasDetails=Object.values(detailFilters).some(Boolean);
const pageSize=z.coerce.number().int().min(1).max(100).default(50).parse(req.query.page_size);
  const stages:Record<string,string>={"Sample Collection":`AND ${labSampleQueueSql}`,"Lab Billing":"AND lower(w.kind)='pos'","Results":"AND w.data->>'collected_at' IS NOT NULL","Reports":"AND w.data->>'result_status' IN ('Completed','Partially Completed') AND w.data->'doctor_approval' IS NOT NULL AND w.data->'doctor_approval'<>'null'::jsonb","Verification":"AND w.data->>'result_status' IN ('Completed','Partially Completed')"};
  const billedOnly=z.enum(["0","1"]).default("0").parse(req.query.billed_only);
  const summaryOnly=z.enum(['0','1']).default('0').parse(req.query.summary_only)==='1';
  const includeSummary=summaryOnly||z.enum(['0','1']).default('1').parse(req.query.include_summary)==='1';
  const extra=labOrderFilterSql({from,to,status,orderType},billing);
  const detailSql="AND ($9::jsonb IS NOT NULL)\nAND (coalesce($9->>'bill_id','')='' OR strpos(lower(concat_ws(' ',f.record_number,w.data->>'bill_number',w.data->>'legacy_opd_id')),lower($9->>'bill_id'))>0)\nAND (coalesce($9->>'uhid','')='' OR strpos(lower(coalesce(p.medical_record_number,w.data->>'medical_record_number','')),lower($9->>'uhid'))>0)\nAND (coalesce($9->>'name','')='' OR strpos(lower(concat_ws(' ',p.first_name,p.last_name,w.data->>'customer_name')),lower($9->>'name'))>0)\nAND (coalesce($9->>'barcode','')='' OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(w.data->'barcodes','[]'::jsonb)) bc WHERE strpos(lower(bc->>'value'),lower($9->>'barcode'))>0) OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(w.data->'sample_records','[]'::jsonb)) sr WHERE strpos(lower(concat_ws(' ',sr->>'barcode',sr->>'barcode_id',sr->>'barcode_no',sr->>'bar_code')),lower($9->>'barcode'))>0))\nAND (coalesce($9->>'result_status','')='' OR coalesce(w.data->>'result_status','Pending')=$9->>'result_status')\nAND ((coalesce($9->>'test_id','')='' AND coalesce($9->>'department','')='') OR EXISTS (\nSELECT 1 FROM jsonb_array_elements(coalesce(w.data->'tests','[]'::jsonb)) t\nLEFT JOIN hospital_diagnostic_masters m ON m.id::text=t->>'test_id' AND m.tenant_id=w.tenant_id\nWHERE (coalesce($9->>'test_id','')='' OR t->>'test_id'=$9->>'test_id')\nAND (coalesce($9->>'department','')='' OR coalesce((SELECT c.name FROM hospital_diagnostic_masters c WHERE c.id::text=m.data->>'category_id' AND c.tenant_id=w.tenant_id),m.data->>'department',m.data->>'department_name',t->>'department','')=$9->>'department')))";
  const filters=`w.tenant_id=$1 AND w.workspace='laboratory' AND lower(w.kind) IN ('orders','pos','sample collection','results','verification','reports') ${stages[stage]||""} ${billing||billedOnly==="1"?"AND f.id IS NOT NULL":""} AND ($4::uuid IS NULL OR w.branch_id=$4) AND ${labSearchSql(true)} ${extra.sql} ${hasDetails?detailSql:"AND $9::jsonb IS NOT NULL"}`;
  const args=[a.tenantId,search,labSearchPatterns(search),!["laboratory","hospital_admin"].includes(a.role)?a.branchId:null,...extra.values,JSON.stringify(detailFilters)];
  const selectSql=`SELECT w.id,w.tenant_id,w.branch_id,w.workspace,w.kind,w.title,w.status,w.priority,w.occurred_at,w.updated_at,w.patient_id,
    (w.data-'lab_results'-'result_history'-'sample_records'-'legacy_payments'-'report_narrative') data,
    coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),w.data->>'customer_name') patient_name,
    coalesce(p.medical_record_number,w.data->>'medical_record_number') medical_record_number,coalesce(p.phone,w.data->>'phone') patient_phone,
    CASE WHEN w.data->>'patient_type'='Lab Own' THEN 'Lab Own' WHEN upper(coalesce(w.data->>'care_type',w.data->>'patient_type',''))='IPD' OR nullif(w.data->>'admission_id','') IS NOT NULL OR nullif(w.data->>'ipd_number','') IS NOT NULL THEN 'IPD' ELSE 'OPD' END patient_type,
    f.id bill_id,f.record_number bill_number,f.status bill_status,f.total bill_total,f.paid bill_paid,f.due bill_due,${labPaymentStatusSql} payment_status
    FROM role_work_items w LEFT JOIN patients p ON p.id=w.patient_id LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id WHERE ${filters}`;
  const billingCountFilters=filters.replace(labSearchSql(true),search?labSearchSql(true):"($2::text='' AND $3::text[] IS NOT NULL)");
  const billingCte=`WITH invoices AS (SELECT DISTINCT ON (f.id) w.id,w.occurred_at,f.id bill_id,f.paid bill_paid,${labPaymentStatusSql} payment_status
    FROM role_work_items w ${search||hasDetails?'LEFT JOIN patients p ON p.id=w.patient_id':''} LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id
    WHERE ${billingCountFilters} ORDER BY f.id,w.occurred_at DESC,w.id DESC)`;
  const billingPageSql=`${billingCte} ${selectSql.replace(`WHERE ${filters}`,`WHERE w.id IN (SELECT id FROM invoices ORDER BY occurred_at DESC,id DESC LIMIT $10 OFFSET $11)`)} ORDER BY w.occurred_at DESC,w.id DESC`;
  const countPlan=labListCountPlan(stage,hasDetails?(search||'filters'):search,billedOnly==="1",includeSummary);
  const countFilters=filters.replace(labSearchSql(true),countPlan.search);
  const countSql=billing?`${billingCte} SELECT ${includeSummary?labBillingSummarySql():'count(*)::int total'} FROM invoices`
    :includeSummary&&stage==='Orders'&&!hasDetails&&!search&&!status?labOrderFastSummarySql(countFilters)
    :`SELECT ${countPlan.aggregate} FROM role_work_items w ${countPlan.joins} WHERE ${countFilters}`;
  if(summaryOnly){const count=await pool.query(countSql,args);return void res.json({total:count.rows[0].total,summary:count.rows[0]});}
  // Bound patient/invoice lookups and JSON projection to the selected page.
  const pageFirst=!hasDetails&&!billing&&!search&&!status&&billedOnly==='0';
  const pageSql=pageFirst?`WITH lab_page AS MATERIALIZED (SELECT w.* FROM role_work_items w WHERE ${filters.replace(labSearchSql(true),countPlan.search)} ORDER BY w.occurred_at DESC,w.id DESC LIMIT $10 OFFSET $11)
    ${selectSql.replace('FROM role_work_items w','FROM lab_page w').replace(`WHERE ${filters}`,'')} ORDER BY w.occurred_at DESC,w.id DESC`
    :billing?billingPageSql:`${selectSql} ORDER BY w.occurred_at DESC,w.id DESC LIMIT $10 OFFSET $11`;
  const [count,result]=await Promise.all([pool.query(countSql,args),pool.query(pageSql,[...args,pageSize,(page-1)*pageSize])]);
  res.json({rows:result.rows.map(row=>({...((stage === "Sample Collection") ? sampleCollectionRow(row) : row),report_available:receptionReportAllowed(row.bill_id?{total:row.bill_total,paid:row.bill_paid,due:row.bill_due,status:row.bill_status}:null,row.data?.doctor_approval)})),total:count.rows[0].total,summary:count.rows[0],page,page_size:pageSize});
});

router.get('/lab-recent-appointments',async(req:Authed,res)=>{
 const a=req.portalUser!;if(!labCommercialAccess(a))return void res.status(403).json({error:'Laboratory access required'});
 const branches=await accessibleBranchIds(a);
 const result=await pool.query(`SELECT p.id,p.first_name,p.last_name,upper(concat_ws(' ',p.first_name,p.last_name)) patient_name,p.medical_record_number,p.phone,p.sex,p.date_of_birth,x.id appointment_id,x.appointment_date,x.appointment_time,x.appointment_number,x.doctor_id,concat_ws(' ',u.first_name,u.last_name) doctor_name FROM clinical_appointments x JOIN patients p ON p.id=x.patient_id AND p.tenant_id=x.tenant_id LEFT JOIN users u ON u.id=x.doctor_id AND u.tenant_id=x.tenant_id WHERE x.tenant_id=$1 AND p.deleted_at IS NULL AND x.appointment_type='OPD' AND lower(x.status) NOT IN ('cancelled','no show','no_show') AND ($2::uuid[] IS NULL OR x.branch_id=ANY($2)) ORDER BY x.appointment_date DESC,x.appointment_time DESC,x.created_at DESC LIMIT 100`,[a.tenantId,branches]);
 res.set('Cache-Control','no-store');res.json(result.rows);
});

router.get("/lab-referrals", async (req: Authed, res) => {
  const a = req.portalUser!;
  if (!labCommercialAccess(a)) return void res.status(403).json({error: "Laboratory access required"});
  const branches=await accessibleBranchIds(a);
  const result=await pool.query(labDoctorLookupSql,[a.tenantId,branches]);
  result.rows.sort((left,right)=>left.name.localeCompare(right.name));
  res.json(result.rows);
});

router.get("/lab-registration-options", async (req: Authed, res) => {
  const a=req.portalUser!;
  if (!labCommercialAccess(a)) return void res.status(403).json({error:"Laboratory access required"});
  const branchIds=a.role==="receptionist"?await accessibleBranchIds(a):null;
  const [partners,staff,centers,pharmacies]=await Promise.all([
    pool.query(`SELECT id,name FROM referral_partners WHERE tenant_id=$1 AND status='Active' AND (branch_id=$2 OR branch_id IS NULL OR $2::uuid IS NULL) ORDER BY name`,[a.tenantId,a.branchId||null]),
    pool.query(`SELECT id,concat_ws(' ',first_name,middle_name,last_name) name FROM staff_members WHERE tenant_id=$1 AND status='Active' AND (branch_id=$2 OR $2::uuid IS NULL) ORDER BY first_name,last_name`,[a.tenantId,a.branchId||null]),
    pool.query(`SELECT id,name FROM branches WHERE tenant_id=$1 AND is_active=true AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,[a.tenantId,branchIds]),
    pool.query(`SELECT id,name,address,discount_percentage FROM hospital_refer_pharmacies WHERE tenant_id=$1 ORDER BY name,source_id`,[a.tenantId]),
  ]);
  res.json({partners:partners.rows,staff:staff.rows,centers:centers.rows,pharmacies:pharmacies.rows,current_center_id:centers.rows.find(branch=>branch.id===a.branchId)?.id||centers.rows[0]?.id||null});
});

router.post("/lab-own-orders", async (req: Authed, res) => {
  const body = z.object({
    patient_id: z.string().uuid(),
    appointment_id:z.string().uuid().nullable().optional(),
    test_ids: z.array(z.string().uuid()).min(1),
    referred_by: z.string().uuid().nullable().default(null),
    referral_partner_id: z.string().uuid().nullable().default(null),
    collector_id: z.string().uuid().nullable().default(null),
    refer_pharmacy_id: z.string().uuid().nullable().default(null),
    pharmacy_discount_percentage: z.number().finite().min(0).max(100).optional(),
    center_id: z.string().uuid().nullable().default(null),
    source: z.string().trim().max(100).default("Self"),
    urgent: z.boolean().default(false),
    payment_mode: z.enum(["Cash", "Card", "UPI", "Bank Transfer", "Insurance"]).default("Cash"),
    paid: z.number().finite().min(0).default(0),
    discount: z.number().finite().min(0).default(0),
  }).parse(req.body);
  const a = req.portalUser!, activeWorkspace = workspace(a);
  if (!labCommercialAccess(a))
    return void res.status(403).json({ error: "Laboratory access required" });
  if(a.role==="receptionist"){
    const branchIds=await accessibleBranchIds(a);
    if(branchIds!==null&&!branchIds.includes(body.center_id||a.branchId))return void res.status(403).json({error:"Select one of your assigned reception branches"});
  }
  const uniqueIds = [...new Set(body.test_ids)];
  const found = await pool.query(
    `SELECT id,name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='test' AND id=ANY($2::uuid[])`,
    [a.tenantId, uniqueIds],
  );
  if (found.rowCount !== uniqueIds.length)
    return void res.status(400).json({ error: "One or more selected pathology tests are invalid" });
  const byId = new Map(found.rows.map((test) => [test.id, test]));
  const tests = uniqueIds.map((id) => {
    const test = byId.get(id)!;
    return { test_id: test.id, name: test.name, test_type: test.data?.test_type || "Pathology", priority: body.urgent ? "Urgent" : "Routine", instruction: "", amount: laboratoryPrice(test.data,body.center_id||a.branchId) };
  });
  const patient=await pool.query(`SELECT id,concat_ws(' ',first_name,last_name) patient_name,medical_record_number,phone,date_of_birth,sex FROM patients WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,[body.patient_id,a.tenantId]);
  if(!patient.rows[0])return void res.status(400).json({error:"Selected patient is unavailable"});
  if(body.appointment_id){
    const branches=await accessibleBranchIds(a);
    const appointment=await pool.query(`SELECT id FROM clinical_appointments WHERE id=$1 AND tenant_id=$2 AND patient_id=$3 AND ($4::uuid[] IS NULL OR branch_id=ANY($4)) AND appointment_type='OPD' AND lower(status) NOT IN ('cancelled','no show','no_show')`,[body.appointment_id,a.tenantId,body.patient_id,branches]);
    if(!appointment.rows[0])return void res.status(400).json({error:'The selected OPD appointment is unavailable for this patient or branch.'});
  }
  const selectedPatient=patient.rows[0],data={appointment_id:body.appointment_id||undefined,patient_type:"OPD",customer_name:selectedPatient.patient_name,phone:selectedPatient.phone,gender:selectedPatient.sex,medical_record_number:selectedPatient.medical_record_number,tests,diagnosis:"",investigation:"",source:"Direct Laboratory"};
  let executive="Self",collector="",center="";
  if(body.referral_partner_id) {
    const partner=await pool.query(`SELECT name FROM referral_partners WHERE id=$1 AND tenant_id=$2 AND status='Active' AND (branch_id=$3 OR branch_id IS NULL OR $3::uuid IS NULL)`,[body.referral_partner_id,a.tenantId,a.branchId||null]);
    if(!partner.rows[0]) return void res.status(400).json({error:"Selected referral partner is unavailable"});
    executive=partner.rows[0].name;
  }
  if(body.collector_id) {
    const staff=await pool.query(`SELECT concat_ws(' ',first_name,middle_name,last_name) name FROM staff_members WHERE id=$1 AND tenant_id=$2 AND status='Active' AND (branch_id=$3 OR $3::uuid IS NULL)`,[body.collector_id,a.tenantId,a.branchId||null]);
    if(!staff.rows[0]) return void res.status(400).json({error:"Selected collection staff is unavailable"});
    collector=staff.rows[0].name;
  }
  if(body.center_id) {
    const branch=await pool.query(`SELECT name FROM branches WHERE id=$1 AND tenant_id=$2 AND is_active=true`,[body.center_id,a.tenantId]);
    if(!branch.rows[0]) return void res.status(400).json({error:"Selected center is unavailable"});
    center=branch.rows[0].name;
  }
  let referredBy = "Self";
  if (body.referred_by) {
    const branches=await accessibleBranchIds(a);
    const doctor=await pool.query(`SELECT name FROM (${labDoctorLookupSql}) referring WHERE id=$3`,[a.tenantId,branches,body.referred_by]);
    if (!doctor.rows[0]) return void res.status(400).json({error:"Selected referring doctor is unavailable"});
    referredBy = doctor.rows[0].name;
  }
  let pharmacy:Record<string,any>|undefined;
  if(body.refer_pharmacy_id){
    pharmacy=(await pool.query(`SELECT id,name,address,discount_percentage FROM hospital_refer_pharmacies WHERE id=$1 AND tenant_id=$2`,[body.refer_pharmacy_id,a.tenantId])).rows[0];
    if(!pharmacy)return void res.status(400).json({error:'Selected refer pharmacy is unavailable'});
  }
  let totals: ReturnType<typeof labPharmacyBilling>;
  try { totals = labPharmacyBilling(tests.map(test => test.amount),body.discount,body.paid,pharmacy ? Number(pharmacy.discount_percentage||0) : 0); }
  catch(error) { return void res.status(400).json({error:error instanceof Error ? error.message : "Invalid billing amount"}); }
  const {subtotal,discount,paid,total,due,status} = totals;
  Object.assign(data,{referred_by:referredBy,referred_by_id:body.referred_by,source:body.source,center,center_id:body.center_id,executive,referral_partner_id:body.referral_partner_id,collector,collector_id:body.collector_id,payment_mode:body.payment_mode,discount_amount:discount,paid_amount:paid,due_amount:due,
    refer_pharmacy_id:pharmacy?.id||null,refer_pharmacy_name:pharmacy?.name||'Not Applicable',refer_pharmacy_address:pharmacy?.address||'',
    manual_discount_amount:totals.manual_discount_amount,pharmacy_discount_percentage:totals.pharmacy_discount_percentage,pharmacy_discount_amount:totals.pharmacy_discount_amount});
  const client = await pool.connect();
  try {
  await client.query("BEGIN");
  const result = await client.query(
    `INSERT INTO role_work_items(tenant_id,branch_id,patient_id,created_by,workspace,kind,title,status,priority,data)
     VALUES($1,$2,$3,$4,'laboratory','orders',$5,'Pending','Normal',$6) RETURNING *`,
    [a.tenantId,body.center_id||a.branchId||null,selectedPatient.id,a.sub,`Direct Lab · ${selectedPatient.patient_name}`,data],
  );
  const row=result.rows[0], number=`LAB-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(row.id).slice(0,8).toUpperCase()}`;
  const invoice=await client.query(`INSERT INTO finance_records(tenant_id,kind,record_number,patient_id,branch_id,data,amount,total,paid,due,status,record_date,created_by) VALUES($1,'invoices',$2,$3,$4,$5,$6,$7,$8,$9,$10,current_date,$11) RETURNING *`,[a.tenantId,number,selectedPatient.id,body.center_id||a.branchId||null,{...data,lab_order_id:row.id,source:"Laboratory",initial_payment:{amount:paid,payment_mode:body.payment_mode,at:new Date().toISOString(),balance_after:due}},subtotal,total,paid,due,status,a.sub]);
  if(paid>0)await client.query(`INSERT INTO finance_records(tenant_id,branch_id,patient_id,invoice_id,kind,record_number,data,amount,total,paid,due,status,created_by) VALUES($1,$2,$3,$4,'payments',$5,$6,$7,$7,$7,0,'Paid',$8)`,[a.tenantId,body.center_id||a.branchId,selectedPatient.id,invoice.rows[0].id,`LAB-PAY-${randomUUID()}`,{source:"Laboratory",lab_order_id:row.id,payment_mode:body.payment_mode,previous_paid:0,invoice_total:total,paid_to_date:paid,balance_after:due},paid,a.sub]);
  await client.query(`UPDATE role_work_items SET kind='pos',status=$1,data=data||$2::jsonb WHERE id=$3`,[status==="Unpaid"?"Awaiting Payment":status,JSON.stringify({bill_id:invoice.rows[0].id,bill_number:number}),row.id]);
  await client.query("COMMIT");
  res.status(201).json({...row,bill:{...invoice.rows[0],tests,patient_name:selectedPatient.patient_name,medical_record_number:selectedPatient.medical_record_number}});
  } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
});

router.patch("/work-items/:id/lab-order", async (req: Authed, res) => {
  if(!labCommercialAccess(req.portalUser!))return void res.status(403).json({error:"Laboratory access required"});
  await editLabOrder(req,res);
});

router.patch("/work-items/:id/lab-action", async (req: Authed, res) => {
  const body = z
      .object({ action: z.enum(["cancel", "send_bill", "send_sample"]) })
      .parse(req.body),
    a = req.portalUser!,
    activeWorkspace = workspace(a);
  if (!["laboratory", "all"].includes(activeWorkspace))
    return void res.status(403).json({ error: "Laboratory access required" });
  const client=await pool.connect();
  try{await client.query("BEGIN");const found=await client.query(`SELECT * FROM role_work_items WHERE id=$1 AND tenant_id=$2 AND workspace='laboratory' FOR UPDATE`,[req.params.id,a.tenantId]),row=found.rows[0];
    if(!row){await client.query("ROLLBACK");return void res.status(404).json({error:"Laboratory order not found"})}
    if(row.status==='Cancelled'||row.data?.cancellation_request_id){await client.query('ROLLBACK');return void res.status(409).json({error:'This order has been cancelled and cannot be sent for billing or sample collection.'});}
    if(row.data?.import_source){await client.query("ROLLBACK");return void res.status(409).json({error:"Imported orders retain their historical billing and status. Reconcile source records before changing them."});}
    if(body.action==="cancel"){
      if(row.kind!=="orders"||row.status!=="Pending"){await client.query("ROLLBACK");return void res.status(409).json({error:"Only pending lab orders can be cancelled"})}
      const cancelled=await client.query(`UPDATE role_work_items SET status='Cancelled',data=data||jsonb_build_object('lab_action','cancel','lab_action_at',now(),'lab_action_by',$1::text),updated_at=now() WHERE id=$2 RETURNING *`,[a.sub,row.id]);await client.query("COMMIT");return void res.json(cancelled.rows[0]);
    }
    if(body.action==="send_bill"){
      if(row.kind!=="orders"||row.status!=="Pending"){await client.query("ROLLBACK");return void res.status(409).json({error:"Only pending lab orders can be sent to billing"})}
      const tests=Array.isArray(row.data?.tests)?row.data.tests:[],total=tests.reduce((sum:number,test:Record<string,unknown>)=>sum+Number(test.amount||0),0),number=`LAB-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${String(row.id).slice(0,8).toUpperCase()}`;
      const inserted=await client.query(`INSERT INTO finance_records(tenant_id,kind,record_number,patient_id,branch_id,data,amount,total,paid,due,status,record_date,created_by) VALUES($1,'invoices',$2,$3,$4,$5,$6,$6,0,$6,'Unpaid',current_date,$7) ON CONFLICT(tenant_id,record_number) DO UPDATE SET updated_at=now() RETURNING id,record_number,total,due,status`,[a.tenantId,number,row.patient_id,row.branch_id,{lab_order_id:row.id,source:"Laboratory",tests},total,a.sub]),bill=inserted.rows[0];
      const billed=await client.query(`UPDATE role_work_items SET kind='pos',status='Awaiting Payment',data=data||$1::jsonb,updated_at=now() WHERE id=$2 RETURNING *`,[JSON.stringify({lab_action:"send_bill",lab_action_at:new Date().toISOString(),lab_action_by:a.sub,bill_id:bill.id,bill_number:bill.record_number,billed_at:new Date().toISOString()}),row.id]);await client.query("COMMIT");return void res.json({...billed.rows[0],bill});
    }
    if(row.kind!=="pos"||!row.data?.bill_id){await client.query("ROLLBACK");return void res.status(409).json({error:"Generate the laboratory bill before sample collection"})}
    const sample=await client.query(`UPDATE role_work_items SET kind='sample collection',status='Awaiting Sample',data=data||jsonb_build_object('lab_action','send_sample','sample_requested_at',now(),'sample_requested_by',$1::text),updated_at=now() WHERE id=$2 RETURNING *`,[a.sub,row.id]);await client.query("COMMIT");res.json(sample.rows[0]);
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
});

router.patch("/work-items/:id/radiology-action", (_req,res)=>{res.status(410).json({error:"Use the Laboratory order workflow for pathology and radiology."});});

router.patch("/work-items/:id/sample-action", async (req: Authed, res) => {
  const body = z.object({
    action: z.enum(["generate_barcodes", "collected"]),
    collector: z.string().trim().min(2).max(120).optional(),
  }).parse(req.body);
  const a = req.portalUser!, activeWorkspace = workspace(a);
  if (!["laboratory", "all"].includes(activeWorkspace))
    return void res.status(403).json({ error: "Laboratory access required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT * FROM role_work_items WHERE id=$1 AND tenant_id=$2 AND workspace='laboratory' FOR UPDATE`,
      [req.params.id, a.tenantId],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return void res.status(404).json({ error: "Sample order not found" });
    }

    if (body.action === "generate_barcodes") {
      if (!awaitingLabSample(row)) {
        await client.query("ROLLBACK");
        return void res.status(409).json({ error: "Barcodes can only be generated for samples awaiting collection" });
      }
      if (!body.collector) {
        await client.query("ROLLBACK");
        return void res.status(400).json({ error: "Please enter who is collecting the sample" });
      }
      const tests = Array.isArray(row.data?.tests) ? row.data.tests : [];
      if (!tests.length) {
        await client.query("ROLLBACK");
        return void res.status(409).json({ error: "This order has no tests" });
      }
      const stamp = Date.now().toString(36).toUpperCase();
      const barcodes = tests.map((test: Record<string, unknown>, index: number) => ({
        test_id: test.test_id || null,
        test_name: String(test.name || `Test ${index + 1}`),
        value: `LAB-${String(row.id).slice(0, 8).toUpperCase()}-${stamp}-${String(index + 1).padStart(2, "0")}`,
      }));
      const updated = await client.query(
        `UPDATE role_work_items SET kind='sample collection',status='Barcode Generated',data=data||$1::jsonb,updated_at=now() WHERE id=$2 RETURNING *`,
        [JSON.stringify({ barcodes, collector: body.collector, barcode_generated_at: new Date().toISOString(), barcode_generated_by: a.sub }), row.id],
      );
      await client.query("COMMIT");
      return void res.json(updated.rows[0]);
    }

    if (row.kind !== "sample collection" || row.status !== "Barcode Generated" || !Array.isArray(row.data?.barcodes)) {
      await client.query("ROLLBACK");
      return void res.status(409).json({ error: "Generate the test barcodes before marking the sample collected" });
    }
    const updated = await client.query(
      `UPDATE role_work_items SET kind='results',status='Sample Collected',data=data||$1::jsonb,updated_at=now() WHERE id=$2 RETURNING *`,
      [JSON.stringify({ collected_at: new Date().toISOString(), collected_by: a.sub }), row.id],
    );
    await client.query("COMMIT");
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/work-items/:id/lab-bill", async (req: Authed, res) => {
  const a = req.portalUser!, activeWorkspace = workspace(a);
  if (!labCommercialAccess(a))
    return void res.status(403).json({ error: "Laboratory access required" });
  const result = await pool.query(
    `SELECT f.*,coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),w.data->>'customer_name') patient_name,coalesce(p.medical_record_number,w.data->>'medical_record_number') medical_record_number,
       coalesce(p.phone,w.data->>'phone') patient_phone,p.date_of_birth patient_date_of_birth,coalesce(p.address,w.data->'patient_address',w.data->'address') patient_address,
       w.title order_title,w.data accounting_lab_data,coalesce(f.data->'tests',w.data->'tests') tests,w.data->>'collector' collector,w.data->>'collected_at' collected_at,
       w.data->'legacy_payments' legacy_payments,coalesce(t.header_image,'') pathology_header_image,coalesce(t.footer_content,'') pathology_footer_content
     FROM role_work_items w
     JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id
     LEFT JOIN patients p ON p.id=w.patient_id
     LEFT JOIN hospital_print_templates t ON t.tenant_id=w.tenant_id AND t.document_type='pathology'
     WHERE w.id=$1 AND w.tenant_id=$2 AND w.workspace='laboratory' AND ($3::uuid IS NULL OR w.branch_id=$3)`,
    [req.params.id, a.tenantId,a.role==="receptionist"?a.branchId:null],
  );
  if (!result.rows[0]) return void res.status(404).json({ error: "Laboratory bill not found" });
  const bill=result.rows[0],payments=await pool.query("SELECT id,record_number,record_date,created_at,amount,data FROM finance_records WHERE tenant_id=$1 AND invoice_id=$2 AND kind='payments' ORDER BY created_at,id",[a.tenantId,bill.id]);
  res.json((await withPrintDoctorDetails([{...bill,payments:labPaymentHistory(payments.rows,bill.legacy_payments||[],bill)}],a.tenantId))[0]);
});

router.patch("/work-items/:id/lab-bill", async (req: Authed, res) => {
  const body = z.object({
    payment_mode: z.enum(["Cash", "Card", "UPI", "Bank Transfer", "Insurance"]),
    paid: z.coerce.number().min(0).optional(),
    payment_amount:z.coerce.number().finite().min(0.01).multipleOf(0.01).optional(),
    payment_request_id:z.string().uuid().optional(),
    discount: z.coerce.number().min(0),
  }).parse(req.body);
  const a = req.portalUser!, activeWorkspace = workspace(a);
  if (!labCommercialAccess(a))
    return void res.status(403).json({ error: "Laboratory access required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT w.id work_id,w.branch_id work_branch_id,f.* FROM role_work_items w JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id
       WHERE w.id=$1 AND w.tenant_id=$2 AND w.workspace='laboratory' FOR UPDATE OF w,f`,
      [req.params.id, a.tenantId],
    );
    const bill = found.rows[0];
    if (!bill) {
      await client.query("ROLLBACK");
      return void res.status(404).json({ error: "Laboratory bill not found" });
    }
    if(a.role==="receptionist"&&bill.work_branch_id!==a.branchId){await client.query("ROLLBACK");return void res.status(403).json({error:"This order belongs to another branch"});}
    const incremental=body.payment_amount!==undefined;
    if(['Cancelled','Refunded'].includes(bill.status)){await client.query('ROLLBACK');return void res.status(409).json({error:'This bill is cancelled. Use the approved refund workflow.'});}
    if(a.role==="receptionist"&&(!incremental||!body.payment_request_id)){await client.query("ROLLBACK");return void res.status(400).json({error:"Enter the amount to collect now with a payment request ID"});}
    if(incremental&&body.payment_request_id){const prior=await client.query(`SELECT amount FROM finance_records WHERE tenant_id=$1 AND invoice_id=$2 AND kind='payments' AND data->>'request_id'=$3`,[a.tenantId,bill.id,body.payment_request_id]);if(prior.rows[0]){if(Number(prior.rows[0].amount)!==body.payment_amount){await client.query("ROLLBACK");return void res.status(409).json({error:"This payment request was already used. Refresh the bill before another payment."});}await client.query("COMMIT");return void res.json(bill);}}
    if(incremental&&body.discount!==Number(bill.data?.discount_amount||0)){await client.query("ROLLBACK");return void res.status(400).json({error:"Payment collection cannot change the original discount"});}
    if(bill.data?.refer_pharmacy_id&&body.discount!==Number(bill.data?.discount_amount||0)){await client.query('ROLLBACK');return void res.status(400).json({error:'Change discounts through Edit Order so the pharmacy percentage is recalculated.'});}
    if(bill.data?.read_only&&!incremental){await client.query("ROLLBACK");return void res.status(409).json({error:"Imported financial history is read only. Reconcile original payment records before changing this bill."});}
    if(incremental){try{body.paid=labCollectionTotals(Number(bill.total),0,Number(bill.paid),body.payment_amount!).paid;}catch(error){await client.query("ROLLBACK");return void res.status(400).json({error:error instanceof Error?error.message:"Invalid payment"});}}
    if(body.paid===undefined){await client.query("ROLLBACK");return void res.status(400).json({error:"Enter a paid amount"});}
    const subtotal = Number(bill.amount);
    if (body.discount > subtotal) {
      await client.query("ROLLBACK");
      return void res.status(400).json({ error: "Discount cannot be greater than the bill subtotal" });
    }
    const total = incremental?Number(bill.total):Math.max(subtotal - body.discount, 0);
    if (body.paid > total) {
      await client.query("ROLLBACK");
      return void res.status(400).json({ error: "Paid amount cannot be greater than the bill total" });
    }
    const due = Math.max(total - body.paid, 0);
    const status = due === 0 ? "Paid" : body.paid > 0 ? "Partially Paid" : "Unpaid";
    const collected=Number(body.paid)-Number(bill.paid);
    if(collected>0){await client.query(`INSERT INTO finance_records(tenant_id,branch_id,patient_id,invoice_id,kind,record_number,data,amount,total,paid,due,status,created_by) VALUES($1,$2,$3,$4,'payments',$5,$6,$7,$7,$7,0,'Paid',$8)`,[a.tenantId,bill.branch_id,bill.patient_id,bill.id,`LAB-PAY-${randomUUID()}`,{source:"Laboratory",lab_order_id:bill.work_id,payment_mode:body.payment_mode,previous_paid:Number(bill.paid),request_id:body.payment_request_id,invoice_total:total,paid_to_date:body.paid,balance_after:due},collected,a.sub]);}
    const updated = await client.query(
      `UPDATE finance_records SET total=$1,paid=$2,due=$3,status=$4,data=data||jsonb_build_object('payment_mode',$5::text,'discount_amount',$6::numeric,'payment_updated_by',$7::text,'payment_updated_at',now()),updated_at=now()
       WHERE id=$8 RETURNING *`,
      [total, body.paid, due, status, body.payment_mode, body.discount, a.sub, bill.id],
    );
    const workStatus = status === "Unpaid" ? "Awaiting Payment" : status;
    await client.query(
      `UPDATE role_work_items SET status=CASE WHEN kind='pos' THEN $1 ELSE status END,data=data||jsonb_build_object('payment_mode',$2::text,'discount_amount',$3::numeric,'paid_amount',$4::numeric,'due_amount',$5::numeric),updated_at=now() WHERE id=$6`,
      [workStatus, body.payment_mode, body.discount, body.paid, due, req.params.id],
    );
    await client.query("COMMIT");
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

async function laboratoryResultRecord(id: string, tenantId: string) {
  const found = await pool.query(
    `SELECT w.*,${reportPrintRevisionSql} report_revision,coalesce(nullif(trim(concat(p.first_name,' ',p.last_name)),''),w.data->>'customer_name') patient_name,
       coalesce(p.medical_record_number,w.data->>'medical_record_number') medical_record_number,
       coalesce(initcap(p.sex),w.data->>'gender','—') patient_gender,p.date_of_birth patient_date_of_birth,p.address patient_address,
       coalesce(p.phone,w.data->>'phone','—') patient_phone,h.name hospital_name,h.logo_url hospital_logo,b.name branch_name,
       h.hospital_type,h.establishment_date,h.website,h.email hospital_email,h.phone hospital_phone,
       h.address_line hospital_address,h.city hospital_city,h.state hospital_state,h.pin_code hospital_pin_code,
       coalesce(t.header_image,'') pathology_header_image,coalesce(t.footer_content,'') pathology_footer_content
     FROM role_work_items w LEFT JOIN patients p ON p.id=w.patient_id
     LEFT JOIN hospitals h ON h.id=w.tenant_id LEFT JOIN branches b ON b.id=w.branch_id
     LEFT JOIN hospital_print_templates t ON t.tenant_id=w.tenant_id AND t.document_type='pathology'
     WHERE w.id=$1 AND w.tenant_id=$2 AND w.workspace='laboratory' AND w.data ? 'collected_at'`,
    [id, tenantId],
  );
  const row = found.rows[0];
  if (!row) return null;
  const orderedTests: Array<Record<string, unknown>> = Array.isArray(row.data?.tests) ? row.data.tests : [];
  const testIds = orderedTests.map((test) => String(test.test_id || "")).filter(Boolean);
  const masters = testIds.length ? (await pool.query(
    `SELECT id,name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='test' AND id=ANY($2::uuid[])`,
    [tenantId, testIds],
  )).rows : [];
  const masterById = new Map(masters.map((master) => [String(master.id), master]));
  const parameterIds = [...new Set([...masters.flatMap((master) => Array.isArray(master.data?.parameter_ids) ? master.data.parameter_ids.map(String) : []),...(row.data?.lab_results||[]).flatMap((test:Record<string,any>)=>(test.parameters||[]).map((parameter:Record<string,any>)=>parameter.parameter_id).filter(Boolean))])];
  const [parameterRows,specimenRows]=await Promise.all([parameterIds.length ? pool.query(
    `SELECT p.id,p.name,p.data,u.name unit_name,s.name specimen_name FROM hospital_diagnostic_masters p
     LEFT JOIN hospital_diagnostic_masters u ON u.id=nullif(p.data->>'unit_id','')::uuid AND u.tenant_id=p.tenant_id
     LEFT JOIN hospital_diagnostic_masters s ON s.id=nullif(p.data->>'specimen_id','')::uuid AND s.tenant_id=p.tenant_id
     WHERE p.tenant_id=$1 AND p.domain='pathology' AND p.kind='parameter' AND p.id=ANY($2::uuid[])`,
    [tenantId, parameterIds],
  ) : Promise.resolve({rows:[]}),pool.query("SELECT id,name FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='specimen'",[tenantId])]);
  const parameters=parameterRows.rows;
  const specimenById=new Map(specimenRows.rows.map((specimen:any)=>[String(specimen.id),specimen.name]));
  const parameterById = new Map(parameters.map((parameter) => [String(parameter.id), parameter]));
  const savedTests: Array<Record<string, any>> = Array.isArray(row.data?.lab_results) ? row.data.lab_results : [];
  const tests = orderedTests.map((ordered) => {
    const testId = String(ordered.test_id || ""), master = masterById.get(testId);
    const saved = savedTests.find((item) => String(item.test_id || "") === testId);
    const ids: string[] = Array.isArray(master?.data?.parameter_ids) ? master.data.parameter_ids.map(String) : [];
    const birth=row.patient_date_of_birth?new Date(row.patient_date_of_birth):null,collection=new Date(row.data?.collected_at||row.occurred_at);
    const ageDays=patientAgeDays(row.patient_address,collection)??(birth&&!Number.isNaN(birth.getTime())?Math.floor((collection.getTime()-birth.getTime())/86400000):null);
    const resultParameters: Array<Record<string, any>> = row.data?.import_source && saved?.parameters?.length ? saved.parameters.map((prior:Record<string,any>)=>{
      const parameter=parameterById.get(String(prior.parameter_id));
      const metadata={method:parameter?.data?.method||"",specimen:parameter?.specimen_name||"",result_type_id:parameter?.data?.result_type_id||"3",choices:parameter?.data?.choices||[],formula:parameter?.data?.formula||"",legacy_id:parameter?.data?.legacy_id,decimals:parameter?.data?.decimals};
      if(prior.reference_text||prior.reference_from||prior.reference_to)return {...metadata,...prior};
      return {...metadata,...prior,...laboratoryReference(parameter?.data?.normal_ranges||[],row.patient_gender||"",ageDays,String(prior.legacy?.range_id||"0"))};
    }) : ids.map((parameterId) => {
      const parameter = parameterById.get(parameterId), prior = saved?.parameters?.find((item: Record<string, unknown>) => String(item.parameter_id || "") === parameterId);
      const reference=laboratoryReference(parameter?.data?.normal_ranges||[],row.patient_gender||"",ageDays);
      return { parameter_id: parameterId, name: parameter?.name || "Parameter", ...reference, reference_from:reference.reference_from||parameter?.data?.reference_from||"",reference_to:reference.reference_to||parameter?.data?.reference_to||"", unit: parameter?.unit_name || "", description: parameter?.data?.description || "", result_type_id:parameter?.data?.result_type_id||"3", choices:parameter?.data?.choices||[], formula:parameter?.data?.formula||"", legacy_id:parameter?.data?.legacy_id, decimals:parameter?.data?.decimals, value: prior?.value || "", remarks: prior?.remarks || "" };
    });
    if (!resultParameters.length) resultParameters.push({ parameter_id: null as string | null, name: ordered.test_type === "Radiology" || master?.data?.test_type === "Radiology" ? "Findings / Impression" : "Overall Result", result_type_id: ordered.test_type === "Radiology" || master?.data?.test_type === "Radiology" ? "27" : "3", reference_from: "", reference_to: "", unit: "", description: "", value: saved?.parameters?.[0]?.value || "", remarks: saved?.parameters?.[0]?.remarks || "" });
    for(const parameter of resultParameters){const masterParameter=parameterById.get(String(parameter.parameter_id));parameter.method ||=masterParameter?.data?.method||"";parameter.specimen ||=masterParameter?.specimen_name||"";}
    const specimenIds=Array.isArray(master?.data?.specimen_ids)?master.data.specimen_ids:master?.data?.specimen_id?[master.data.specimen_id]:[];
    const specimenNames=specimenIds.map((id:unknown)=>specimenById.get(String(id))).filter(Boolean);
    return { test_id: testId || null, name: ordered.name || master?.name || "Pathology Test",specimen_names:specimenNames, parameters: resultParameters,notes:master?.data?.notes||"",summaries:master?.data?.summaries||[] };
  });
  const entryIds=[...new Set([row.data?.result_completed_by,...Object.values(row.data?.result_entry?.tests||{}).map((entry:any)=>entry.by),...(row.data?.result_history||[]).map((entry:any)=>entry.by)].filter((id:any)=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];
  const [staff,legacyApprovers,bill,prints,entryUsers]=await Promise.all([pool.query(`SELECT id,user_id,first_name,middle_name,last_name,designation,professional,staff_type FROM staff_members WHERE tenant_id=$1 AND (staff_type IN ('Pathologist','Radiologist') OR user_id=$2::uuid) ORDER BY created_at`,[tenantId,row.data?.doctor_approval?.by||null]),pool.query(`SELECT name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='approver'`,[tenantId]),pool.query(`SELECT record_number,amount,total,paid,due,status,data FROM finance_records WHERE id=nullif($1,'')::uuid AND tenant_id=$2`,[row.data?.bill_id||"",tenantId]),reportPrintEvents(row.id,tenantId,row.report_revision),pool.query("SELECT id,trim(concat_ws(' ',first_name,last_name)) name FROM users WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[tenantId,entryIds])]);
  const qualifiedRow=(await withPrintDoctorDetails([row],tenantId))[0];
  return { ...qualifiedRow, data:{...row.data,result_entry_names:Object.fromEntries(entryUsers.rows.map((entry:any)=>[entry.id,entry.name]))},tests:normalizeLabResultFormats(tests),report_prints:prints,report_bill:bill.rows[0]||null,bill_number:bill.rows[0]?.record_number||row.data?.legacy_opd_id||"",report_signatories:reportSignatories(row.data?.doctor_approval||null,staff.rows,legacyApprovers.rows) };
}

router.post("/work-items/:id/lab-report-share",async(req:Authed,res)=>{
  const a=req.portalUser!;if(!labCommercialAccess(a))return void res.status(403).json({error:"Laboratory access required"});
  const body=z.object({pdf:z.string().max(16_000_000),filename:z.string().max(120).default("Lab-Report.pdf"),updated_at:z.string()}).parse(req.body);
  let bytes:Buffer;try{bytes=decodeReportPdf(body.pdf);}catch(error){return void res.status(400).json({error:error instanceof Error?error.message:"Invalid report PDF"});}
  await ensureReportShares();const client=await pool.connect();
  try{await client.query("BEGIN");const found=await client.query(`SELECT w.*,f.total,f.paid,f.due,f.status bill_status,md5(jsonb_build_object('results',w.data->'lab_results','approval',w.data->'doctor_approval','technician',w.data->'technician_approval')::text) revision FROM role_work_items w LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND w.workspace='laboratory' AND ($3::uuid IS NULL OR w.branch_id=$3) FOR UPDATE OF w`,[req.params.id,a.tenantId,a.role==="receptionist"?a.branchId:null]);
    const row=found.rows[0];if(!row||!["Completed","Partially Completed"].includes(row.data?.result_status)||!row.data?.doctor_approval)throw new Error("Only completed, doctor-approved reports can be shared");
    if(!savedPrintableKeys(row.data).length)throw new Error("Both technician and doctor verification are required before sharing");
    if(new Date(row.updated_at).getTime()!==new Date(body.updated_at).getTime())throw new Error("Report changed. Reopen the report before sharing.");
    if(a.role==="receptionist"&&!receptionReportAllowed({...row,status:row.bill_status},row.data.doctor_approval))throw new Error("Full payment and doctor approval are required before sharing");
    await client.query("DELETE FROM lab_report_shares WHERE expires_at<=now() OR (tenant_id=$1 AND order_id=$2 AND revision<>$3)",[a.tenantId,row.id,row.revision]);
    const token=newReportShareToken(),filename=body.filename.replace(/[^a-z0-9_.-]/gi,"-");
    const saved=await client.query(`INSERT INTO lab_report_shares(tenant_id,order_id,token_hash,pdf,filename,revision,require_payment,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING expires_at`,[a.tenantId,row.id,shareTokenHash(token),bytes,filename,row.revision,a.role==="receptionist",a.sub]);
    await client.query("COMMIT");res.status(201).json({path:`/api/v1/lab-report-shares/${token}`,expires_at:saved.rows[0].expires_at});
  }catch(error){await client.query("ROLLBACK");res.status(409).json({error:error instanceof Error?error.message:"Unable to share report"});}finally{client.release();}
});

router.post("/work-items/:id/lab-report-print",async(req:Authed,res)=>{if(!labCommercialAccess(req.portalUser!))return void res.status(403).json({error:"Laboratory access required"});await confirmReportPrint(req,res);});

router.get("/work-items/:id/lab-results", async (req: Authed, res) => {
  const a = req.portalUser!, activeWorkspace = workspace(a);
  if (!labCommercialAccess(a)) return void res.status(403).json({ error: "Laboratory access required" });
  if(a.role==="receptionist"){const found=await pool.query(`SELECT w.data->'doctor_approval' doctor_approval,f.total,f.paid,f.due,f.status FROM role_work_items w LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND w.branch_id=$3 AND w.workspace='laboratory'`,[req.params.id,a.tenantId,a.branchId]);if(!receptionReportAllowed(found.rows[0]||null,found.rows[0]?.doctor_approval))return void res.status(403).json({error:"Report available only after full payment and doctor approval"});}
  const record = await laboratoryResultRecord(String(req.params.id), a.tenantId);
  if (!record) return void res.status(404).json({ error: "Collected laboratory order not found" });
  if (req.query.mode !== 'entry' && record.data?.result_status === "Completed" && !record.data?.report_narrative && !record.data?.import_source) {
    const narrative=await createLabNarrative(labResultProgress(record.tests).completed,{gender:record.patient_gender||record.data?.gender||"",age:record.data?.age||""});
    record.data={...record.data,report_narrative:narrative};
    await pool.query(`UPDATE role_work_items SET data=data||jsonb_build_object('report_narrative',$1::jsonb),updated_at=updated_at WHERE id=$2 AND tenant_id=$3`,[JSON.stringify(narrative),record.id,a.tenantId]);
  }
  res.json(record);
});

type LabNarrative = { overview: string; findings: Array<{ test_name: string; purpose: string; summary: string; attention: string }>; follow_up: string[] };
function fallbackLabNarrative(tests: Array<Record<string, any>>): LabNarrative {
  const purposeFor=(name:string)=>{const key=name.toLowerCase();if(key.includes("complete blood")||key.includes("cbc"))return"A Complete Blood Count evaluates red blood cells, white blood cells, haemoglobin, haematocrit and platelets. It is commonly used to review oxygen-carrying capacity, immune-cell patterns, anaemia indicators and platelet status.";if(key.includes("lipid")||key.includes("cholesterol"))return"A lipid profile measures cholesterol and triglyceride-related markers. Clinicians use it with age, blood pressure, diabetes, smoking history and other factors when assessing cardiovascular risk.";if(key.includes("liver"))return"A liver function panel measures enzymes, proteins and bilirubin-related markers associated with liver-cell activity, bile processing and the liver's protein-producing function.";if(key.includes("kidney")||key.includes("renal"))return"A kidney function panel assesses filtration and waste-handling markers such as creatinine, urea and related electrolytes. Results are interpreted with hydration, medicines, muscle mass and clinical history.";if(key.includes("thyroid"))return"A thyroid panel measures hormones involved in metabolism, energy regulation, temperature control and many body functions. Interpretation depends on the combination of TSH and thyroid hormone results.";if(key.includes("glucose")||key.includes("sugar")||key.includes("hba1c"))return"Blood glucose testing assesses the amount of glucose in the blood, while HbA1c reflects average glucose exposure over roughly the previous two to three months.";if(key.includes("urine"))return"Urinalysis reviews physical, chemical and microscopic urine findings that may provide information about hydration, urinary health, glucose, protein and other metabolic or kidney-related changes.";return`This investigation measures the listed parameters in the ${name} panel to help a clinician assess body function, screen for changes or monitor an existing clinical concern.`};
  const findings = tests.map((test) => {
    const abnormal = test.parameters.filter((parameter: Record<string, any>) => {
      const value=Number(String(parameter.value).replaceAll(",","")),from=Number(String(parameter.reference_from).replaceAll(",","")),to=Number(String(parameter.reference_to).replaceAll(",",""));
      return Number.isFinite(value)&&((String(parameter.reference_from).trim()&&Number.isFinite(from)&&value<from)||(String(parameter.reference_to).trim()&&Number.isFinite(to)&&value>to));
    });
    const normal=test.parameters.filter((parameter:Record<string,any>)=>!abnormal.includes(parameter));
    const resultSummary=test.parameters.map((parameter:Record<string,any>)=>`${parameter.name}: ${parameter.value}${parameter.unit?` ${parameter.unit}`:""}${parameter.reference_from||parameter.reference_to?` (reference ${parameter.reference_from||"—"}–${parameter.reference_to||"—"})`:""}`).join("; ");
    return { test_name:String(test.name), purpose:purposeFor(String(test.name)), summary:`${test.parameters.length} parameter${test.parameters.length===1?" was":"s were"} reported. ${resultSummary}. ${normal.length} ${normal.length===1?"result is":"results are"} not outside the configured numeric interval.`, attention:abnormal.length?`${abnormal.map((parameter:Record<string,any>)=>`${parameter.name} (${parameter.value}${parameter.unit?` ${parameter.unit}`:""})`).join(", ")} ${abnormal.length===1?"is":"are"} outside the configured reference interval. This flag identifies a value for clinical review; it does not establish a diagnosis by itself.`:"None of the reported numeric values in this panel is outside its configured interval. A within-range result must still be interpreted with symptoms and clinical history." };
  });
  return { overview:`This laboratory report contains ${tests.length} investigation group${tests.length===1?"":"s"}. Results should be interpreted with the patient's symptoms, history, examination and other clinical information.`,findings,follow_up:["Discuss results marked high or low with the treating clinician.","Do not start, stop or change treatment based only on this report.","Seek prompt medical attention for severe or worsening symptoms, irrespective of laboratory flags."] };
}
async function createLabNarrative(tests: Array<Record<string, any>>, patientContext: Record<string, unknown>): Promise<LabNarrative> {
  const fallback=fallbackLabNarrative(tests); if(!config.GROQ_API_KEY)return fallback;
  try {
    const verified={patient_context:patientContext,tests:tests.map(test=>({name:test.name,parameters:test.parameters.map((parameter:Record<string,any>)=>({name:parameter.name,value:parameter.value,unit:parameter.unit,reference_from:parameter.reference_from,reference_to:parameter.reference_to,description:parameter.description,remarks:parameter.remarks}))}))};
    const system=`You write patient-friendly laboratory report explanations. Return ONLY JSON with overview, findings, follow_up. findings must be an array with exactly one item per supplied test, each containing test_name, purpose, summary, attention. follow_up is an array of 2-4 short strings. Explain why each test is commonly performed, what it broadly assesses, and which supplied values are outside their supplied intervals. Use only VERIFIED_REPORT. Never diagnose, predict disease, invent symptoms, claim a treatment is needed, recommend medication, or change/omit values. State that normal results do not exclude illness and abnormal results need clinical correlation. Use clear professional English. VERIFIED_REPORT=${JSON.stringify(verified)}`;
    const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${config.GROQ_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:config.GROQ_MODEL,temperature:.1,max_completion_tokens:1800,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:"Create the detailed report explanation."}]}),signal:AbortSignal.timeout(30_000)});
    if(!response.ok)return fallback;const payload=await response.json() as {choices?:Array<{message?:{content?:string}}>};
    const schema=z.object({overview:z.string().min(20).max(2500),findings:z.array(z.object({test_name:z.string().min(1).max(300),purpose:z.string().min(10).max(1800),summary:z.string().min(10).max(1800),attention:z.string().min(5).max(1800)})).min(1).max(100),follow_up:z.array(z.string().min(5).max(700)).min(1).max(6)});
    const parsed=schema.safeParse(JSON.parse(payload.choices?.[0]?.message?.content||"{}"));return parsed.success?parsed.data:fallback;
  } catch { return fallback; }
}

router.patch("/work-items/:id/lab-results", async (req: Authed, res) => {
  const body = z.object({ updated_at:z.string().datetime().optional(), results: z.array(z.object({ test_id: z.string().uuid().nullable(), parameters: z.array(z.object({ parameter_id: z.string().uuid().nullable().optional(), value: z.string().trim().max(20000), remarks: z.string().trim().max(1000).default("") })) })) }).parse(req.body);
  const a = req.portalUser!, activeWorkspace = workspace(a);
  if (!["laboratory", "all"].includes(activeWorkspace)) return void res.status(403).json({ error: "Laboratory access required" });
  const record = await laboratoryResultRecord(String(req.params.id), a.tenantId);
  if (!record) return void res.status(404).json({ error: "Collected laboratory order not found" });
  if(record.data?.processing_status === "Rejected") return void res.status(409).json({error:"Rejected samples cannot receive results"});
  if(body.updated_at && Date.parse(body.updated_at)!==new Date(record.updated_at).getTime())return void res.status(409).json({error:"Results changed since you opened this page. Reopen results before editing."});
  let labResults:Record<string,any>[];
  try {labResults=prepareLabResults(record.tests,body.results,record.data);}catch(error){return void res.status(400).json({error:error instanceof Error?error.message:"Invalid result"});}
  const entryActor=await pool.query("SELECT id,trim(concat_ws(' ',first_name,last_name)) name FROM users WHERE tenant_id=$1 AND id=$2",[a.tenantId,a.sub]);
  const resultEntry=attributeLabResults(record.data,record.tests,labResults,body.results,{by:a.sub,name:entryActor.rows[0]?.name||'',at:new Date().toISOString()});
  const progress=labResultProgress(labResults);
  const reportNarrative=progress.completed.length?await createLabNarrative(progress.completed,{gender:record.patient_gender||record.data?.gender||"",age:record.data?.age||""}):null;
  const updated = await pool.query(
    `UPDATE role_work_items SET data=data||jsonb_build_object('result_history',coalesce(data->'result_history','[]'::jsonb)||jsonb_build_array(jsonb_build_object('results',data->'lab_results','technician_approval',data->'technician_approval','at',now(),'by',$4::text,'changes',$6::jsonb)))||$1::jsonb,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND date_trunc('milliseconds',updated_at)=date_trunc('milliseconds',$5::timestamptz) AND coalesce(data->>'processing_status','')<>'Rejected' RETURNING *`,
    [JSON.stringify({ lab_results: labResults, result_entry:resultEntry, report_narrative:reportNarrative, result_status: progress.status, completed_test_ids:progress.completed.map(test=>test.test_id), technician_approval:record.data?.technician_approval||null, result_completed_at:progress.completed.length?new Date().toISOString():null, result_completed_by:a.sub }), req.params.id, a.tenantId, a.sub, record.updated_at, JSON.stringify(labResultChanges(record.tests,labResults))],
  );
  if(!updated.rowCount) return void res.status(409).json({error:"The result changed during editing. Refresh and try again."});
  res.json(updated.rows[0]);
});

router.patch("/work-items/:id", async (req: Authed, res) => {
  const body = z
      .object({
        status: z.string().min(1),
        data: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body),
    a = req.portalUser!,
    activeWorkspace = workspace(a);
  const existing = await pool.query(`SELECT workspace,kind FROM role_work_items WHERE id=$1 AND tenant_id=$2`,[req.params.id,a.tenantId]);
  if(existing.rows[0]?.workspace==='nurse')return void res.status(409).json({error:'Use Nursing Station actions. Clinical data and timestamps cannot be overwritten through work items.'});
  if(existing.rows[0]?.workspace === "laboratory" && ["orders","pos","sample collection","results","verification","reports"].includes(String(existing.rows[0].kind).toLowerCase()))return void res.status(409).json({error:"Use the laboratory collection, result and approval actions to update this order"});
  const result = await pool.query(
    `UPDATE role_work_items SET status=$1,data=CASE WHEN $2::jsonb IS NULL THEN data ELSE data||$2::jsonb END,updated_at=now() WHERE id=$3 AND tenant_id=$4 AND ($5='all' OR workspace=$5 OR ($5='branch' AND branch_id=$6)) RETURNING *`,
    [
      body.status,
      body.data ? JSON.stringify(body.data) : null,
      req.params.id,
      a.tenantId,
      activeWorkspace,
      a.branchId,
    ],
  );
  if (!result.rows[0])
    return void res.status(404).json({ error: "Work item not found" });
  res.json(result.rows[0]);
});

export default router;
