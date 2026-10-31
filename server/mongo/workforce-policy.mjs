import {cents} from './money.mjs';
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
export function payrollAmount(data) {
  const value=cents(data.basic_salary)+cents(data.allowances)+cents(data.overtime)-cents(data.deductions)-cents(data.tax);
  if(value<0)invalid('Payroll deductions exceed earnings.');
  return value/100;
}
export function claimAmounts(body) {
  const claimed=cents(body.claimed_amount),approved=cents(body.approved_amount),settled=cents(body.settled_amount);
  if(approved>claimed||settled>approved)invalid('Approved claims cannot exceed the claim, and settlement cannot exceed approval.');
  if(body.status==='Settled'&&settled!==approved)invalid('A settled claim must match its approved amount.');
  if(body.status==='Rejected'&&(approved||settled))invalid('Rejected claims cannot have approved or settled amounts.');
}
export function attendanceStatus(checkIn,staffType,roles,fallback) {
  if(!checkIn)return fallback;
  const rules=roles?.[staffType]??{};
  for(const [label,rule] of Object.entries(rules)){
    if(!rule||!/^\d{2}:\d{2}$/.test(rule.from??'')||!/^\d{2}:\d{2}$/.test(rule.upto??''))continue;
    const matches=rule.from<=rule.upto?checkIn>=rule.from&&checkIn<=rule.upto:checkIn>=rule.from||checkIn<=rule.upto;
    if(matches)return label.replace(/\s*\([^)]*\)$/,'').replace('Half Day Second Shift','Half Day');
  }
  return fallback;
}
