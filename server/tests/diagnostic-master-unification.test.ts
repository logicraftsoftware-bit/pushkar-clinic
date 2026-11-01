import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {diagnosticMasterUnificationSql,diagnosticTestType,diagnosticClinicalDomain} from '../src/diagnostic-master-unification.js';
import {diagnosticMasterLabel} from '../../src/hospital/diagnostic-master-labels.js';

test('merge retires old radiology tests, preserves pathology data and patient history, and runs only once',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE hospital_diagnostic_masters(id uuid PRIMARY KEY,tenant_id uuid,domain text,kind text,name text,data jsonb);
      CREATE TABLE role_work_items(id integer,data jsonb);
      INSERT INTO hospital_diagnostic_masters VALUES
      ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','pathology','test','CBC','{"test_type":"Legacy","amount":500,"parameter_ids":["p1"]}'),
      ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010','radiology','test','Old X-Ray','{"amount":1000}'),
      ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000011','radiology','test','Other Clinic X-Ray','{}'),
      ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000010','blood','test','Blood Product','{}');
      INSERT INTO role_work_items VALUES(1,'{"tests":[{"test_id":"00000000-0000-4000-8000-000000000002","name":"Old X-Ray"}],"report":"Historical report"}');`);
    const history=(await db.query('SELECT data FROM role_work_items')).rows;
    await db.exec(diagnosticMasterUnificationSql);
    const rows=(await db.query<any>('SELECT * FROM hospital_diagnostic_masters ORDER BY id')).rows;
    assert.equal(rows.length,2);assert.equal(rows[0].data.test_type,'Pathology');
    assert.equal(rows[0].data.amount,500);assert.deepEqual(rows[0].data.parameter_ids,['p1']);assert.equal(rows[0].data.legacy_test_type,'Legacy');
    assert.equal(rows[1].domain,'blood');
    const archived=(await db.query<any>('SELECT record FROM retired_diagnostic_test_masters ORDER BY id')).rows;
    assert.equal(archived.length,2);assert.equal(archived[0].record.name,'Old X-Ray');
    assert.deepEqual((await db.query('SELECT data FROM role_work_items')).rows,history);
    await db.exec(`INSERT INTO hospital_diagnostic_masters VALUES('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000010','pathology','test','Future CT','{"test_type":"Radiology"}')`);
    await db.exec(diagnosticMasterUnificationSql);
    assert.equal((await db.query<any>("SELECT data FROM hospital_diagnostic_masters WHERE name='Future CT'")).rows[0].data.test_type,'Radiology');
    assert.equal((await db.query('SELECT * FROM retired_diagnostic_test_masters')).rows.length,2);
  } finally {await db.close();}
});
test('shared master defaults to Pathology and accepts all three diagnostic types',()=>{
  assert.equal(diagnosticTestType.parse(undefined),'Pathology');
  assert.equal(diagnosticTestType.parse('Radiology'),'Radiology');
  assert.equal(diagnosticTestType.parse('Neurology'),'Neurology');
  assert.equal(diagnosticClinicalDomain({data:{test_type:'Neurology'}}),'pathology');
  assert.throws(()=>diagnosticTestType.parse('Other'));
  assert.equal(diagnosticClinicalDomain({domain:'pathology',data:{test_type:'Radiology'}}),'radiology');
  assert.equal(diagnosticClinicalDomain({domain:'pathology',data:{}}),'pathology');
  for(const key of ['Pathology Test','Radiology Test','Lab Test Masters','Radiology Test Masters'])assert.equal(diagnosticMasterLabel(key),'Pathology, Radiology & Neurology Test Master');
});
