import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {combinedDiagnosticTests,laboratoryOrderFromRadiology,migrateRadiologyWorkspace} from '../src/diagnostic-workflow.js';
import {labTestComplete,reportableLabTests} from '../src/lab-result-completion.js';

test('pathology and radiology selections create one diagnostic order with no duplicate test IDs',()=>{
  const tests=combinedDiagnosticTests([{test_id:'lab',name:'CBC'},{test_id:'scan',name:'CT'}],[{test_id:'scan',name:'CT',priority:'Urgent'}]);
  assert.equal(tests.length,2);assert.equal(tests[0].test_type,'Pathology');assert.equal(tests[1].test_type,'Radiology');assert.equal(tests[1].priority,'Urgent');
});
test('verified radiology findings retain report eligibility after conversion to the laboratory flow',()=>{
  const migrated=laboratoryOrderFromRadiology({kind:'verification',status:'Verified',updated_at:'2026-10-26T10:00:00Z',data:{tests:[{test_id:'scan',name:'CT Chest',amount:2000}],report:'No focal lesion.',bill_id:'existing-bill',radiology_action_by:'doctor',radiology_action_at:'2026-10-26T09:00:00Z'}});
  assert.equal(migrated.workspace,'laboratory');assert.equal(migrated.data.bill_id,'existing-bill');assert.equal(migrated.status,'Doctor Approved');
  assert.equal(migrated.data.report,'No focal lesion.');assert.equal(migrated.data.lab_results[0].parameters[0].result_type_id,'27');
  assert.equal(labTestComplete(migrated.data.lab_results[0]),true);assert.equal(reportableLabTests(migrated.data.lab_results,migrated.data).length,1);
});
test('historical free-text reports without test definitions remain readable in Laboratory',()=>{
  const migrated=laboratoryOrderFromRadiology({title:'Legacy X-Ray',kind:'verification',status:'Verified',data:{report:'Historical findings'}});
  assert.equal(migrated.data.tests[0].name,'Legacy X-Ray');assert.equal(migrated.data.lab_results[0].parameters[0].value,'Historical findings');
  assert.equal(reportableLabTests(migrated.data.lab_results,migrated.data).length,1);
});
test('workspace migration preserves order identities, original records and billing links and runs once',async()=>{
  const db=new PGlite(),tenant='00000000-0000-4000-8000-000000000001';
  try {
    await db.exec(`CREATE TABLE hospital_feature_migrations(name text PRIMARY KEY);
      CREATE TABLE role_work_items(id uuid PRIMARY KEY,tenant_id uuid,workspace text,kind text,status text,data jsonb,updated_at timestamptz DEFAULT now());`);
    await db.query(`INSERT INTO role_work_items VALUES
      ('00000000-0000-4000-8000-000000000002',$1,'radiology','orders','Pending','{"tests":[{"test_id":"scan","name":"CT"}],"bill_id":"bill-1"}',now()),
      ('00000000-0000-4000-8000-000000000003',$1,'radiology','verification','Verified','{"tests":[{"test_id":"scan","name":"CT"}],"report":"Historical findings"}',now()),
      ('00000000-0000-4000-8000-000000000004',$1,'laboratory','orders','Pending','{"tests":[{"name":"CBC"}]}',now())`,[tenant]);
    const client={query:async(sql:string,args:any[]=[])=>db.query(sql,args)} as any;
    await db.exec('BEGIN');await migrateRadiologyWorkspace(client);await db.exec('COMMIT');
    const rows=(await db.query<any>('SELECT * FROM role_work_items ORDER BY id')).rows;
    assert.equal(rows.length,3);assert.ok(rows.every(row=>row.workspace==='laboratory'));assert.equal(rows[0].data.bill_id,'bill-1');
    assert.equal(rows[1].data.lab_results[0].parameters[0].value,'Historical findings');assert.equal(rows[2].data.tests[0].name,'CBC');
    const backup=(await db.query<any>('SELECT record FROM diagnostic_workspace_migration_backup ORDER BY id')).rows;
    assert.equal(backup.length,2);assert.equal(backup[0].record.workspace,'radiology');
    await db.query("UPDATE role_work_items SET data=data||'{\"new_result\":true}' WHERE id=$1",[rows[0].id]);
    await migrateRadiologyWorkspace(client);
    assert.equal((await db.query<any>('SELECT data FROM role_work_items WHERE id=$1',[rows[0].id])).rows[0].data.new_result,true);
    assert.equal((await db.query('SELECT * FROM diagnostic_workspace_migration_backup')).rows.length,2);
  } finally {await db.close();}
});
