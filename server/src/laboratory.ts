import {verifyLabTests,disapproveLabTests} from "./lab-test-verification.js";
import {labTestHasResults,approvedLabTestIds} from "./lab-result-completion.js";
import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { hasPermission } from "./access-control.js";
import { ensureLaboratorySchema } from "./laboratory-schema.js";
import { qcEvaluation } from "./lab-clinical.js";
import {verificationPathologists} from "./lab-doctor-verification.js";
import { labSearchPatterns, labSearchSql } from "./lab-search.js";
import {labTestStatusReportSql,labTestStatusSummarySql} from './lab-test-status-report.js';
type Req=Request&{portalUser?:{sub:string;tenantId:string;branchId:string;role:string}};
const router=Router();let ready:Promise<void>|null=null;
router.use(async(req:Req,res,next)=>{
  const a=req.portalUser!;
  if(!["hospital_admin","laboratory","radiology"].includes(a.role))return void res.status(403).json({error:"Laboratory access required"});
  try{ready??=ensureLaboratorySchema(pool);await ready;next();}catch(error){ready=null;next(error);}
});
async function permitted(req:Req,code:string){const a=req.portalUser!;return a.role==="hospital_admin"||await hasPermission(a.sub,a.tenantId,code);}
router.get('/test-status-report',async(req:Req,res)=>{
  if(!await permitted(req,'lab.order.view'))return void res.status(403).json({error:'Laboratory report access required'});
  const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Invalid date');
  const filter=z.object({from:day,to:day,test_id:z.string().uuid().or(z.literal('')).prefault(''),status:z.enum(['all','pending','conducted']).prefault('all'),search:z.string().trim().max(150).prefault(''),test_search:z.string().trim().max(150).prefault(''),page:z.coerce.number().int().min(1).max(100000).prefault(1)}).safeParse(req.query);
  if(!filter.success)return void res.status(400).json({error:'Select valid dates, test and status filters'});
  const {from,to,test_id,status,search,test_search,page}=filter.data;
  if(from>to)return void res.status(400).json({error:'From Date must be on or before To Date'});
  const pattern=search?`%${search.replace(/[\\%_]/g,'\\$&')}%`:'';
  const testPattern=test_search?`%${test_search.replace(/[\\%_]/g,'\\$&')}%`:'';
  const [result,counts]=await Promise.all([
    pool.query(labTestStatusReportSql,[req.portalUser!.tenantId,from,to,test_id,status,pattern,(page-1)*100,testPattern]),
    pool.query(labTestStatusSummarySql,[req.portalUser!.tenantId,from,to,test_id,pattern,testPattern]),
  ]);
  res.json({rows:result.rows.map(({total,...row})=>row),total:result.rows[0]?.total||0,summary:counts.rows[0]||{total:0,pending:0,conducted:0},page,page_size:100});
});
router.get("/pathologists",async(req:Req,res)=>{
  if(!await permitted(req,"lab.result.verify"))return void res.status(403).json({error:"Laboratory approval permission required"});
  const rows=await pool.query(`SELECT id,concat_ws(' ',first_name,middle_name,last_name) name,coalesce(professional->>'digital_signature','')<>'' has_signature FROM staff_members WHERE tenant_id=$1 AND staff_type IN ('Pathologist','Radiologist') ORDER BY first_name,last_name`,[req.portalUser!.tenantId]);
  const actor=await pool.query("SELECT id,staff_type FROM staff_members WHERE tenant_id=$1 AND user_id=$2",[req.portalUser!.tenantId,req.portalUser!.sub]);
  res.json({rows:rows.rows,self_pathologist_id:actor.rows.find(row=>["Pathologist","Radiologist"].includes(row.staff_type))?.id||null});
});
router.get("/workflow",async(req:Req,res)=>{
  const a=req.portalUser!,view=String(req.query.view||"status"),search=z.string().trim().max(150).prefault("").parse(req.query.search);
  const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).prefault('');
  const from=day.parse(req.query.from),to=day.parse(req.query.to);
  if(from&&to&&from>to)return void res.status(400).json({error:'From Date must be on or before To Date'});
  const page=Math.max(1,Number(req.query.page)||1),stage:Record<string,string>={processing:"AND w.data->>'collected_at' IS NOT NULL AND coalesce(w.data->>'processing_status','') NOT IN ('Accepted','Rejected')",worksheet:"AND w.data->>'collected_at' IS NOT NULL AND w.status<>'Rejected'",verification:"AND w.data->>'result_status' IN ('Completed','Partially Completed')",reports:"AND w.data->'doctor_approval' IS NOT NULL AND w.data->'doctor_approval'<>'null'::jsonb"};
  const where=`w.tenant_id=$1 AND w.workspace='laboratory' AND lower(w.kind) IN ('orders','pos','sample collection','results','verification','reports') ${stage[view]||""} AND ${labSearchSql()}
    AND ($4::date IS NULL OR (w.occurred_at AT TIME ZONE 'Asia/Kolkata')::date >= $4::date)
    AND ($5::date IS NULL OR (w.occurred_at AT TIME ZONE 'Asia/Kolkata')::date <= $5::date)`;
  const [records,count]=await Promise.all([
    pool.query(`SELECT w.id,w.title,w.status,w.kind,w.occurred_at,coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),w.data->>'customer_name') patient_name,coalesce(p.medical_record_number,w.data->>'medical_record_number') medical_record_number,
      jsonb_build_object('tests',w.data->'tests','processing_status',w.data->'processing_status','processing_note',w.data->'processing_note','result_status',w.data->'result_status','completed_test_ids',w.data->'completed_test_ids','technician_approval',w.data->'technician_approval','result_entry',w.data->'result_entry','doctor_approval',w.data->'doctor_approval','billing_review_required',w.data->'billing_review_required','unlinked_patient',w.data->'unlinked_patient','import_source',w.data->'import_source') data
      FROM role_work_items w LEFT JOIN patients p ON p.id=w.patient_id WHERE ${where} ORDER BY w.occurred_at DESC,w.id DESC LIMIT 50 OFFSET $6`,[a.tenantId,search,labSearchPatterns(search),from||null,to||null,(page-1)*50]),
    pool.query(`SELECT count(*)::int count FROM role_work_items w LEFT JOIN patients p ON p.id=w.patient_id WHERE ${where}`,[a.tenantId,search,labSearchPatterns(search),from||null,to||null]),
  ]);
  res.json({rows:records.rows,total:count.rows[0].count,page});
});
router.get("/summary",async(req:Req,res)=>{
  const a=req.portalUser!;
  const [orders,qc,imports]=await Promise.all([
    pool.query(`SELECT status,count(*)::int count FROM role_work_items WHERE tenant_id=$1 AND workspace='laboratory' AND lower(kind) IN ('orders','pos','sample collection','results','verification','reports') GROUP BY status ORDER BY status`,[a.tenantId]),
    pool.query(`SELECT status,count(*)::int count FROM lab_qc_runs WHERE tenant_id=$1 AND created_at>=now()-interval '30 days' GROUP BY status`,[a.tenantId]),
    pool.query(`SELECT id,summary,status,created_at FROM lab_import_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`,[a.tenantId]),
  ]);res.json({orders:orders.rows,qc:qc.rows,latest_import:imports.rows[0]||null});
});
router.patch("/orders/:id/process",async(req:Req,res)=>{
  if(!await permitted(req,"lab.result.create"))return void res.status(403).json({error:"Sample processing permission required"});
  const b=z.object({action:z.enum(["receive","accept","reject"]),note:z.string().trim().max(2000).prefault("")}).parse(req.body),a=req.portalUser!;
  if(b.action==="reject"&&!b.note)return void res.status(400).json({error:"Enter the reason for rejecting the sample"});
  const state={receive:"Received",accept:"Accepted",reject:"Rejected"}[b.action];
  const result=await pool.query(`UPDATE role_work_items SET status=CASE WHEN $1='Rejected' THEN 'Rejected' ELSE status END,data=data||$2::jsonb,updated_at=now() WHERE id=$3 AND tenant_id=$4 AND workspace='laboratory' AND data->>'collected_at' IS NOT NULL AND (data->'doctor_approval' IS NULL OR data->'doctor_approval'='null'::jsonb) AND coalesce(data->>'processing_status','')<>'Rejected' RETURNING id`,[state,JSON.stringify({processing_status:state,processing_note:b.note,processing_at:new Date().toISOString(),processing_by:a.sub}),req.params.id,a.tenantId]);
  if(!result.rowCount)return void res.status(409).json({error:"This sample is unavailable, rejected, or already doctor approved"});
  res.json({status:state});
});
router.patch("/orders/:id/approve",async(req:Req,res)=>{
  const b=z.object({stage:z.enum(["doctor","technician","return","disapprove"]),updated_at:z.string().optional(),test_ids:z.array(z.string().min(1)).max(300).prefault([]),pathologist_ids:z.array(z.string().uuid()).max(6).prefault([]),test_pathologists:z.record(z.string(),z.string().uuid()).optional(),note:z.string().trim().max(2000).prefault("")}).parse(req.body),a=req.portalUser!;
  if(!await permitted(req,b.stage==="return"?"lab.result.create":"lab.result.verify"))return void res.status(403).json({error:"Laboratory approval permission required"});
  if(b.stage==="return"&&!b.note)return void res.status(400).json({error:"Enter the reason for returning the result"});
  const client=await pool.connect();
  try{await client.query("BEGIN");const found=await client.query(`SELECT * FROM role_work_items WHERE id=$1 AND tenant_id=$2 AND workspace='laboratory' FOR UPDATE`,[req.params.id,a.tenantId]),row=found.rows[0];
    if(!row)throw new Error("Laboratory order not found");
    if(b.stage!=="return"&&(!b.updated_at||!Number.isFinite(Date.parse(b.updated_at))||Date.parse(b.updated_at)!==new Date(row.updated_at).getTime()))throw new Error("Results changed. Reopen verification and review the current results.");
    if(!["Completed","Partially Completed"].includes(row.data.result_status))throw new Error("Save completed or partially completed test results before approval");
    const eligible=(row.data.lab_results||[]).filter(labTestHasResults);
    if(!eligible.length)throw new Error("Save results for at least one test before approval");
    if(row.status==="Rejected")throw new Error("Rejected samples cannot be approved");
    if(b.stage==="doctor"&&row.data.doctor_approval&&eligible.every((test:Record<string,any>)=>approvedLabTestIds(row.data).includes(test.test_id)))throw new Error("All tests with saved results have already been approved");
    const actor=await client.query(`SELECT concat_ws(' ',u.first_name,u.last_name) name,s.id staff_id,s.staff_type,s.professional->>'medical_registration_number' registration_number FROM users u LEFT JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id WHERE u.id=$1 AND u.tenant_id=$2`,[a.sub,a.tenantId]);
    const profiles=b.stage==="doctor"?await client.query("SELECT id,concat_ws(' ',first_name,middle_name,last_name) name,professional FROM staff_members WHERE tenant_id=$1 AND staff_type IN ('Pathologist','Radiologist')",[a.tenantId]):{rows:[]};
    const perTest:Record<string,any>={};
    const selected=b.stage==="doctor"?(b.test_pathologists?b.test_ids.flatMap(id=>{const doctors=verificationPathologists(actor.rows[0]||{},b.test_pathologists?.[id]?[b.test_pathologists[id]]:[],profiles.rows);perTest[id]={pathologist_ids:doctors.map(doctor=>doctor.id),pathologist_names:doctors.map(doctor=>doctor.name)};return doctors;}):verificationPathologists(actor.rows[0]||{},b.pathologist_ids,profiles.rows)):[];
    const metadata={test_ids:b.test_ids,pathologist_ids:selected.map(row=>row.id),pathologist_names:selected.map(row=>row.name),by:a.sub,name:actor.rows[0]?.name||"",staff_type:actor.rows[0]?.staff_type||"",registration_number:actor.rows[0]?.registration_number||"",at:new Date().toISOString(),note:b.note};
    const patch=b.stage==="disapprove"?disapproveLabTests(row.data,b.test_ids):b.stage==="return"?{result_status:"Returned",technician_approval:null,doctor_approval:null,return_reason:b.note}:verifyLabTests(row.data,b.stage,b.test_ids,metadata,Object.fromEntries(Object.entries(perTest).map(([id,doctor])=>[id,{...metadata,...doctor,test_ids:[id]}])));
    await client.query(`UPDATE role_work_items SET status=$1,data=data||$2::jsonb,updated_at=now() WHERE id=$3`,[b.stage==="disapprove"?"Results Returned":b.stage==="return"?"Results Returned":b.stage==="doctor"?"Doctor Approved":"Technician Approved",JSON.stringify({...patch,approval_history:[...(row.data.approval_history||[]),{stage:b.stage,...metadata,test_pathologists:perTest,...(b.stage==="disapprove"?{previous_approval:row.data.doctor_approval,results:(row.data.lab_results||[]).filter((test:any)=>b.test_ids.includes(test.test_id))}:{})}]}),row.id]);
    await client.query("COMMIT");res.json({status:"Updated"});
  }catch(error){await client.query("ROLLBACK");res.status(409).json({error:error instanceof Error?error.message:"Unable to approve result"});}finally{client.release();}
});
router.get("/qc",async(req:Req,res)=>{
  const a=req.portalUser!;const [controls,runs,parameters]=await Promise.all([
    pool.query(`SELECT c.*,p.name parameter_name FROM lab_qc_controls c JOIN hospital_diagnostic_masters p ON p.id=c.parameter_id WHERE c.tenant_id=$1 ORDER BY c.created_at DESC`,[a.tenantId]),
    pool.query(`SELECT r.*,c.name control_name,c.lot,c.level,p.name parameter_name FROM lab_qc_runs r JOIN lab_qc_controls c ON c.id=r.control_id JOIN hospital_diagnostic_masters p ON p.id=c.parameter_id WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 500`,[a.tenantId]),
    pool.query(`SELECT id,name FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='parameter' ORDER BY name`,[a.tenantId]),
  ]);res.json({controls:controls.rows,runs:runs.rows,parameters:parameters.rows});
});
router.post("/qc/controls",async(req:Req,res)=>{
  const a=req.portalUser!;if(!await permitted(req,"lab.result.verify"))return void res.status(403).json({error:"QC configuration permission required"});
  const b=z.object({name:z.string().trim().min(1),parameter_id:z.string().uuid(),lot:z.string().trim().min(1),level:z.string().trim().min(1),target:z.coerce.number().finite(),sd:z.coerce.number().finite().positive(),expires_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(req.body);
  const parameter=await pool.query(`SELECT id FROM hospital_diagnostic_masters WHERE id=$1 AND tenant_id=$2 AND domain='pathology' AND kind='parameter'`,[b.parameter_id,a.tenantId]);
  if(!parameter.rowCount)return void res.status(400).json({error:"Select a laboratory parameter"});
  const result=await pool.query(`INSERT INTO lab_qc_controls(tenant_id,branch_id,name,parameter_id,lot,level,target,sd,expires_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[a.tenantId,a.branchId||null,b.name,b.parameter_id,b.lot,b.level,b.target,b.sd,b.expires_on]);res.status(201).json(result.rows[0]);
});
router.post("/qc/runs",async(req:Req,res)=>{
  const a=req.portalUser!;if(!await permitted(req,"lab.result.create"))return void res.status(403).json({error:"QC recording permission required"});
  const b=z.object({control_id:z.string().uuid(),value:z.coerce.number().finite(),note:z.string().trim().max(2000).prefault("")}).parse(req.body);
  const control=await pool.query(`SELECT * FROM lab_qc_controls WHERE id=$1 AND tenant_id=$2 AND status='Active' AND expires_on>=(now() AT TIME ZONE 'Asia/Kolkata')::date`,[b.control_id,a.tenantId]);
  if(!control.rowCount)return void res.status(400).json({error:"Select an active, unexpired QC control"});
  const evaluated=qcEvaluation(b.value,Number(control.rows[0].target),Number(control.rows[0].sd));
  const result=await pool.query(`INSERT INTO lab_qc_runs(tenant_id,control_id,value,z_score,status,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[a.tenantId,b.control_id,b.value,evaluated.z_score,evaluated.status,b.note,a.sub]);res.status(201).json(result.rows[0]);
});
router.get('/workflow-filter-options',async(req:Req,res)=>{
  const a=req.portalUser!;
  const result=await pool.query(`SELECT m.id,m.name,jsonb_build_object('department',coalesce(c.name,m.data->>'department',m.data->>'department_name','')) data
    FROM hospital_diagnostic_masters m LEFT JOIN hospital_diagnostic_masters c ON c.id::text=m.data->>'category_id' AND c.tenant_id=m.tenant_id
    WHERE m.tenant_id=$1 AND m.domain='pathology' AND m.kind='test' ORDER BY m.name`,[a.tenantId]);
  res.json(result.rows);
});
router.get("/masters/:kind",async(req:Req,res)=>{
  const kind=z.enum(["specimen","container","method","approver","test","parameter"]).parse(req.params.kind),a=req.portalUser!;
  const result=await pool.query(`SELECT id,name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind=$2 ORDER BY name`,[a.tenantId,kind]);res.json(result.rows);
});
router.patch("/masters/:id/accreditation",async(req:Req,res)=>{
  const a=req.portalUser!;if(!await permitted(req,"lab.result.verify"))return void res.status(403).json({error:"Laboratory configuration permission required"});
  const b=z.object({accredited:z.boolean(),scope:z.string().trim().max(500).prefault(""),valid_until:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()}).parse(req.body);
  if(b.accredited&&(!b.scope||!b.valid_until))return void res.status(400).json({error:"Enter the accreditation scope and validity date"});
  const result=await pool.query(`UPDATE hospital_diagnostic_masters SET data=data||$1::jsonb,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND domain='pathology' AND kind='test' RETURNING id`,[JSON.stringify({nabl_accredited:b.accredited,nabl_scope:b.scope,nabl_valid_until:b.valid_until}),req.params.id,a.tenantId]);
  if(!result.rowCount)return void res.status(404).json({error:"Laboratory test not found"});res.json({status:"Updated"});
});
export default router;
