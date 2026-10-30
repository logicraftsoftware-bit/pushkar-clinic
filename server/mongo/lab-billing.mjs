export function labBillingTotals(amounts          , discount        , paid        ) {
  const round = (value        ) => Math.round(value * 100) / 100;
  if ([...amounts, discount, paid].some(value => !Number.isFinite(value) || value < 0)) throw new Error("Invalid billing amount");
  const subtotal = round(amounts.reduce((sum, amount) => sum + amount, 0));
  discount = round(discount);
  paid = round(paid);
  const total = round(subtotal - discount);
  if (discount > subtotal || paid > total) throw new Error("Discount or payment exceeds the bill amount");
  const due = round(total - paid);
  return {subtotal, discount, paid, total, due, status: due === 0 ? "Paid" : paid > 0 ? "Partially Paid" : "Unpaid"};
}

export function labPharmacyBilling(amounts         ,manualDiscount       ,paid       ,percentage=0){
  if(!Number.isFinite(percentage)||percentage<0||percentage>100)throw Error('Invalid pharmacy discount percentage');
  const base=labBillingTotals(amounts,manualDiscount,0);
  const pharmacyDiscount=Math.round(base.total*percentage)/100;
  const totals=labBillingTotals(amounts,base.discount+pharmacyDiscount,paid);
  return {...totals,manual_discount_amount:base.discount,pharmacy_discount_percentage:percentage,pharmacy_discount_amount:pharmacyDiscount};
}
