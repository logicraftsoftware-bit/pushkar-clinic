import { randomUUID } from 'node:crypto';
import { db } from '../database.mjs';
import { slotsFor, receipt } from '../clinical.mjs';
import { configuredPrefix } from '../settings.mjs';
import { cents, paymentStatus } from '../money.mjs';
import { assignQueueSerial, sessionStart } from '../queue-service.mjs';
import { hospitalDay } from '../finance-ledger.mjs';
import {
  accountProfile,
  audit,
  clinicAccess,
  fail,
  lockDoctor,
  ownRow,
  pick,
  selectedDoctor,
  uuid,
} from './common.mjs';
import { clinicPatient } from './profiles.mjs';

export async function ownHold(account, id, session, { active = true } = {}) {
  const row = await db
    .collection('mobile_booking_holds')
    .findOne({ id: uuid.parse(id), account_id: account.id }, { session });
  if (!row) throw fail('Booking hold not found.', 404);
  await accountProfile(account, row.profile_id, session);
  if (active && (row.state !== 'Active' || row.expires_at <= new Date()))
    throw fail(
      'Booking hold expired. Select the appointment again.',
      409,
      'HOLD_EXPIRED'
    );
  return row;
}
export async function pricing(account, hold, doctor, session) {
  const profile = await accountProfile(account, hold.profile_id, session);
  if (!profile.name || !profile.date_of_birth)
    throw fail(
      'Complete the patient name and date of birth before payment.',
      409
    );
  const { settings } = await clinicAccess(hold.tenant_id, {
      session,
      module: 'opd',
    }),
    fee = cents(doctor.professional.consultation_fee ?? 0),
    bookingFee = cents(settings.booking_fee ?? 0);
  if (fee < 0 || bookingFee < 0)
    throw fail('Clinic pricing is unavailable.', 503);
  return {
    consultation_fee: fee / 100,
    charges: bookingFee
      ? [{ name: 'Booking Fee', amount: bookingFee / 100 }]
      : [],
    total_cents: fee + bookingFee,
    currency: 'INR',
    pay_at_clinic: settings.pay_at_clinic !== false,
  };
}
export async function appointmentView(row) {
  const [user, branch, hospital, patient] = await Promise.all([
    db
      .collection('users')
      .findOne({ id: row.doctor_id, tenant_id: row.tenant_id }),
    db
      .collection('branches')
      .findOne({ id: row.branch_id, tenant_id: row.tenant_id }),
    db.collection('hospitals').findOne({ id: row.tenant_id }),
    db
      .collection('patients')
      .findOne({ id: row.patient_id, tenant_id: row.tenant_id }),
  ]);
  return {
    ...pick(row, [
      'id',
      'patient_id',
      'mobile_profile_id',
      'appointment_number',
      'appointment_date',
      'appointment_time',
      'appointment_type',
      'visit_type',
      'reason',
      'symptoms',
      'consultation_fee',
      'charges',
      'discount',
      'paid_amount',
      'payment_status',
      'status',
      'token_number',
      'slot_serial',
      'queue_serial',
      'created_at',
      'updated_at',
    ]),
    patient_name: patient
      ? `${patient.first_name} ${patient.last_name}`.trim()
      : '',
    medical_record_number: patient?.medical_record_number ?? '',
    clinic_id: row.tenant_id,
    branch_id: row.branch_id,
    doctor_id: row.doctor_id,
    doctor_name: user ? `${user.first_name} ${user.last_name}`.trim() : '',
    clinic_name: hospital?.name ?? '',
    branch_name: branch?.name ?? '',
    total:
      (cents(row.consultation_fee) +
        (row.charges ?? []).reduce((sum, c) => sum + cents(c.amount), 0) -
        cents(row.discount ?? 0)) /
      100,
    currency: 'INR',
  };
}

