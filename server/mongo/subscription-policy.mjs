export function subscriptionState(row, now = Date.now()) {
  if (!row) return 'missing';
  if (!['active','trial'].includes(row.status)) return row.status;
  const start = new Date(row.starts_at).getTime(), end = effectiveEnd(row);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'invalid';
  if (now < start) return 'scheduled';
  return now >= end ? 'expired' : row.status;
}
export function subscriptionSummary(row, now = Date.now()) {
  const status = subscriptionState(row, now), end=row?effectiveEnd(row):NaN,days_remaining = Number.isFinite(end)?Math.max(0, Math.ceil((end-now)/86400000)):0;
  return {...row,...(Number.isFinite(end)?{expires_at:new Date(end)}:{}),status,days_remaining,renewal_warning:['active','trial'].includes(status)&&days_remaining<=30,
    monthly_value:status==='active'?Number(row.monthly_amount??0)/(row.billing_cycle==='yearly'?12:1):0};
}
function effectiveEnd(row){
  const end=new Date(row.expires_at).getTime();
  // Correct existing trials without extending access or modifying clinic data.
  if(row.status==='trial'&&row.billing_cycle!=='trial'&&Number.isInteger(row.trial_days)&&row.trial_days>0)return Math.min(end,new Date(row.starts_at).getTime()+row.trial_days*86400000);
  return end;
}
export function trialEnd(date, days) {
  if (!Number.isInteger(days)||days<1||days>365) throw Error('A trial must have 1–365 days.');
  const start=new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==date) throw Error('Invalid trial start.');
  return new Date(start.getTime()+days*86400000);
}
