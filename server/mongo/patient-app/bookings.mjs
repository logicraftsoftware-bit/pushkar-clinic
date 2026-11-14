import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { db, transaction } from '../database.mjs';
import { config } from '../config.mjs';
import { slotsFor } from '../clinical.mjs';
import { appointmentTotal, cents } from '../money.mjs';
import { hospitalDay } from '../finance-ledger.mjs';
import {
  assignQueueSerial,
  queueSnapshot,
  safeQueue,
  sessionStart,
} from '../queue-service.mjs';
import {
  accountProfile,
  audit,
  clinicAccess,
  date,
  fail,
  linkFilter,
  linksFor,
  lockDoctor,
  ownRow,
  page,
  pick,
  remember,
  replay,
  requestKey,
  route,
  selectedDoctor,
  time,
  uuid,
} from './common.mjs';
import {
  appointmentView,
  cancellationPolicy,
  confirmBooking,
  ownHold,
  pricing,
} from './booking-service.mjs';
import { gateway } from './payments.mjs';
import { validateSession } from './auth.mjs';
import { sendPdf, simplePdf } from './documents.mjs';

const visit = z
  .object({
    reason: z.string().trim().max(4000).prefault(''),
    symptoms: z.array(z.string().trim().min(1).max(200)).max(20).prefault([]),
    visit_type: z.enum(['New', 'Follow-up']).prefault('New'),
    upload_ids: z.array(uuid).max(10).prefault([]),
  })
  .strict();
const holdView = (row) =>
  pick(row, [
    'id',
    'profile_id',
    'tenant_id',
    'branch_id',
    'doctor_id',
    'appointment_date',
    'appointment_time',
    'reason',
    'symptoms',
    'visit_type',
    'upload_ids',
    'state',
    'expires_at',
    'appointment_id',
  ]);
const holdInput = visit
  .extend({
    profile_id: uuid,
    clinic_id: uuid,
    branch_id: uuid,
    doctor_id: uuid,
    appointment_date: date,
    appointment_time: time,
  })
  .strict();
export async function patientQueue(account, appointmentId) {
  const row = await ownRow(account, 'clinical_appointments', appointmentId);
  await clinicAccess(row.tenant_id, { module: 'opd' });
  const snapshot = await queueSnapshot({
    tenant_id: row.tenant_id,
    branch_id: row.branch_id,
    doctor_id: row.doctor_id,
    date: row.appointment_date,
  });
  const own = snapshot.rows.find((r) => r.id === row.id),
    active = snapshot.rows.filter((r) =>
      ['Waiting', 'Awaiting check-in', 'In Consultation'].includes(r.status)
    ),
    index = active.findIndex((r) => r.id === row.id),
    nowServing = snapshot.appointments.find(
      (r) => r.id === snapshot.current?.id
    ),
    enabled = snapshot.settings.live_queue_enabled !== false;
  return {
    appointment_id: row.id,
    token: row.token_number,
    status: row.status,
    queue_status: own?.status ?? null,
    queue_enabled: enabled,
    now_serving_token: nowServing?.token_number ?? null,
    patients_ahead: index < 0 ? 0 : index,
    estimated_wait_minutes: own?.estimated_at
      ? Math.max(
          0,
          Math.ceil((Date.parse(own.estimated_at) - Date.now()) / 60000)
        )
      : null,
    room: snapshot.room ?? '',
    queue: enabled ? safeQueue(snapshot) : null,
    updated_at: new Date().toISOString(),
  };
}
const streams = new Map();
let totalStreams = 0;
async function noPendingCancellation(row, session) {
  if (
    await db.collection('cancellation_requests').findOne(
      {
        tenant_id: row.tenant_id,
        bill_type: 'OPD',
        target_id: row.id,
        status: { $ne: 'Rejected' },
      },
      { session }
    )
  )
    throw fail(
      'A cancellation request is awaiting clinic review.',
      409,
      'CANCELLATION_PENDING'
    );
}
async function queueEvents(req, res) {
  const account = res.locals.account,
    count = streams.get(account.id) ?? 0;
  if (count >= 3 || totalStreams >= 200)
    throw fail('Too many live queue connections.', 429);
  const initial = await patientQueue(account, req.params.id);
  res.set({
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Cache-Control': 'no-store',
  });
  res.flushHeaders();
  streams.set(account.id, count + 1);
  totalStreams++;
  let busy = false,
    closed = false,
    timer,
    lifetime;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clearTimeout(lifetime);
    streams.set(account.id, Math.max(0, (streams.get(account.id) ?? 1) - 1));
    totalStreams--;
    res.end();
  };
  const send = (value) => {
    if (!closed && !res.destroyed) {
      if (res.writableLength > 1000000) return close();
      res.write(`event: snapshot\ndata: ${JSON.stringify(value)}\n\n`);
    }
  };
  send(initial);
  timer = setInterval(async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const auth = await validateSession(req);
      send(await patientQueue(auth.account, req.params.id));
    } catch {
      if (!closed)
        res.write(
          'event: unavailable\ndata: {"error":"Session or queue access changed. Reconnect after signing in."}\n\n'
        );
      close();
    } finally {
      busy = false;
    }
  }, 4000);
  timer.unref();
  lifetime = setTimeout(close, 8 * 60000);
  lifetime.unref();
  res.on('close', close);
  req.on('aborted', close);
}

