import {Router} from 'express';
import {z} from 'zod';
import {db} from './database.mjs';
import {requirePermission,scopeFor,allowedBranches} from './access.mjs';
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
router.get('/lookups',requirePermission('billing.view'),async(_request,response)=>{
  const tenant_id=response.locals.account.tenant_id,ids=await allowedBranches(response.locals.account,response.locals.claims.portal);
  const branches=await db.collection('branches').find({tenant_id,is_active:true,...(ids===null?{}:{id:{$in:ids}})},{projection:{_id:0,id:1,name:1}}).toArray();
  const patients=await db.collection('patients').find(await scopeFor(response,{deleted_at:null}),{projection:{_id:0,id:1,first_name:1,last_name:1,medical_record_number:1}}).toArray();
  response.json({branches,patients:patients.map(row=>({...row,name:`${row.first_name} ${row.last_name}`})),invoices:await db.collection('finance_records').find(await scopeFor(response,{kind:'invoices'}),{projection:{_id:0}}).toArray()});
});
export default router;
