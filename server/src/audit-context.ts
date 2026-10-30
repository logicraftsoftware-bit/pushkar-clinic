import {AsyncLocalStorage,AsyncResource} from 'node:async_hooks';
export type AuditContext={actor_id?:string;actor_name:string;actor_role:string;tenant_id?:string;branch_id?:string;ip_address:string;request_path:string;request_id:string};
export const auditContext=new AsyncLocalStorage<AuditContext>();
let triggersReady=false;
export function activateAuditTriggers(){triggersReady=true;}
export function instrumentAuditPool(pool:{connect:any}){
  const connect=pool.connect.bind(pool);
  pool.connect=function(...args:any[]){
    // pg dispatches queued callbacks in the releasing request's context unless bound.
    if(typeof args[0]==='function')args[0]=AsyncResource.bind(args[0]);
    return connect(...args);
  };
}
// Serialize context and SQL on each connection, including pg's callback-based pool queries.
export function instrumentAuditClient(client:{query:any}){
  const original=client.query.bind(client);let queue:Promise<unknown>=Promise.resolve();
  let appliedContext:string|null=null;
  client.query=function(...input:any[]){
    const context=auditContext.getStore();const callback=typeof input.at(-1)==='function'?input.pop():null;
    const sql=typeof input[0]==='string'?input[0]:input[0]?.text||'';
    const task=queue.then(async()=>{
      // ROLLBACK must remain possible after a failed statement poisons the transaction.
      const control=/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)&&!sql.trim().replace(/;$/,'').includes(';');
      const serialized=JSON.stringify(context||{});
      if(!control&&serialized!==appliedContext){
        await original("SELECT set_config('app.audit_context',$1,false)",[serialized]);
        appliedContext=serialized;
      }
      let result;
      try{result=await original(...input);}
      catch(error){appliedContext=null;throw error;}
      finally{
        // ROLLBACK (including TO SAVEPOINT) can restore an older session setting.
        // An error also makes the connection's transaction state uncertain.
        if(/^\s*ROLLBACK\b/i.test(sql))appliedContext=null;
      }
      if(triggersReady&&/\bCREATE\s+TABLE\b/i.test(sql))await original('SELECT install_site_audit_triggers()');
      return result;
    });queue=task.then(()=>undefined,()=>undefined);
    if(callback){task.then(result=>callback(null,result),error=>callback(error));return;}
    return task;
  };
}
