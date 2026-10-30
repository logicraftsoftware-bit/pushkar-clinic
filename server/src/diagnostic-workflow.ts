import type {PoolClient} from 'pg';
type Row=Record<string,any>;

export function combinedDiagnosticTests(pathology:Row[],radiology:Row[]) {
  const tests:Row[]=[...pathology.map(test=>({...test,test_type:test.test_type||'Pathology'})),...radiology.map(test=>({...test,test_type:'Radiology'}))];
  return [...new Map(tests.map(test=>[test.test_id||`${test.test_type}:${String(test.name).toLowerCase()}`,test])).values()];
}

export function comparableDiagnosticTests(tests:Row[]) {
  return tests.map(({test_type:_type,...test})=>test);
}

export function laboratoryOrderFromRadiology(row:Row) {
  const original=row.data||{},tests=(original.tests||[]).map((test:Row)=>({...test,test_type:'Radiology'}));
  const report=String(original.report||original.radiology_report||'');
  if(report&&!tests.length)tests.push({test_id:null,name:row.title||'Radiology Study',test_type:'Radiology',amount:0});
  const collected=Boolean(original.collected_at||report||['Study In Progress','Awaiting Report','Awaiting Verification','Verified'].includes(row.status));
  const verified=row.status==='Verified';
  const results=report?tests.map((test:Row)=>({test_id:test.test_id||null,name:test.name,test_name:test.name,parameters:[{parameter_id:null,name:'Findings / Impression',result_type_id:'27',value:report,remarks:'',unit:''}]})):original.lab_results;
  return {
    workspace:'laboratory',
    kind:verified?'reports':collected?'sample collection':'orders',
    status:row.status==='Cancelled'?'Cancelled':verified?'Doctor Approved':report?'Results Saved':collected?'Sample Collected':row.status,
    data:{...original,tests,legacy_radiology_workspace:{kind:row.kind,status:row.status},
      ...(collected?{collected_at:original.collected_at||original.radiology_action_at||row.updated_at||row.occurred_at}:{}),
      ...(results?{lab_results:results}:{}),
      ...(report?{result_status:'Completed'}:{}),
      ...(verified&&report?{doctor_approval:original.doctor_approval||{by:original.radiology_action_by,at:original.radiology_action_at,test_ids:tests.map((test:Row)=>test.test_id||null)}}:{}),
    },
  };
}

export async function migrateRadiologyWorkspace(client:Pick<PoolClient,'query'>) {
  const version='radiology_into_laboratory_workspace_v1';
  if((await client.query('SELECT name FROM hospital_feature_migrations WHERE name=$1',[version])).rows.length)return;
  const table=await client.query("SELECT to_regclass('public.role_work_items')::text name");
  if(table.rows[0]?.name){
    await client.query(`CREATE TABLE IF NOT EXISTS diagnostic_workspace_migration_backup(id uuid PRIMARY KEY,tenant_id uuid,record jsonb NOT NULL,created_at timestamptz DEFAULT now())`);
    const rows=await client.query("SELECT * FROM role_work_items WHERE workspace='radiology' ORDER BY id FOR UPDATE");
    for(const row of rows.rows){
      await client.query('INSERT INTO diagnostic_workspace_migration_backup(id,tenant_id,record) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[row.id,row.tenant_id,JSON.stringify(row)]);
      const migrated=laboratoryOrderFromRadiology(row);
      await client.query('UPDATE role_work_items SET workspace=$1,kind=$2,status=$3,data=$4 WHERE id=$5',[migrated.workspace,migrated.kind,migrated.status,JSON.stringify(migrated.data),row.id]);
    }
  }
  await client.query('INSERT INTO hospital_feature_migrations(name) VALUES($1)',[version]);
}
