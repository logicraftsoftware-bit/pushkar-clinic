import {test} from 'node:test';
import assert from 'node:assert/strict';
import {subscriptionState,subscriptionSummary,trialEnd} from '../subscription-policy.mjs';
const row={status:'active',starts_at:'2026-11-01T00:00:00Z',expires_at:'2026-12-01T00:00:00Z',billing_cycle:'monthly',monthly_amount:1200};
test('access ends at the exact expiry instant, and cannot start early',()=>{
  assert.equal(subscriptionState(row,Date.parse(row.expires_at)-1),'active');
  assert.equal(subscriptionState(row,Date.parse(row.expires_at)),'expired');
  assert.equal(subscriptionState(row,Date.parse(row.starts_at)-1),'scheduled');
  assert.equal(subscriptionState(null),'missing');
  assert.equal(subscriptionState({...row,expires_at:'bad'}),'invalid');
  assert.equal(subscriptionState({...row,status:'cancelled'}),'cancelled');
});
test('MRR normalizes annual price and excludes trials, cancellations and expired terms',()=>{
  const now=Date.parse('2026-11-10');
  assert.equal(subscriptionSummary({...row,billing_cycle:'yearly'},now).monthly_value,100);
  assert.equal(subscriptionSummary({...row,status:'trial'},now).monthly_value,0);
  assert.equal(subscriptionSummary(row,Date.parse('2026-12-02')).monthly_value,0);
  assert.equal(subscriptionSummary({...row,status:'superseded'},now).monthly_value,0);
  assert.equal(subscriptionSummary(row,now).renewal_warning,true);
});
test('legacy trial days shorten calendar billing expiry and are never silently extended',()=>{
  assert.equal(trialEnd('2026-11-01',14).toISOString(),'2026-11-15T00:00:00.000Z');
  assert.equal(subscriptionState({...row,status:'trial',trial_days:14},Date.parse('2026-11-15')),'expired');
  assert.throws(()=>trialEnd('2026-11-01',0));
});
