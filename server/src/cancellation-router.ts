import {Router,type Request,type Response,type NextFunction} from 'express';
import jwt from 'jsonwebtoken';
import {z} from 'zod';
import {config} from './config.js';
import {pool} from './db.js';
import {hasPermission} from './access-control.js';
import {accessibleBranchIds} from './branch-access.js';
import {operationalSettings} from './settings-runtime.js';
import {CancellationError} from './cancellation-policy.js';
import {findCancellationBills,submitCancellation,reviewCancellation,payCancellationRefund,type CancellationActor} from './cancellation-service.js';

type Auth={sub:string;tenantId:string;branchId:string;role:string;portal:string};
type Req=Request&{auth?:Auth;actor?:CancellationActor};
const router=Router();
router.use(async(req:Req,res,next)=>{
  try{
    try{req.auth=jwt.verify(req.header('authorization')?.replace(/^Bearer /i,'')||'',config.JWT_SECRET,{issuer:'careframe-api',audience:'careframe-portal'}) as Auth;}catch{throw new CancellationError(401,'Session expired or invalid.');}
    if(!['receptionist','accountant','hospital_admin'].includes(req.auth.role))throw new CancellationError(403,'Reception or accountant access required.');
    if(!await hasPermission(req.auth.sub,req.auth.tenantId,'billing.view'))throw new CancellationError(403,'Billing access required.');
    req.actor={tenantId:req.auth.tenantId,sub:req.auth.sub,branches:await accessibleBranchIds(req.auth)};next();
  }catch(error){next(error);}
});
async function authorize(req:Req,kind:'reception'|'accountant'){
  const roles=kind==='reception'?['receptionist','hospital_admin']:['accountant','hospital_admin'];
  if(!roles.includes(req.auth!.role))throw new CancellationError(403,kind==='accountant'?'Only an accountant can approve or reject requests.':'Only reception can submit requests and process refunds.');
  const permission=kind==='accountant'?'billing.refund':'billing.update';
  if(!await hasPermission(req.auth!.sub,req.auth!.tenantId,permission))throw new CancellationError(403,`Permission required: ${permission}`);
}
router.get('/options',async(req:Req,res)=>{const settings=await operationalSettings(req.actor!.tenantId);res.json({payment_methods:settings.payment_methods,can_review:['accountant','hospital_admin'].includes(req.auth!.role),can_process:['receptionist','hospital_admin'].includes(req.auth!.role)});});
router.get('/bill',async(req:Req,res)=>{const number=z.string().trim().min(1).max(100).parse(req.query.number);res.json(await findCancellationBills(pool,req.actor!,number));});
router.get('/',async(req:Req,res)=>{
  const query=z.string().trim().max(150).default('').parse(req.query.search),stage=z.enum(['requests','refunds']).default('requests').parse(req.query.stage),status=z.enum(['','Pending','Approved','Rejected','Partially Refunded','Completed']).default('').parse(req.query.status),page=z.coerce.number().int().min(1).default(1).parse(req.query.page);
  const where=`r.tenant_id=$1 AND ($2::uuid[] IS NULL OR r.branch_id=ANY($2)) AND ($3='' OR concat_ws(' ',r.bill_number,r.request_number,r.patient_name) ILIKE '%'||$3||'%') AND ($4='' OR r.status=$4) ${stage==='refunds'?"AND r.status IN('Approved','Partially Refunded','Completed')":''}`;
  const args=[req.actor!.tenantId,req.actor!.branches,query,status];
  const [count,rows]=await Promise.all([pool.query(`SELECT count(*)::int total,coalesce(sum(approved_amount-refunded_amount) FILTER(WHERE status IN('Approved','Partially Refunded')),0) pending_refund FROM cancellation_requests r WHERE ${where}`,args),pool.query(`SELECT r.*,b.name branch_name,concat_ws(' ',u.first_name,u.last_name) requested_by_name,concat_ws(' ',v.first_name,v.last_name) reviewed_by_name FROM cancellation_requests r JOIN branches b ON b.id=r.branch_id LEFT JOIN users u ON u.id=r.created_by LEFT JOIN users v ON v.id=r.reviewed_by WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET $5`,[...args,(page-1)*20])]);
  res.json({rows:rows.rows,total:count.rows[0].total,pending_refund:count.rows[0].pending_refund,page,page_size:20});
});
router.get('/:id/events',async(req:Req,res)=>{
  const id=z.string().uuid().parse(req.params.id),found=await pool.query(`SELECT id FROM cancellation_requests WHERE id=$1 AND tenant_id=$2 AND ($3::uuid[] IS NULL OR branch_id=ANY($3))`,[id,req.actor!.tenantId,req.actor!.branches]);
  if(!found.rowCount)throw new CancellationError(404,'Cancellation request not found.');
  res.json((await pool.query(`SELECT e.*,coalesce(nullif(e.actor_name,''),CASE WHEN u.role='hospital_admin' THEN 'Hospital Admin' ELSE concat_ws(' ',u.first_name,u.last_name) END) actor_name,coalesce(e.actor_role,u.role::text) actor_role,f.record_number FROM cancellation_events e JOIN users u ON u.id=e.actor_id LEFT JOIN finance_records f ON f.id=e.finance_id WHERE e.request_id=$1 AND e.tenant_id=$2 ORDER BY e.created_at,e.id`,[id,req.actor!.tenantId])).rows);
});
const amount=z.number().finite().min(0).max(99999999.99);
router.post('/',async(req:Req,res)=>{
  await authorize(req,'reception');const body=z.object({type:z.enum(['OPD','Lab']),target_id:z.string().uuid(),reason:z.string().trim().min(3).max(1000),amount}).parse(req.body),client=await pool.connect();
  try{res.status(201).json(await submitCancellation(client,req.actor!,body));}finally{client.release();}
});
router.post('/:id/review',async(req:Req,res)=>{
  await authorize(req,'accountant');const id=z.string().uuid().parse(req.params.id),body=z.object({decision:z.enum(['approve','reject']),amount,note:z.string().trim().min(3).max(1000)}).parse(req.body),client=await pool.connect();
  try{res.json(await reviewCancellation(client,req.actor!,id,body));}finally{client.release();}
});
router.post('/:id/refund',async(req:Req,res)=>{
  await authorize(req,'reception');const id=z.string().uuid().parse(req.params.id),body=z.object({amount,method:z.string().trim().min(1).max(100),reference:z.string().trim().max(150).default(''),payment_key:z.string().uuid()}).parse(req.body);
  const methods=(await operationalSettings(req.actor!.tenantId)).payment_methods;
  if(!methods.includes(body.method))throw new CancellationError(400,'Select a valid refund payment method.');
  if(body.method!=='Cash'&&!body.reference)throw new CancellationError(400,'Enter the transaction reference for this payment method.');
  const client=await pool.connect();try{res.json(await payCancellationRefund(client,req.actor!,id,body));}finally{client.release();}
});
router.use((error:unknown,_req:Request,res:Response,next:NextFunction)=>{if(error instanceof CancellationError)res.status(error.status).json({error:error.message});else next(error);});
export default router;
