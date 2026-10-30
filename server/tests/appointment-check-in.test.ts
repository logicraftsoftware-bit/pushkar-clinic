import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { checkInAppointment, checkInBody, CheckInError } from "../src/appointment-check-in.js";

const appointment = {
  id: "appointment-1", tenant_id: "hospital-1", patient_id: "patient-1", branch_id: "branch-1",
  appointment_number: "AP-1", status: "Booked", consultation_fee: "500.00",
  charges: [{ amount: 100 }], discount: "50.00", paid_amount: "0.00",
  payment_status: "Pending", payment_mode: "", payment_reference: "",
};
function fixture(overrides = {}, failAt = "", missing = false) {
  const row = { ...appointment, ...overrides };
  const queries: { sql: string; values: unknown[] }[] = [];
  const client = { async query(sql: string, values: unknown[] = []) {
    queries.push({ sql, values });
    if (failAt && sql.includes(failAt)) throw new Error("Database write failed");
    if (sql.startsWith("SELECT")) return { rows: missing ? [] : [row] };
    if (sql.startsWith("UPDATE")) return { rows: [{ ...row, status: "Checked In", consultation_fee: values[0], paid_amount: values[1], payment_status: values[2], payment_mode: values[3], payment_reference: values[4] }] };
    return { rows: [] };
  } } as unknown as PoolClient;
  return { queries, run: (body: unknown) => checkInAppointment(client, "hospital-1", ["branch-1"], row.id, "staff-1", checkInBody.parse(body), ["Cash", "UPI"]) };
}
const payment = (amount: number, method = "Cash", reference = "") => ({ payment: { amount, method, reference } });

test("full payment includes charges and discount, persists reference and creates a receipt in the transaction", async () => {
  const f = fixture();
  const result = await f.run(payment(550, "UPI", " UTR123 "));
  assert.equal(result.status, "Checked In"); assert.equal(result.paid_amount, 550);
  assert.equal(result.payment_status, "Paid"); assert.equal(result.payment_reference, "UTR123");
  const lock = f.queries[1]!;
  assert.match(lock.sql, /tenant_id=\$2/); assert.match(lock.sql, /branch_id=ANY/); assert.match(lock.sql, /FOR UPDATE/);
  assert.deepEqual(lock.values, ["appointment-1", "hospital-1", ["branch-1"]]);
  const receipt = f.queries.find(query => query.sql.startsWith("INSERT"))!;
  assert.equal(receipt.values[5], 550);
  assert.equal(JSON.parse(String(receipt.values[4])).transaction_reference, "UTR123");
  assert.equal(JSON.parse(String(receipt.values[4])).payment_method, "UPI");
  assert.equal(f.queries[0]?.sql, "BEGIN"); assert.equal(f.queries.at(-1)?.sql, "COMMIT");
});
test("partial payment adds to prior collections without charging them again", async () => {
  const f = fixture({ paid_amount: "100.00", payment_status: "Partially Paid" });
  const result = await f.run(payment(200));
  assert.equal(result.paid_amount, 300); assert.equal(result.payment_status, "Partially Paid");
  assert.equal(f.queries.find(query => query.sql.startsWith("INSERT"))?.values[5], 200);
});
test("paid patients check in without another receipt or changing payment details", async () => {
  const f = fixture({ paid_amount: "550.00", payment_status: "Paid", payment_mode: "UPI", payment_reference: "existing" });
  const result = await f.run({});
  assert.equal(result.payment_reference, "existing"); assert.equal(result.paid_amount, 550);
  assert.equal(f.queries.some(query => query.sql.startsWith("INSERT")), false);
});
test("unpriced imported appointment saves the entered consultation fee", async () => {
  const result = await fixture({ consultation_fee: 0, charges: [], discount: 0 }).run(payment(700));
  assert.equal(result.consultation_fee, 700); assert.equal(result.payment_status, "Paid");
});
test("explicit zero for a free appointment creates no payment record", async () => {
  const f = fixture({ consultation_fee: 0, charges: [], discount: 0 });
  const result = await f.run(payment(0, ""));
  assert.equal(result.payment_status, "Payment not required");
  assert.equal(f.queries.some(query => query.sql.startsWith("INSERT")), false);
});
for (const [name, body, overrides, status] of [
  ["missing payment", {}, {}, 400],
  ["zero payment against a balance", payment(0), {}, 400],
  ["overpayment", payment(551), {}, 400],
  ["invalid method", payment(550, "Unknown"), {}, 400],
  ["duplicate check-in", payment(550), { status: "Checked In" }, 409],
  ["cancelled appointment", payment(550), { status: "Cancelled" }, 409],
  ["stale unpaid screen", payment(550), { payment_status: "Paid" }, 409],
] as const) {
  test(`rejects ${name} and rolls back before any write`, async () => {
    const f = fixture(overrides);
    await assert.rejects(f.run(body), (error: unknown) => error instanceof CheckInError && error.status === status);
    assert.equal(f.queries.at(-1)?.sql, "ROLLBACK");
    assert.equal(f.queries.some(query => /^(INSERT|UPDATE)/.test(query.sql)), false);
  });
}
test("inaccessible appointments do not produce a write", async () => {
  const f = fixture({}, "", true);
  await assert.rejects(f.run(payment(550)), (error: unknown) => error instanceof CheckInError && error.status === 404);
  assert.equal(f.queries.at(-1)?.sql, "ROLLBACK");
});
for (const failAt of ["INSERT", "UPDATE"]) {
  test(`a failed ${failAt} rolls back payment and check-in`, async () => {
    const f = fixture({}, failAt);
    await assert.rejects(f.run(payment(550)), /Database write failed/);
    assert.equal(f.queries.at(-1)?.sql, "ROLLBACK");
    assert.equal(f.queries.some(query => query.sql === "COMMIT"), false);
  });
}
test("payment schema rejects negative, non-finite, excessive and fractional-paisa values", () => {
  for (const amount of [-1, Infinity, NaN, 100000000, 0.001]) assert.equal(checkInBody.safeParse(payment(amount)).success, false);
  assert.equal(checkInBody.safeParse(payment(0.29)).success, true);
  assert.equal(checkInBody.safeParse({ payment: { amount: 1, method: "Cash" } }).success, true);
});
