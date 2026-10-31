import { db } from './database.mjs';
import { activeAccount,authorizedPortal } from './security.mjs';
import {hasActiveRole} from './access.mjs';

// Poll the shared MongoDB state so separate hosting processes see revocations.
// No patient data or bearer tokens are included in the event stream.
export function accessEvents(request,response) {
  const claims=response.locals.claims;
  response.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'});
  response.flushHeaders();
  let stopped=false,pending=false;
  const close=()=>{if(stopped)return;stopped=true;clearInterval(timer);if(!response.writableEnded)response.end();};
  async function refresh() {
    if(stopped||pending)return;
    pending=true;
    try {
      const [session,account]=await Promise.all([
        db.collection('sessions').findOne({_id:claims.jti,user_id:claims.sub,audience:'careframe-portal',expires_at:{$gt:new Date()}}),
        db.collection('users').findOne({id:claims.sub,tenant_id:claims.tenantId}),
      ]);
      const hospital=account?await db.collection('hospitals').findOne({id:account.tenant_id}):null;
      const branch=account?await db.collection('branches').findOne({tenant_id:account.tenant_id,id:account.branch_id,is_active:true}):null;
      if(stopped)return;
      response.write('data: refresh\n\n');
      if(!session||!branch||!activeAccount(account,hospital)||(account.session_version??0)!==claims.version||account.role!==claims.role||account.branch_id!==claims.branchId||!authorizedPortal(account,claims.portal)||!await hasActiveRole(account))close();
    }catch{close();}
    finally{pending=false;}
  }
  const timer=setInterval(()=>{void refresh();},20000);timer.unref();
  request.once('close',close);response.once('close',close);
  void refresh();
}
