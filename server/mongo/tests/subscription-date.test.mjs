import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionEnd,calendarMonthsEnd } from '../subscription-date.mjs';
test('calendar subscriptions clamp to the target month instead of overflowing',()=>{
  assert.equal(subscriptionEnd('2026-10-31','monthly').toISOString().slice(0,10),'2026-11-30');
  assert.equal(subscriptionEnd('2024-01-31','monthly').toISOString().slice(0,10),'2024-02-29');
  assert.equal(subscriptionEnd('2024-02-29','yearly').toISOString().slice(0,10),'2025-02-28');
  assert.throws(()=>subscriptionEnd('2026-02-30','monthly'));
  assert.equal(calendarMonthsEnd('2026-01-31',2).toISOString().slice(0,10),'2026-03-31');
});
