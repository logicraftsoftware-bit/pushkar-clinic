import {Router} from 'express';
import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import {db,transaction} from './database.mjs';
import {requirePermission,allowedBranches,assertBranch,writeAudit} from './access.mjs';
const router=Router(),uuid=z.string().uuid();
const kind=z.enum(['items','categories','suppliers','purchase-orders','purchases','stock-transfers','assets']);
const editable=new Set(['items','categories','suppliers','purchase-orders','assets']);
const nullableId=z.union([uuid,z.literal(''),z.null()]).optional().transform(value=>value||null);
const quantity=z.coerce.number().finite().nonnegative().max(99999999).refine(value=>Math.abs(value*1000-Math.round(value*1000))<0.00001,'Use at most three decimal places for quantities.');
const money=z.coerce.number().finite().nonnegative().max(99999999.99).multipleOf(0.01);
const input=z.object({branch_id:nullableId,supplier_id:nullableId,category_id:nullableId,item_id:nullableId,record_date:z.union([z.string().date(),z.literal('')]).optional(),status:z.string().max(80).default('Active'),quantity:quantity.default(0),amount:money.default(0),data:z.record(z.string(),z.unknown()).default({}),request_id:uuid.optional(),updated_at:z.string().datetime().optional()});
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function inventoryScope(response,extra={},session) {
  const ids=await allowedBranches(response.locals.account,response.locals.claims.portal,session);
  return {$and:[{tenant_id:response.locals.account.tenant_id},...(ids===null?[]:[{$or:[{branch_id:{$in:ids}},{branch_id:null,kind:{$in:['categories','suppliers']}}]}]),extra]};
}
async function reference(response,identity,expected,session) {
  if(!identity)return null;
  const row=await db.collection('inventory_records').findOne(await inventoryScope(response,{id:identity,kind:expected},session),{session});
  if(!row||row.status==='Inactive')throw failure(`Select an active ${expected} record in an authorized branch.`);
  return row;
}
async function enrich(response,rows) {
  const tenant_id=response.locals.account.tenant_id;
  for(const row of rows){
    const [branch,category,supplier,item,destination]=await Promise.all([
      row.branch_id?db.collection('branches').findOne({tenant_id,id:row.branch_id}):null,
      row.category_id?db.collection('inventory_records').findOne({tenant_id,id:row.category_id,kind:'categories'}):null,
      row.supplier_id?db.collection('inventory_records').findOne({tenant_id,id:row.supplier_id,kind:'suppliers'}):null,
      row.item_id?db.collection('inventory_records').findOne({tenant_id,id:row.item_id,kind:'items'}):null,
      row.data?.to_branch?db.collection('branches').findOne({tenant_id,id:row.data.to_branch}):null,
    ]);
    Object.assign(row,{branch_name:branch?.name??'',category_name:category?.data?.name??'',supplier_name:supplier?.data?.name??'',item_name:item?.data?.name??'',destination_branch_name:destination?.name??''});
  }
  return rows;
}
router.get('/inventory/:kind',requirePermission('inventory.view'),async(request,response)=>{
  const requested=z.enum([...kind.options,'stock','low-stock']).parse(request.params.kind);
  const rows=await db.collection('inventory_records').find(await inventoryScope(response,{kind:['stock','low-stock'].includes(requested)?'items':requested}),{projection:{_id:0,request_hash:0}}).sort({record_date:-1,created_at:-1}).toArray();
  response.json(await enrich(response,requested==='low-stock'?rows.filter(row=>Number(row.quantity)<=Number(row.data?.reorder_level??0)):rows));
});
async function validate(response,body,resource,session) {
  if(body.branch_id)await assertBranch(response,body.branch_id,session);
  if(['items','assets'].includes(resource)&&!body.branch_id)throw failure('Select a branch.');
  for(const [field,expected] of [['category_id','categories'],['supplier_id','suppliers']]){
    const ref=await reference(response,body[field],expected,session);
    if(ref?.branch_id&&body.branch_id&&ref.branch_id!==body.branch_id)throw failure('Inventory references must belong to the selected branch or be shared.');
  }
  if(['items','categories','suppliers','assets'].includes(resource))body.data.name=z.string().trim().min(1).max(200).parse(body.data.name);
  if(resource==='assets')body.data.serial_number=z.string().trim().min(1).max(200).parse(body.data.serial_number);
  if(resource==='items'){
    if(body.data.reorder_level!==undefined)body.data.reorder_level=quantity.parse(body.data.reorder_level);
    if(body.data.purchase_price!==undefined)body.data.purchase_price=money.parse(body.data.purchase_price);
  }
  if(['purchase-orders','purchases'].includes(resource)&&!body.supplier_id)throw failure('Select a supplier.');
  if(['purchase-orders','purchases','stock-transfers'].includes(resource)){
    if(!body.quantity)throw failure('Enter a quantity greater than zero.');
    const source=await reference(response,uuid.parse(body.item_id),'items',session);
    if(body.branch_id&&body.branch_id!==source.branch_id)throw failure('The source branch must match the item.');
    body.branch_id=source.branch_id;await assertBranch(response,source.branch_id,session);
    if(resource==='purchases')await db.collection('inventory_records').updateOne({tenant_id:source.tenant_id,id:source.id},{$set:{quantity:(Math.round(source.quantity*1000)+Math.round(body.quantity*1000))/1000,updated_at:new Date()}},{session});
    if(resource==='stock-transfers'){
      const destination=await reference(response,uuid.parse(body.data.destination_item_id),'items',session),branch=uuid.parse(body.data.to_branch);
      await assertBranch(response,branch,session);
      if(destination.id===source.id||destination.branch_id===source.branch_id||destination.branch_id!==branch)throw failure('Select a destination item in a different branch.');
      if(source.data.name!==destination.data.name||(source.data.unit??'')!==(destination.data.unit??''))throw failure('Transfer items must have matching names and units.');
      if(Math.round(source.quantity*1000)<Math.round(body.quantity*1000))throw failure('Insufficient stock.',409);
      for(const [row,delta] of [[source,-1],[destination,1]])await db.collection('inventory_records').updateOne({tenant_id:row.tenant_id,id:row.id},{$set:{quantity:(Math.round(row.quantity*1000)+delta*Math.round(body.quantity*1000))/1000,updated_at:new Date()}},{session});
    }
  }
}
router.post('/inventory/:kind',requirePermission('inventory.manage'),async(request,response)=>{
  const resource=kind.parse(request.params.kind),body=input.parse(request.body),tenant_id=response.locals.account.tenant_id;
  const request_hash=createHash('sha256').update(JSON.stringify({resource,body})).digest('hex');
  const result=await transaction(async session=>{
    await db.collection('workflow_locks').updateOne({_id:`${tenant_id}:inventory`},{$inc:{version:1}},{session,upsert:true});
    if(body.request_id){
      const existing=await db.collection('inventory_records').findOne({tenant_id,request_id:body.request_id},{session,projection:{_id:0}});
      if(existing){if(existing.request_hash!==request_hash)throw failure('This request ID was already used with different values.',409);delete existing.request_hash;return existing;}
    }
    await validate(response,body,resource,session);
    const counter=await db.collection('counters').findOneAndUpdate({_id:`${tenant_id}:inventory:${resource}`},{$inc:{value:1}},{session,upsert:true,returnDocument:'after'});
    const prefixes={items:'ITM',categories:'CAT',suppliers:'SUP','purchase-orders':'PO',purchases:'PUR','stock-transfers':'TRF',assets:'AST'};
    const record_code=body.data.code?z.string().trim().min(1).max(100).parse(body.data.code):`${prefixes[resource]}-${String(counter.value).padStart(5,'0')}`;
    const now=new Date(),row={...body,id:randomUUID(),tenant_id,kind:resource,record_code,record_date:body.record_date||day(),status:['purchases','stock-transfers'].includes(resource)?'Completed':body.status,created_by:response.locals.account.id,created_at:now,updated_at:now,...(body.request_id?{request_hash}:{})};
    await db.collection('inventory_records').insertOne({...row},{session});
    await writeAudit(response,'inventory_created',row.id,session,{kind:resource,quantity:row.quantity,source_item_id:row.item_id,destination_item_id:row.data.destination_item_id??null});
    delete row.request_hash;return row;
  });response.status(201).json(result);
});
router.put('/inventory/:kind/:id',requirePermission('inventory.manage'),async(request,response)=>{
  const resource=kind.parse(request.params.kind),recordId=uuid.parse(request.params.id),body=input.parse(request.body);
  if(!editable.has(resource))throw failure('Posted stock movements are immutable.',409);
  if(!body.updated_at)throw failure('Refresh the record before editing.',409);
  const saved=await transaction(async session=>{
    const tenant_id=response.locals.account.tenant_id;
    await db.collection('workflow_locks').updateOne({_id:`${tenant_id}:inventory`},{$inc:{version:1}},{session,upsert:true});
    const filter=await inventoryScope(response,{id:recordId,kind:resource},session),previous=await db.collection('inventory_records').findOne(filter,{session});
    if(!previous)throw failure('Inventory record not found.',404);
    if(new Date(previous.updated_at).toISOString()!==body.updated_at)throw failure('Record changed. Refresh before editing.',409);
    if(['items','assets'].includes(resource)&&previous.branch_id!==body.branch_id)throw failure('Use a stock transfer to move items between branches.');
    await validate(response,body,resource,session);
    const {_id,...old}=previous,row={...old,...body,updated_at:new Date(Math.max(Date.now(),new Date(previous.updated_at).getTime()+1))};
    delete row.request_id;delete row.request_hash;
    // Preserve original retry identity so creating again cannot duplicate posted stock.
    if(previous.request_id){row.request_id=previous.request_id;row.request_hash=previous.request_hash;}
    await db.collection('inventory_records').replaceOne(filter,row,{session});
    await writeAudit(response,'inventory_updated',recordId,session,{kind:resource,previous_quantity:previous.quantity,quantity:row.quantity});
    delete row.request_hash;return row;
  });response.json(saved);
});
export default router;
