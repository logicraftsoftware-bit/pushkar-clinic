import {createHmac,timingSafeEqual} from 'node:crypto';
export function verifyCapturedCheckout({secret,signature,order,payment,amount,orderId,paymentId}) {
  const fail=()=>{throw Object.assign(new Error('Online payment has not been verified for this booking.'),{status:402});};
  if(!Number.isSafeInteger(amount)||amount<=0||typeof signature!=='string'||!/^[a-f0-9]{64}$/i.test(signature))fail();
  const expected=createHmac('sha256',secret).update(`${orderId}|${paymentId}`).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))fail();
  if(order.id!==orderId||order.currency!=='INR'||order.amount!==amount||order.amount_paid!==amount||order.status!=='paid'||payment.id!==paymentId||payment.order_id!==orderId||payment.currency!=='INR'||payment.amount!==amount||payment.status!=='captured'||payment.captured!==true||Number(payment.amount_refunded??0)!==0)fail();
  return true;
}
