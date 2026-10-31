import {Router} from 'express';
import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {scopeFor,assertBranch,allowedBranches,requirePermission,writeAudit} from './access.mjs';
import {cents} from './money.mjs';
import {configuredPrefix} from './settings.mjs';
import {hospitalDay} from './finance-ledger.mjs';
const router=Router();export const pharmacyMasters=Router();
const uuid=z.string().uuid(),name=z.string().trim().min(1).max(200),money=z.coerce.number().finite().nonnegative().max(99999999.99).multipleOf(0.01),quantity=z.coerce.number().finite().nonnegative().max(99999999).refine(value=>Math.abs(value*1000-Math.round(value*1000))<0.00001),percent=z.coerce.number().min(0).max(100).multipleOf(0.01);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const masterKind=z.enum(['category','supplier','dosage','interval','duration','unit','company','group','medicine']),masterInput=z.object({name,data:z.record(z.string(),z.unknown()).prefault({})});
async function serialize(tenant,session){await db.collection('workflow_locks').updateOne({_id:`${tenant}:inventory`},{$inc:{version:1}},{session,upsert:true});}
async function saveMaster(response,kind,body,identity){
  const tenant_id=response.locals.account.tenant_id;
  return transaction(async session=>{
    await serialize(tenant_id,session);
    for(const ref of ['category','dosage','interval','duration','unit','company','group'])if(body.data[ref+'_id']&&!await db.collection('hospital_pharmacy_masters').findOne({tenant_id,id:uuid.parse(body.data[ref+'_id']),kind:ref},{session}))throw failure(`Invalid medicine ${ref}.`);
    for(const field of ['tax','gst_percent'])if(body.data[field]!==undefined)body.data[field]=percent.parse(body.data[field]);
    for(const field of ['purchase_price','sale_price','mrp'])if(body.data[field]!==undefined)body.data[field]=money.parse(body.data[field]);
    const old=identity?await db.collection('hospital_pharmacy_masters').findOne({tenant_id,id:identity,kind},{session}):kind==='dosage'?await db.collection('hospital_pharmacy_masters').findOne({tenant_id,kind,name:body.name},{session}):null;
    if(identity&&!old)throw failure('Pharmacy master not found.',404);
    const now=new Date(),row={...body,id:old?.id??randomUUID(),tenant_id,kind,created_at:old?.created_at??now,updated_at:now};
    if(old)await db.collection('hospital_pharmacy_masters').replaceOne({tenant_id,id:old.id},row,{session});else await db.collection('hospital_pharmacy_masters').insertOne({...row},{session});
    await writeAudit(response,'pharmacy_master_saved',row.id,session,{kind});return row;
  });
}
pharmacyMasters.get('/pharmacy-masters/:kind',requirePermission('pharmacy.view'),async(request,response)=>response.json(await db.collection('hospital_pharmacy_masters').find({tenant_id:response.locals.account.tenant_id,kind:masterKind.parse(request.params.kind)},{projection:{_id:0}}).sort({created_at:-1}).toArray()));
pharmacyMasters.post('/pharmacy-masters/:kind',requirePermission('pharmacy.inventory.manage'),async(request,response)=>response.status(201).json(await saveMaster(response,masterKind.parse(request.params.kind),masterInput.parse(request.body))));
pharmacyMasters.put('/pharmacy-masters/:kind/:id',requirePermission('pharmacy.inventory.manage'),async(request,response)=>response.json(await saveMaster(response,masterKind.parse(request.params.kind),masterInput.parse(request.body),uuid.parse(request.params.id))));
async function removeMaster(response,kind,identity){
  await transaction(async session=>{
    const tenant_id=response.locals.account.tenant_id;await serialize(tenant_id,session);
    if(await db.collection('inventory_records').findOne({tenant_id,$or:[{'data.medicine_id':identity},{'data.supplier_id':identity}]},{session})||await db.collection('hospital_pharmacy_masters').findOne({tenant_id,['data.'+kind+'_id']:identity},{session}))throw failure('This master has stock or reference history. Set it inactive instead.',409);
    const removed=await db.collection('hospital_pharmacy_masters').deleteOne({tenant_id,id:identity,kind},{session});if(!removed.deletedCount)throw failure('Pharmacy master not found.',404);await writeAudit(response,'pharmacy_master_deleted',identity,session,{kind});
  });
}
pharmacyMasters.delete('/pharmacy-masters/:kind/:id',requirePermission('pharmacy.inventory.manage'),async(request,response)=>{await removeMaster(response,masterKind.parse(request.params.kind),uuid.parse(request.params.id));response.status(204).end();});
router.use('/pharmacy',(request,response,next)=>requirePermission(request.method==='GET'?'inventory.view':'inventory.manage')(request,response,next));
const supplier=z.object({name,contact_person:z.string().max(200).prefault(''),phone:z.string().max(30).prefault(''),email:z.union([z.string().email(),z.literal('')]).prefault(''),drug_license_number:z.string().max(200).prefault(''),gstin:z.string().max(100).prefault(''),address:z.string().max(2000).prefault(''),status:z.enum(['Active','Inactive']).prefault('Active'),notes:z.string().max(4000).prefault('')});
function supplierMaster(body){const {name,...data}=body;return {name,data:{...data,contact_person_name:data.contact_person,supplier_contact:data.phone,contact_person_phone:data.phone}};}
router.get('/pharmacy/suppliers',async(_request,response)=>response.json(await db.collection('hospital_pharmacy_masters').find({tenant_id:response.locals.account.tenant_id,kind:'supplier'},{projection:{_id:0}}).sort({name:1}).toArray()));
router.post('/pharmacy/suppliers',async(request,response)=>response.status(201).json(await saveMaster(response,'supplier',supplierMaster(supplier.parse(request.body)))));
router.put('/pharmacy/suppliers/:id',async(request,response)=>response.json(await saveMaster(response,'supplier',supplierMaster(supplier.parse(request.body)),uuid.parse(request.params.id))));
router.delete('/pharmacy/suppliers/:id',async(request,response)=>{await removeMaster(response,'supplier',uuid.parse(request.params.id));response.status(204).end();});
router.post('/pharmacy/medicines',async(request,response)=>{
  const body=z.object({name,hsn_code:z.string().max(100).prefault(''),tax:percent.prefault(0),packing_type:z.string().max(100).prefault('Box'),units_per_strip:quantity.refine(value=>value>0).optional(),volume_ml:quantity.optional()}).parse(request.body),{name:medicineName,...data}=body;
  response.status(201).json({...await saveMaster(response,'medicine',{name:medicineName,data}),price:0});
});
router.get('/pharmacy/lookups',async(_request,response)=>{
  const tenant_id=response.locals.account.tenant_id,ids=await allowedBranches(response.locals.account,response.locals.claims.portal),rows=await db.collection('hospital_pharmacy_masters').find({tenant_id,kind:{$in:['medicine','supplier']}},{projection:{_id:0}}).sort({name:1}).toArray();
  response.json({medicines:rows.filter(row=>row.kind==='medicine'),suppliers:rows.filter(row=>row.kind==='supplier'),branches:await db.collection('branches').find({tenant_id,is_active:true,...(ids===null?{}:{id:{$in:ids}})},{projection:{_id:0,id:1,name:1}}).toArray()});
});
function expiry(value){if(/^\d{4}-\d{2}$/.test(value)){const [year,month]=value.split('-').map(Number);if(month<1||month>12)throw failure('Invalid expiry month.');return `${value}-${String(new Date(Date.UTC(year,month,0)).getUTCDate()).padStart(2,'0')}`;}return z.string().date().parse(value);}
const purchaseInput=z.object({supplier_id:uuid,branch_id:z.union([uuid,z.literal('')]).optional(),invoice_number:name,purchase_date:z.string().date(),payment_status:z.enum(['Paid','Unpaid','Partially Paid']).prefault('Unpaid'),notes:z.string().max(4000).prefault(''),request_id:uuid.optional(),items:z.array(z.object({medicine_id:uuid,batch_number:name,manufacturing_date:z.union([z.string().date(),z.literal('')]).prefault(''),expiry_date:z.string().transform(expiry),quantity:quantity.refine(value=>value>0),free_quantity:quantity.prefault(0),purchase_rate:money,mrp:money,gst_percent:percent.prefault(0),discount_percent:percent.prefault(0)})).min(1).max(200)});
async function enrich(response,row){
  const tenant_id=row.tenant_id,supplier=row.data?.supplier_id?await db.collection('hospital_pharmacy_masters').findOne({tenant_id,id:row.data.supplier_id,kind:'supplier'}):null,branch=await db.collection('branches').findOne({tenant_id,id:row.branch_id});
  row.supplier_name=supplier?.name??'';row.branch_name=branch?.name??'';
  if(row.kind==='pharmacy-purchase')row.item_count=await db.collection('inventory_records').countDocuments({tenant_id,kind:'pharmacy-batch','data.purchase_id':row.id,status:{$ne:'Cancelled'}});
  if(row.kind==='pharmacy-batch'){const medicine=await db.collection('hospital_pharmacy_masters').findOne({tenant_id,id:row.data.medicine_id,kind:'medicine'});row.medicine_name=medicine?.name??'';row.medicine_data=medicine?.data??{};const today=hospitalDay(),soon=hospitalDay(new Date(Date.now()+90*86400000));row.batch_status=row.data.expiry_date<today?'Expired':row.data.expiry_date<=soon?'Expiring Soon':row.quantity<=0?'Out of Stock':'Available';}
  return row;
}
for(const [path,kind] of [['purchases','pharmacy-purchase'],['batches','pharmacy-batch']])router.get(`/pharmacy/${path}`,async(_request,response)=>{const rows=await db.collection('inventory_records').find(await scopeFor(response,{kind,status:{$ne:'Cancelled'}}),{projection:{_id:0,request_hash:0}}).sort({record_date:-1,created_at:-1}).toArray();for(const row of rows)await enrich(response,row);response.json(rows);});
router.get('/pharmacy/purchases/:id',async(request,response)=>{
  const row=await db.collection('inventory_records').findOne(await scopeFor(response,{id:uuid.parse(request.params.id),kind:'pharmacy-purchase',status:{$ne:'Cancelled'}}),{projection:{_id:0,request_hash:0}});if(!row)throw failure('Purchase not found.',404);
  const batches=await db.collection('inventory_records').find({tenant_id:row.tenant_id,kind:'pharmacy-batch','data.purchase_id':row.id,status:{$ne:'Cancelled'}},{projection:{_id:0}}).sort({record_code:1}).toArray();response.json({...await enrich(response,row),items:batches.map(batch=>({...batch.data,id:batch.id,quantity:batch.data.purchased_quantity,free_quantity:batch.data.free_quantity,current_quantity:batch.quantity}))});
});
async function unused(tenant,purchaseId,session){
  const batches=await db.collection('inventory_records').find({tenant_id:tenant,kind:'pharmacy-batch','data.purchase_id':purchaseId},{session}).toArray();
  if(batches.some(row=>Math.round(row.quantity*1000)!==Math.round((row.data.purchased_quantity+row.data.free_quantity)*1000))||await db.collection('pharmacy_stock_adjustments').findOne({tenant_id:tenant,batch_id:{$in:batches.map(row=>row.id)}},{session}))throw failure('This purchase has stock movement history and cannot be changed or deleted.',409);
  return batches;
}
for(const editing of [false,true])router[editing?'put':'post'](editing?'/pharmacy/purchases/:id':'/pharmacy/purchases',async(request,response)=>{
  const body=purchaseInput.parse(request.body),tenant_id=response.locals.account.tenant_id,identity=editing?uuid.parse(request.params.id):randomUUID(),hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const result=await transaction(async session=>{
    await serialize(tenant_id,session);const branch_id=body.branch_id||response.locals.account.branch_id;await assertBranch(response,branch_id,session);
    if(!editing&&body.request_id){const prior=await db.collection('inventory_records').findOne({tenant_id,kind:'pharmacy-purchase',request_id:body.request_id},{session,projection:{_id:0}});if(prior){if(prior.request_hash!==hash)throw failure('Request ID already used with different values.',409);delete prior.request_hash;return prior;}}
    const old=editing?await db.collection('inventory_records').findOne(await scopeFor(response,{id:identity,kind:'pharmacy-purchase',status:{$ne:'Cancelled'}},session),{session}):null;
    if(editing&&!old)throw failure('Purchase not found.',404);
    if(old){await unused(tenant_id,identity,session);if(old.branch_id!==branch_id)throw failure('A posted purchase cannot be moved to another branch.');}
    const supplier=await db.collection('hospital_pharmacy_masters').findOne({tenant_id,id:body.supplier_id,kind:'supplier','data.status':{$ne:'Inactive'}},{session});if(!supplier)throw failure('Select an active supplier in this clinic.');
    let subtotal=0,total=0;
    for(const line of body.items){if(!await db.collection('hospital_pharmacy_masters').findOne({tenant_id,id:line.medicine_id,kind:'medicine','data.status':{$ne:'Inactive'}},{session}))throw failure('Select active medicine masters in this clinic.');if(line.manufacturing_date&&line.manufacturing_date>line.expiry_date||line.expiry_date<body.purchase_date)throw failure('Expiry must follow manufacture and purchase dates.');const net=Math.round(cents(line.purchase_rate)*line.quantity*(10000-Math.round(line.discount_percent*100))/10000);subtotal+=net;total+=net+Math.round(net*Math.round(line.gst_percent*100)/10000);}
    cents(total/100);
    const counter=old?null:await db.collection('counters').findOneAndUpdate({_id:`${tenant_id}:pharmacy-purchase`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'}),code=old?.record_code??`${await configuredPrefix(tenant_id,'pharmacy_purchase_prefix','PHPN',session)}-${String(counter.value).padStart(6,'0')}`,now=new Date();
    const row={id:identity,tenant_id,kind:'pharmacy-purchase',record_code:code,branch_id,data:{supplier_id:body.supplier_id,invoice_number:body.invoice_number,payment_status:body.payment_status,notes:body.notes,subtotal:subtotal/100,tax:(total-subtotal)/100},amount:total/100,quantity:0,status:body.payment_status,record_date:body.purchase_date,created_by:old?.created_by??response.locals.account.id,created_at:old?.created_at??now,updated_at:now,...(old?.request_id?{request_id:old.request_id,request_hash:old.request_hash}:body.request_id?{request_id:body.request_id,request_hash:hash}:{})};
    if(old){await db.collection('inventory_records').replaceOne({tenant_id,id:identity},row,{session});await db.collection('inventory_records').deleteMany({tenant_id,kind:'pharmacy-batch','data.purchase_id':identity},{session});}else await db.collection('inventory_records').insertOne({...row},{session});
    for(const [index,line] of body.items.entries())await db.collection('inventory_records').insertOne({id:randomUUID(),tenant_id,kind:'pharmacy-batch',record_code:`${code}-B${String(index+1).padStart(2,'0')}`,branch_id,data:{...line,purchase_id:identity,supplier_id:body.supplier_id,purchased_quantity:line.quantity,reorder_level:10},quantity:(Math.round(line.quantity*1000)+Math.round(line.free_quantity*1000))/1000,amount:Math.round(cents(line.purchase_rate)*line.quantity)/100,status:'Available',record_date:body.purchase_date,created_by:response.locals.account.id,created_at:now,updated_at:now},{session});
    await writeAudit(response,old?'pharmacy_purchase_updated':'pharmacy_purchase_created',identity,session,{amount:row.amount});delete row.request_hash;return row;
  });response.status(editing?200:201).json(result);
});
router.delete('/pharmacy/purchases/:id',async(request,response)=>{const identity=uuid.parse(request.params.id);await transaction(async session=>{const tenant_id=response.locals.account.tenant_id;await serialize(tenant_id,session);const row=await db.collection('inventory_records').findOne(await scopeFor(response,{id:identity,kind:'pharmacy-purchase',status:{$ne:'Cancelled'}},session),{session});if(!row)throw failure('Purchase not found.',404);await unused(tenant_id,identity,session);await db.collection('inventory_records').updateMany({tenant_id,$or:[{id:identity},{kind:'pharmacy-batch','data.purchase_id':identity}]},{$set:{status:'Cancelled',quantity:0,updated_at:new Date()}},{session});await writeAudit(response,'pharmacy_purchase_cancelled',identity,session);});response.status(204).end();});
router.post('/pharmacy/batches/:id/adjust',async(request,response)=>{
  const identity=uuid.parse(request.params.id),body=z.object({quantity,reason:z.string().trim().min(2).max(2000),type:z.enum(['Add','Remove','Set']),request_id:uuid.optional()}).parse(request.body);
  const result=await transaction(async session=>{
    const tenant_id=response.locals.account.tenant_id;await serialize(tenant_id,session);
    const batch=await db.collection('inventory_records').findOne(await scopeFor(response,{id:identity,kind:'pharmacy-batch',status:{$ne:'Cancelled'}},session),{session});if(!batch)throw failure('Batch not found.',404);
    if(body.request_id){const prior=await db.collection('pharmacy_stock_adjustments').findOne({tenant_id,request_id:body.request_id},{session});if(prior){if(prior.batch_id!==identity||prior.requested_quantity!==body.quantity||prior.adjustment_type!==body.type||prior.reason!==body.reason)throw failure('Request ID already used with different values.',409);delete batch._id;return batch;}}
    const before=Math.round(batch.quantity*1000),requested=Math.round(body.quantity*1000),after=body.type==='Set'?requested:body.type==='Add'?before+requested:before-requested;if(after<0)throw failure('Adjustment exceeds available stock.',409);quantity.parse(after/1000);
    const now=new Date();await db.collection('inventory_records').updateOne({tenant_id,id:identity},{$set:{quantity:after/1000,'data.last_adjustment_reason':body.reason,'data.last_adjusted_at':now,updated_at:now}},{session});
    await db.collection('pharmacy_stock_adjustments').insertOne({id:randomUUID(),tenant_id,batch_id:identity,branch_id:batch.branch_id,adjustment_type:body.type,requested_quantity:body.quantity,quantity_before:before/1000,quantity_after:after/1000,reason:body.reason,created_by:response.locals.account.id,created_at:now,...(body.request_id?{request_id:body.request_id}:{})},{session});
    await writeAudit(response,'pharmacy_stock_adjusted',identity,session,{before:before/1000,after:after/1000,reason:body.reason});delete batch._id;return {...batch,quantity:after/1000,updated_at:now};
  });response.json(result);
});
router.get('/pharmacy/adjustments',async(_request,response)=>{const rows=await db.collection('pharmacy_stock_adjustments').find(await scopeFor(response),{projection:{_id:0}}).sort({created_at:-1}).limit(500).toArray();for(const row of rows){const batch=await db.collection('inventory_records').findOne({tenant_id:row.tenant_id,id:row.batch_id}),user=await db.collection('users').findOne({tenant_id:row.tenant_id,id:row.created_by});row.record_code=batch?.record_code??'';row.batch_number=batch?.data.batch_number??'';row.medicine_name=batch?(await db.collection('hospital_pharmacy_masters').findOne({tenant_id:row.tenant_id,id:batch.data.medicine_id}))?.name??'':'';row.adjusted_by=user?`${user.first_name} ${user.last_name}`:'';}response.json(rows);});
router.get('/pharmacy/summary',async(_request,response)=>{const rows=await db.collection('inventory_records').find(await scopeFor(response,{kind:'pharmacy-batch',status:{$ne:'Cancelled'}})).toArray(),today=hospitalDay(),soon=hospitalDay(new Date(Date.now()+90*86400000));response.json({active_batches:rows.filter(row=>row.quantity>0).length,medicines:new Set(rows.filter(row=>row.quantity>0).map(row=>row.data.medicine_id)).size,units:rows.reduce((sum,row)=>sum+Math.round(row.quantity*1000),0)/1000,stock_value:rows.reduce((sum,row)=>sum+Math.round(cents(row.data.purchase_rate)*row.quantity),0)/100,expiring:rows.filter(row=>row.quantity>0&&row.data.expiry_date>=today&&row.data.expiry_date<=soon).length,expired:rows.filter(row=>row.quantity>0&&row.data.expiry_date<today).length,low_stock:new Set(rows.filter(row=>row.quantity<=Number(row.data.reorder_level??10)).map(row=>row.data.medicine_id)).size});});
export default router;
