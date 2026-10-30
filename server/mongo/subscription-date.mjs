// Match calendar-month subscriptions, including month ends and leap years.
export function calendarMonthsEnd(date, months) {
  const starts = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(starts.getTime()) || starts.toISOString().slice(0,10) !== date || !Number.isInteger(months) || months<1 || months>1200) throw new Error('Invalid subscription dates.');
  const target = new Date(Date.UTC(starts.getUTCFullYear(),starts.getUTCMonth()+months,1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(starts.getUTCDate(),lastDay));
  return target;
}
export function subscriptionEnd(date,billingCycle){
  if(!['monthly','yearly'].includes(billingCycle))throw new Error('Invalid subscription billing cycle.');
  return calendarMonthsEnd(date,billingCycle==='monthly'?1:12);
}
