import {Router} from 'express';
import {z} from 'zod';
import {db} from './database.mjs';
import {scopeFor,requirePermission} from './access.mjs';
import {escapeSearch} from './search.mjs';
const router=Router();
router.get('/lab/test-status-report',requirePermission('lab.order.view'),async(request,response)=>{
  const filters=z.object({from:z.string().date(),to:z.string().date(),test_id:z.string().uuid().or(z.literal('')).default(''),status:z.enum(['all','pending','conducted']).default('all'),search:z.string().trim().max(150).default(''),test_search:z.string().trim().max(150).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(request.query);
  if(filters.from>filters.to)return response.status(400).json({error:'From Date must be on or before To Date.'});
  const match=await scopeFor(response,{workspace:'laboratory',kind:{$in:['orders','pos','sample collection','results','verification','reports']},status:{$nin:['Cancelled','Rejected']},occurred_at:{$gte:new Date(filters.from+'T00:00:00+05:30'),$lte:new Date(filters.to+'T23:59:59.999+05:30')}});
  const lookup=(from,local,as)=>({$lookup:{from,let:{identity:local,tenant:'$tenant_id'},pipeline:[{$match:{$expr:{$and:[{$eq:['$id','$$identity']},{$eq:['$tenant_id','$$tenant']}]}}}],as}});
  const savedTest={$arrayElemAt:[{$filter:{input:{$ifNull:['$data.lab_results',[]]},as:'saved',cond:{$eq:['$$saved.test_id','$data.tests.test_id']}}},0]};
  const definition={$arrayElemAt:[{$filter:{input:'$definitions',as:'definition',cond:{$eq:['$$definition.id','$$parameter.parameter_id']}}},0]};
  const resultType={$ifNull:['$$parameter.result_type_id',{$let:{vars:{definition},in:{$ifNull:['$$definition.data.result_type_id','3']}}}]};
  const required={$filter:{input:{$ifNull:['$saved.parameters',[]]},as:'parameter',cond:{$not:[{$in:[resultType,['0','5']]}]}}};
  const value={$trim:{input:{$convert:{input:'$$parameter.value',to:'string',onNull:'',onError:''}}}};
  const filled={$size:{$filter:{input:'$required',as:'parameter',cond:{$ne:[value,'']}}}};
  const barcodeRows={$filter:{input:{$ifNull:['$data.barcodes',[]]},as:'barcode',cond:{$eq:['$$barcode.test_id','$data.tests.test_id']}}};
  const barcode={$reduce:{input:barcodeRows,initialValue:'',in:{$concat:['$$value',{$cond:[{$eq:['$$value','']},'',', ']},'$$this.value']}}};
  const patientName={$trim:{input:{$concat:[{$ifNull:['$patient.first_name','']},' ',{$ifNull:['$patient.last_name','']}]}}};
  const completed={$and:[{$gt:[{$size:'$required'},0]},{$eq:['$filled',{$size:'$required'}]}]};
  const stages=[
    {$match:match},{$unwind:'$data.tests'},
    ...(filters.test_id?[{$match:{'data.tests.test_id':filters.test_id}}]:[]),
    lookup('patients','$patient_id','patient'),lookup('finance_records','$data.bill_id','invoice'),
    {$set:{patient:{$arrayElemAt:['$patient',0]},invoice:{$arrayElemAt:['$invoice',0]},saved:savedTest}},
    {$lookup:{from:'hospital_diagnostic_masters',let:{ids:{$ifNull:['$saved.parameters.parameter_id',[]]},tenant:'$tenant_id'},pipeline:[{$match:{$expr:{$and:[{$eq:['$tenant_id','$$tenant']},{$in:['$id','$$ids']}]}}}],as:'definitions'}},
    {$set:{required}},{$set:{filled}},
    {$project:{_id:0,order_id:'$id',test_id:'$data.tests.test_id',test_name:{$ifNull:['$data.tests.test_name',{$ifNull:['$data.tests.name','Laboratory test']}]},report_date:{$dateToString:{date:'$occurred_at',format:'%Y-%m-%d',timezone:'Asia/Kolkata'}},registered_at:'$occurred_at',uhid:{$ifNull:['$patient.medical_record_number',{$ifNull:['$data.medical_record_number','']}]},patient_name:{$cond:[{$ne:[{$ifNull:['$patient.id',null]},null]},patientName,{$ifNull:['$data.customer_name','Patient link pending']}]},bill_number:{$ifNull:['$invoice.record_number',{$ifNull:['$data.bill_number','']}]},barcode,result_status:{$cond:[completed,'Completed',{$cond:[{$gt:['$filled',0]},'Partially Completed','Pending']}]}}}
  ];
  if(filters.test_search)stages.push({$match:{test_name:{$regex:escapeSearch(filters.test_search),$options:'i'}}});
  if(filters.search)stages.push({$match:{$or:['uhid','patient_name','bill_number','barcode','test_name'].map(field=>({[field]:{$regex:escapeSearch(filters.search),$options:'i'}}))}});
  const status=filters.status==='all'?[]:[{$match:{result_status:filters.status==='conducted'?'Completed':{$ne:'Completed'}}}];
  const summaryGroup={_id:null,total:{$sum:1},pending:{$sum:{$cond:[{$ne:['$result_status','Completed']},1,0]}},conducted:{$sum:{$cond:[{$eq:['$result_status','Completed']},1,0]}}};
  const window={$setWindowFields:{partitionBy:{$concat:['$report_date','/','$test_id']},output:{group_total:{$count:{}}}}};
  const facet={$facet:{summary:[{$group:summaryGroup}],total:[...status,{$count:'total'}],rows:[...status,window,{$sort:{report_date:1,test_name:1,test_id:1,registered_at:1,order_id:1}},{$skip:(filters.page-1)*100},{$limit:100}]}};
  const [result]=await db.collection('role_work_items').aggregate([...stages,facet]).toArray();
  const summary=result?.summary[0]??{total:0,pending:0,conducted:0};delete summary._id;response.json({rows:result?.rows??[],total:result?.total[0]?.total??0,summary,page:filters.page,page_size:100});
});
export default router;
