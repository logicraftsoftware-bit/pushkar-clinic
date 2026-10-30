import {cents} from './money.mjs';
export function bedStayAmount(stay,now=new Date()){
  const start=new Date(stay.started_at).getTime(),end=new Date(stay.ended_at??now).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw new Error('Invalid bed-stay timestamps.');
  const days=Math.max(1,Math.ceil((end-start)/86400000)),amount=cents(stay.daily_rate)*days;
  if(!Number.isSafeInteger(amount))throw new Error('Bed-stay amount exceeds supported precision.');
  return {days,amount:amount/100};
}
export function inpatientTotal(stays,charges,discount,now=new Date()){
  const bed=stays.reduce((sum,stay)=>sum+Math.round(bedStayAmount(stay,now).amount*100),0);
  const services=charges.reduce((sum,item)=>sum+cents(item.amount),0),reduction=cents(discount);
  return {bed_amount:bed/100,total_amount:Math.max(0,bed+services-reduction)/100};
}
