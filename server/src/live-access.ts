import {Router,type Request,type Response,type NextFunction} from 'express';
import jwt from 'jsonwebtoken';
import {Client} from 'pg';
import {config} from './config.js';
import {pool} from './db.js';
import {accountAccessProblem,type LiveAccount} from './live-access-policy.js';

type Claims={sub:string;tenantId:string;role:string;portal?:string};
export async function currentAccount(a:Claims) {
  const result=await pool.query<LiveAccount & {actor_name:string}>(`SELECT u.force_password_change,u.role::text,u.is_active,u.account_expires_at,h.status::text hospital_status,h.deleted_at,concat_ws(' ',u.first_name,u.last_name) actor_name,
    (SELECT count(*)::int FROM rbac_user_roles ur WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id) assigned_roles,
    ARRAY(SELECT CASE WHEN r.is_system THEN upper(r.code::text) ELSE 'CUSTOM' END FROM rbac_user_roles ur JOIN rbac_roles r ON r.id=ur.role_id WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id AND r.status='Active') role_codes
    FROM users u JOIN hospitals h ON h.id=u.tenant_id WHERE u.id=$1 AND u.tenant_id=$2`,[a.sub,a.tenantId]);
  return result.rows[0];
}
export async function enforceLiveAccount(req:Request,res:Response,next:NextFunction) {
  const token=req.header('authorization')?.replace(/^Bearer /i,'');
  if(!token)return next();
  let claims:Claims;
  try{claims=jwt.verify(token,config.JWT_SECRET,{issuer:'careframe-api',audience:'careframe-portal'}) as Claims;}catch{return next();}
  try{
    if(claims.role==='broker'){
      const row=await pool.query(`SELECT p.status,p.name actor_name,h.status hospital_status,h.deleted_at FROM referral_partners p JOIN hospitals h ON h.id=p.tenant_id WHERE p.id=$1 AND p.tenant_id=$2`,[claims.sub,claims.tenantId]);
      if(!row.rows[0]||row.rows[0].status!=='Active'||row.rows[0].deleted_at||!['active','trial'].includes(row.rows[0].hospital_status))return void res.status(401).json({code:'ACCESS_REVOKED',error:'Your broker or hospital account is inactive. Contact your hospital administrator.'});
      res.locals.auditActorName=row.rows[0].actor_name;
    }else{
      const account=await currentAccount(claims);
      const problem=accountAccessProblem(account,claims);
      if(problem)return void res.status(401).json({code:'ACCESS_REVOKED',error:problem});
      if(account?.force_password_change && !['/api/v1/auth/change-password','/api/v1/auth/logout'].includes(req.path))return void res.status(403).json({code:'PASSWORD_CHANGE_REQUIRED',error:'Change your temporary password before continuing.'});
      res.locals.auditActorName=account?.actor_name;
    }
    next();
  }catch(error){next(error);}
}

// PostgreSQL sends notifications only after commit, including changes made by
// another API process. One dedicated listener serves every connected browser.
const subscribers=new Set<()=>void>();
let listener:Client|null=null,retry:ReturnType<typeof setTimeout>|undefined;
function listen(){
  retry=undefined;
  const client=new Client({connectionString:config.DATABASE_URL,ssl:config.DATABASE_SSL?{rejectUnauthorized:true}:false,application_name:'careframe-access-events'});
  listener=client;
  const reconnect=()=>{if(listener!==client)return;listener=null;void client.end().catch(()=>{});retry=setTimeout(listen,3000);retry.unref();for(const notify of subscribers)notify();};
  client.on('error',reconnect);client.on('end',reconnect);
  client.on('notification',()=>{for(const notify of subscribers)notify();});
  void client.connect().then(()=>client.query('LISTEN careframe_access_changed')).catch(reconnect);
}
export const liveAccessRouter=Router();
liveAccessRouter.get('/events',(req,res)=>{
  try{jwt.verify(req.header('authorization')?.replace(/^Bearer /i,'')??'',config.JWT_SECRET,{issuer:'careframe-api',audience:'careframe-portal'});}catch{return void res.status(401).json({error:'Session expired or invalid.'});}
  if(!listener&&!retry)listen();
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'});res.flushHeaders();
  const notify=()=>{if(!res.writableEnded)res.write('data: refresh\n\n');};subscribers.add(notify);notify();
  const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),20000);heartbeat.unref();
  req.on('close',()=>{clearInterval(heartbeat);subscribers.delete(notify);});
});
