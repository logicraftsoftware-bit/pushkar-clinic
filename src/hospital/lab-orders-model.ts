import {awaitingLabSample} from "../../server/src/lab-sample-queue";
type Row=Record<string,any>;
export function labOrderPresentation(row:Row){
  const data=row.data||{},kind=String(row.kind).toLowerCase(),result=String(data.result_status||'');
  let sample=row.status||'Pending';
  if(row.status==='Cancelled')sample='Cancelled';
  else if(row.status==='Rejected'||data.processing_status==='Rejected')sample='Rejected';
  else if(data.collected_at)sample=['Completed','Partially Completed'].includes(result)?'Sample Collected':result==='In Progress'||data.processing_status==='Accepted'?'Processing':'Sample Collected';
  else if(row.status==='Barcode Generated')sample='Barcode Generated';
  else if(awaitingLabSample({...row,workspace:row.workspace||'laboratory'})||kind==='sample collection'||data.sample_requested_at)sample='Awaiting Sample';
  const tone=['Cancelled','Rejected'].includes(sample)?'red':sample==='Processing'?'blue':['Sample Collected','Paid'].includes(sample)?'green':sample==='Barcode Generated'?'violet':['Awaiting Payment','Partially Paid'].includes(sample)?'amber':'gray';
  return {sample,tone,type:({orders:'Tests',pos:'POS','sample collection':'Samples',results:'Results',verification:'Verification',reports:'Reports'} as Record<string,string>)[kind]||row.kind,
    resultLabel:data.doctor_approval?'Doctor Approved':result||'—',
    resultTone:data.doctor_approval?'green':result==='Completed'?'blue':result==='Partially Completed'?'amber':'gray',
    billingLabel:!row.bill_id?'Not Generated':Number(row.bill_due)>0&&Number(row.bill_paid)===0?'Unpaid':'Bill Generated',
    billingTone:!row.bill_id?'gray':Number(row.bill_due)>0&&Number(row.bill_paid)===0?'red':'green'};
}
export function labOrderTrend(current:unknown,previous:unknown){
  const now=Number(current)||0,before=Number(previous)||0;
  if(!before)return {label:now?'New this month':'No change',direction:now?'up':'flat'};
  const percent=Math.round((now-before)/before*100);
  return {label:`${percent>0?'+':''}${percent}%`,direction:percent>0?'up':percent<0?'down':'flat'};
}
export function labOrderPages(current:number,total:number):(number|'gap')[]{
  const visible=[...new Set([1,total,current-1,current,current+1].filter(page=>page>=1&&page<=total))].sort((a,b)=>a-b);
  const pages:(number|'gap')[]=[];for(const page of visible){const last=pages.at(-1);if(typeof last==='number'&&page-last>1)pages.push('gap');pages.push(page);}return pages;
}
