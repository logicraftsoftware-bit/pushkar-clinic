import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {permissionsFor,assertBranch,writeAudit} from './access.mjs';
import {validateLabPrices} from './lab-price-validation.mjs';
import {cents} from './money.mjs';
const router=Router(),domainInput=z.enum(['pathology','blood','symptoms']),kindInput=z.enum(['test','category','unit','parameter','product','type','head','specimen','container','method','approver']);
router.use(['/diagnostic-masters','/diagnostic-branches'],async(request,response,next)=>{
  const permissions=await permissionsFor(response.locals.account),required=request.method==='GET'?['hospital.manage','lab.order.view','radiology.view']:['hospital.manage','lab.result.create','radiology.report.create'];
  if(!permissions.includes('*')&&!required.some(code=>permissions.includes(code)))return response.status(403).json({error:'Diagnostic master permission required.'});
  next();
});
router.get('/diagnostic-branches',async(_request,response)=>{
  const {allowedBranches}=await import('./access.mjs');
  const ids=await allowedBranches(response.locals.account,response.locals.claims.portal);
  response.json(await db.collection('branches').find({tenant_id:response.locals.account.tenant_id,is_active:true,...(ids===null?{}:{id:{$in:ids}})},{projection:{_id:0,id:1,name:1}}).toArray());
});
router.get('/diagnostic-masters/:domain/:kind',async(request,response)=>{
  const domain=domainInput.parse(request.params.domain),kind=kindInput.parse(request.params.kind);
  response.json(await db.collection('hospital_diagnostic_masters').find({tenant_id:response.locals.account.tenant_id,domain,kind},{projection:{_id:0}}).sort({created_at:-1}).toArray());
});
async function save(request,response){
  const domain=domainInput.parse(request.params.domain),kind=kindInput.parse(request.params.kind),recordId=request.params.id?z.string().uuid().parse(request.params.id):randomUUID();
  const body=z.object({name:z.string().trim().min(1).max(200),data:z.record(z.string(),z.unknown()).prefault({})}).parse(request.body),tenant_id=response.locals.account.tenant_id;
  if(domain==='pathology'&&kind==='test')body.data.test_type=z.enum(['Pathology','Radiology','Neurology']).prefault('Pathology').parse(body.data.test_type);
  delete body.data.created_branch_id;
  const result=await transaction(async session=>{
    const existing=request.params.id?await db.collection('hospital_diagnostic_masters').findOne({tenant_id,id:recordId,domain,kind},{session}):null;
    if(request.params.id&&!existing)throw Object.assign(new Error('Diagnostic record not found'),{status:404});
    const branches=validateLabPrices(body.data);
    for(const branch of branches)await assertBranch(response,branch,session);
    if(body.data.available_branch_ids)for(const branch of z.array(z.string().uuid()).max(100).parse(body.data.available_branch_ids))await assertBranch(response,branch,session);
    for(const field of ['amount','standard_charge'])if(body.data[field]!==undefined)cents(body.data[field]);
    for(const value of Object.values(body.data.branch_prices??{}))cents(value);
    for(const [field,type] of [['unit_id','unit'],['type_id','type'],['category_id','category']])if(body.data[field]&&!await db.collection('hospital_diagnostic_masters').findOne({tenant_id,id:z.string().uuid().parse(body.data[field]),domain,kind:type},{session}))throw Object.assign(new Error(`Invalid ${type} selection`),{status:400});
    for(const [field,type] of [['billing_category_id','category'],['charge_id','charge']])if(body.data[field]&&!await db.collection('hospital_charge_masters').findOne({tenant_id,id:z.string().uuid().parse(body.data[field]),kind:type},{session}))throw Object.assign(new Error(`Invalid billing ${type} selection`),{status:400});
    for(const [field,type] of [['parameter_ids','parameter'],['container_ids','container']]){
      const ids=z.array(z.string().uuid()).max(1000).prefault([]).parse(body.data[field]);
      if(ids.length!==new Set(ids).size)throw Object.assign(new Error(`Duplicate ${type} selections`),{status:400});
      if(ids.length&&await db.collection('hospital_diagnostic_masters').countDocuments({tenant_id,id:{$in:ids},domain,kind:type},{session})!==ids.length)throw Object.assign(new Error(`Invalid ${type} selections`),{status:400});
    }
    const now=new Date(),data={...body.data,...(domain==='pathology'&&kind==='test'?{created_branch_id:existing?.data?.created_branch_id??response.locals.account.branch_id}:{})};
    const record={id:recordId,tenant_id,domain,kind,name:body.name,data,created_at:existing?.created_at??now,updated_at:now};
    if(existing)await db.collection('hospital_diagnostic_masters').replaceOne({tenant_id,id:recordId},{...record},{session});
    else await db.collection('hospital_diagnostic_masters').insertOne({...record},{session});
    await writeAudit(response,'diagnostic_master_saved',recordId,session,{domain,kind});return record;
  });response.status(request.params.id?200:201).json(result);
}
router.post('/diagnostic-masters/:domain/:kind',save);
router.put('/diagnostic-masters/:domain/:kind/:id',save);
export default router;
