import {Router} from 'express';
import {z} from 'zod';
import {db} from './database.mjs';
import {requirePermission,scopeFor,allowedBranches,permissionsFor} from './access.mjs';
import {inventoryScope} from './inventory.mjs';
import {operationalSettings} from './settings.mjs';
const router=Router();
router.get('/finance/:kind',requirePermission('billing.view'),async(request,response)=>{
  const kind=z.enum(['invoices','payments','expenses','refunds','pharmacy-bill']).parse(request.params.kind);
  const filter=await scopeFor(response,{kind});
  const rows=await db.collection('finance_records').find(filter,{projection:{_id:0}}).sort({created_at:-1}).toArray();
  for(const row of rows){
    const patient=row.patient_id?await db.collection('patients').findOne({tenant_id:row.tenant_id,id:row.patient_id}):null;
    row.patient_name=patient?`${patient.first_name} ${patient.last_name}`:'';row.medical_record_number=patient?.medical_record_number??'';
    const branch=await db.collection('branches').findOne({tenant_id:row.tenant_id,id:row.branch_id});row.branch_name=branch?.name??'';
  }
  response.json(rows);
});
router.get('/lookups',async(request,response)=>{
  const tenant_id=response.locals.account.tenant_id,ids=await allowedBranches(response.locals.account,response.locals.claims.portal),permissions=await permissionsFor(response.locals.account);
  const has=code=>permissions.includes('*')||permissions.includes(code),billing=has('billing.view'),stock=has('inventory.view');
  if(!billing&&!stock)return response.status(403).json({error:'Billing or inventory access required.'});
  const requested=z.string().max(300).default(billing?'branches,patients,invoices':'branches,items,categories,suppliers,users').parse(request.query.keys).split(',').filter(Boolean);
  const result={};
  for(const key of new Set(requested)){
    if(key==='branches')result.branches=await db.collection('branches').find({tenant_id,is_active:true,...(ids===null?{}:{id:{$in:ids}})},{projection:{_id:0,id:1,name:1}}).toArray();
    else if(['patients','invoices'].includes(key)){
      if(!billing)return response.status(403).json({error:'Billing access required for patient and invoice lookups.'});
      if(key==='patients')result.patients=(await db.collection('patients').find(await scopeFor(response,{deleted_at:null}),{projection:{_id:0,id:1,first_name:1,last_name:1,medical_record_number:1}}).toArray()).map(row=>({...row,name:`${row.first_name} ${row.last_name}`}));
      else result.invoices=(await db.collection('finance_records').find(await scopeFor(response,{kind:'invoices'}),{projection:{_id:0,id:1,record_number:1,total:1,due:1}}).toArray()).map(row=>({...row,code:row.record_number}));
    }else if(['items','categories','suppliers'].includes(key)){
      if(!stock)return response.status(403).json({error:'Inventory access required.'});
      result[key]=(await db.collection('inventory_records').find(await inventoryScope(response,{kind:key,status:{$ne:'Inactive'}}),{projection:{_id:0,id:1,record_code:1,data:1,quantity:1,branch_id:1}}).toArray()).map(row=>({id:row.id,code:row.record_code,name:row.data?.name??'',stock:row.quantity,branch_id:row.branch_id}));
    }else if(key==='users')result.users=(await db.collection('users').find(await scopeFor(response,{is_active:true}),{projection:{_id:0,id:1,first_name:1,last_name:1}}).toArray()).map(row=>({id:row.id,name:`${row.first_name} ${row.last_name}`}));
  }
  const runtime=await operationalSettings(tenant_id);
  response.json({...result,payment_methods:runtime.payment_methods,general_settings:runtime.general});
});
export default router;
