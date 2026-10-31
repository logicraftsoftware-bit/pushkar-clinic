import {Router} from 'express';
import {z} from 'zod';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,permissionsFor,writeAudit} from './access.mjs';
import {resultRecord,reportRevision} from './lab-result-record.mjs';
import {savedPrintableKeys} from './lab-report-print-model.mjs';
import {canonicalReportPdf} from './report-pdf.mjs';
const router=Router(),uuid=z.string().uuid(),failure=message=>Object.assign(new Error(message),{status:409});
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
function ready(row){return row?.data?.collected_at&&['Completed','Partially Completed'].includes(row.data.result_status)&&savedPrintableKeys(row.data).length&&!['Cancelled','Rejected','Refunded'].includes(row.status)&&!row.data.cancellation_request_id;}
function paid(bill){return bill?.status==='Paid'&&Number(bill.due)===0&&Number.isFinite(Number(bill.total))&&Number(bill.paid)>=Number(bill.total);}
async function releaseRecord(response,id,session){
  const account=response.locals.account,permission=account.role==='receptionist'?'billing.view':'lab.order.view',permissions=await permissionsFor(account,session);
  if(!permissions.includes('*')&&!permissions.includes(permission))throw Object.assign(new Error('Laboratory report access is required.'),{status:403});
  const row=await db.collection('role_work_items').findOne(await scopeFor(response,{id,workspace:'laboratory'},session),{session});
  if(!ready(row))throw failure('Only current doctor-approved reportable results can be released.');
  const record=await resultRecord(row,session);
  if(account.role==='receptionist'&&!paid(record.report_bill))throw Object.assign(new Error('Full payment and doctor approval are required.'),{status:403});
  return {row,record};
}
router.post('/work-items/:id/lab-report-print',async(request,response)=>{
  const input=z.object({test_ids:z.array(uuid).min(1).max(300),revision:z.string().regex(/^[a-f0-9]{64}$/),request_id:uuid}).parse(request.body),id=uuid.parse(request.params.id);
  const events=await transaction(async session=>{
    const {row}=await releaseRecord(response,id,session),revision=reportRevision(row.data);
    if(revision!==input.revision)throw failure('Report changed. Reopen and print the current version.');
    await db.collection('role_work_items').updateOne({tenant_id:row.tenant_id,id},{$inc:{report_print_version:1}},{session});
    const selected=[...new Set(input.test_ids)].sort(),allowed=new Set(savedPrintableKeys(row.data));
    if(selected.some(id=>!allowed.has(id)))throw failure('One or more tests are not approved for printing.');
    const prior=await db.collection('report_print_events').findOne({tenant_id:row.tenant_id,order_id:id,request_id:input.request_id},{session});
    if(prior&&(prior.revision!==revision||JSON.stringify(prior.test_ids)!==JSON.stringify(selected)))throw failure('This print request was already used for another selection.');
    if(!prior){
      await db.collection('report_print_events').insertOne({id:randomUUID(),tenant_id:row.tenant_id,order_id:id,revision,test_ids:selected,request_id:input.request_id,confirmed_by:response.locals.account.id,confirmed_by_name:`${response.locals.account.first_name} ${response.locals.account.last_name}`,confirmed_at:new Date(),created_at:new Date()},{session});
      await writeAudit(response,'lab_report_print_confirmed',id,session,{test_ids:selected,revision});
    }
    return db.collection('report_print_events').find({tenant_id:row.tenant_id,order_id:id,revision},{session,projection:{_id:0}}).sort({confirmed_at:-1}).toArray();
  });response.json({events});
});
router.post('/work-items/:id/lab-report-share',async(request,response)=>{
  const body=z.object({pdf:z.string().max(16000000).optional(),filename:z.string().max(120).default('Lab-Report.pdf'),updated_at:z.string().datetime()}).parse(request.body),id=uuid.parse(request.params.id),token=randomBytes(32).toString('hex');
  // Generate from the reviewed server record; never publish client-uploaded PDF content.
  const snapshot=await releaseRecord(response,id),revision=snapshot.record.report_revision;
  if(Date.parse(body.updated_at)!==new Date(snapshot.row.updated_at).getTime())throw failure('Report changed. Reopen it before sharing.');
  const pdf=await canonicalReportPdf(snapshot.record);
  const expires_at=new Date(Date.now()+7*86400000),filename=body.filename.replace(/[^a-z0-9_.-]/gi,'-')||'Lab-Report.pdf';
  await transaction(async session=>{
    const {row}=await releaseRecord(response,id,session);
    if(reportRevision(row.data)!==revision||new Date(row.updated_at).getTime()!==Date.parse(body.updated_at))throw failure('Report changed during preparation. Reopen it before sharing.');
    // Serialize release with edits/approval on the same order document.
    await db.collection('role_work_items').updateOne({tenant_id:row.tenant_id,id},{$inc:{report_release_version:1}},{session});
    await db.collection('report_shares').insertOne({id:randomUUID(),tenant_id:row.tenant_id,order_id:id,token_hash:tokenHash(token),pdf,filename,revision,require_payment:response.locals.account.role==='receptionist',created_by:response.locals.account.id,created_at:new Date(),expires_at},{session});
    await writeAudit(response,'lab_report_share_created',id,session,{revision,expires_at});
  });response.status(201).json({path:`/api/v1/lab-report-shares/${token}`,expires_at});
});
export const publicReports=Router();
publicReports.get('/:token',async(request,response)=>{
  if(!/^[a-f0-9]{64}$/.test(request.params.token))return response.status(404).send('Report link not found or expired');
  const shared=await transaction(async session=>{
    const share=await db.collection('report_shares').findOne({token_hash:tokenHash(request.params.token),expires_at:{$gt:new Date()}},{session});
    if(!share)return null;
    const row=await db.collection('role_work_items').findOne({tenant_id:share.tenant_id,id:share.order_id,workspace:'laboratory'},{session});
    const hospital=await db.collection('hospitals').findOne({id:share.tenant_id,deleted_at:null,status:{$in:['active','trial']}},{session});
    const branch=row?await db.collection('branches').findOne({tenant_id:share.tenant_id,id:row.branch_id,is_active:true},{session}):null;
    if(!hospital||!branch||!ready(row)||reportRevision(row.data)!==share.revision)return null;
    if(share.require_payment&&!paid(await db.collection('finance_records').findOne({tenant_id:row.tenant_id,id:row.data.bill_id},{session})))return null;
    return share;
  });
  if(!shared)return response.status(404).send('Report link not found, expired or no longer available');
  response.set({'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${shared.filename}"`,'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'});
  response.send(Buffer.isBuffer(shared.pdf)?shared.pdf:Buffer.from(shared.pdf.buffer));
});
export default router;
