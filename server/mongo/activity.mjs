import {Router} from 'express';
import {z} from 'zod';
import {db} from './database.mjs';
import {scopeFor,permissionsFor} from './access.mjs';
import {escapeSearch} from './search.mjs';
const router=Router();
async function activityScope(response,extra={}){const permissions=await permissionsFor(response.locals.account),admin=permissions.includes('*')||permissions.includes('audit.view');return scopeFor(response,{...extra,...(admin?{}:{actor_id:response.locals.account.id})});}
async function present(rows){
  for(const row of rows){const actor=await db.collection('users').findOne({tenant_id:row.tenant_id,id:row.actor_id},{projection:{first_name:1,last_name:1,role:1}});Object.assign(row,{actor_name:actor?`${actor.first_name} ${actor.last_name}`:'System',actor_role:actor?.role??'system',record_label:row.metadata?.record_label??row.record_id??'',module:row.metadata?.module??String(row.action).split('_')[0]});}return rows;
}
router.get('/',async(request,response)=>{
  const filters=z.object({search:z.string().trim().max(150).default(''),module:z.string().max(100).default(''),record:z.string().max(250).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(request.query),scope=await activityScope(response,filters.record?{record_id:filters.record}:{});
  const pipeline=[{$match:scope},{$set:{module:{$ifNull:['$metadata.module',{$arrayElemAt:[{$split:['$action','_']},0]}]}}},...(filters.module?[{$match:{module:filters.module}}]:[]),...(filters.search?[{$match:{$or:['record_id','action','metadata.record_label'].map(field=>({[field]:{$regex:escapeSearch(filters.search),$options:'i'}}))}}]:[])];
  const [result]=await db.collection('audit_events').aggregate([...pipeline,{$facet:{rows:[{$sort:{created_at:-1,id:-1}},{$skip:(filters.page-1)*50},{$limit:50},{$project:{_id:0}}],count:[{$count:'total'}]}}]).toArray();
  const modules=await db.collection('audit_events').aggregate([{$match:await activityScope(response)},{$project:{module:{$ifNull:['$metadata.module',{$arrayElemAt:[{$split:['$action','_']},0]}]}}},{$group:{_id:'$module'}},{$sort:{_id:1}}]).toArray();response.json({rows:await present(result?.rows??[]),total:result?.count[0]?.total??0,modules:modules.map(row=>row._id),page:filters.page,page_size:50});
});
router.get('/record',async(request,response)=>{
  const id=z.string().min(1).max(250).parse(request.query.id),module=z.string().regex(/^[a-z_]+$/).parse(request.query.module),rows=await present(await db.collection('audit_events').find(await activityScope(response,{record_id:id}),{projection:{_id:0}}).sort({created_at:1,id:1}).toArray());
  if(!rows.length)return response.status(404).json({error:'No accessible tracking history for this record.'});
  // Explicit audit events are retained even when the UI uses a legacy table name.
  response.json({events:rows,created:rows.find(row=>/(?:created|registered)$/.test(row.action))??null,module});
});
export default router;
