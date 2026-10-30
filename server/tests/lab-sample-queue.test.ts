import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {awaitingLabSample,inLabSampleQueue,labSampleQueueSql,sampleCollectionRow} from '../src/lab-sample-queue.js';
import {labOrderPresentation} from '../../src/hospital/lab-orders-model.js';

test('new doctor and direct orders enter sample collection automatically regardless of payment; completed, cancelled and imported orders stay out',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE role_work_items(id int,workspace text,kind text,status text,data jsonb)');
    const rows:any[]=[];
    const add=(kind:string,status:string,extra:any={})=>rows.push({id:rows.length+1,workspace:'laboratory',kind,status,data:{tests:[{test_id:'test',name:'Blood test'}],...extra}});
    add('orders','Pending');add('pos','Paid');add('pos','Partially Paid');add('pos','Awaiting Payment');
    add('sample collection','Barcode Generated',{barcodes:[{value:'barcode'}]});
    add('pos','Cancelled');add('results','Sample Collected',{collected_at:'now'});
    add('pos','Paid',{import_source:'legacy'});add('pos','Paid',{read_only:true});
    add('pos','Paid',{tests:[]});add('pos','Paid',{result_status:'Completed'});add('pos','Paid',{cancellation_request_id:'cancel'});
    for(const row of rows)await db.query('INSERT INTO role_work_items VALUES($1,$2,$3,$4,$5)',[row.id,row.workspace,row.kind,row.status,row.data]);
    const result=await db.query<any>(`SELECT w.id FROM role_work_items w WHERE w.workspace='laboratory' AND ${labSampleQueueSql} ORDER BY w.id`);
    assert.deepEqual(result.rows.map(row=>row.id),[1,2,3,4,5]);
    assert.deepEqual(rows.filter(inLabSampleQueue).map(row=>row.id),[1,2,3,4,5]);
    for(const row of rows.slice(0,4)){
      assert.ok(awaitingLabSample(row));assert.equal(sampleCollectionRow(row).status,'Awaiting Sample');
      assert.equal(labOrderPresentation(row).sample,'Awaiting Sample');
    }
    assert.equal(rows[1].status,'Paid','listing must not overwrite the stored payment state');
    assert.equal(sampleCollectionRow(rows[4]).status,'Barcode Generated');
    assert.equal(awaitingLabSample(rows[4]),false,'generating barcodes twice must be rejected');
  }finally{await db.close();}
});
