import type { LabImportPlan } from "./lab-import-plan.js";
import { csvNumber, readLegacyCsv } from "./lab-csv.js";
export type LabBranchMap={tenant_id:string;centers:Record<string,string>;primary_centers:Record<string,string>;price_sources:Record<string,"default"|"bgarh"|"aditya"|"lakhimpur">};
export function mapLaboratoryBranches(plan:LabImportPlan,map:LabBranchMap,directory:string){
  if(map.tenant_id!==plan.tenant_id)throw new Error("Branch mapping belongs to a different hospital");
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for(const id of [...Object.values(map.centers),...Object.keys(map.primary_centers)])if(!uuid.test(id))throw new Error("Invalid mapped branch identity");
  for(const order of plan.orders){
    if(order.legacy_center&&!map.centers[order.legacy_center])throw new Error(`No branch mapping for legacy centre ${order.legacy_center}`);
    order.branch_id=order.legacy_center?map.centers[order.legacy_center]:null;
    order.data.branch_review_required=!order.branch_id;
  }
  for(const patient of plan.patients){const branches=plan.orders.filter(order=>order.legacy_patient_id===patient.legacy_id).map(order=>order.branch_id).filter(Boolean);patient.branch_id=branches[0]||plan.branch_id;}
  for(const invoice of plan.invoices){const linked=plan.orders.filter(order=>invoice.order_ids.includes(order.id));const branches=[...new Set(linked.map(order=>order.branch_id))];if(branches.length!==1)throw new Error("A historical bill spans multiple branches; reconcile its source visit");invoice.branch_id=branches[0];}
  const rates=readLegacyCsv(directory,"testmaster_rate"),byTest=new Map<string,Record<string,number>>();
  for(const rate of rates){const id=rate.testid!,center=rate.centreno!,value=csvNumber(rate.rate,"centre test price"),prices=byTest.get(id)||{};if(prices[center]!==undefined&&prices[center]!==value)throw new Error(`Conflicting prices for test ${id}, centre ${center}`);prices[center]=value;byTest.set(id,prices);}
  for(const master of plan.masters.filter(master=>master.kind==="test")){
    const centrePrices=byTest.get(master.data.legacy_id)||{},branchPrices:Record<string,number>={};
    for(const [id,center] of Object.entries(map.primary_centers)){
      const source=map.price_sources[id];if(!source)throw new Error("Missing branch price source");
      const raw=source==="default"?master.data.amount:master.data.legacy_branch_rates[source];
      branchPrices[id]=centrePrices[center]??csvNumber(raw,"branch test price");
    }
    Object.assign(master.data,{branch_prices:branchPrices,legacy_center_rates:centrePrices});
  }
  plan.summary.branch_counts=Object.fromEntries([...new Set(plan.orders.map(order=>order.branch_id||"unassigned"))].map(id=>[id,plan.orders.filter(order=>(order.branch_id||"unassigned")===id).length]));
  plan.summary.branch_review_orders=plan.orders.filter(order=>!order.branch_id).length;
  plan.summary.branch_mapping=map;
}
