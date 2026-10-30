export function cents(value){
  const number=Number(value??0);
  if(!Number.isFinite(number)||number<0||number>99999999.99||Math.abs(number*100-Math.round(number*100))>0.00001)throw Object.assign(new Error('Enter a valid non-negative amount with at most two decimal places.'),{status:400});
  return Math.round(number*100);
}
export function appointmentTotal(row){
  const gross=cents(row.consultation_fee)+(row.charges??[]).reduce((sum,charge)=>sum+cents(charge.amount),0);
  const discount=cents(row.discount);
  if(discount>gross)throw Object.assign(new Error('Discount exceeds appointment charges.'),{status:400});
  return gross-discount;
}
export function paymentStatus(total,paid){return total===0?'Payment not required':paid>=total?'Paid':paid>0?'Partially Paid':'Unpaid';}
