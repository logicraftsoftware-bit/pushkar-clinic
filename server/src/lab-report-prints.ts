import type {Request,Response} from 'express';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {accessibleBranchIds} from './branch-access.js';
import {receptionReportAllowed} from './reception-lab.js';
import {reportPrintRevisionSql,savedPrintableKeys} from './lab-report-print-model.js';
type Actor={sub:string;tenantId:string;branchId:string;role:string;portal?:string};
export const reportPrintSchemaSql=`CREATE TABLE IF NOT EXISTS lab_report_print_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id),
  order_id uuid NOT NULL REFERENCES role_work_items(id),revision text NOT NULL,test_ids text[] NOT NULL,
  request_id uuid NOT NULL,confirmed_by uuid NOT NULL REFERENCES users(id),confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,order_id,request_id));
  CREATE INDEX IF NOT EXISTS lab_report_print_order ON lab_report_print_events(tenant_id,order_id,revision,confirmed_at DESC);`;
let ready:Promise<unknown>|undefined;
export function ensureReportPrints(){return ready??=pool.query(reportPrintSchemaSql).catch(error=>{ready=undefined;throw error;});}
export async function reportPrintEvents(orderId:string,tenantId:string,revision:string,db:Pick<PoolClient,'query'>=pool){
  await ensureReportPrints();
  return (await db.query(`SELECT e.revision,e.test_ids,e.confirmed_at,trim(concat_ws(' ',u.first_name,u.last_name)) confirmed_by_name
    FROM lab_report_print_events e LEFT JOIN users u ON u.id=e.confirmed_by AND u.tenant_id=e.tenant_id
    WHERE e.order_id=$1 AND e.tenant_id=$2 AND e.revision=$3 ORDER BY e.confirmed_at DESC`,[orderId,tenantId,revision])).rows;
}
export async function confirmReportPrint(req:Request&{portalUser?:Actor},res:Response){
  const body=z.object({test_ids:z.array(z.string().min(1).max(200)).min(1).max(300),revision:z.string().regex(/^[a-f0-9]{32}$/),request_id:z.string().uuid()}).parse(req.body);
  const actor=req.portalUser!,branches=await accessibleBranchIds(actor);
  await ensureReportPrints();const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const row=(await client.query(`SELECT w.*,f.total,f.paid,f.due,f.status bill_status,${reportPrintRevisionSql} report_revision
      FROM role_work_items w LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id
      WHERE w.id=$1 AND w.tenant_id=$2 AND w.workspace='laboratory' AND ($3::uuid[] IS NULL OR w.branch_id=ANY($3)) FOR UPDATE OF w`,[req.params.id,actor.tenantId,branches])).rows[0];
    if(!row)throw Error('Report not found or outside your branch access');
    if(['Cancelled','Rejected','Refunded'].includes(row.status)||row.data?.cancellation_request_id)throw Error('This report is no longer available for printing');
    if(row.report_revision!==body.revision)throw Error('Report changed. Reopen it and print the current version before confirming.');
    if(!['Completed','Partially Completed'].includes(row.data?.result_status))throw Error('Saved results are required');
    if(actor.role==='receptionist'&&!receptionReportAllowed({...row,status:row.bill_status},row.data.doctor_approval))throw Error('Full payment and doctor approval are required');
    const keys=[...new Set(body.test_ids)].sort(),allowed=new Set(savedPrintableKeys(row.data));
    if(keys.some(key=>!allowed.has(key)))throw Error('One or more tests have no non-zero printable results, are unavailable or are awaiting doctor approval');
    const prior=(await client.query('SELECT test_ids,revision FROM lab_report_print_events WHERE tenant_id=$1 AND order_id=$2 AND request_id=$3',[actor.tenantId,row.id,body.request_id])).rows[0];
    if(prior&&(prior.revision!==body.revision||JSON.stringify([...prior.test_ids].sort())!==JSON.stringify(keys)))throw Error('This print confirmation was already used for another selection');
    if(!prior)await client.query('INSERT INTO lab_report_print_events(tenant_id,order_id,revision,test_ids,request_id,confirmed_by) VALUES($1,$2,$3,$4,$5,$6)',[actor.tenantId,row.id,body.revision,keys,body.request_id,actor.sub]);
    await client.query('COMMIT');
    res.json({events:await reportPrintEvents(String(row.id),actor.tenantId,body.revision,client)});
  }catch(error){await client.query('ROLLBACK');res.status(409).json({error:error instanceof Error?error.message:'Unable to confirm printing'});}finally{client.release();}
}
