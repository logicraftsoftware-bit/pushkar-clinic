import type { LabImportPlan } from "./lab-import-plan.js";
export function validateLabImportPlan(plan:LabImportPlan){
  const masterIds=new Set(plan.masters.map(row=>row.id));
  if(!plan.masters.length||!plan.orders.length)throw new Error("Refusing an empty laboratory replacement");
  for(const [name,rows] of Object.entries({masters:plan.masters,patients:plan.patients,orders:plan.orders,invoices:plan.invoices})){
    if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error(`Duplicate ${name} identities in backup`);
  }
  for(const master of plan.masters){
    if(master.kind==="test"&&master.data.legacy?.category_id!=="1")throw new Error("Non-laboratory test in replacement plan");
    for(const id of [master.data.unit_id,master.data.category_id,...(master.data.parameter_ids||[]),...(master.data.sub_test_ids||[])].filter(Boolean))if(!masterIds.has(id))throw new Error(`Missing master reference for ${master.name}`);
    if(master.kind==="approver"&&"password" in (master.data.legacy||{}))throw new Error("Legacy credentials cannot be imported");
  }
  for(const order of plan.orders){
    if(!order.occurred_at)throw new Error("Order is missing an original timestamp");
    for(const test of order.data.tests||[])if(!masterIds.has(test.test_id))throw new Error("Historical test definition is missing");
  }
  for(const invoice of plan.invoices){
    if([invoice.amount,invoice.total,invoice.paid,invoice.due].some(value=>!Number.isFinite(value)||value<0)||Math.abs(invoice.total-invoice.paid-invoice.due)>.02)throw new Error("Historical invoice does not reconcile");
  }
  const resultRows=plan.orders.reduce((count,order)=>count+(order.data.lab_results||[]).reduce((sum:number,test:Record<string,any>)=>sum+(test.parameters||[]).length,0),0);
  if(plan.summary.lab_result_rows!==undefined&&resultRows!==plan.summary.lab_result_rows)throw new Error("Source laboratory results were lost during grouping");
  return {masters:plan.masters.length,orders:plan.orders.length,invoices:plan.invoices.length};
}