export function registerBookings(router) {
  route(
    router,
    'post',
    '/booking-holds',
    'Temporarily reserve a doctor slot',
    async (req, res) => {
      const a = res.locals.account,
        key = requestKey(req),
        input = req.input;
      const result = await transaction(async (session) => {
        const prior = await replay(a, 'hold', key, input, session);
        if (prior) return prior;
        await accountProfile(a, input.profile_id, session);
        await lockDoctor(
          input.clinic_id,
          input.doctor_id,
          input.appointment_date,
          session
        );
        const doctor = await selectedDoctor(
            input.clinic_id,
            input.branch_id,
            input.doctor_id,
            session
          ),
          now = new Date();
        await db.collection('mobile_booking_holds').updateMany(
          {
            tenant_id: input.clinic_id,
            doctor_id: input.doctor_id,
            appointment_date: input.appointment_date,
            state: 'Active',
            expires_at: { $lte: now },
          },
          { $set: { state: 'Expired' } },
          { session }
        );
        await db
          .collection('mobile_accounts')
          .updateOne({ id: a.id }, { $inc: { hold_version: 1 } }, { session });
        if (
          (await db
            .collection('mobile_booking_holds')
            .countDocuments(
              { account_id: a.id, state: 'Active', expires_at: { $gt: now } },
              { session }
            )) >= 3
        )
          throw fail(
            'Release an earlier hold before reserving another slot.',
            409
          );
        const slot = (
          await slotsFor(
            doctor,
            input.appointment_date,
            undefined,
            null,
            session
          )
        ).find((s) => s.time === input.appointment_time);
        if (!slot)
          throw fail(
            'This appointment slot is no longer available.',
            409,
            'SLOT_UNAVAILABLE'
          );
        const { clinic_id, ...data } = input,
          row = {
            ...data,
            id: randomUUID(),
            account_id: a.id,
            tenant_id: clinic_id,
            slot_serial: slot.serial,
            state: 'Active',
            created_at: now,
            updated_at: now,
            expires_at: new Date(Date.now() + 10 * 60000),
            purge_at: new Date(Date.now() + 86400000),
          };
        await db
          .collection('mobile_booking_holds')
          .insertOne({ ...row }, { session });
        return remember(a, 'hold', key, input, holdView(row), session);
      });
      res.status(201).json(result);
    },
    { idempotent: true, body: holdInput }
  );
  route(
    router,
    'patch',
    '/booking-holds/:id',
    'Update visit information on a live booking hold',
    async (req, res) => {
      const a = res.locals.account;
      res.json(
        await transaction(async (session) => {
          const hold = await ownHold(a, req.params.id, session);
          await lockDoctor(
            hold.tenant_id,
            hold.doctor_id,
            hold.appointment_date,
            session
          );
          await ownHold(a, hold.id, session);
          return holdView(
            await db
              .collection('mobile_booking_holds')
              .findOneAndUpdate(
                { id: hold.id, account_id: a.id, state: 'Active' },
                { $set: { ...req.input, updated_at: new Date() } },
                { session, returnDocument: 'after' }
              )
          );
        })
      );
    },
    { body: visit.partial().strict() }
  );
  route(
    router,
    'delete',
    '/booking-holds/:id',
    'Release a temporary slot reservation',
    async (req, res) => {
      const a = res.locals.account;
      await transaction(async (session) => {
        const hold = await ownHold(a, req.params.id, session, {
          active: false,
        });
        await lockDoctor(
          hold.tenant_id,
          hold.doctor_id,
          hold.appointment_date,
          session
        );
        if (hold.state === 'Active')
          await db
            .collection('mobile_booking_holds')
            .updateOne(
              { id: hold.id, account_id: a.id, state: 'Active' },
              { $set: { state: 'Cancelled', updated_at: new Date() } },
              { session }
            );
      });
      res.status(204).end();
    }
  );
  route(
    router,
    'post',
    '/booking-quotes',
    'Calculate and freeze server-side appointment charges',
    async (req, res) => {
      const a = res.locals.account,
        quote = await transaction(async (session) => {
          const hold = await ownHold(a, req.input.hold_id, session),
            doctor = await selectedDoctor(
              hold.tenant_id,
              hold.branch_id,
              hold.doctor_id,
              session
            ),
            price = await pricing(a, hold, doctor, session),
            row = {
              id: randomUUID(),
              account_id: a.id,
              hold_id: hold.id,
              tenant_id: hold.tenant_id,
              ...price,
              expires_at: hold.expires_at,
              created_at: new Date(),
            };
          await db
            .collection('mobile_booking_quotes')
            .insertOne({ ...row }, { session });
          return row;
        });
      let online = false;
      try {
        await gateway(quote.tenant_id);
        online = true;
      } catch (error) {
        if (error.status !== 503) throw error;
      }
      res.status(201).json({
        ...pick(quote, [
          'id',
          'hold_id',
          'consultation_fee',
          'charges',
          'total_cents',
          'currency',
          'expires_at',
        ]),
        payment_options: { pay_at_clinic: quote.pay_at_clinic, online },
      });
    },
    { body: z.object({ hold_id: uuid }).strict() }
  );
  route(
    router,
    'post',
    '/appointments',
    'Confirm an appointment using a quote and verified payment or clinic payment',
    async (req, res) => {
      const a = res.locals.account,
        key = requestKey(req),
        input = req.input;
      const result = await transaction(async (session) => {
        const prior = await replay(a, 'appointment', key, input, session);
        if (prior) return prior;
        const row = await confirmBooking(
          a,
          input.quote_id,
          input.payment_order_id,
          input.pay_at_clinic,
          session
        );
        return remember(
          a,
          'appointment',
          key,
          input,
          pick(row, [
            'id',
            'appointment_number',
            'token_number',
            'status',
            'appointment_date',
            'appointment_time',
          ]),
          session
        );
      });
      res.status(201).json({
        ...result,
        appointment: await appointmentView(
          await ownRow(a, 'clinical_appointments', result.id)
        ),
      });
    },
    {
      idempotent: true,
      body: z
        .object({
          quote_id: uuid,
          payment_order_id: uuid.optional(),
          pay_at_clinic: z.boolean().prefault(false),
        })
        .strict()
        .refine(
          (v) => !(v.payment_order_id && v.pay_at_clinic),
          'Choose one payment method.'
        ),
    }
  );
  route(
    router,
    'get',
    '/appointments',
    'List patient appointments by profile and status',
    async (req, res) => {
      const a = res.locals.account,
        filter = linkFilter(await linksFor(a, req.query.patient_id)),
        status = z
          .enum(['upcoming', 'past', 'cancelled', 'all'])
          .prefault('all')
          .parse(req.query.status),
        today = hospitalDay(),
        extra =
          status === 'upcoming'
            ? {
                appointment_date: { $gte: today },
                status: { $nin: ['Completed', 'Cancelled', 'No Show'] },
              }
            : status === 'past'
            ? {
                $or: [
                  { appointment_date: { $lt: today } },
                  { status: { $in: ['Completed', 'No Show'] } },
                ],
              }
            : status === 'cancelled'
            ? { status: 'Cancelled' }
            : {};
      const result = await page(
        'clinical_appointments',
        { $and: [filter, extra] },
        req.query,
        { _id: 0 },
        {
          appointment_date: status === 'upcoming' ? 1 : -1,
          appointment_time: 1,
          id: 1,
        }
      );
      res.json({
        ...result,
        data: await Promise.all(result.data.map(appointmentView)),
      });
    }
  );
  route(
    router,
    'get',
    '/appointments/:id',
    'Get an appointment and its available actions',
    async (req, res) => {
      const row = await ownRow(
        res.locals.account,
        'clinical_appointments',
        req.params.id
      );
      res.json({
        ...(await appointmentView(row)),
        cancellation_policy: cancellationPolicy(row),
        can_reschedule:
          ['Booked', 'Confirmed'].includes(row.status) &&
          row.appointment_date >= hospitalDay(),
      });
    }
  );
  route(
    router,
    'post',
    '/appointments/:id/reschedule',
    'Move an unstarted appointment to another slot with the same doctor',
    async (req, res) => {
      const a = res.locals.account,
        key = requestKey(req),
        input = req.input;
      const result = await transaction(async (session) => {
        const prior = await replay(
          a,
          'reschedule:' + req.params.id,
          key,
          input,
          session
        );
        if (prior) return prior;
        const old = await ownRow(
          a,
          'clinical_appointments',
          req.params.id,
          {},
          session
        );
        await noPendingCancellation(old, session);
        if (!['Booked', 'Confirmed'].includes(old.status))
          throw fail('This appointment cannot be rescheduled.', 409);
        if (new Date(old.updated_at).toISOString() !== input.updated_at)
          throw fail('Appointment changed. Refresh before rescheduling.', 409);
        for (const day of [
          ...new Set([old.appointment_date, input.appointment_date]),
        ].sort())
          await lockDoctor(old.tenant_id, old.doctor_id, day, session);
        const doctor = await selectedDoctor(
            old.tenant_id,
            old.branch_id,
            old.doctor_id,
            session
          ),
          slot = (
            await slotsFor(
              doctor,
              input.appointment_date,
              undefined,
              old.id,
              session
            )
          ).find((s) => s.time === input.appointment_time);
        if (!slot) throw fail('Requested slot is unavailable.', 409);
        const row = {
          ...old,
          appointment_date: input.appointment_date,
          appointment_time: slot.time,
          slot_serial: slot.serial,
          queue_session_start: sessionStart(
            doctor.professional,
            input.appointment_date,
            slot.time
          ),
          updated_at: new Date(
            Math.max(Date.now(), Date.parse(old.updated_at) + 1)
          ),
        };
        delete row._id;
        if (old.appointment_date !== input.appointment_date)
          await assignQueueSerial(row, session);
        const initials = `${doctor.user.first_name} ${doctor.user.last_name}`
          .split(/\s+/)
          .map((v) => v[0])
          .join('')
          .toUpperCase();
        row.token_number = `${input.appointment_date
          .split('-')
          .reverse()
          .join('')}/${initials}/${doctor.department.name
          .replace(/[^a-z0-9]/gi, '')
          .slice(0, 5)
          .toUpperCase()}/${String(slot.serial).padStart(3, '0')}`;
        await db
          .collection('clinical_appointments')
          .replaceOne({ id: old.id, tenant_id: old.tenant_id }, row, {
            session,
          });
        await audit(
          a,
          'patient_app_appointment_rescheduled',
          row.id,
          session,
          row.tenant_id
        );
        return remember(
          a,
          'reschedule:' + req.params.id,
          key,
          input,
          { id: row.id },
          session
        );
      });
      res.json(
        await appointmentView(
          await ownRow(a, 'clinical_appointments', result.id)
        )
      );
    },
    {
      idempotent: true,
      body: z
        .object({
          appointment_date: date,
          appointment_time: time,
          updated_at: z.string().datetime(),
        })
        .strict(),
    }
  );
  route(
    router,
    'post',
    '/appointments/:id/cancel',
    'Cancel an unpaid booking or submit a paid cancellation for clinic review',
    async (req, res) => {
      const a = res.locals.account,
        key = requestKey(req),
        input = req.input;
      const result = await transaction(async (session) => {
        const prior = await replay(
          a,
          'cancel:' + req.params.id,
          key,
          input,
          session
        );
        if (prior) return prior;
        const row = await ownRow(
          a,
          'clinical_appointments',
          req.params.id,
          {},
          session
        );
        await lockDoctor(
          row.tenant_id,
          row.doctor_id,
          row.appointment_date,
          session
        );
        if (!cancellationPolicy(row).can_cancel)
          throw fail(
            'This appointment cannot be cancelled by the patient.',
            409
          );
        await db
          .collection('clinical_appointments')
          .updateOne(
            { id: row.id, tenant_id: row.tenant_id },
            { $inc: { cancellation_version: 1 } },
            { session }
          );
        const paid = cents(row.paid_amount ?? 0);
        let output;
        if (!paid) {
          await db
            .collection('clinical_appointments')
            .updateOne(
              { id: row.id, tenant_id: row.tenant_id },
              { $set: { status: 'Cancelled', updated_at: new Date() } },
              { session }
            );
          output = {
            appointment_id: row.id,
            status: 'Cancelled',
            refund_amount: 0,
          };
        } else {
          let request = await db.collection('cancellation_requests').findOne(
            {
              tenant_id: row.tenant_id,
              bill_type: 'OPD',
              target_id: row.id,
              status: { $ne: 'Rejected' },
            },
            { session }
          );
          if (!request) {
            const patient = await db
              .collection('patients')
              .findOne(
                { tenant_id: row.tenant_id, id: row.patient_id },
                { session }
              );
            request = {
              id: randomUUID(),
              tenant_id: row.tenant_id,
              branch_id: row.branch_id,
              bill_type: 'OPD',
              target_id: row.id,
              invoice_id: null,
              patient_id: row.patient_id,
              request_number: 'CAN-' + randomUUID().slice(0, 8).toUpperCase(),
              bill_number: row.appointment_number,
              patient_name: `${patient.first_name} ${patient.last_name}`.trim(),
              reason: input.reason,
              bill_total: appointmentTotal(row) / 100,
              collected_amount: paid / 100,
              requested_amount: paid / 100,
              approved_amount: 0,
              refunded_amount: 0,
              booked_tests: [],
              status: 'Pending',
              created_by: a.id,
              source: 'Patient App',
              created_at: new Date(),
              updated_at: new Date(),
            };
            await db
              .collection('cancellation_requests')
              .insertOne({ ...request }, { session });
            await db.collection('cancellation_events').insertOne(
              {
                id: randomUUID(),
                tenant_id: row.tenant_id,
                request_id: request.id,
                actor_id: a.id,
                actor_name: 'Patient App',
                actor_role: 'patient',
                action: 'Requested',
                amount: paid / 100,
                note: input.reason,
                created_at: new Date(),
              },
              { session }
            );
          }
          output = {
            appointment_id: row.id,
            status: 'Cancellation Requested',
            cancellation_request_id: request.id,
            refund_requires_review: true,
          };
        }
        await audit(
          a,
          'patient_app_cancellation_requested',
          row.id,
          session,
          row.tenant_id
        );
        return remember(
          a,
          'cancel:' + req.params.id,
          key,
          input,
          output,
          session
        );
      });
      res.json(result);
    },
    {
      idempotent: true,
      body: z.object({ reason: z.string().trim().min(3).max(1000) }).strict(),
    }
  );
  route(
    router,
    'post',
    '/appointments/:id/check-in',
    'Validate clinic arrival and mark a fully paid patient checked in',
    async (req, res) => {
      const a = res.locals.account;
      res.json(
        await transaction(async (session) => {
          const row = await ownRow(
              a,
              'clinical_appointments',
              req.params.id,
              {},
              session
            ),
            { settings } = await clinicAccess(row.tenant_id, {
              session,
              module: 'opd',
            });
          await lockDoctor(
            row.tenant_id,
            row.doctor_id,
            row.appointment_date,
            session
          );
          await noPendingCancellation(row, session);
          if (row.appointment_date !== hospitalDay())
            throw fail(
              'Check-in is available only on the appointment date.',
              409
            );
          if (req.input.clinic_qr) {
            let payload;
            try {
              payload = jwt.verify(req.input.clinic_qr, config.JWT_SECRET, {
                issuer: 'careframe-api',
                audience: 'patient-clinic-check-in',
                algorithms: ['HS256'],
              });
            } catch {
              throw fail('Clinic QR code is invalid or expired.', 400);
            }
            if (
              payload.tenant_id !== row.tenant_id ||
              payload.branch_id !== row.branch_id
            )
              throw fail('Scan the QR code at your appointment clinic.', 403);
          } else if (settings.manual_check_in !== true)
            throw fail(
              'Scan the clinic check-in QR code or ask reception to mark your arrival.',
              409,
              'CLINIC_QR_REQUIRED'
            );
          if (['Checked In', 'Waiting', 'In Consultation'].includes(row.status))
            return appointmentView(row);
          if (!['Booked', 'Confirmed'].includes(row.status))
            throw fail('This appointment cannot be checked in.', 409);
          if (cents(row.paid_amount ?? 0) < appointmentTotal(row))
            throw fail('Complete payment at reception before check-in.', 402);
          if (
            await db
              .collection('mobile_payment_orders')
              .findOne(
                {
                  appointment_id: row.id,
                  $or: [
                    { refund_amount_cents: { $gt: 0 } },
                    { provider_refunded_cents: { $gt: 0 } },
                  ],
                },
                { session }
              )
          )
            throw fail('A payment adjustment needs reception review.', 402);
          const result = await db
            .collection('clinical_appointments')
            .findOneAndUpdate(
              { id: row.id, tenant_id: row.tenant_id, status: row.status },
              { $set: { status: 'Checked In', updated_at: new Date() } },
              { session, returnDocument: 'after' }
            );
          await audit(
            a,
            'patient_app_checked_in',
            row.id,
            session,
            row.tenant_id
          );
          return appointmentView(result);
        })
      );
    },
    { body: z.object({ clinic_qr: z.string().max(4000).optional() }).strict() }
  );
  route(
    router,
    'get',
    '/appointments/:id/queue',
    'Get a private live queue snapshot',
    async (req, res) =>
      res.json(await patientQueue(res.locals.account, req.params.id))
  );
  route(
    router,
    'get',
    '/appointments/:id/events',
    'Subscribe to authenticated live queue events',
    queueEvents
  );
  route(
    router,
    'get',
    '/appointments/:id/pass',
    'Get a signed appointment pass or download its PDF',
    async (req, res) => {
      const row = await ownRow(
          res.locals.account,
          'clinical_appointments',
          req.params.id
        ),
        appointment = await appointmentView(row),
        ttl = Math.max(
          900,
          Math.ceil(
            (Date.parse(row.appointment_date + 'T23:59:59+05:30') +
              7 * 86400000 -
              Date.now()) /
              1000
          )
        ),
        qr = jwt.sign(
          {
            appointment_id: row.id,
            tenant_id: row.tenant_id,
            branch_id: row.branch_id,
          },
          config.JWT_SECRET,
          {
            issuer: 'careframe-api',
            audience: 'patient-appointment-pass',
            algorithm: 'HS256',
            expiresIn: ttl,
          }
        );
      if (req.query.format === 'pdf')
        return sendPdf(
          res,
          row.appointment_number + '.pdf',
          await simplePdf(
            'Appointment Pass',
            [
              appointment.clinic_name,
              appointment.doctor_name,
              `Patient: ${appointment.patient_name}`,
              `UHID: ${appointment.medical_record_number}`,
              `Appointment: ${row.appointment_number}`,
              `Date: ${row.appointment_date}  Time: ${row.appointment_time}`,
              `Token: ${row.token_number}`,
              `Status: ${row.status}`,
              `Payment: ${row.payment_status}`,
            ],
            qr
          )
        );
      res.json({
        appointment,
        qr_payload: qr,
        expires_in: ttl,
        download_path: `/api/v1/patient-app/appointments/${row.id}/pass?format=pdf`,
      });
    }
  );
}
