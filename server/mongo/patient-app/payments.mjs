import { Router } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, transaction } from '../database.mjs';
import { verifyCapturedCheckout } from '../payment-verification.mjs';
import {
  accountProfile,
  clinicAccess,
  digest,
  equalSecret,
  fail,
  linksFor,
  linkFilter,
  ownRow,
  page,
  pick,
  requestKey,
  route,
  uuid,
} from './common.mjs';
import { confirmBooking, ownHold } from './booking-service.mjs';

export async function gateway(tenant, { webhook = false } = {}) {
  const row = await db.collection('hospital_settings').findOne({
      tenant_id: tenant,
      section: 'PaymentMethods',
      key: 'gateways',
    }),
    selected = await db.collection('hospital_settings').findOne({
      tenant_id: tenant,
      section: 'PaymentMethods',
      key: 'selected_gateway',
    }),
    g = row?.value?.Razorpay;
  if (
    selected?.value !== 'Razorpay' ||
    !g?.api_key ||
    !g?.password ||
    (webhook && !g.webhook_secret)
  )
    throw fail(
      'Online payments are not configured for this clinic.',
      503,
      'PAYMENTS_NOT_CONFIGURED'
    );
  return {
    key: String(g.api_key),
    secret: String(g.password),
    webhook_secret: g.webhook_secret,
  };
}
async function provider(keys, path, body) {
  let response;
  try {
    response = await fetch('https://api.razorpay.com/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${keys.key}:${keys.secret}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
  } catch {
    throw fail(
      'Payment provider unavailable. Check payment status before retrying.',
      503
    );
  }
  if (!response.ok)
    throw fail('Payment provider did not confirm this request.', 503);
  return response.json();
}
export const paymentView = (row) => ({
  ...pick(row, [
    'id',
    'quote_id',
    'hold_id',
    'provider_order_id',
    'provider_payment_id',
    'amount_cents',
    'currency',
    'status',
    'appointment_id',
    'refund_amount_cents',
    'provider_refunded_cents',
    'refund_status',
    'requires_review',
    'expires_at',
    'created_at',
    'updated_at',
  ]),
  checkout_available: row.status === 'Ready' && row.expires_at > new Date(),
});
async function ownPayment(account, id) {
  const row = await db
    .collection('mobile_payment_orders')
    .findOne({ id: uuid.parse(id), account_id: account.id });
  if (!row) throw fail('Payment not found.', 404);
  await accountProfile(account, row.profile_id);
  return row;
}
async function captured(stored, payment) {
  if (
    payment.order_id !== stored.provider_order_id ||
    payment.currency !== 'INR' ||
    payment.amount !== stored.amount_cents ||
    payment.status !== 'captured' ||
    payment.captured !== true ||
    Number(payment.amount_refunded ?? 0) !== 0 ||
    !/^pay_[a-z0-9]+$/i.test(payment.id ?? '')
  )
    throw fail('Payment amount, order, or capture status did not match.', 402);
  return transaction(async (session) => {
    const row = await db
      .collection('mobile_payment_orders')
      .findOne({ id: stored.id }, { session });
    if (row.provider_payment_id && row.provider_payment_id !== payment.id)
      throw fail('Payment order was already captured by another payment.', 409);
    if (row.refund_amount_cents > 0 || row.provider_refunded_cents > 0)
      throw fail('Refunded payment requires reconciliation.', 409);
    if (row.status === 'Consumed') return row;
    return db.collection('mobile_payment_orders').findOneAndUpdate(
      { id: row.id },
      {
        $set: {
          status: 'Captured',
          provider_payment_id: payment.id,
          captured_at: new Date(),
          updated_at: new Date(),
        },
      },
      { session, returnDocument: 'after' }
    );
  });
}
async function refunded(tenant, refund) {
  if (
    !/^rfnd_[a-z0-9]+$/i.test(refund.id ?? '') ||
    !/^pay_[a-z0-9]+$/i.test(refund.payment_id ?? '') ||
    refund.status !== 'processed' ||
    refund.currency !== 'INR' ||
    !Number.isSafeInteger(refund.amount) ||
    refund.amount <= 0
  )
    throw fail('Refund event is invalid.');
  return transaction(async (session) => {
    const prior = await db
      .collection('mobile_refund_events')
      .findOne({ provider_refund_id: refund.id }, { session });
    if (prior) {
      if (
        prior.tenant_id !== tenant ||
        prior.payment_id !== refund.payment_id ||
        prior.amount_cents !== refund.amount
      )
        throw fail('Refund event changed.', 409);
      return prior;
    }
    const stored = await db
      .collection('mobile_payment_orders')
      .findOne(
        { tenant_id: tenant, provider_payment_id: refund.payment_id },
        { session }
      );
    if (!stored) return null;
    const total = (stored.refund_amount_cents ?? 0) + refund.amount;
    if (total > stored.amount_cents)
      throw fail('Refund exceeds the captured amount.', 409);
    const event = {
      id: randomUUID(),
      tenant_id: tenant,
      provider_refund_id: refund.id,
      payment_id: refund.payment_id,
      payment_order_id: stored.id,
      amount_cents: refund.amount,
      status: 'Processed',
      created_at: new Date(),
    };
    await db
      .collection('mobile_refund_events')
      .insertOne({ ...event }, { session });
    await db.collection('mobile_payment_orders').updateOne(
      { id: stored.id },
      {
        $set: {
          refund_amount_cents: total,
          refund_status:
            total === stored.amount_cents ? 'Refunded' : 'Partially Refunded',
          requires_review: true,
          review_reason: 'PROVIDER_REFUND_RECONCILIATION',
          updated_at: new Date(),
        },
      },
      { session }
    );
    if (stored.appointment_id)
      await db.collection('clinical_appointments').updateOne(
        {
          id: stored.appointment_id,
          tenant_id: tenant,
          status: { $ne: 'Cancelled' },
        },
        { $set: { payment_status: 'Refund Review', updated_at: new Date() } },
        { session }
      );
    return event;
  });
}
async function providerRefundReview(stored, payment) {
  const amount = Number(payment.amount_refunded ?? 0);
  if (
    !/^pay_[a-z0-9]+$/i.test(payment.id ?? '') ||
    (payment.id !== stored.provider_payment_id && stored.provider_payment_id) ||
    payment.order_id !== stored.provider_order_id ||
    payment.amount !== stored.amount_cents ||
    payment.currency !== 'INR' ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > stored.amount_cents
  )
    throw fail('Provider refund details did not match.', 402);
  return transaction(async (session) => {
    const fresh = await db
      .collection('mobile_payment_orders')
      .findOne({ id: stored.id }, { session });
    if (
      !fresh ||
      (fresh.provider_payment_id && fresh.provider_payment_id !== payment.id)
    )
      throw fail('Payment changed during reconciliation.', 409);
    const saved = await db.collection('mobile_payment_orders').findOneAndUpdate(
      { id: stored.id },
      {
        $set: {
          provider_payment_id: payment.id,
          provider_refunded_cents: Math.max(
            amount,
            fresh.provider_refunded_cents ?? 0
          ),
          requires_review: true,
          review_reason: 'PROVIDER_REFUND_RECONCILIATION',
          updated_at: new Date(),
          ...(!fresh.appointment_id ? { status: 'Requires Attention' } : {}),
        },
      },
      { session, returnDocument: 'after' }
    );
    if (saved.appointment_id)
      await db.collection('clinical_appointments').updateOne(
        {
          id: saved.appointment_id,
          tenant_id: saved.tenant_id,
          status: { $ne: 'Cancelled' },
        },
        { $set: { payment_status: 'Refund Review', updated_at: new Date() } },
        { session }
      );
    return saved;
  });
}
async function finalize(stored) {
  if (stored.appointment_id) return stored;
  try {
    await transaction(async (session) => {
      const account = await db
        .collection('mobile_accounts')
        .findOne({ id: stored.account_id, status: 'Active' }, { session });
      if (!account) throw fail('Account needs review.', 409);
      await confirmBooking(account, stored.quote_id, stored.id, false, session);
    });
  } catch (error) {
    if (![400, 401, 402, 403, 404, 409].includes(error.status)) throw error;
    await db.collection('mobile_payment_orders').updateOne(
      { id: stored.id, status: 'Captured' },
      {
        $set: {
          requires_review: true,
          review_reason: error.code ?? 'BOOKING_NOT_CONFIRMED',
          updated_at: new Date(),
        },
      }
    );
  }
  return db.collection('mobile_payment_orders').findOne({ id: stored.id });
}

export function registerPayments(router) {
  route(
    router,
    'post',
    '/payment-orders',
    'Create an online checkout order using the clinic gateway',
    async (req, res) => {
      const a = res.locals.account,
        key = requestKey(req),
        prior = await db
          .collection('mobile_payment_orders')
          .findOne({ account_id: a.id, key });
      if (prior) {
        if (prior.quote_id !== req.input.quote_id)
          throw fail(
            'Payment key was already used with a different quote.',
            409
          );
        await accountProfile(a, prior.profile_id);
        if (!prior.provider_order_id)
          throw fail(
            'Payment creation is pending or needs reception review.',
            409
          );
        return res.json({
          ...paymentView(prior),
          provider: 'Razorpay',
          key_id: prior.key_id,
        });
      }
      const quote = await db
        .collection('mobile_booking_quotes')
        .findOne({ id: req.input.quote_id, account_id: a.id });
      if (!quote || quote.expires_at <= new Date())
        throw fail('Booking quote expired or unavailable.', 409);
      const hold = await ownHold(a, quote.hold_id);
      await clinicAccess(hold.tenant_id, { module: 'billing' });
      if (quote.total_cents <= 0)
        throw fail('This appointment does not require online payment.');
      const keys = await gateway(hold.tenant_id);
      const id = randomUUID(),
        row = {
          id,
          account_id: a.id,
          tenant_id: hold.tenant_id,
          branch_id: hold.branch_id,
          profile_id: hold.profile_id,
          quote_id: quote.id,
          hold_id: hold.id,
          key,
          key_id: keys.key,
          amount_cents: quote.total_cents,
          currency: 'INR',
          status: 'Creating',
          expires_at: quote.expires_at,
          created_at: new Date(),
          updated_at: new Date(),
        };
      await transaction(async (session) => {
        await ownHold(a, hold.id, session);
        if (
          await db
            .collection('mobile_payment_orders')
            .findOne({ hold_id: hold.id }, { session })
        )
          throw fail(
            'A payment order already exists for this hold. Use its payment status.',
            409
          );
        await db
          .collection('mobile_payment_orders')
          .insertOne({ ...row }, { session });
      });
      try {
        const order = await provider(keys, 'orders', {
          amount: row.amount_cents,
          currency: 'INR',
          receipt: 'MOB-' + id.replaceAll('-', ''),
        });
        if (
          !/^order_[a-z0-9]+$/i.test(order.id ?? '') ||
          order.amount !== row.amount_cents ||
          order.currency !== 'INR'
        )
          throw fail(
            'Payment provider returned inconsistent order details.',
            503
          );
        const saved = await db
          .collection('mobile_payment_orders')
          .findOneAndUpdate(
            { id, status: 'Creating' },
            {
              $set: {
                provider_order_id: order.id,
                status: 'Ready',
                updated_at: new Date(),
              },
            },
            { returnDocument: 'after' }
          );
        res.status(201).json({
          ...paymentView(saved),
          provider: 'Razorpay',
          key_id: keys.key,
        });
      } catch (error) {
        await db.collection('mobile_payment_orders').updateOne(
          { id, status: 'Creating' },
          {
            $set: {
              status: 'Requires Attention',
              requires_review: true,
              updated_at: new Date(),
            },
          }
        );
        throw error;
      }
    },
    { idempotent: true, body: z.object({ quote_id: uuid }).strict() }
  );
  route(
    router,
    'post',
    '/payments/:id/verify',
    'Verify a captured checkout and finalize the booking',
    async (req, res) => {
      const stored = await ownPayment(res.locals.account, req.params.id);
      if (!stored.provider_order_id)
        throw fail('Checkout order is not ready.', 409);
      if (stored.status === 'Consumed') return res.json(paymentView(stored));
      const keys = await gateway(stored.tenant_id),
        body = req.input;
      const [order, payment] = await Promise.all([
        provider(
          keys,
          'orders/' + encodeURIComponent(stored.provider_order_id)
        ),
        provider(keys, 'payments/' + encodeURIComponent(body.payment_id)),
      ]);
      verifyCapturedCheckout({
        secret: keys.secret,
        signature: body.signature,
        order,
        payment,
        amount: stored.amount_cents,
        orderId: stored.provider_order_id,
        paymentId: body.payment_id,
      });
      res.json(paymentView(await finalize(await captured(stored, payment))));
    },
    {
      body: z
        .object({
          payment_id: z.string().regex(/^pay_[a-z0-9]+$/i),
          signature: z.string().regex(/^[a-f0-9]{64}$/i),
        })
        .strict(),
    }
  );
  route(
    router,
    'get',
    '/payments/:id',
    'Get a patient payment or receipt status',
    async (req, res) => {
      const order = await db.collection('mobile_payment_orders').findOne({
        id: uuid.parse(req.params.id),
        account_id: res.locals.account.id,
      });
      if (order) {
        await ownPayment(res.locals.account, order.id);
        return res.json(paymentView(order));
      }
      const row = await ownRow(
        res.locals.account,
        'finance_records',
        req.params.id,
        { kind: 'payments' }
      );
      res.json(
        pick(row, [
          'id',
          'record_number',
          'record_date',
          'amount',
          'total',
          'paid',
          'status',
          'created_at',
        ])
      );
    }
  );
  route(
    router,
    'post',
    '/payments/:id/sync',
    'Recover payment status from the gateway if the mobile checkout callback was interrupted',
    async (req, res) => {
      const stored = await ownPayment(res.locals.account, req.params.id);
      if (!stored.provider_order_id)
        throw fail('Checkout creation needs clinic review.', 409);
      const keys = await gateway(stored.tenant_id),
        order = await provider(
          keys,
          'orders/' + encodeURIComponent(stored.provider_order_id)
        );
      if (
        order.id !== stored.provider_order_id ||
        order.currency !== 'INR' ||
        order.amount !== stored.amount_cents
      )
        throw fail('Provider order does not match this booking.', 402);
      if (order.status !== 'paid' || order.amount_paid !== stored.amount_cents)
        return res.json(paymentView(stored));
      const result = await provider(
          keys,
          'orders/' + encodeURIComponent(stored.provider_order_id) + '/payments'
        ),
        candidates = (result.items ?? []).filter(
          (p) =>
            p.status === 'captured' &&
            p.captured === true &&
            p.order_id === stored.provider_order_id &&
            p.amount === stored.amount_cents &&
            p.currency === 'INR'
        );
      if (candidates.length !== 1)
        throw fail('Payment needs clinic review before another charge.', 409);
      if (Number(candidates[0].amount_refunded ?? 0) > 0)
        return res.json(
          paymentView(await providerRefundReview(stored, candidates[0]))
        );
      res.json(
        paymentView(await finalize(await captured(stored, candidates[0])))
      );
    }
  );
  route(
    router,
    'get',
    '/payments',
    'List patient receipts and pending online orders',
    async (req, res) => {
      const a = res.locals.account;
      const result = await page(
        'finance_records',
        {
          $and: [
            linkFilter(await linksFor(a, req.query.patient_id)),
            { kind: 'payments' },
          ],
        },
        req.query,
        {
          _id: 0,
          id: 1,
          record_number: 1,
          record_date: 1,
          amount: 1,
          total: 1,
          paid: 1,
          status: 1,
          created_at: 1,
        }
      );
      const profiles = await db
        .collection('mobile_profiles')
        .find({ account_id: a.id, active: true }, { projection: { id: 1 } })
        .toArray();
      const pending = await db
        .collection('mobile_payment_orders')
        .find({
          account_id: a.id,
          profile_id: { $in: profiles.map((p) => p.id) },
          status: { $ne: 'Consumed' },
          ...(req.query.patient_id
            ? { profile_id: uuid.parse(req.query.patient_id) }
            : {}),
        })
        .sort({ created_at: -1 })
        .limit(50)
        .toArray();
      res.json({ ...result, pending_orders: pending.map(paymentView) });
    }
  );
}

export const paymentWebhookRouter = Router();
route(
  paymentWebhookRouter,
  'post',
  '/razorpay/:clinicId',
  'Receive a signed Razorpay payment webhook',
  async (req, res) => {
    const tenant = uuid.parse(req.params.clinicId),
      keys = await gateway(tenant, { webhook: true }),
      signature = req.header('x-razorpay-signature') ?? '';
    if (
      !Buffer.isBuffer(req.rawBody) ||
      !/^[a-f0-9]{64}$/i.test(signature) ||
      !equalSecret(
        signature.toLowerCase(),
        createHmac('sha256', String(keys.webhook_secret))
          .update(req.rawBody)
          .digest('hex')
      )
    )
      throw fail('Invalid payment webhook signature.', 401);
    const body = z
        .object({
          event: z.string(),
          payload: z.object({
            payment: z
              .object({ entity: z.record(z.string(), z.unknown()) })
              .optional(),
            refund: z
              .object({ entity: z.record(z.string(), z.unknown()) })
              .optional(),
          }),
        })
        .parse(req.body),
      payment = body.payload.payment?.entity;
    if (body.event === 'refund.processed' && body.payload.refund?.entity) {
      const event = await refunded(tenant, body.payload.refund.entity);
      return res.json({
        received: true,
        processed: Boolean(event),
        requires_clinic_reconciliation: Boolean(event),
      });
    }
    if (body.event !== 'payment.captured' || !payment)
      return res.json({ received: true, processed: false });
    const stored = await db
      .collection('mobile_payment_orders')
      .findOne({ tenant_id: tenant, provider_order_id: payment.order_id });
    if (!stored) return res.json({ received: true, processed: false });
    const current = await provider(
      keys,
      'payments/' + encodeURIComponent(payment.id)
    );
    if (Number(current.amount_refunded ?? 0) > 0) {
      await providerRefundReview(stored, current);
      return res.json({
        received: true,
        processed: false,
        requires_clinic_reconciliation: true,
      });
    }
    const saved = await captured(stored, current);
    await db.collection('mobile_webhook_events').updateOne(
      { tenant_id: tenant, event_hash: digest(req.rawBody.toString('utf8')) },
      {
        $setOnInsert: {
          created_at: new Date(),
          event: body.event,
          payment_order_id: stored.id,
        },
      },
      { upsert: true }
    );
    const result = await finalize(saved);
    res.json({ received: true, processed: true, status: result.status });
  },
  { public: true, base: '/api/v1/webhooks/payments' }
);
