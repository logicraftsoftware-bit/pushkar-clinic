// Run only against an explicitly selected disposable local replica set, never Atlas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {generateKeyPairSync} from 'node:crypto';
import { randomUUID, createHmac } from 'node:crypto';
if (
  process.env.PATIENT_APP_INTEGRATION_TEST !== 'true' ||
  process.env.NODE_ENV !== 'test' ||
  !/^pushkar_test_patient_[a-z0-9_]+$/.test(process.env.MONGODB_DB ?? '') ||
  !/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(process.env.MONGODB_URI ?? '')
)
  throw Error(
    'Use a disposable local pushkar_test_patient_* replica-set database with explicit test mode.'
  );
const { db, client, initializeMongo } = await import('./database.mjs');
const { hashPassword } = await import('./security.mjs');
const { initializeRoles } = await import('./access.mjs');
const { secretHash } = await import('./patient-app/common.mjs');
const { hospitalDay } = await import('./finance-ledger.mjs');
const { default: app } = await import('./app.mjs');
await initializeMongo();
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`,
  api = '/api/v1/patient-app',
  admin = '/api/v1/patient-app-admin';
const realFetch = globalThis.fetch,
  orders = new Map(),
  payments = new Map();
let orderNumber = 0;
const firebaseKeys=generateKeyPairSync('rsa',{modulusLength:2048});
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(String(url));
  if (target.hostname === '127.0.0.1' && target.origin === base)
    return realFetch(url, options);
  if(target.href==='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com')return Response.json({synthetic:firebaseKeys.publicKey.export({type:'spki',format:'pem'})},{headers:{'cache-control':'max-age=3600'}});
  if (target.origin === 'https://api.razorpay.com') {
    const path = target.pathname.replace('/v1/', '');
    if (path === 'orders' && options.method === 'POST') {
      const body = JSON.parse(options.body),
        row = {
          id: 'order_test' + ++orderNumber,
          amount: body.amount,
          amount_paid: 0,
          currency: 'INR',
          status: 'created',
        };
      orders.set(row.id, row);
      return Response.json(row);
    }
    if (path.startsWith('orders/') && path.endsWith('/payments'))
      return Response.json({
        items: [...payments.values()].filter(
          (p) => p.order_id === path.split('/')[1]
        ),
      });
    if (path.startsWith('orders/'))
      return Response.json(orders.get(path.slice(7)) ?? {}, {
        status: orders.has(path.slice(7)) ? 200 : 404,
      });
    if (path.startsWith('payments/'))
      return Response.json(payments.get(path.slice(9)) ?? {}, {
        status: payments.has(path.slice(9)) ? 200 : 404,
      });
  }
  throw Error(
    'Unmocked external provider request is prohibited in patient API tests.'
  );
};
after(async () => {
  globalThis.fetch = realFetch;
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await db.dropDatabase();
  await client.close();
});
async function http(
  path,
  { method = 'GET', body, token, key, headers = {} } = {}
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...headers,
    },
    ...(body
      ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  });
  const type = response.headers.get('content-type') ?? '',
    data =
      response.status === 204
        ? null
        : type.includes('application/json')
        ? await response.json()
        : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, headers: response.headers };
}
const call = (path, token, method = 'GET', body, key) =>
  http(api + path, { token, method, body, key });
function expectStatus(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
}
async function login(phone) {
  const challenge = expectStatus(
    await call('/auth/otp/request', null, 'POST', { phone }),
    202
  );
  assert.match(challenge.development_code, /^\d{6}$/);
  const result = expectStatus(
    await call('/auth/otp/verify', null, 'POST', {
      challenge_id: challenge.challenge_id,
      code: challenge.development_code,
    }),
    200
  );
  return { ...result, challenge };
}
const password = 'Synthetic-patient-api-test-password-123',
  today = hospitalDay(),
  day = (n) => hospitalDay(new Date(Date.now() + n * 86400000));
const clinics = [];
for (let n = 0; n < 2; n++) {
  const tenant = randomUUID(),
    branch = randomUUID(),
    department = randomUUID(),
    doctor = randomUUID(),
    owner = randomUUID(),
    plan = randomUUID(),
    now = new Date(),
    email = `mobile-owner-${n}@example.invalid`;
  const modules = await db.collection('platform_modules').find({}).toArray();
  await db.collection('hospitals').insertOne({
    id: tenant,
    code: 'MOBILE' + n,
    name: 'Synthetic Mobile Clinic ' + n,
    status: 'active',
    modules: modules.map((m) => m.code),
    deleted_at: null,
    created_at: now,
    phone: '9999999999',
    address: 'Synthetic Road',
    city: 'Test City',
  });
  await db.collection('branches').insertOne({
    id: branch,
    tenant_id: tenant,
    code: 'MAIN',
    name: 'Main',
    is_active: true,
  });
  await db.collection('departments').insertOne({
    id: department,
    tenant_id: tenant,
    branch_id: branch,
    code: 'CARD',
    name: 'Cardiology',
    is_active: true,
  });
  await db.collection('subscription_plans').insertOne({
    id: plan,
    code: 'MOBILE-PLAN-' + n,
    module_ids: modules.map((m) => m.id),
    max_branches: 10,
    max_users: 100,
    max_doctors: 100,
  });
  await db.collection('subscriptions').insertOne({
    id: randomUUID(),
    tenant_id: tenant,
    plan_id: plan,
    status: 'active',
    starts_at: new Date(Date.now() - 86400000),
    expires_at: new Date(Date.now() + 365 * 86400000),
    created_at: now,
  });
  await initializeRoles(tenant);
  await db.collection('users').insertMany([
    {
      id: owner,
      tenant_id: tenant,
      branch_id: branch,
      email,
      phone: '999999999' + n,
      first_name: 'Synthetic',
      last_name: 'Owner',
      role: 'hospital_admin',
      role_codes: ['HOSPITAL_ADMIN'],
      is_active: true,
      password_hash: await hashPassword(password),
      session_version: 0,
    },
    {
      id: doctor,
      tenant_id: tenant,
      branch_id: branch,
      department_id: department,
      email: `doctor-${n}@example.invalid`,
      first_name: 'Synthetic',
      last_name: 'Doctor ' + n,
      role: 'doctor',
      role_codes: ['DOCTOR'],
      is_active: true,
    },
  ]);
  await db.collection('staff_members').insertOne({
    id: randomUUID(),
    tenant_id: tenant,
    branch_id: branch,
    branch_ids: [branch],
    user_id: doctor,
    department_id: department,
    staff_type: 'Doctor',
    status: 'Active',
    professional: {
      consultation_fee: 700,
      slot_duration: 30,
      appointment_default_schedule: {
        from_time: '00:00',
        to_time: '23:59',
        slot_mode: 'time',
      },
      room_chamber: 'Room 2',
      live_queue_enabled: true,
    },
  });
  const session = expectStatus(
    await http('/api/v1/auth/login', {
      method: 'POST',
      body: { identifier: email, password, portal: 'hospital_admin' },
    }),
    200
  );
  clinics.push({
    tenant,
    branch,
    department,
    doctor,
    owner,
    token: session.token,
  });
}
let a, b, family, booked, paidBooking, paidCancel, releaseId, uploadId;
const c = clinics[0],
  other = clinics[1],
  existingPatient = randomUUID();
await db.collection('patients').insertOne({
  id: existingPatient,
  tenant_id: c.tenant,
  branch_id: c.branch,
  first_name: 'Historical',
  last_name: 'Patient',
  normalized_name: 'historical patient',
  phone: '9860000001',
  medical_record_number: 'UHID-LEGACY',
  deleted_at: null,
  date_of_birth: '2000-08-15',
  created_at: new Date(),
});
async function hold(
  token,
  profile,
  dateValue = day(1),
  timeValue = '10:00',
  extra = {}
) {
  return call(
    '/booking-holds',
    token,
    'POST',
    {
      profile_id: profile,
      clinic_id: c.tenant,
      branch_id: c.branch,
      doctor_id: c.doctor,
      appointment_date: dateValue,
      appointment_time: timeValue,
      ...extra,
    },
    randomUUID()
  );
}
async function quote(token, holdId) {
  return expectStatus(
    await call('/booking-quotes', token, 'POST', { hold_id: holdId }),
    201
  );
}
async function makeBooking(
  token,
  profile,
  timeValue = '12:00',
  dateValue = day(1)
) {
  const h = expectStatus(await hold(token, profile, dateValue, timeValue), 201),
    q = await quote(token, h.id);
  return expectStatus(
    await call(
      '/appointments',
      token,
      'POST',
      { quote_id: q.id, pay_at_clinic: true },
      randomUUID()
    ),
    201
  ).appointment;
}
async function paidOrder(token, profile, timeValue) {
  const key = randomUUID();
  const h = expectStatus(await hold(token, profile, day(1), timeValue), 201),
    q = await quote(token, h.id),
    r = expectStatus(
      await call('/payment-orders', token, 'POST', { quote_id: q.id }, key),
      201
    );
  return { hold: h, quote: q, order: r, key };
}
function capture(order, id) {
  const p = {
    id,
    order_id: order.provider_order_id,
    amount: order.amount_cents,
    currency: 'INR',
    status: 'captured',
    captured: true,
    amount_refunded: 0,
  };
  payments.set(id, p);
  Object.assign(orders.get(order.provider_order_id), {
    amount_paid: order.amount_cents,
    status: 'paid',
  });
  return p;
}
const gatewaySecret = 'synthetic-razorpay-secret-not-real',
  webhookSecret = 'synthetic-webhook-secret-not-real';

test('patient mobile HTTP workflows, access boundaries and financial integrity', async (t) => {
  await t.test('Firebase phone exchange verifies project and provider, reuses account and blocks disabled accounts',async()=>{
    const now=Math.floor(Date.now()/1000);
    const identity={sub:'synthetic-firebase-uid',phone_number:'+919999988888',auth_time:now,iat:now,exp:now+3600,aud:'jiboncare',iss:'https://securetoken.google.com/jiboncare',firebase:{sign_in_provider:'phone'}};
    const signed=(extra={})=>jwt.sign({...identity,...extra},firebaseKeys.privateKey,{algorithm:'RS256',keyid:'synthetic'});
    expectStatus(await call('/auth/firebase',null,'POST',{id_token:signed({aud:'wrong-project'})}),401);
    expectStatus(await call('/auth/firebase',null,'POST',{id_token:signed({firebase:{sign_in_provider:'password'}})}),401);
    const first=expectStatus(await call('/auth/firebase',null,'POST',{id_token:signed()}),200);
    assert.equal(first.account.phone,identity.phone_number);assert.ok(first.refresh_token);
    const next=expectStatus(await call('/auth/firebase',null,'POST',{id_token:signed()}),200);
    assert.equal(next.account.id,first.account.id);assert.equal(next.profile.id,first.profile.id);
    expectStatus(await call('/me',first.access_token),200);
    await db.collection('mobile_accounts').updateOne({id:first.account.id},{$set:{status:'Disabled'}});
    expectStatus(await call('/auth/firebase',null,'POST',{id_token:signed()}),403);
  });
  await t.test(
    'OpenAPI documents the implemented routes and public config has no provider secrets',
    async () => {
      const spec = expectStatus(await call('/openapi.json'), 200);
      assert.ok(Object.keys(spec.paths).length >= 50);
      assert.ok(spec.paths[api + '/appointments'].post);
      assert.equal(
        spec.components.securitySchemes.PatientBearer.scheme,
        'bearer'
      );
      assert.equal((await call('/me')).status, 401);
      const config = expectStatus(await call('/config'), 200);
      assert.equal(config.sms_login_configured, true);
      assert.equal(config.phone_auth_provider, 'firebase');
      assert.ok(!JSON.stringify(config).includes(gatewaySecret));
    }
  );
  await t.test(
    'clinics are private until a clinic administrator publishes them',
    async () => {
      assert.equal(expectStatus(await call('/clinics'), 200).total, 0);
      expectStatus(
        await http(admin + '/settings', {
          method: 'PATCH',
          token: c.token,
          body: {
            enabled: true,
            pay_at_clinic: true,
            booking_fee: 20,
            public_profile: {
              type: 'Clinic',
              description: 'Synthetic public description',
              latitude: 26.1,
              longitude: 91.7,
              facilities: ['OPD', 'Laboratory'],
            },
          },
        }),
        200
      );
      const list = expectStatus(
        await call('/clinics?q=Synthetic&lat=26&lng=91'),
        200
      );
      assert.equal(list.total, 1);
      assert.equal(list.data[0].id, c.tenant);
      assert.equal(list.data[0].password_hash, undefined);
      assert.equal((await call('/clinics/' + other.tenant)).status, 404);
      assert.equal(
        expectStatus(await call('/doctors?clinic_id=' + c.tenant), 200).data[0]
          .id,
        c.doctor
      );
      assert.equal((await call('/doctors/' + other.doctor)).status, 404);
      assert.equal(
        expectStatus(await call('/specialties?clinic_id=' + c.tenant), 200)
          .total,
        1
      );
    }
  );
  await t.test(
    'OTP is random, single use, rate limited and does not link historical records by phone',
    async () => {
      a = await login('9860000001');
      b = await login('9860000002');
      assert.equal(
        (
          await call('/auth/otp/verify', null, 'POST', {
            challenge_id: a.challenge.challenge_id,
            code: a.challenge.development_code,
          })
        ).status,
        401
      );
      assert.equal(
        (await call('/auth/otp/request', null, 'POST', { phone: '9860000001' }))
          .status,
        429
      );
      assert.equal(
        expectStatus(await call('/clinic-links', a.access_token), 200).data
          .length,
        0
      );
      expectStatus(
        await call('/me', a.access_token, 'PATCH', {
          name: 'Synthetic Patient',
          date_of_birth: '2000-08-15',
          sex: 'Male',
        }),
        200
      );
      expectStatus(
        await call('/me', b.access_token, 'PATCH', {
          name: 'Other Patient',
          date_of_birth: '1995-01-01',
          sex: 'Female',
        }),
        200
      );
      assert.equal(
        (
          await call('/me', a.access_token, 'PATCH', {
            account_id: b.account.id,
          })
        ).status,
        400
      );
      const ch = expectStatus(
        await call('/auth/otp/request', null, 'POST', { phone: '9860000003' }),
        202
      );
      for (let i = 0; i < 5; i++)
        assert.equal(
          (
            await call('/auth/otp/verify', null, 'POST', {
              challenge_id: ch.challenge_id,
              code: ch.development_code === '000000' ? '000001' : '000000',
            })
          ).status,
          401
        );
      assert.equal(
        (
          await call('/auth/otp/verify', null, 'POST', {
            challenge_id: ch.challenge_id,
            code: ch.development_code,
          })
        ).status,
        401
      );
    }
  );
  await t.test(
    'patient sessions cannot use staff APIs and staff sessions cannot use patient APIs',
    async () => {
      assert.equal((await call('/me', c.token)).status, 401);
      assert.equal(
        (await http('/api/v1/clinical/appointments', { token: a.access_token }))
          .status,
        401
      );
      assert.equal(
        (await http(admin + '/settings', { token: a.access_token })).status,
        401
      );
    }
  );
  await t.test(
    'refresh rotates both tokens and immediately invalidates the older access and refresh tokens',
    async () => {
      const old = a.access_token,
        refresh = a.refresh_token,
        r = expectStatus(
          await call('/auth/refresh', null, 'POST', { refresh_token: refresh }),
          200
        );
      a = { ...a, ...r };
      assert.equal((await call('/me', old)).status, 401);
      assert.equal(
        (await call('/auth/refresh', null, 'POST', { refresh_token: refresh }))
          .status,
        401
      );
      expectStatus(await call('/me', a.access_token), 200);
    }
  );
  await t.test(
    'family creation requires consent and profiles cannot be edited across accounts',
    async () => {
      assert.equal(
        (
          await call('/family-members', a.access_token, 'POST', {
            name: 'Family Patient',
            date_of_birth: '2015-01-01',
            relationship: 'Child',
            consent: false,
          })
        ).status,
        400
      );
      family = expectStatus(
        await call('/family-members', a.access_token, 'POST', {
          name: 'Family Patient',
          date_of_birth: '2015-01-01',
          relationship: 'Child',
          consent: true,
        }),
        201
      );
      assert.equal(
        (
          await call('/family-members/' + family.id, b.access_token, 'PATCH', {
            name: 'Intruder',
          })
        ).status,
        404
      );
      assert.equal(
        expectStatus(await call('/family-members', a.access_token), 200).data
          .length,
        2
      );
    }
  );
  await t.test(
    'reception record-link codes are phone-bound, branch-scoped and one-time',
    async () => {
      assert.equal(
        (
          await http(admin + '/link-codes', {
            method: 'POST',
            token: other.token,
            body: {
              patient_id: existingPatient,
              phone: '9860000001',
              consent_confirmed: true,
            },
          })
        ).status,
        404
      );
      const code = expectStatus(
        await http(admin + '/link-codes', {
          method: 'POST',
          token: c.token,
          body: {
            patient_id: existingPatient,
            phone: '9860000001',
            consent_confirmed: true,
          },
        }),
        201
      );
      assert.equal(
        (
          await call('/clinic-links', b.access_token, 'POST', {
            profile_id: b.account.self_profile_id,
            code: code.code,
          })
        ).status,
        404
      );
      const linked = expectStatus(
        await call('/clinic-links', a.access_token, 'POST', {
          profile_id: a.account.self_profile_id,
          code: code.code,
        }),
        201
      );
      assert.equal(linked.patient_id, existingPatient);
      assert.equal(
        (
          await call('/clinic-links', a.access_token, 'POST', {
            profile_id: a.account.self_profile_id,
            code: code.code,
          })
        ).status,
        404
      );
    }
  );
  await t.test(
    'simultaneous mobile reservations cannot take the same slot and reception sees mobile holds',
    async () => {
      const key = randomUUID(),
        body = {
          profile_id: a.account.self_profile_id,
          clinic_id: c.tenant,
          branch_id: c.branch,
          doctor_id: c.doctor,
          appointment_date: day(1),
          appointment_time: '10:00',
        },
        result = await Promise.all([
          call('/booking-holds', a.access_token, 'POST', body, key),
          hold(b.access_token, b.account.self_profile_id),
        ]);
      assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
      const winner = result.find((r) => r.status === 201),
        token = result[0].status === 201 ? a.access_token : b.access_token;
      const available = expectStatus(
        await call(
          `/doctors/${c.doctor}/availability?clinic_id=${c.tenant}&branch_id=${
            c.branch
          }&date=${day(1)}`
        ),
        200
      );
      assert.ok(!available.slots.some((s) => s.time === '10:00'));
      const staff = await http('/api/v1/clinical/appointments', {
        method: 'POST',
        token: c.token,
        body: {
          branch_id: c.branch,
          department_id: c.department,
          patient_id: existingPatient,
          doctor_id: c.doctor,
          appointment_date: day(1),
          appointment_time: '10:00',
          appointment_type: 'OPD',
          visit_type: 'New',
        },
      });
      assert.equal(staff.status, 409);
      expectStatus(
        await call('/booking-holds/' + winner.data.id, token, 'DELETE'),
        204
      );
    }
  );
  await t.test(
    'hold idempotency detects changed payloads and expired holds can be reclaimed',
    async () => {
      const key = randomUUID(),
        body = {
          profile_id: a.account.self_profile_id,
          clinic_id: c.tenant,
          branch_id: c.branch,
          doctor_id: c.doctor,
          appointment_date: day(1),
          appointment_time: '10:00',
        },
        h = expectStatus(
          await call('/booking-holds', a.access_token, 'POST', body, key),
          201
        );
      assert.equal(
        expectStatus(
          await call('/booking-holds', a.access_token, 'POST', body, key),
          201
        ).id,
        h.id
      );
      assert.equal(
        (
          await call(
            '/booking-holds',
            a.access_token,
            'POST',
            { ...body, appointment_time: '10:30' },
            key
          )
        ).status,
        409
      );
      assert.equal(
        (
          await call('/booking-holds/' + h.id, b.access_token, 'PATCH', {
            reason: 'No access',
          })
        ).status,
        404
      );
      await db
        .collection('mobile_booking_holds')
        .updateOne(
          { id: h.id },
          { $set: { expires_at: new Date(Date.now() - 1000) } }
        );
      const fresh = expectStatus(
        await hold(a.access_token, a.account.self_profile_id),
        201
      );
      assert.notEqual(fresh.id, h.id);
      await call('/booking-holds/' + fresh.id, a.access_token, 'DELETE');
    }
  );
  await t.test(
    'quotes use server prices and clinic payment creates an unpaid appointment once',
    async () => {
      const h = expectStatus(
          await hold(a.access_token, a.account.self_profile_id),
          201
        ),
        q = await quote(a.access_token, h.id);
      assert.equal(q.total_cents, 72000);
      assert.equal(q.payment_options.online, false);
      assert.equal(
        (
          await call(
            '/payment-orders',
            a.access_token,
            'POST',
            { quote_id: q.id },
            randomUUID()
          )
        ).status,
        503
      );
      assert.equal(
        (
          await call(
            '/appointments',
            a.access_token,
            'POST',
            { quote_id: q.id, pay_at_clinic: true, paid_amount: 720 },
            randomUUID()
          )
        ).status,
        400
      );
      const key = randomUUID(),
        body = { quote_id: q.id, pay_at_clinic: true },
        r = expectStatus(
          await call('/appointments', a.access_token, 'POST', body, key),
          201
        );
      booked = r.appointment;
      assert.equal(booked.paid_amount, 0);
      assert.equal(booked.payment_status, 'Unpaid');
      assert.equal(
        expectStatus(
          await call('/appointments', a.access_token, 'POST', body, key),
          201
        ).id,
        booked.id
      );
      assert.equal(
        await db
          .collection('clinical_appointments')
          .countDocuments({ id: booked.id }),
        1
      );
      assert.equal(booked.patient_id, existingPatient);
      assert.equal(
        (await call('/appointments/' + booked.id, b.access_token)).status,
        404
      );
    }
  );
  await t.test(
    'rescheduling preserves billing, rejects stale edits and only moves owned appointments',
    async () => {
      assert.equal(
        (
          await call(
            '/appointments/' + booked.id + '/reschedule',
            b.access_token,
            'POST',
            {
              appointment_date: day(1),
              appointment_time: '10:30',
              updated_at: booked.updated_at,
            },
            randomUUID()
          )
        ).status,
        404
      );
      assert.equal(
        (
          await call(
            '/appointments/' + booked.id + '/reschedule',
            a.access_token,
            'POST',
            {
              appointment_date: day(1),
              appointment_time: '10:30',
              updated_at: new Date(0).toISOString(),
            },
            randomUUID()
          )
        ).status,
        409
      );
      booked = expectStatus(
        await call(
          '/appointments/' + booked.id + '/reschedule',
          a.access_token,
          'POST',
          {
            appointment_date: day(1),
            appointment_time: '10:30',
            updated_at: booked.updated_at,
          },
          randomUUID()
        ),
        200
      );
      assert.equal(booked.appointment_time, '10:30');
      assert.equal(booked.total, 720);
    }
  );
  await t.test(
    'appointment passes and invoice downloads are private PDFs with real appointment totals',
    async () => {
      assert.equal(
        (await call('/appointments/' + booked.id + '/pass', b.access_token))
          .status,
        404
      );
      const pass = expectStatus(
        await call('/appointments/' + booked.id + '/pass', a.access_token),
        200
      );
      assert.equal(
        expectStatus(
          await http(admin + '/validate-pass', {
            method: 'POST',
            token: c.token,
            body: { qr_payload: pass.qr_payload },
          }),
          200
        ).id,
        booked.id
      );
      const pdf = expectStatus(
        await call(
          '/appointments/' + booked.id + '/pass?format=pdf',
          a.access_token
        ),
        200
      );
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.equal(
        expectStatus(await call('/invoices/' + booked.id, a.access_token), 200)
          .due,
        720
      );
      assert.equal(
        expectStatus(
          await call('/invoices/' + booked.id + '/download', a.access_token),
          200
        )
          .subarray(0, 5)
          .toString(),
        '%PDF-'
      );
      assert.ok(
        expectStatus(
          await call('/invoices?status=pending', a.access_token),
          200
        ).data.some((r) => r.id === booked.id)
      );
    }
  );
  await t.test(
    'unpaid appointments cannot self-check-in and can be cancelled without deleting billing history',
    async () => {
      await db
        .collection('clinical_appointments')
        .updateOne({ id: booked.id }, { $set: { appointment_date: today } });
      const qr = expectStatus(
        await http(admin + '/check-in-codes', {
          method: 'POST',
          token: c.token,
          body: { branch_id: c.branch },
        }),
        200
      );
      assert.equal(
        (
          await call(
            '/appointments/' + booked.id + '/check-in',
            a.access_token,
            'POST',
            { clinic_qr: qr.qr_payload }
          )
        ).status,
        402
      );
      const r = expectStatus(
        await call(
          '/appointments/' + booked.id + '/cancel',
          a.access_token,
          'POST',
          { reason: 'Synthetic cancellation' },
          randomUUID()
        ),
        200
      );
      assert.equal(r.status, 'Cancelled');
      assert.ok(
        await db.collection('clinical_appointments').findOne({ id: booked.id })
      );
    }
  );
  await t.test(
    'Razorpay checkout verifies signature, exact amount and captured status before booking',
    async () => {
      await db.collection('hospital_settings').insertMany([
        {
          tenant_id: c.tenant,
          section: 'PaymentMethods',
          key: 'selected_gateway',
          value: 'Razorpay',
        },
        {
          tenant_id: c.tenant,
          section: 'PaymentMethods',
          key: 'gateways',
          value: {
            Razorpay: {
              api_key: 'rzp_test_synthetic',
              password: gatewaySecret,
              webhook_secret: webhookSecret,
            },
          },
        },
      ]);
      const { order } = await paidOrder(
          a.access_token,
          a.account.self_profile_id,
          '11:00'
        ),
        p = capture(order, 'pay_verified');
      assert.equal(
        (
          await call(
            '/payments/' + order.id + '/verify',
            b.access_token,
            'POST',
            { payment_id: p.id, signature: '0'.repeat(64) }
          )
        ).status,
        404
      );
      assert.equal(
        (
          await call(
            '/payments/' + order.id + '/verify',
            a.access_token,
            'POST',
            { payment_id: p.id, signature: '0'.repeat(64) }
          )
        ).status,
        402
      );
      const signature = createHmac('sha256', gatewaySecret)
        .update(order.provider_order_id + '|' + p.id)
        .digest('hex');
      p.amount = 1;
      assert.equal(
        (
          await call(
            '/payments/' + order.id + '/verify',
            a.access_token,
            'POST',
            { payment_id: p.id, signature }
          )
        ).status,
        402
      );
      p.amount = 72000;
      const verified = expectStatus(
        await call(
          '/payments/' + order.id + '/verify',
          a.access_token,
          'POST',
          { payment_id: p.id, signature }
        ),
        200
      );
      assert.equal(verified.status, 'Consumed');
      paidBooking = expectStatus(
        await call('/appointments/' + verified.appointment_id, a.access_token),
        200
      );
      assert.equal(paidBooking.paid_amount, 720);
      assert.equal(
        await db.collection('finance_records').countDocuments({
          'data.appointment_id': paidBooking.id,
          kind: 'payments',
        }),
        1
      );
      expectStatus(
        await call(
          '/payments/' + order.id + '/verify',
          a.access_token,
          'POST',
          { payment_id: p.id, signature }
        ),
        200
      );
      assert.equal(
        await db.collection('finance_records').countDocuments({
          'data.appointment_id': paidBooking.id,
          kind: 'payments',
        }),
        1
      );
    }
  );
  await t.test(
    'signed payment webhooks finalize exactly once and never trust unsigned payloads',
    async () => {
      const { order } = await paidOrder(
          a.access_token,
          a.account.self_profile_id,
          '11:30'
        ),
        p = capture(order, 'pay_webhook'),
        body = JSON.stringify({
          event: 'payment.captured',
          payload: { payment: { entity: p } },
        }),
        path = '/api/v1/webhooks/payments/razorpay/' + c.tenant;
      assert.equal(
        (
          await http(path, {
            method: 'POST',
            body,
            headers: {
              'Content-Type': 'application/json',
              'x-razorpay-signature': '0'.repeat(64),
            },
          })
        ).status,
        401
      );
      const signature = createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');
      for (let i = 0; i < 2; i++)
        assert.equal(
          expectStatus(
            await http(path, {
              method: 'POST',
              body,
              headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': signature,
              },
            }),
            200
          ).status,
          'Consumed'
        );
      const saved = await db
        .collection('mobile_payment_orders')
        .findOne({ id: order.id });
      assert.equal(
        await db.collection('finance_records').countDocuments({
          'data.appointment_id': saved.appointment_id,
          kind: 'payments',
        }),
        1
      );
    }
  );
  await t.test(
    'a captured payment after hold expiry is retained for review without an extra booking',
    async () => {
      const { order, hold: h } = await paidOrder(
          a.access_token,
          a.account.self_profile_id,
          '12:00'
        ),
        p = capture(order, 'pay_expired');
      await db
        .collection('mobile_booking_holds')
        .updateOne(
          { id: h.id },
          { $set: { expires_at: new Date(Date.now() - 1000) } }
        );
      const body = JSON.stringify({
          event: 'payment.captured',
          payload: { payment: { entity: p } },
        }),
        signature = createHmac('sha256', webhookSecret)
          .update(body)
          .digest('hex');
      expectStatus(
        await http('/api/v1/webhooks/payments/razorpay/' + c.tenant, {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': signature,
          },
        }),
        200
      );
      const result = expectStatus(
        await call('/payments/' + order.id, a.access_token),
        200
      );
      assert.equal(result.status, 'Captured');
      assert.equal(result.requires_review, true);
      assert.equal(result.appointment_id, undefined);
    }
  );
  await t.test(
    'clinic QR check-in and live queue do not expose other patient names',
    async () => {
      await db
        .collection('clinical_appointments')
        .updateOne(
          { id: paidBooking.id },
          { $set: { appointment_date: today } }
        );
      assert.equal(
        (
          await call(
            '/appointments/' + paidBooking.id + '/check-in',
            a.access_token,
            'POST',
            {}
          )
        ).status,
        409
      );
      const wrong = expectStatus(
        await http(admin + '/check-in-codes', {
          method: 'POST',
          token: other.token,
          body: { branch_id: other.branch },
        }),
        200
      );
      assert.equal(
        (
          await call(
            '/appointments/' + paidBooking.id + '/check-in',
            a.access_token,
            'POST',
            { clinic_qr: wrong.qr_payload }
          )
        ).status,
        403
      );
      const qr = expectStatus(
        await http(admin + '/check-in-codes', {
          method: 'POST',
          token: c.token,
          body: { branch_id: c.branch },
        }),
        200
      );
      assert.equal(
        expectStatus(
          await call(
            '/appointments/' + paidBooking.id + '/check-in',
            a.access_token,
            'POST',
            { clinic_qr: qr.qr_payload }
          ),
          200
        ).status,
        'Checked In'
      );
      expectStatus(
        await call(
          '/appointments/' + paidBooking.id + '/check-in',
          a.access_token,
          'POST',
          { clinic_qr: qr.qr_payload }
        ),
        200
      );
      const queue = expectStatus(
        await call(
          '/appointments/' + paidBooking.id + '/queue',
          a.access_token
        ),
        200
      );
      assert.ok(!JSON.stringify(queue).includes('Historical Patient'));
      assert.ok(!JSON.stringify(queue.queue?.rows).includes('patient_id'));
      assert.equal(
        (
          await call(
            '/appointments/' + paidBooking.id + '/queue',
            b.access_token
          )
        ).status,
        404
      );
      const controller = new AbortController(),
        response = await realFetch(
          base + api + '/appointments/' + paidBooking.id + '/events',
          {
            headers: { Authorization: 'Bearer ' + a.access_token },
            signal: controller.signal,
          }
        );
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const reader = response.body.getReader(),
        snapshot = await reader.read();
      assert.match(Buffer.from(snapshot.value).toString(), /event: snapshot/);
      controller.abort();
    }
  );
  await t.test(
    'paid cancellations use the existing clinic approval and refund workflow',
    async () => {
      const row = await makeBooking(
        a.access_token,
        a.account.self_profile_id,
        '12:30'
      );
      await db.collection('clinical_appointments').updateOne(
        { id: row.id },
        {
          $set: {
            paid_amount: 720,
            payment_status: 'Paid',
            payment_mode: 'Cash',
          },
        }
      );
      paidCancel = expectStatus(
        await call(
          '/appointments/' + row.id + '/cancel',
          a.access_token,
          'POST',
          { reason: 'Synthetic paid cancellation' },
          randomUUID()
        ),
        200
      );
      assert.equal(paidCancel.status, 'Cancellation Requested');
      assert.equal(
        (await db.collection('clinical_appointments').findOne({ id: row.id }))
          .status,
        'Booked'
      );
      expectStatus(
        await http(
          '/api/v1/cancellations/' +
            paidCancel.cancellation_request_id +
            '/review',
          {
            method: 'POST',
            token: c.token,
            body: {
              decision: 'approve',
              amount: 720,
              note: 'Synthetic review',
            },
          }
        ),
        200
      );
      assert.equal(
        (await db.collection('clinical_appointments').findOne({ id: row.id }))
          .status,
        'Cancelled'
      );
      assert.equal(
        expectStatus(
          await call(
            '/refunds/' + paidCancel.cancellation_request_id,
            a.access_token
          ),
          200
        ).approved_amount,
        720
      );
      assert.equal(
        (
          await call(
            '/refunds/' + paidCancel.cancellation_request_id,
            b.access_token
          )
        ).status,
        404
      );
    }
  );
  await t.test(
    'uploads validate file signatures and remain private across accounts',
    async () => {
      assert.equal(
        (
          await call('/uploads', a.access_token, 'POST', {
            profile_id: a.account.self_profile_id,
            filename: 'bad.pdf',
            mime: 'application/pdf',
            content_base64: Buffer.from('not pdf').toString('base64'),
          })
        ).status,
        400
      );
      const file = expectStatus(
        await call('/uploads', a.access_token, 'POST', {
          profile_id: a.account.self_profile_id,
          filename: 'sample.pdf',
          mime: 'application/pdf',
          content_base64: Buffer.from('%PDF-1.4\nSynthetic test file').toString(
            'base64'
          ),
          share_with_clinic: true,
        }),
        201
      );
      uploadId = file.id;
      const quotaId = randomUUID();
      await db
        .collection('mobile_uploads')
        .insertOne({
          id: quotaId,
          account_id: a.account.id,
          size: 50 * 1024 * 1024,
        });
      assert.equal(
        (
          await call('/uploads', a.access_token, 'POST', {
            profile_id: a.account.self_profile_id,
            filename: 'quota.pdf',
            mime: 'application/pdf',
            content_base64: Buffer.from(
              '%PDF-1.4\nSynthetic test file'
            ).toString('base64'),
          })
        ).status,
        409
      );
      await db.collection('mobile_uploads').deleteOne({ id: quotaId });
      assert.equal(
        (await call('/uploads/' + file.id + '/download', b.access_token))
          .status,
        404
      );
      expectStatus(
        await call(
          '/records',
          a.access_token,
          'POST',
          {
            profile_id: a.account.self_profile_id,
            upload_id: file.id,
            title: 'Personal report',
            record_date: today,
          },
          randomUUID()
        ),
        201
      );
      assert.equal(
        expectStatus(await call('/records?type=uploaded', a.access_token), 200)
          .total,
        1
      );
    }
  );
  await t.test(
    'draft and unapproved medical records are hidden; releases invalidate immediately after edits',
    async () => {
      const source = {
        id: randomUUID(),
        tenant_id: c.tenant,
        branch_id: c.branch,
        patient_id: existingPatient,
        doctor_id: c.doctor,
        record_type: 'consultation',
        data: {
          encounter_status: 'Draft',
          diagnosis: 'Synthetic diagnosis',
          private_internal_note: 'DO_NOT_LEAK',
          medicines: [{ name: 'Sample medicine', dose: 'Sample only' }],
        },
        created_at: new Date(),
        updated_at: new Date(),
      };
      await db.collection('doctor_clinical_records').insertOne({ ...source });
      assert.equal(
        (await call('/prescriptions/' + source.id, a.access_token)).status,
        404
      );
      assert.equal(
        (
          await http(admin + '/releases', {
            method: 'POST',
            token: c.token,
            body: { kind: 'consultation', source_id: source.id },
          })
        ).status,
        409
      );
      await db.collection('doctor_clinical_records').updateOne(
        { id: source.id },
        {
          $set: {
            'data.encounter_status': 'Completed',
            updated_at: new Date(),
          },
        }
      );
      const release = expectStatus(
        await http(admin + '/releases', {
          method: 'POST',
          token: c.token,
          body: { kind: 'consultation', source_id: source.id },
        }),
        201
      );
      releaseId = release.id;
      const body = expectStatus(
        await call('/prescriptions/' + source.id, a.access_token),
        200
      );
      assert.equal(body.data.diagnosis, 'Synthetic diagnosis');
      assert.ok(!JSON.stringify(body).includes('DO_NOT_LEAK'));
      assert.equal(
        (await call('/records/' + release.id + '/download', b.access_token))
          .status,
        404
      );
      assert.equal(
        expectStatus(
          await call('/records/' + release.id + '/download', a.access_token),
          200
        )
          .subarray(0, 5)
          .toString(),
        '%PDF-'
      );
      assert.equal(
        expectStatus(
          await call('/records?type=prescription', a.access_token),
          200
        ).total,
        1
      );
      await db.collection('doctor_clinical_records').updateOne(
        { id: source.id },
        {
          $set: {
            'data.diagnosis': 'Updated',
            updated_at: new Date(Date.now() + 1000),
          },
        }
      );
      assert.equal(
        (await call('/prescriptions/' + source.id, a.access_token)).status,
        404
      );
      assert.equal(
        expectStatus(
          await call('/records?type=prescription', a.access_token),
          200
        ).total,
        0
      );
    }
  );
  await t.test(
    'laboratory requests use public-bookable tests and authoritative branch prices',
    async () => {
      const testId = randomUUID(),
        hidden = randomUUID();
      await db.collection('hospital_diagnostic_masters').insertMany([
        {
          id: testId,
          tenant_id: c.tenant,
          domain: 'pathology',
          kind: 'test',
          name: 'Synthetic CBC',
          data: {
            patient_app_bookable: true,
            amount: 100,
            available_branch_ids: [c.branch],
            branch_prices: { [c.branch]: 175 },
          },
        },
        {
          id: hidden,
          tenant_id: c.tenant,
          domain: 'pathology',
          kind: 'test',
          name: 'Hidden test',
          data: { amount: 1 },
        },
      ]);
      const list = expectStatus(
        await call(
          `/lab-tests?clinic_id=${c.tenant}&branch_id=${c.branch}`,
          a.access_token
        ),
        200
      );
      assert.equal(list.total, 1);
      assert.equal(list.data[0].amount, 175);
      assert.equal(
        (
          await call(
            '/lab-bookings',
            a.access_token,
            'POST',
            {
              profile_id: a.account.self_profile_id,
              clinic_id: c.tenant,
              branch_id: c.branch,
              test_ids: [hidden],
            },
            randomUUID()
          )
        ).status,
        409
      );
      const order = expectStatus(
        await call(
          '/lab-bookings',
          a.access_token,
          'POST',
          {
            profile_id: a.account.self_profile_id,
            clinic_id: c.tenant,
            branch_id: c.branch,
            test_ids: [testId],
          },
          randomUUID()
        ),
        201
      );
      assert.equal(order.total, 175);
      assert.equal(
        (await call('/lab-orders/' + order.id, b.access_token)).status,
        404
      );
      const bill = randomUUID(),
        unapproved = randomUUID(),
        now = new Date();
      await db.collection('finance_records').insertOne({
        id: bill,
        tenant_id: c.tenant,
        branch_id: c.branch,
        patient_id: existingPatient,
        kind: 'invoices',
        record_number: 'INV-LAB-SYNTHETIC',
        total: 175,
        paid: 0,
        due: 175,
        status: 'Unpaid',
        record_date: today,
        created_at: now,
      });
      await db.collection('role_work_items').updateOne(
        { id: order.id },
        {
          $set: {
            'data.bill_id': bill,
            'data.collected_at': now.toISOString(),
            'data.result_status': 'Completed',
            'data.tests': [
              { test_id: testId, name: 'Synthetic CBC' },
              { test_id: unapproved, name: 'Unapproved Test' },
            ],
            'data.lab_results': [
              {
                test_id: testId,
                name: 'Synthetic CBC',
                parameters: [
                  {
                    name: 'Synthetic parameter',
                    result_type_id: '3',
                    value: '10',
                    unit: 'units',
                  },
                ],
              },
              {
                test_id: unapproved,
                name: 'Unapproved Test',
                parameters: [
                  {
                    name: 'Secret unreleased result',
                    result_type_id: '3',
                    value: 'DO_NOT_LEAK',
                  },
                ],
              },
            ],
            'data.doctor_approval': { test_ids: [testId], pathologist_ids: [] },
            updated_at: new Date(),
          },
        }
      );
      const release = expectStatus(
        await http(admin + '/releases', {
          method: 'POST',
          token: c.token,
          body: { kind: 'lab', source_id: order.id },
        }),
        201
      );
      assert.equal(
        (await call('/records/' + release.id + '/download', a.access_token))
          .status,
        402
      );
      assert.equal(
        expectStatus(await call('/lab-orders/' + order.id, a.access_token), 200)
          .results,
        undefined
      );
      await db
        .collection('finance_records')
        .updateOne(
          { id: bill },
          { $set: { paid: 175, due: 0, status: 'Paid' } }
        );
      const detail = expectStatus(
        await call('/lab-orders/' + order.id, a.access_token),
        200
      );
      assert.equal(detail.results.length, 1);
      assert.ok(!JSON.stringify(detail.results).includes('DO_NOT_LEAK'));
      assert.equal(
        expectStatus(
          await call('/records/' + release.id + '/download', a.access_token),
          200
        )
          .subarray(0, 5)
          .toString(),
        '%PDF-'
      );
    }
  );
  await t.test(
    'account settings, favorites, support and notification ownership work without providers',
    async () => {
      expectStatus(
        await call('/me/preferences', a.access_token, 'PATCH', {
          language: 'bn',
          push_enabled: false,
        }),
        200
      );
      expectStatus(
        await call('/favorites/clinic/' + c.tenant, a.access_token, 'PUT'),
        204
      );
      assert.equal(
        expectStatus(await call('/favorites', a.access_token), 200).total,
        1
      );
      const support = expectStatus(
        await call('/support-tickets', a.access_token, 'POST', {
          clinic_id: c.tenant,
          subject: 'Synthetic support',
          message: 'A test question',
        }),
        201
      );
      assert.equal(
        (await call('/support-tickets/' + support.id, b.access_token)).status,
        404
      );
      expectStatus(
        await http(admin + '/support-tickets/' + support.id, {
          method: 'PATCH',
          token: c.token,
          body: { status: 'Resolved', message: 'Synthetic response' },
        }),
        200
      );
      assert.equal(
        expectStatus(
          await call('/support-tickets/' + support.id, a.access_token),
          200
        ).messages.length,
        2
      );
      const inbox = expectStatus(
        await call('/notifications', a.access_token),
        200
      );
      assert.ok(inbox.total > 0);
      assert.equal(
        (
          await call(
            '/notifications/' + inbox.data[0].id,
            b.access_token,
            'PATCH',
            { read: true }
          )
        ).status,
        404
      );
      expectStatus(
        await call('/notifications/read-all', a.access_token, 'POST'),
        204
      );
      assert.equal(
        await db
          .collection('mobile_notifications')
          .countDocuments({ account_id: a.account.id, read: false }),
        0
      );
      expectStatus(await call('/home', a.access_token), 200);
      expectStatus(await call('/help', a.access_token), 200);
    }
  );

  await t.test(
    'partial updates preserve omitted profile and visit fields',
    async () => {
      const before = expectStatus(
        await call('/me', a.access_token),
        200
      ).profile;
      const saved = expectStatus(
        await call('/me', a.access_token, 'PATCH', {
          name: 'Synthetic Updated Patient',
        }),
        200
      );
      assert.equal(saved.date_of_birth, before.date_of_birth);
      assert.equal(saved.sex, before.sex);
      const h = expectStatus(
        await hold(a.access_token, a.account.self_profile_id, day(1), '13:30'),
        201
      );
      expectStatus(
        await call('/booking-holds/' + h.id, a.access_token, 'PATCH', {
          reason: 'Keep this visit reason',
          symptoms: ['Synthetic symptom'],
        }),
        200
      );
      const edited = expectStatus(
        await call('/booking-holds/' + h.id, a.access_token, 'PATCH', {
          upload_ids: [],
        }),
        200
      );
      assert.equal(edited.reason, 'Keep this visit reason');
      assert.deepEqual(edited.symptoms, ['Synthetic symptom']);
      expectStatus(
        await call('/booking-holds/' + h.id, a.access_token, 'DELETE'),
        204
      );
    }
  );
  await t.test(
    'unexpired price quotes retain the promised server amount if fees change',
    async () => {
      const h = expectStatus(
          await hold(
            a.access_token,
            a.account.self_profile_id,
            day(1),
            '13:30'
          ),
          201
        ),
        q = await quote(a.access_token, h.id);
      await db
        .collection('staff_members')
        .updateOne(
          { tenant_id: c.tenant, user_id: c.doctor },
          { $set: { 'professional.consultation_fee': 900 } }
        );
      try {
        const booking = expectStatus(
          await call(
            '/appointments',
            a.access_token,
            'POST',
            { quote_id: q.id, pay_at_clinic: true },
            randomUUID()
          ),
          201
        );
        assert.equal(booking.appointment.total, 720);
      } finally {
        await db
          .collection('staff_members')
          .updateOne(
            { tenant_id: c.tenant, user_id: c.doctor },
            { $set: { 'professional.consultation_fee': 700 } }
          );
      }
    }
  );
  await t.test(
    'payment sync recovers a lost callback and payment creation replays after confirmation',
    async () => {
      const fixture = await paidOrder(
          a.access_token,
          a.account.self_profile_id,
          '14:00'
        ),
        p = capture(fixture.order, 'pay_sync');
      const synced = expectStatus(
        await call(
          '/payments/' + fixture.order.id + '/sync',
          a.access_token,
          'POST'
        ),
        200
      );
      assert.equal(synced.status, 'Consumed');
      assert.ok(synced.appointment_id);
      const replayed = expectStatus(
        await call(
          '/payment-orders',
          a.access_token,
          'POST',
          { quote_id: fixture.quote.id },
          fixture.key
        ),
        200
      );
      assert.equal(replayed.id, fixture.order.id);
      assert.equal(replayed.status, 'Consumed');
      const payload = {
          event: 'refund.processed',
          payload: {
            refund: {
              entity: {
                id: 'rfnd_synthetic',
                payment_id: p.id,
                amount: 10000,
                currency: 'INR',
                status: 'processed',
              },
            },
          },
        },
        body = JSON.stringify(payload),
        signature = createHmac('sha256', webhookSecret)
          .update(body)
          .digest('hex');
      for (let i = 0; i < 2; i++)
        expectStatus(
          await http('/api/v1/webhooks/payments/razorpay/' + c.tenant, {
            method: 'POST',
            body,
            headers: {
              'Content-Type': 'application/json',
              'x-razorpay-signature': signature,
            },
          }),
          200
        );
      const status = expectStatus(
        await call('/payments/' + fixture.order.id, a.access_token),
        200
      );
      assert.equal(status.refund_amount_cents, 10000);
      assert.equal(status.requires_review, true);
      assert.equal(
        await db
          .collection('mobile_refund_events')
          .countDocuments({ provider_refund_id: 'rfnd_synthetic' }),
        1
      );
      assert.equal(
        await db.collection('finance_records').countDocuments({
          'data.appointment_id': synced.appointment_id,
          kind: 'payments',
        }),
        1
      );
      p.amount_refunded = 10000;
      const staleBody = JSON.stringify({
          event: 'payment.captured',
          payload: { payment: { entity: { ...p, amount_refunded: 0 } } },
        }),
        staleSignature = createHmac('sha256', webhookSecret)
          .update(staleBody)
          .digest('hex');
      const stale = expectStatus(
        await http('/api/v1/webhooks/payments/razorpay/' + c.tenant, {
          method: 'POST',
          body: staleBody,
          headers: {
            'Content-Type': 'application/json',
            'x-razorpay-signature': staleSignature,
          },
        }),
        200
      );
      assert.equal(stale.processed, false);
      assert.equal(stale.requires_clinic_reconciliation, true);
      assert.equal(
        (
          await db
            .collection('clinical_appointments')
            .findOne({ id: synced.appointment_id })
        ).payment_status,
        'Refund Review'
      );
    }
  );
  await t.test(
    'pending paid cancellations prevent rescheduling and check-in',
    async () => {
      const row = await makeBooking(
        a.access_token,
        a.account.self_profile_id,
        '14:30'
      );
      await db
        .collection('clinical_appointments')
        .updateOne(
          { id: row.id },
          { $set: { paid_amount: 720, payment_status: 'Paid' } }
        );
      expectStatus(
        await call(
          '/appointments/' + row.id + '/cancel',
          a.access_token,
          'POST',
          { reason: 'Pending review test' },
          randomUUID()
        ),
        200
      );
      const moved = await call(
        '/appointments/' + row.id + '/reschedule',
        a.access_token,
        'POST',
        {
          appointment_date: day(1),
          appointment_time: '15:00',
          updated_at: row.updated_at,
        },
        randomUUID()
      );
      assert.equal(moved.status, 409);
      assert.equal(moved.data.code, 'CANCELLATION_PENDING');
      const checked = await call(
        '/appointments/' + row.id + '/check-in',
        a.access_token,
        'POST',
        {}
      );
      assert.equal(checked.status, 409);
      assert.equal(checked.data.code, 'CANCELLATION_PENDING');
    }
  );
  await t.test(
    'SSE revalidates the session and closes after access-token rotation',
    async () => {
      const response = await realFetch(
          base + api + '/appointments/' + paidBooking.id + '/events',
          {
            headers: { Authorization: 'Bearer ' + a.access_token },
            signal: AbortSignal.timeout(10000),
          }
        ),
        reader = response.body.getReader();
      assert.equal(response.status, 200);
      await reader.read();
      a = {
        ...a,
        ...expectStatus(
          await call('/auth/refresh', null, 'POST', {
            refresh_token: a.refresh_token,
          }),
          200
        ),
      };
      const update = await reader.read();
      assert.match(Buffer.from(update.value).toString(), /event: unavailable/);
      await reader.cancel();
    }
  );
  await t.test(
    'doctor feedback is tied to owned completed visits and requires moderation',
    async () => {
      await db
        .collection('clinical_appointments')
        .updateOne(
          { id: paidBooking.id },
          { $set: { status: 'Completed', updated_at: new Date() } }
        );
      const review = expectStatus(
        await call(
          '/doctors/' + c.doctor + '/reviews',
          a.access_token,
          'POST',
          {
            appointment_id: paidBooking.id,
            rating: 5,
            comment: 'A synthetic review',
          }
        ),
        201
      );
      assert.equal(
        expectStatus(await call('/doctors/' + c.doctor + '/reviews'), 200)
          .total,
        0
      );
      expectStatus(
        await http(admin + '/reviews/' + review.id, {
          method: 'PATCH',
          token: c.token,
          body: { status: 'Published' },
        }),
        200
      );
      assert.equal(
        expectStatus(await call('/doctors/' + c.doctor + '/reviews'), 200)
          .total,
        1
      );
      assert.equal(
        expectStatus(await call('/doctors/' + c.doctor), 200).rating,
        5
      );
    }
  );
  await t.test(
    'notification jobs deduplicate events without contacting an unconfigured push provider',
    async () => {
      const { runPatientAppJobs } = await import('./patient-app/jobs.mjs');
      await runPatientAppJobs();
      const count = await db
        .collection('mobile_notifications')
        .countDocuments({ account_id: a.account.id });
      await runPatientAppJobs();
      assert.equal(
        await db
          .collection('mobile_notifications')
          .countDocuments({ account_id: a.account.id }),
        count
      );
      assert.equal(
        await db
          .collection('mobile_push_outbox')
          .countDocuments({ state: 'Sent' }),
        0
      );
    }
  );

  await t.test(
    'family unlink revokes subsequent access while retaining the clinic medical record',
    async () => {
      const row = await makeBooking(a.access_token, family.id, '13:00');
      expectStatus(
        await call('/family-members/' + family.id, a.access_token, 'DELETE'),
        204
      );
      assert.equal(
        (await call('/appointments/' + row.id, a.access_token)).status,
        404
      );
      assert.ok(
        await db
          .collection('patients')
          .findOne({ id: row.patient_id, tenant_id: c.tenant })
      );
    }
  );
  await t.test(
    'device registrations are private and logout revokes access and device delivery',
    async () => {
      const device = expectStatus(
        await call('/devices', b.access_token, 'POST', {
          token: 'synthetic-device-token-with-no-real-provider',
          platform: 'android',
        }),
        201
      );
      expectStatus(
        await call('/devices/' + device.id, a.access_token, 'DELETE'),
        204
      );
      assert.ok(
        await db.collection('mobile_devices').findOne({ id: device.id })
      );
      expectStatus(await call('/auth/logout', b.access_token, 'POST'), 204);
      assert.equal((await call('/me', b.access_token)).status, 401);
      assert.equal(
        await db
          .collection('mobile_devices')
          .countDocuments({ account_id: b.account.id }),
        0
      );
    }
  );
  await t.test(
    'deletion requests revoke all mobile access without deleting clinic records',
    async () => {
      const result = expectStatus(
        await call('/account-deletion-requests', a.access_token, 'POST', {
          reason: 'Synthetic deletion test',
        }),
        202
      );
      assert.equal(result.status, 'Deletion Requested');
      assert.equal((await call('/me', a.access_token)).status, 401);
      assert.equal(
        await db
          .collection('mobile_sessions')
          .countDocuments({ account_id: a.account.id }),
        0
      );
      assert.ok(
        await db.collection('patients').findOne({ id: existingPatient })
      );
    }
  );
});
