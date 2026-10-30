// Match calendar-month subscriptions, including month ends and leap years.
export function subscriptionEnd(date, billingCycle) {
  const starts = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(starts.getTime()) || starts.toISOString().slice(0,10) !== date || !['monthly','yearly'].includes(billingCycle)) throw new Error('Invalid subscription dates.');
  const months = billingCycle === 'monthly' ? 1 : 12;
  const target = new Date(Date.UTC(starts.getUTCFullYear(),starts.getUTCMonth()+months,1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(starts.getUTCDate(),lastDay));
  return target;
}