// Shared by the authenticated confirmation endpoint and a verified payment webhook.
// No provider call happens inside a MongoDB transaction.
export async function confirmBooking(
  account,
  quoteId,
  paymentOrderId,
  payAtClinic,
  session
) {
  const quote = await db
    .collection('mobile_booking_quotes')
    .findOne({ id: uuid.parse(quoteId), account_id: account.id }, { session });
  if (!quote) throw fail('Booking quote not found.', 404);
  const payment = paymentOrderId
    ? await db.collection('mobile_payment_orders').findOne(
        {
          id: uuid.parse(paymentOrderId),
          account_id: account.id,
          quote_id: quote.id,
        },
        { session }
      )
    : null;
  if (paymentOrderId && !payment) throw fail('Payment order not found.', 404);
  if (payment?.refund_amount_cents > 0 || payment?.provider_refunded_cents > 0)
    throw fail(
      'This payment has been refunded and needs clinic review.',
      409,
      'PAYMENT_REFUNDED'
    );
  if (paymentOrderId && payAtClinic)
    throw fail('Choose either online payment or pay at clinic.');
  if (payment?.appointment_id) {
    const prior = await ownRow(
      account,
      'clinical_appointments',
      payment.appointment_id,
      {},
      session
    );
    return prior;
  }
  const hold = await ownHold(account, quote.hold_id, session);
  await lockDoctor(
    hold.tenant_id,
    hold.doctor_id,
    hold.appointment_date,
    session
  );
  if (quote.expires_at <= new Date())
    throw fail(
      'Booking quote expired. Contact reception if a payment was made.',
      409,
      'QUOTE_EXPIRED'
    );
  const doctor = await selectedDoctor(
      hold.tenant_id,
      hold.branch_id,
      hold.doctor_id,
      session
    ),
    price = await pricing(account, hold, doctor, session);
  // An unexpired quote is the server's price commitment; never accept client totals.
  if (
    quote.total_cents > 0 &&
    !payAtClinic &&
    (!payment ||
      payment.status !== 'Captured' ||
      payment.amount_cents !== quote.total_cents)
  )
    throw fail('Online payment has not been confirmed.', 402);
  if (payAtClinic && !price.pay_at_clinic)
    throw fail('This clinic requires online payment.', 402);
  const slot = (
    await slotsFor(
      doctor,
      hold.appointment_date,
      undefined,
      null,
      session,
      hold.id
    )
  ).find((s) => s.time === hold.appointment_time);
  if (!slot)
    throw fail(
      'This slot is unavailable. Contact reception if payment was made.',
      409,
      'SLOT_UNAVAILABLE'
    );
  const profile = await accountProfile(account, hold.profile_id, session),
    patient = await clinicPatient(
      account,
      profile,
      hold.tenant_id,
      hold.branch_id,
      session
    ),
    now = new Date();
  const counter = await db
      .collection('counters')
      .findOneAndUpdate(
        { _id: `${hold.tenant_id}:appointment` },
        { $inc: { value: 1 } },
        { session, upsert: true, returnDocument: 'after' }
      ),
    initials = `${doctor.user.first_name} ${doctor.user.last_name}`
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .join('')
      .toUpperCase(),
    paid = payment?.status === 'Captured' ? quote.total_cents : 0;
  const row = {
    id: randomUUID(),
    tenant_id: hold.tenant_id,
    branch_id: hold.branch_id,
    department_id: doctor.department.id,
    doctor_id: hold.doctor_id,
    patient_id: patient.id,
    mobile_profile_id: profile.id,
    mobile_account_id: account.id,
    appointment_number: `${await configuredPrefix(
      hold.tenant_id,
      'appointment_prefix',
      'APT',
      session
    )}-${String(counter.value).padStart(6, '0')}`,
    appointment_date: hold.appointment_date,
    appointment_time: slot.time,
    slot_serial: slot.serial,
    appointment_type: 'OPD',
    visit_type: hold.visit_type ?? 'New',
    reason: hold.reason ?? '',
    symptoms: hold.symptoms ?? [],
    notes: '',
    consultation_fee: quote.consultation_fee,
    charges: quote.charges,
    discount: 0,
    paid_amount: paid / 100,
    payment_status: paymentStatus(quote.total_cents, paid),
    payment_mode: paid ? 'Razorpay' : '',
    payment_reference: payment?.provider_payment_id ?? '',
    source: 'Patient App',
    status: 'Booked',
    token_number: `${hold.appointment_date
      .split('-')
      .reverse()
      .join('')}/${initials}/${doctor.department.name
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 5)
      .toUpperCase()}/${String(slot.serial).padStart(3, '0')}`,
    queue_session_start: sessionStart(
      doctor.professional,
      hold.appointment_date,
      slot.time
    ),
    created_at: now,
    updated_at: now,
  };
  await db
    .collection('staff_members')
    .updateOne(
      { id: doctor.staff.id, tenant_id: row.tenant_id },
      { $inc: { workflow_version: 1 } },
      { session }
    );
  await db
    .collection('users')
    .updateOne(
      { id: doctor.user.id, tenant_id: row.tenant_id },
      { $inc: { booking_version: 1 } },
      { session }
    );
  await assignQueueSerial(row, session);
  await db
    .collection('clinical_appointments')
    .insertOne({ ...row }, { session });
  await db
    .collection('mobile_booking_holds')
    .updateOne(
      { id: hold.id, account_id: account.id, state: 'Active' },
      { $set: { state: 'Consumed', appointment_id: row.id, updated_at: now } },
      { session }
    );
  if (payment)
    await db.collection('mobile_payment_orders').updateOne(
      { id: payment.id, status: 'Captured' },
      {
        $set: { status: 'Consumed', appointment_id: row.id, updated_at: now },
      },
      { session }
    );
  for (const uploadId of hold.upload_ids ?? []) {
    const upload = await db.collection('mobile_uploads').findOne(
      {
        id: uploadId,
        account_id: account.id,
        profile_id: profile.id,
        share_with_clinic: true,
      },
      { session }
    );
    if (!upload)
      throw fail(
        'Attached reports must be uploaded for this patient with clinic sharing enabled.'
      );
    await db.collection('mobile_uploads').updateOne(
      { id: uploadId },
      {
        $addToSet: {
          clinic_shares: {
            tenant_id: row.tenant_id,
            patient_id: row.patient_id,
            branch_id: row.branch_id,
            appointment_id: row.id,
          },
        },
      },
      { session }
    );
  }
  await receipt(
    { locals: { account: { id: account.id } } },
    row,
    paid,
    `MOBILE-BOOKING-${row.id}`,
    session
  );
  await audit(
    account,
    'patient_app_appointment_booked',
    row.id,
    session,
    row.tenant_id
  );
  return row;
}
export function cancellationPolicy(row) {
  return {
    can_cancel:
      ['Booked', 'Confirmed'].includes(row.status) &&
      row.appointment_date >= hospitalDay(),
    refund_requires_review: cents(row.paid_amount ?? 0) > 0,
    maximum_refund: Number(row.paid_amount ?? 0),
    currency: 'INR',
  };
}
