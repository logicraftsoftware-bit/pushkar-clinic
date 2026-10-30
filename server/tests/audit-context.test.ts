import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditContext,instrumentAuditClient,instrumentAuditPool,type AuditContext} from '../src/audit-context.js';
import {PGlite} from '@electric-sql/pglite';
const context=(name:string):AuditContext=>({actor_name:name,actor_role:'receptionist',ip_address:'203.0.113.10',request_path:'/api/v1/patients',request_id:name});

test('repeated queries reuse audit context while rollbacks and savepoints restore the correct actor',async()=>{
  const db=new PGlite();let settings=0;
  const client={query:async(sql:string,args?:any[])=>{if(sql.includes("set_config('app.audit_context'"))settings++;return db.query<any>(sql,args);}};
  instrumentAuditClient(client);
  try{
    await auditContext.run(context('Gayatri'),async()=>{
      for(let n=0;n<10;n++)await client.query('SELECT 1');
    });
    assert.equal(settings,1,'ten reads require one context setup, rather than ten');
    await client.query('BEGIN');await client.query('SAVEPOINT before_actor');
    await auditContext.run(context('Mausumi'),async()=>{
      await client.query('SELECT 1');await client.query('ROLLBACK TO SAVEPOINT before_actor');
      const value=await client.query("SELECT current_setting('app.audit_context')::jsonb actor");
      assert.equal(value.rows[0].actor.actor_name,'Mausumi');
      await client.query('ROLLBACK');
      const after=await client.query("SELECT current_setting('app.audit_context')::jsonb actor");
      assert.equal(after.rows[0].actor.actor_name,'Mausumi');
    });
    const outside=await client.query("SELECT current_setting('app.audit_context')::jsonb actor");
    assert.deepEqual(outside.rows[0].actor,{});
  }finally{await db.close();}
});
test('connection queue isolates concurrent request actors and resets pooled connection context',async()=>{
  let active:any;const written:string[]=[];
  const client={query:async(sql:string,args?:any[])=>{await new Promise(resolve=>setTimeout(resolve,2));if(sql.includes('set_config'))active=JSON.parse(args![0]);else written.push(active.actor_name||'System');return{rows:[]};}};
  instrumentAuditClient(client);
  await Promise.all([auditContext.run(context('Xunmoni'),()=>client.query('INSERT patient')),auditContext.run(context('Gayatri'),()=>client.query('UPDATE patient'))]);
  await client.query('SELECT patient');assert.deepEqual(written,['Xunmoni','Gayatri','System']);
});
test('failed SQL can roll back and callback-based pool queries retain their actor',async()=>{
  let failed=false,active:any;
  const client:{query:any}={query:async(sql:string,args?:any[])=>{if(sql==='ROLLBACK'){failed=false;return{rows:[]};}if(failed)throw Error('Transaction aborted');if(sql.includes('set_config')){active=JSON.parse(args![0]);return{rows:[]};}if(sql==='BROKEN'){failed=true;throw Error('SQL failed');}return{rows:[active]};}};
  instrumentAuditClient(client);await assert.rejects(()=>client.query('BROKEN'),/SQL failed/);await client.query('ROLLBACK');
  const row=await auditContext.run(context('Nikita'),()=>new Promise<any>((resolve,reject)=>client.query('SELECT patient',[],(error:any,result:any)=>error?reject(error):resolve(result.rows[0]))));
  assert.equal(row.actor_name,'Nikita');assert.equal(row.ip_address,'203.0.113.10');
});
test('queued pg pool acquisition keeps the waiting request actor when another request releases a client',()=>{
  let pending:()=>void=()=>{},name='';
  const pool={connect:(callback:()=>void)=>{pending=callback;}};
  instrumentAuditPool(pool);
  auditContext.run(context('Mausumi'),()=>pool.connect(()=>{name=auditContext.getStore()!.actor_name;}));
  auditContext.run(context('Himanshu'),()=>pending());
  assert.equal(name,'Mausumi');
});
