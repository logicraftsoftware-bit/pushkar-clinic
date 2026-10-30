type Row=Record<string,any>;
export function labPaymentHistory(payments:Row[],legacy:Row[]=[],bill?:Row){
  const old=legacy.filter(row=>Number(row.amount)>0).map(row=>({id:`legacy-${row.pay_id}`,record_number:`Legacy payment ${row.pay_id}`,record_date:row.date,amount:Number(row.amount),data:{payment_mode:row.payment_mode,transaction_reference:row.transaction_no||row.cheque_ref_no,legacy:true,balance_after:row.balance_amount!==""&&row.balance_amount!=null?Number(row.balance_amount):undefined}}));
  const snapshot=bill?.data?.initial_payment;
  const initial=Number(snapshot?.amount??bill?.data?.paid_amount??0);
  const recorded=[...old,...payments].reduce((sum,row)=>sum+Number(row.amount),0);
  const alreadyRecorded=payments.some(row=>Number(row.data?.previous_paid)===0&&Math.abs(Number(row.amount)-initial)<.005);
  const recoverable=bill&&!bill.data?.read_only&&!old.length&&initial>0&&!alreadyRecorded&&recorded+initial<=Number(bill.paid)+.005;
  const first=recoverable?[{id:`initial-${bill.id}`,record_number:`${bill.record_number}-INITIAL`,record_date:snapshot?.at||bill.created_at||bill.record_date,amount:initial,data:{initial_payment:true,payment_mode:snapshot?.payment_mode||(!bill.data?.payment_updated_at?bill.data?.payment_mode:undefined),balance_after:snapshot?.balance_after??bill.data?.due_amount}}]:[];
  return [...old,...first,...payments];
}
