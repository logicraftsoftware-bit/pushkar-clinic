import type { PoolClient } from "pg";
import { z } from "zod";

export const checkInBody = z.object({
  payment: z.object({
    amount: z.number().finite().min(0).max(99999999.99)
      .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use at most two decimal places."),
    method: z.string().trim().max(100),
    reference: z.string().trim().max(150).prefault(""),
  }).optional(),
});

export class CheckInError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Lock the appointment so retries or two reception desks cannot collect twice.
export async function checkInAppointment(
  client: PoolClient, tenantId: string, branchIds: string[] | null,
  appointmentId: string, actorId: string, input: z.infer<typeof checkInBody>, methods: string[],
) {
  await client.query("BEGIN");
  try {
    const found = await client.query(
      `SELECT * FROM clinical_appointments WHERE id=$1 AND tenant_id=$2
       AND ($3::uuid[] IS NULL OR branch_id=ANY($3)) FOR UPDATE`,
      [appointmentId, tenantId, branchIds],
    );
    const row = found.rows[0];
    if (!row) throw new CheckInError(404, "Appointment not found.");
    if (!["booked", "confirmed"].includes(String(row.status).trim().toLowerCase()))
      throw new CheckInError(409, "This appointment can no longer be checked in. Refresh the patient list.");
    const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
    const fee = cents(row.consultation_fee), discount = cents(row.discount);
    const charges = Array.isArray(row.charges) ? row.charges.reduce((sum: number, item: { amount?: unknown }) => sum + cents(item.amount), 0) : 0;
    let total = Math.max(0, fee + charges - discount);
    let paid = cents(row.paid_amount), paymentStatus = row.payment_status;
    let consultationFee = fee, method = row.payment_mode, reference = row.payment_reference || "";
    const alreadyPaid = ["paid", "payment not required"].includes(String(paymentStatus).trim().toLowerCase());
    if (alreadyPaid && input.payment) throw new CheckInError(409, "Payment is already recorded. Refresh the patient list before checking in.");
    if (!alreadyPaid) {
      const payment = input.payment;
      if (!payment) throw new CheckInError(400, "Enter payment details before checking in.");
      const amount = cents(payment.amount);
      if (amount > 0 && !methods.includes(payment.method)) throw new CheckInError(400, "Select a valid payment method.");
      // Imported appointments can have no fee. The form explicitly tells the
      // receptionist that their entered amount establishes the consultation fee.
      if (fee === 0 && charges === 0 && discount === 0 && paid === 0 && amount > 0) {
        consultationFee = amount;
        total = amount;
      }
      const due = Math.max(0, total - paid);
      if (due > 0 && amount === 0) throw new CheckInError(400, "Enter an amount greater than zero.");
      if (amount > due) throw new CheckInError(400, `Payment exceeds the outstanding amount of ${(due / 100).toFixed(2)}.`);
      paid += amount;
      paymentStatus = total === 0 ? "Payment not required" : paid >= total ? "Paid" : "Partially Paid";
      if (amount > 0) {
        method = payment.method;
        reference = payment.reference;
        await client.query(
          `INSERT INTO finance_records(tenant_id,kind,record_number,patient_id,branch_id,data,amount,total,paid,due,status,record_date,created_by)
           VALUES($1,'payments',$2,$3,$4,$5,$6,$6,$6,0,'Paid',(now() AT TIME ZONE 'Asia/Kolkata')::date,$7)`,
          [tenantId, `OPD-CHECKIN-${row.id}`, row.patient_id, row.branch_id,
            JSON.stringify({ appointment_id: row.id, appointment_number: row.appointment_number, payment_method: method, transaction_reference: reference, source: "OPD Check-in" }),
            amount / 100, actorId],
        );
      }
    }
    const updated = await client.query(
      `UPDATE clinical_appointments SET status='Checked In',consultation_fee=$1,paid_amount=$2,
       payment_status=$3,payment_mode=$4,payment_reference=$5,updated_at=now()
       WHERE id=$6 AND tenant_id=$7 RETURNING *`,
      [consultationFee / 100, paid / 100, paymentStatus, method, reference, row.id, tenantId],
    );
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
