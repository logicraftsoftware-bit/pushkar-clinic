import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {siteAuditSchemaSql} from '../src/site-audit-schema.js';
import {auditContext,instrumentAuditClient,activateAuditTriggers,type AuditContext} from '../src/audit-context.js';

test('site-wide audit records committed changes with immutable staff names, IPs and transactional rollback',async t=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE TABLE cancellation_events(id uuid PRIMARY KEY);
      CREATE TABLE records(id int PRIMARY KEY,tenant_id uuid,status text,updated_at timestamptz DEFAULT now());
      CREATE TABLE settings(tenant_id uuid,key text,value text,PRIMARY KEY(tenant_id,key));`);
    await db.exec(siteAuditSchemaSql);
    const client={query:(sql:string,args?:any[])=>db.query<any>(sql,args)};
    instrumentAuditClient(client);activateAuditTriggers();
    const tenant='00000000-0000-4000-8000-000000000001';
    const context=(name:string,ip:string):AuditContext=>({actor_name:name,actor_role:name==='Clinic Admin'?'hospital_admin':'receptionist',tenant_id:tenant,ip_address:ip,request_path:'/api/v1/records',request_id:name});
    await t.test('concurrent actors keep distinct names, IP addresses and creation timestamps',async()=>{
      await Promise.all([
        auditContext.run(context('Xunmoni','203.0.113.1'),()=>client.query('INSERT INTO records VALUES(1,$1,$2,now())',[tenant,'Booked'])),
        auditContext.run(context('Mausumi','203.0.113.2'),()=>client.query('INSERT INTO records VALUES(2,$1,$2,now())',[tenant,'Booked'])),
      ]);
      const rows=(await client.query('SELECT * FROM site_activity_events ORDER BY id')).rows;
      assert.deepEqual(rows.map(row=>[row.actor_name,row.ip_address]),[['Xunmoni','203.0.113.1'],['Mausumi','203.0.113.2']]);
      assert.ok(rows.every(row=>row.action==='Created'&&row.tenant_id===tenant&&row.created_at));
    });
    await t.test('updates preserve the original creator and show the admin action and changed fields',async()=>{
      await auditContext.run(context('Clinic Admin','198.51.100.1'),()=>client.query("UPDATE records SET status='Confirmed',updated_at=now() WHERE id=1"));
      const rows=(await client.query("SELECT * FROM site_activity_events WHERE record_id='1' ORDER BY id")).rows;
      assert.equal(rows[0].actor_name,'Xunmoni');assert.equal(rows[1].actor_name,'Clinic Admin');
      assert.equal(rows[1].action_detail,'Confirmed');assert.deepEqual(rows[1].changed_fields,['status']);
    });
    await t.test('failed transactions and timestamp-only updates leave no audit entries',async()=>{
      const before=(await client.query('SELECT count(*)::int n FROM site_activity_events')).rows[0].n;
      await client.query('UPDATE records SET updated_at=now()');
      await auditContext.run(context('Xunmoni','203.0.113.1'),async()=>{
        await client.query('BEGIN');await client.query("UPDATE records SET status='Cancelled' WHERE id=1");
        await assert.rejects(()=>client.query('INSERT INTO records VALUES(1,$1,$2,now())',[tenant,'Duplicate']));await client.query('ROLLBACK');
      });
      assert.equal((await client.query('SELECT count(*)::int n FROM site_activity_events')).rows[0].n,before);
    });
    await t.test('composite keys and late-created modules are tracked without storing field values',async()=>{
      await client.query('INSERT INTO settings VALUES($1,$2,$3)',[tenant,'currency','PRIVATE-VALUE']);
      const setting=(await client.query("SELECT * FROM site_activity_events WHERE module='settings'")).rows[0];
      assert.equal(setting.record_id,tenant+':currency');assert.ok(!JSON.stringify(setting).includes('PRIVATE-VALUE'));
      await client.query('CREATE TABLE late_records(id int PRIMARY KEY,tenant_id uuid)');
      await auditContext.run(context('Mausumi','203.0.113.2'),()=>client.query('INSERT INTO late_records VALUES(1,$1)',[tenant]));
      assert.equal((await client.query("SELECT actor_name FROM site_activity_events WHERE module='late_records'")).rows[0].actor_name,'Mausumi');
    });
    await t.test('background actions reset actor context and deletions retain their history',async()=>{
      await client.query('DELETE FROM records WHERE id=2');
      const row=(await client.query("SELECT * FROM site_activity_events WHERE module='records' AND record_id='2' ORDER BY id DESC LIMIT 1")).rows[0];
      assert.equal(row.action,'Deleted');assert.equal(row.actor_name,'System');assert.equal(row.ip_address,null);
    });
  }finally{await db.close();}
});
