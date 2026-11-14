import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, transaction } from '../database.mjs';
import { appointmentTotal, cents } from '../money.mjs';
import { hospitalDay } from '../finance-ledger.mjs';
import {
  accountProfile,
  audit,
  digest,
  fail,
  linkFilter,
  linksFor,
  ownRow,
  page,
  pageInput,
  pick,
  publicClinic,
  rateLimit,
  requestKey,
  remember,
  replay,
  route,
  secretHash,
  text,
  uuid,
} from './common.mjs';
import { appointmentView } from './booking-service.mjs';
import { patientQueue } from './bookings.mjs';
import { sendPdf, simplePdf } from './documents.mjs';

export async function notify(accountId, key, title, message, target) {
  const now = new Date(),
    row = await db.collection('mobile_notifications').findOneAndUpdate(
      { dedupe: digest(accountId + ':' + key) },
      {
        $setOnInsert: {
          id: randomUUID(),
          account_id: accountId,
          title,
          message,
          target,
          read: false,
          created_at: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
  await db.collection('mobile_push_outbox').updateOne(
    { notification_id: row.id },
    {
      $setOnInsert: {
        account_id: accountId,
        notification_id: row.id,
        state: 'Pending',
        attempts: 0,
        created_at: now,
      },
    },
    { upsert: true }
  );
  return row;
}
export async function syncNotifications(account) {
  const links = await linksFor(account),
    filter = linkFilter(links),
    since = new Date(Date.now() - 30 * 86400000),
    rows = await db
      .collection('clinical_appointments')
      .find({ $and: [filter, { updated_at: { $gte: since } }] })
      .sort({ updated_at: -1 })
      .limit(50)
      .toArray();
  for (const row of rows) {
    const stamp = [row.status, row.appointment_date, row.appointment_time].join(
        ':'
      ),
      cancelled = row.status === 'Cancelled',
      completed = row.status === 'Completed';
    await notify(
      account.id,
      'appointment:' + row.id + ':' + stamp,
      cancelled
        ? 'Appointment Cancelled'
        : completed
        ? 'Visit Completed'
        : 'Appointment Update',
      cancelled
        ? 'Your appointment has been cancelled.'
        : completed
        ? 'Your visit has been completed.'
        : 'Your appointment details are available in the app.',
      { screen: 'AppointmentDetails', appointment_id: row.id }
    );
    if (
      account.preferences?.appointment_reminders !== false &&
      row.appointment_date === hospitalDay()
    )
      await notify(
        account.id,
        'reminder:' + row.id + ':' + row.appointment_date,
        'Appointment Reminder',
        'You have a clinic appointment today.',
        { screen: 'AppointmentDetails', appointment_id: row.id }
      );
    if (
      account.preferences?.queue_alerts !== false &&
      row.appointment_date === hospitalDay() &&
      ['Checked In', 'Waiting', 'In Consultation'].includes(row.status)
    ) {
      try {
        const queue = await patientQueue(account, row.id);
        if (queue.queue_enabled && queue.patients_ahead <= 2)
          await notify(
            account.id,
            'turn:' + row.id + ':' + row.appointment_date,
            'Turn Alert',
            'Your turn is approaching. Please check your live queue.',
            { screen: 'Queue', appointment_id: row.id }
          );
      } catch (error) {
        if (![401, 403, 404].includes(error.status)) throw error;
      }
    }
  }
  const releases = await db
    .collection('mobile_record_releases')
    .find({ $and: [filter, { active: true, created_at: { $gte: since } }] })
    .sort({ created_at: -1 })
    .limit(50)
    .toArray();
  for (const r of releases)
    await notify(
      account.id,
      'release:' + r.id + ':' + r.source_revision,
      'Medical Record Available',
      'Your clinic has released a medical document.',
      {
        screen: r.kind === 'lab' ? 'LabReports' : 'Prescription',
        record_id: r.id,
      }
    );
}

async function invoice(account, id) {
  const key = uuid.parse(id),
    bill = await db.collection('finance_records').findOne({
      $and: [
        { id: key, kind: { $in: ['invoices', 'pharmacy-bill'] } },
        linkFilter(await linksFor(account)),
      ],
    });
  if (bill)
    return {
      ...pick(bill, [
        'id',
        'record_number',
        'record_date',
        'total',
        'paid',
        'due',
        'status',
        'patient_id',
        'created_at',
        'updated_at',
      ]),
      clinic_id: bill.tenant_id,
      items: (bill.data?.tests ?? bill.data?.items ?? []).map((i) =>
        pick(i, ['name', 'quantity', 'amount', 'price'])
      ),
      currency: 'INR',
    };
  const row = await ownRow(account, 'clinical_appointments', key),
    total = appointmentTotal(row) / 100;
  return {
    id: row.id,
    record_number: row.appointment_number,
    record_date: row.appointment_date,
    total,
    paid: row.paid_amount ?? 0,
    due: Math.max(0, cents(total) - cents(row.paid_amount ?? 0)) / 100,
    status: row.payment_status,
    appointment_status: row.status,
    patient_id: row.patient_id,
    clinic_id: row.tenant_id,
    items: [
      { name: 'Consultation', amount: row.consultation_fee },
      ...(row.charges ?? []).map((i) => ({
        name: i.name ?? i.label,
        amount: i.amount,
      })),
    ],
    currency: 'INR',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
export function registerAccount(router) {
  route(
    router,
    'get',
    '/home',
    'Get the selected patient home overview',
    async (req, res) => {
      const a = res.locals.account,
        p = await accountProfile(a, req.query.patient_id),
        filter = linkFilter(await linksFor(a, p.id)),
        rows = await db
          .collection('clinical_appointments')
          .find({
            $and: [
              filter,
              {
                appointment_date: { $gte: hospitalDay() },
                status: { $nin: ['Cancelled', 'Completed', 'No Show'] },
              },
            ],
          })
          .sort({ appointment_date: 1, appointment_time: 1 })
          .limit(5)
          .toArray();
      let queue = null;
      const active = rows.find((r) => r.appointment_date === hospitalDay());
      if (active) {
        try {
          queue = await patientQueue(a, active.id);
        } catch (error) {
          if (![401, 403, 404].includes(error.status)) throw error;
        }
      }
      res.json({
        profile: pick(p, ['id', 'name', 'photo_upload_id']),
        upcoming_appointments: await Promise.all(rows.map(appointmentView)),
        queue,
        unread_notifications: await db
          .collection('mobile_notifications')
          .countDocuments({ account_id: a.id, read: false }),
        shortcuts: ['booking', 'queue', 'reports', 'prescriptions'],
      });
    }
  );
  route(
    router,
    'get',
    '/invoices',
    'List clinic invoices and OPD appointment bills',
    async (req, res) => {
      const filter = linkFilter(
          await linksFor(res.locals.account, req.query.patient_id)
        ),
        { page: current, page_size } = pageInput.parse(req.query),
        status = z
          .enum(['all', 'paid', 'pending'])
          .prefault('all')
          .parse(req.query.status),
        match = { kind: { $in: ['invoices', 'pharmacy-bill'] } };
      const pipeline = [
        { $match: { $and: [filter, match] } },
        {
          $project: {
            _id: 0,
            id: 1,
            record_number: 1,
            record_date: 1,
            total: 1,
            paid: 1,
            due: 1,
            status: 1,
            created_at: 1,
            clinic_id: '$tenant_id',
          },
        },
        {
          $unionWith: {
            coll: 'clinical_appointments',
            pipeline: [
              { $match: filter },
              {
                $lookup: {
                  from: 'finance_records',
                  let: { id: '$id', tenant: '$tenant_id' },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $eq: ['$tenant_id', '$$tenant'] },
                            { $eq: ['$kind', 'invoices'] },
                            { $eq: ['$data.appointment_id', '$$id'] },
                          ],
                        },
                      },
                    },
                    { $project: { id: 1 } },
                  ],
                  as: 'invoice',
                },
              },
              { $match: { invoice: { $size: 0 } } },
              {
                $project: {
                  _id: 0,
                  id: 1,
                  record_number: '$appointment_number',
                  record_date: '$appointment_date',
                  total: {
                    $subtract: [
                      {
                        $add: [
                          { $ifNull: ['$consultation_fee', 0] },
                          { $sum: '$charges.amount' },
                        ],
                      },
                      { $ifNull: ['$discount', 0] },
                    ],
                  },
                  paid: { $ifNull: ['$paid_amount', 0] },
                  status: '$payment_status',
                  appointment_status: '$status',
                  created_at: 1,
                  clinic_id: '$tenant_id',
                },
              },
              {
                $set: {
                  due: { $max: [0, { $subtract: ['$total', '$paid'] }] },
                },
              },
            ],
          },
        },
      ];
      if (status !== 'all')
        pipeline.push({
          $match:
            status === 'paid'
              ? { status: { $in: ['Paid', 'Payment not required'] } }
              : { due: { $gt: 0 } },
        });
      pipeline.push(
        { $sort: { record_date: -1, id: -1 } },
        {
          $facet: {
            data: [{ $skip: (current - 1) * page_size }, { $limit: page_size }],
            total: [{ $count: 'n' }],
          },
        }
      );
      const result = await db
        .collection('finance_records')
        .aggregate(pipeline)
        .next();
      res.json({
        data: (result?.data ?? []).map((r) => ({ ...r, currency: 'INR' })),
        total: result?.total?.[0]?.n ?? 0,
        page: current,
        page_size,
      });
    }
  );
  route(
    router,
    'get',
    '/invoices/:id',
    'View a patient invoice or appointment bill',
    async (req, res) =>
      res.json(await invoice(res.locals.account, req.params.id))
  );
  route(
    router,
    'get',
    '/invoices/:id/download',
    'Download a patient invoice PDF',
    async (req, res) => {
      const bill = await invoice(res.locals.account, req.params.id);
      sendPdf(
        res,
        bill.record_number + '.pdf',
        await simplePdf('Clinic Invoice', [
          `Invoice: ${bill.record_number}`,
          `Date: ${bill.record_date}`,
          ...bill.items.map(
            (i) => `${i.name ?? 'Service'}: INR ${i.amount ?? i.price ?? 0}`
          ),
          `Total: INR ${bill.total}`,
          `Paid: INR ${bill.paid}`,
          `Due: INR ${bill.due}`,
          `Status: ${bill.status}`,
        ])
      );
    }
  );
  route(
    router,
    'get',
    '/refunds/:id',
    'Get the clinic-reviewed cancellation and refund status',
    async (req, res) => {
      const row = await ownRow(
        res.locals.account,
        'cancellation_requests',
        req.params.id
      );
      res.json(
        pick(row, [
          'id',
          'request_number',
          'target_id',
          'status',
          'requested_amount',
          'approved_amount',
          'refunded_amount',
          'created_at',
          'updated_at',
        ])
      );
    }
  );
  route(
    router,
    'get',
    '/notifications',
    'List the account notification inbox',
    async (req, res) => {
      await syncNotifications(res.locals.account);
      res.json(
        await page(
          'mobile_notifications',
          { account_id: res.locals.account.id },
          req.query,
          {
            _id: 0,
            id: 1,
            title: 1,
            message: 1,
            target: 1,
            read: 1,
            created_at: 1,
          }
        )
      );
    }
  );
  route(
    router,
    'patch',
    '/notifications/:id',
    'Mark an account notification read or unread',
    async (req, res) => {
      const row = await db.collection('mobile_notifications').findOneAndUpdate(
        { id: uuid.parse(req.params.id), account_id: res.locals.account.id },
        { $set: { read: req.input.read } },
        {
          returnDocument: 'after',
          projection: { _id: 0, dedupe: 0, account_id: 0 },
        }
      );
      if (!row) throw fail('Notification not found.', 404);
      res.json(row);
    },
    { body: z.object({ read: z.boolean() }).strict() }
  );
  route(
    router,
    'post',
    '/notifications/read-all',
    'Mark all current notifications as read',
    async (_req, res) => {
      await db
        .collection('mobile_notifications')
        .updateMany(
          { account_id: res.locals.account.id, read: false },
          { $set: { read: true } }
        );
      res.status(204).end();
    }
  );
  route(
    router,
    'get',
    '/me/preferences',
    'Get notification and language preferences',
    async (_req, res) => res.json(res.locals.account.preferences ?? {})
  );
  route(
    router,
    'patch',
    '/me/preferences',
    'Update notification and language preferences',
    async (req, res) => {
      const changes = Object.fromEntries(
          Object.entries(req.input).map(([k, v]) => ['preferences.' + k, v])
        ),
        a = await db
          .collection('mobile_accounts')
          .findOneAndUpdate(
            { id: res.locals.account.id, status: 'Active' },
            { $set: { ...changes, updated_at: new Date() } },
            { returnDocument: 'after' }
          );
      res.json(a.preferences);
    },
    {
      body: z
        .object({
          language: z.enum(['en', 'hi', 'bn']).optional(),
          push_enabled: z.boolean().optional(),
          appointment_reminders: z.boolean().optional(),
          queue_alerts: z.boolean().optional(),
        })
        .strict(),
    }
  );
  route(
    router,
    'post',
    '/devices',
    'Register this session device for push notifications',
    async (req, res) => {
      const a = res.locals.account,
        hash = secretHash(req.input.token);
      await rateLimit(`device:${a.id}`, 30);
      const row = await db.collection('mobile_devices').findOneAndUpdate(
        { token_hash: hash },
        {
          $set: {
            account_id: a.id,
            session_id: res.locals.session.id,
            token: req.input.token,
            platform: req.input.platform,
            device_name: req.input.device_name ?? '',
            updated_at: new Date(),
          },
          $setOnInsert: { id: randomUUID(), created_at: new Date() },
        },
        { upsert: true, returnDocument: 'after' }
      );
      res
        .status(201)
        .json(pick(row, ['id', 'platform', 'device_name', 'created_at']));
    },
    {
      body: z
        .object({
          token: z.string().min(20).max(4096),
          platform: z.enum(['android', 'ios']),
          device_name: z.string().max(60).optional(),
        })
        .strict(),
    }
  );
  route(
    router,
    'delete',
    '/devices/:id',
    'Remove an account-owned push device registration',
    async (req, res) => {
      await db.collection('mobile_devices').deleteOne({
        id: uuid.parse(req.params.id),
        account_id: res.locals.account.id,
      });
      res.status(204).end();
    }
  );
  route(
    router,
    'get',
    '/favorites',
    'List saved clinics and doctors',
    async (req, res) =>
      res.json(
        await page(
          'mobile_favorites',
          { account_id: res.locals.account.id },
          req.query,
          { _id: 0, kind: 1, resource_id: 1, created_at: 1 }
        )
      )
  );
  route(
    router,
    'put',
    '/favorites/:kind/:id',
    'Save a public clinic or doctor',
    async (req, res) => {
      const kind = z.enum(['clinic', 'doctor']).parse(req.params.kind),
        id = uuid.parse(req.params.id);
      if (kind === 'clinic') await publicClinic(id);
      else {
        const doctor = await db
          .collection('staff_members')
          .findOne({ user_id: id, status: 'Active', staff_type: 'Doctor' });
        if (!doctor) throw fail('Doctor not found.', 404);
        await publicClinic(doctor.tenant_id);
      }
      await db
        .collection('mobile_favorites')
        .updateOne(
          { account_id: res.locals.account.id, kind, resource_id: id },
          { $setOnInsert: { created_at: new Date() } },
          { upsert: true }
        );
      res.status(204).end();
    }
  );
  route(
    router,
    'delete',
    '/favorites/:kind/:id',
    'Remove an account-owned saved clinic or doctor',
    async (req, res) => {
      await db.collection('mobile_favorites').deleteOne({
        account_id: res.locals.account.id,
        kind: z.enum(['clinic', 'doctor']).parse(req.params.kind),
        resource_id: uuid.parse(req.params.id),
      });
      res.status(204).end();
    }
  );
  route(
    router,
    'post',
    '/doctors/:id/reviews',
    'Submit feedback for a completed owned appointment for moderation',
    async (req, res) => {
      const row = await ownRow(
          res.locals.account,
          'clinical_appointments',
          req.input.appointment_id,
          { status: 'Completed', doctor_id: uuid.parse(req.params.id) }
        ),
        id = randomUUID();
      await db.collection('mobile_reviews').insertOne({
        id,
        account_id: res.locals.account.id,
        appointment_id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        doctor_id: row.doctor_id,
        rating: req.input.rating,
        comment: req.input.comment,
        display_name: 'Verified patient',
        status: 'Pending',
        created_at: new Date(),
      });
      res.status(201).json({ id, status: 'Pending moderation' });
    },
    {
      body: z
        .object({
          appointment_id: uuid,
          rating: z.number().int().min(1).max(5),
          comment: z.string().trim().max(2000),
        })
        .strict(),
    }
  );
  route(router, 'get', '/help', 'Get patient help topics', async (_req, res) =>
    res.json({
      topics: [
        {
          id: 'booking',
          question: 'How do I book a doctor?',
          answer:
            'Choose a clinic, doctor and available slot. Review the server quote and confirm your payment option.',
        },
        {
          id: 'queue',
          question: 'How do I join the live queue?',
          answer:
            'Check in using the clinic QR after completing payment, or ask reception to confirm your arrival.',
        },
        {
          id: 'records',
          question: 'Where are my old clinic records?',
          answer:
            'Reception can issue a one-time code linking your verified phone to the correct patient record.',
        },
        {
          id: 'refunds',
          question: 'How are refunds processed?',
          answer:
            'Paid cancellations are reviewed and processed by the clinic. Track the request in the app.',
        },
      ],
    })
  );
  route(
    router,
    'post',
    '/support-tickets',
    'Create a patient support request',
    async (req, res) => {
      const a = res.locals.account;
      await rateLimit(`support:${a.id}`, 10, 86400);
      if (req.input.profile_id) await accountProfile(a, req.input.profile_id);
      if (req.input.clinic_id) await publicClinic(req.input.clinic_id);
      const now = new Date(),
        row = {
          id: randomUUID(),
          account_id: a.id,
          tenant_id: req.input.clinic_id ?? null,
          profile_id: req.input.profile_id ?? null,
          subject: req.input.subject,
          messages: [
            { by: 'patient', message: req.input.message, created_at: now },
          ],
          status: 'Open',
          created_at: now,
          updated_at: now,
        };
      await db.collection('mobile_support_tickets').insertOne({ ...row });
      res
        .status(201)
        .json(
          pick(row, [
            'id',
            'subject',
            'messages',
            'status',
            'created_at',
            'updated_at',
          ])
        );
    },
    {
      body: z
        .object({
          subject: text(200),
          message: text(4000),
          profile_id: uuid.optional(),
          clinic_id: uuid.optional(),
        })
        .strict(),
    }
  );
  route(
    router,
    'get',
    '/support-tickets',
    'List account support requests',
    async (req, res) =>
      res.json(
        await page(
          'mobile_support_tickets',
          { account_id: res.locals.account.id },
          req.query,
          { _id: 0, id: 1, subject: 1, status: 1, created_at: 1, updated_at: 1 }
        )
      )
  );
  route(
    router,
    'get',
    '/support-tickets/:id',
    'Read an account-owned support conversation',
    async (req, res) => {
      const row = await db
        .collection('mobile_support_tickets')
        .findOne(
          { id: uuid.parse(req.params.id), account_id: res.locals.account.id },
          { projection: { _id: 0, account_id: 0 } }
        );
      if (!row) throw fail('Support request not found.', 404);
      res.json(row);
    }
  );
  route(
    router,
    'post',
    '/account-deletion-requests',
    'Request account deletion and immediately revoke mobile sessions',
    async (req, res) => {
      const a = res.locals.account;
      await transaction(async (session) => {
        await db.collection('mobile_account_deletion_requests').insertOne(
          {
            id: randomUUID(),
            account_id: a.id,
            status: 'Pending',
            reason: req.input.reason ?? '',
            created_at: new Date(),
          },
          { session }
        );
        await db
          .collection('mobile_accounts')
          .updateOne(
            { id: a.id, status: 'Active' },
            { $set: { status: 'Deletion Requested', updated_at: new Date() } },
            { session }
          );
        await db
          .collection('mobile_sessions')
          .deleteMany({ account_id: a.id }, { session });
        await db
          .collection('mobile_devices')
          .deleteMany({ account_id: a.id }, { session });
        await audit(a, 'patient_app_deletion_requested', a.id, session);
      });
      res.status(202).json({
        status: 'Deletion Requested',
        message:
          'Mobile access has been revoked. Clinic records are retained for the clinic retention and deletion review process.',
      });
    },
    { body: z.object({ reason: z.string().max(1000).optional() }).strict() }
  );
}
