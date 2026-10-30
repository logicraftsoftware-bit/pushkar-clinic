export function receptionReportAllowed(bill:Record<string,any>|null,doctorApproval:unknown):boolean{
  if(!bill||!doctorApproval||typeof doctorApproval!=="object"||Array.isArray(doctorApproval)||bill.status!=="Paid")return false;
  if([bill.total,bill.paid,bill.due].some(value=>value===undefined||value===null||value===""))return false;
  const total=Number(bill.total),paid=Number(bill.paid),due=Number(bill.due);
  return [total,paid,due].every(Number.isFinite)&&total>=0&&paid>=total&&due===0;
}
export function labCollectionTotals(subtotal:number,discount:number,previousPaid:number,received:number){
  if(![subtotal,discount,previousPaid,received].every(Number.isFinite)||subtotal<0||discount<0||discount>subtotal||previousPaid<0||received<0.01||Math.abs(received*100-Math.round(received*100))>0.000001)throw new Error("Enter a valid payment amount");
  const total=Math.round((subtotal-discount)*100)/100,paid=Math.round((previousPaid+received)*100)/100;
  if(paid>total)throw new Error("Payment exceeds the remaining balance");
  const due=Math.round((total-paid)*100)/100;
  return {total,paid,due,status:due===0?"Paid":"Partially Paid"};
}
