import {randomUUID} from 'node:crypto';
import {Router,type Request,type Response,type NextFunction} from 'express';
import jwt from 'jsonwebtoken';
import {z} from 'zod';
import {config} from './config.js';
import {pool} from './db.js';
import {auditContext,type AuditContext} from './audit-context.js';
import {accessibleBranchIds} from './branch-access.js';
import {hasPermission} from './access-control.js';

type Auth={sub:string;tenantId?:string;branchId?:string;role:string;portal?:string};
function verified(req:Request):Auth|null{
  const token=req.header('authorization')?.replace(/^Bearer\s+/i,'')||'';
  try{return jwt.verify(token,config.JWT_SECRET,{issuer:'careframe-api',audience:'careframe-portal'}) as Auth;}catch{}
  try{const auth=jwt.verify(token,config.JWT_SECRET,{issuer:'careframe-api',audience:'careframe-superadmin'}) as Auth;return auth.role==='super_admin'?auth:null;}catch{return null;}
}
export async function trackSiteRequest(req:Request,_res:Response,next:NextFunction){
  try{
    const auth=verified(req);let name=auth?.role==='hospital_admin'?'Hospital Admin':auth?.role==='super_admin'?'Super Admin':_res.locals.auditActorName||'';
    if(auth&&!name){
      const table=auth.role==='broker'?'referral_partners':'users';
      const result=await pool.query(table==='users'?`SELECT concat_ws(' ',first_name,last_name) name FROM users WHERE id=$1 AND tenant_id=$2`:`SELECT name FROM referral_partners WHERE id=$1 AND tenant_id=$2`,[auth.sub,auth.tenantId]);name=result.rows[0]?.name||'Unknown staff';
    }
    const context:AuditContext={actor_id:auth?.sub,actor_name:name||(req.path.includes('self-registration')?'Public Registration':'System'),actor_role:auth?.role||'system',tenant_id:auth?.tenantId,branch_id:auth?.branchId,ip_address:req.ip||req.socket.remoteAddress||'',request_path:req.path,request_id:randomUUID()};
    auditContext.run(context,next);
  }catch(error){next(error);}
}
const router=Router();
const permissions:Record<string,string>={patients:'patient.view',clinical_appointments:'appointment.view',ipd_admissions:'ipd.view',finance_records:'billing.view',cancellation_requests:'billing.view',cancellation_events:'billing.view',role_work_items:'patient.view',staff_members:'staff.view',users:'staff.view',inventory_records:'inventory.view',hospital_settings:'settings.view',hospital_documents:'documents.view',hospital_diagnostic_masters:'menu.lab-orders.view',hospital_pharmacy_masters:'menu.inventory.view',dietary_orders:'ipd.view',doctor_clinical_records:'opd.view',ipd_transfer_history:'ipd.view',ipd_bed_stays:'ipd.view',wards:'ipd.view',rooms:'ipd.view',beds:'ipd.view',bed_masters:'ipd.view',hospital_charge_masters:'billing.view',hospital_print_templates:'settings.view',hospital_operation_masters:'ipd.view',hr_records:'hr.view',insurance_claims:'insurance.view',pharmacy_stock_adjustments:'inventory.view',patient_diets:'ipd.view',dietary_menu:'ipd.view',dietary_package_rules:'ipd.view',dietary_meal_schedules:'ipd.view',dietary_meal_holds:'ipd.view',ot_cases:'ipd.view',ot_case_events:'ipd.view',ot_consumables:'ipd.view',ot_rooms:'ipd.view',lab_qc_controls:'lab.order.view',lab_qc_runs:'lab.order.view',lab_report_shares:'lab.order.view',referral_partners:'billing.view',referral_commissions:'billing.view',referral_wallet_transactions:'billing.view',referral_withdrawals:'billing.view'};
async function filters(req:Request){
  const auth=verified(req);if(!auth)throw Object.assign(Error('Session expired or invalid.'),{status:401});
  if(auth.role==='super_admin')return{auth,sql:'true',args:[] as unknown[]};
  if(!auth.tenantId)throw Object.assign(Error('Hospital access required.'),{status:403});
  if(['patient','broker'].includes(auth.role))return{auth,sql:'tenant_id=$1 AND actor_id=$2',args:[auth.tenantId,auth.sub] as unknown[]};
  const branches=await accessibleBranchIds({...auth,tenantId:auth.tenantId}),admin=auth.role==='hospital_admin'||await hasPermission(auth.sub,auth.tenantId,'audit.view');
  const allowed=admin?null:new Set((await Promise.all([...new Set(Object.values(permissions))].map(async permission=>await hasPermission(auth.sub,auth.tenantId!,permission)?permission:null))).filter(Boolean));
  const modules=allowed===null?null:Object.entries(permissions).filter(([,permission])=>allowed.has(permission)).map(([table])=>table);
  return{auth,sql:`tenant_id=$1 AND ($2::uuid[] IS NULL OR branch_id=ANY($2) OR branch_id IS NULL) AND ($4::text[] IS NULL OR module=ANY($4) OR actor_id=$3)`,args:[auth.tenantId,branches,auth.sub,modules] as unknown[]};
}
router.get('/',async(req,res)=>{
  const scope=await filters(req),search=z.string().trim().max(150).prefault('').parse(req.query.search),module=z.string().max(100).prefault('').parse(req.query.module),record=z.string().max(250).prefault('').parse(req.query.record),page=z.coerce.number().int().min(1).max(100000).prefault(1).parse(req.query.page);
  const args=[...scope.args,search,module,record],n=scope.args.length;
  const where=`${scope.sql} AND ($${n+1}='' OR concat_ws(' ',actor_name,record_id,record_label,ip_address,action) ILIKE '%'||$${n+1}||'%') AND ($${n+2}='' OR module=$${n+2}) AND ($${n+3}='' OR record_id=$${n+3})`;
  const [rows,count,modules]=await Promise.all([
    pool.query(`SELECT * FROM site_activity_events WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET $${n+4}`,[...args,(page-1)*50]),
    pool.query(`SELECT count(*)::int total FROM site_activity_events WHERE ${where}`,args),
    pool.query(`SELECT DISTINCT module FROM site_activity_events WHERE ${scope.sql} ORDER BY module`,scope.args),
  ]);
  res.json({rows:rows.rows,total:count.rows[0].total,modules:modules.rows.map(row=>row.module),page,page_size:50});
});
router.get('/record',async(req,res)=>{
  const scope=await filters(req),module=z.string().regex(/^[a-z_]+$/).parse(req.query.module),id=z.string().min(1).max(250).parse(req.query.id),n=scope.args.length;
  const result=await pool.query(`SELECT * FROM site_activity_events WHERE ${scope.sql} AND module=$${n+1} AND record_id=$${n+2} ORDER BY created_at,id`,[...scope.args,module,id]);
  if(!result.rows.length)return void res.status(404).json({error:'No accessible tracking history for this record.'});
  res.json({events:result.rows,created:[...result.rows].reverse().find(row=>row.action==='Created')||null});
});
router.use((error:any,_req:Request,res:Response,next:NextFunction)=>{if(error.status)res.status(error.status).json({error:error.message});else next(error);});
export default router;
