import {
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import { db } from '../database.mjs';
import { config } from '../config.mjs';
import { subscriptionAccess, requireModule } from '../subscription-access.mjs';
import { doctorFor } from '../clinical.mjs';

export const uuid = z.string().uuid(),
  date = z.string().date(),
  time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const text = (max = 200) => z.string().trim().min(1).max(max);
export const fail = (message, status = 400, code) =>
  Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
export const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export const secretHash = (value) =>
  createHmac('sha256', config.JWT_SECRET)
    .update('patient-app:' + value)
    .digest('hex');
export function equalSecret(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function phoneNumber(value) {
  const v = String(value).replace(/[\s()-]/g, '');
  const n = v.replace(/^\+?91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(n))
    throw fail('Enter a valid Indian mobile number.');
  return '+91' + n;
}
export const phone = z.string().max(25).transform(phoneNumber);
export const pageInput = z.object({
  page: z.coerce.number().int().min(1).max(10000).prefault(1),
  page_size: z.coerce.number().int().min(1).max(100).prefault(20),
});
export async function page(
  collection,
  filter,
  query = {},
  projection = { _id: 0 },
  sort = { created_at: -1, id: -1 }
) {
  const { page: current, page_size } = pageInput.parse(query),
    [data, total] = await Promise.all([
      db
        .collection(collection)
        .find(filter, { projection })
        .sort(sort)
        .skip((current - 1) * page_size)
        .limit(page_size)
        .toArray(),
      db.collection(collection).countDocuments(filter),
    ]);
  return { data, total, page: current, page_size };
}
export const pick = (row, keys) =>
  Object.fromEntries(
    keys.filter((key) => row?.[key] !== undefined).map((key) => [key, row[key]])
  );
export const profileFields = [
  'id',
  'name',
  'date_of_birth',
  'sex',
  'address',
  'emergency_contact',
  'relationship',
  'photo_upload_id',
  'created_at',
  'updated_at',
];
export const safeProfile = (row) => pick(row, profileFields);
export function revision(row) {
  return digest({
    data: row.data,
    updated_at: row.updated_at,
    status: row.status,
  });
}
export async function accountProfile(account, id, session) {
  const row = await db.collection('mobile_profiles').findOne(
    {
      account_id: account.id,
      id: uuid.parse(id ?? account.self_profile_id),
      active: true,
    },
    { session }
  );
  if (!row) throw fail('Patient profile not found.', 404);
  return row;
}
export async function linksFor(account, profileId, session) {
  if (profileId) await accountProfile(account, profileId, session);
  const profiles = await db
    .collection('mobile_profiles')
    .find(
      {
        account_id: account.id,
        active: true,
        ...(profileId ? { id: profileId } : {}),
      },
      { session, projection: { id: 1 } }
    )
    .toArray();
  return db
    .collection('mobile_clinic_links')
    .find(
      {
        account_id: account.id,
        profile_id: { $in: profiles.map((p) => p.id) },
        active: true,
      },
      { session }
    )
    .toArray();
}
export function linkFilter(links) {
  return links.length
    ? {
        $or: links.map((row) => ({
          tenant_id: row.tenant_id,
          patient_id: row.patient_id,
        })),
      }
    : { id: { $in: [] } };
}
export async function ownRow(account, collection, id, extra = {}, session) {
  const row = await db.collection(collection).findOne(
    {
      $and: [
        { id: uuid.parse(id) },
        linkFilter(await linksFor(account, null, session)),
        extra,
      ],
    },
    { session }
  );
  if (!row) throw fail('Record not found.', 404);
  return row;
}
export async function clinicSettings(tenant, session) {
  const rows = await db
    .collection('hospital_settings')
    .find({ tenant_id: tenant, section: 'PatientApp' }, { session })
    .toArray();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}
export async function clinicAccess(
  tenant,
  { session, module = 'patient_portal', published = true } = {}
) {
  const hospital = await db.collection('hospitals').findOne(
    {
      id: uuid.parse(tenant),
      deleted_at: null,
      status: { $in: ['active', 'trial'] },
    },
    { session }
  );
  const settings = await clinicSettings(tenant, session);
  if (!hospital || (published && settings.enabled !== true))
    throw fail('Clinic is not available in the patient app.', 404);
  await subscriptionAccess(tenant, { session, revoke: !session });
  await requireModule(tenant, 'patient_portal');
  if (module !== 'patient_portal') await requireModule(tenant, module);
  return { hospital, settings };
}
export async function publicClinic(tenant) {
  const hospital = await db.collection('hospitals').findOne({
      id: uuid.parse(tenant),
      deleted_at: null,
      status: { $in: ['active', 'trial'] },
    }),
    settings = await clinicSettings(tenant);
  if (!hospital || settings.enabled !== true)
    throw fail('Clinic not found.', 404);
  return { hospital, settings };
}
export async function selectedDoctor(tenant, branchId, doctorId, session) {
  await clinicAccess(tenant, { session, module: 'opd' });
  const staff = await db.collection('staff_members').findOne(
    {
      tenant_id: tenant,
      user_id: uuid.parse(doctorId),
      staff_type: 'Doctor',
      status: 'Active',
    },
    { session }
  );
  if (!staff) throw fail('Doctor not found.', 404);
  const branch = uuid.parse(branchId),
    department =
      staff.professional?.branch_fees?.[branch]?.department_id ??
      staff.department_id;
  if (!department || !(staff.branch_ids ?? [staff.branch_id]).includes(branch))
    throw fail('Doctor is not assigned to this branch.', 404);
  // This context grants only this validated branch; patient tokens never enter staff middleware.
  return doctorFor(
    {
      locals: {
        account: {
          id: null,
          tenant_id: tenant,
          branch_id: branch,
          role_codes: [],
        },
        claims: { portal: 'patient_app' },
      },
    },
    branch,
    department,
    doctorId,
    session
  );
}
export async function lockDoctor(tenant, doctor, day, session) {
  await db
    .collection('workflow_locks')
    .updateOne(
      { _id: `${tenant}:doctor:${doctor}:${day}` },
      { $inc: { version: 1 } },
      { session, upsert: true }
    );
}
export async function audit(account, action, record, session, tenant = null) {
  await db.collection('audit_events').insertOne(
    {
      id: randomUUID(),
      tenant_id: tenant,
      actor_id: account.id,
      actor_type: 'patient_app',
      action,
      record_id: record,
      created_at: new Date(),
    },
    { session }
  );
}
export function requestKey(request) {
  return uuid.parse(request.header('Idempotency-Key'));
}
export async function replay(account, operation, key, payload, session) {
  const row = await db
    .collection('mobile_requests')
    .findOne({ account_id: account.id, operation, key }, { session });
  if (row && row.hash !== digest(payload))
    throw fail('Idempotency key was used with different values.', 409);
  return row?.result;
}
export async function remember(
  account,
  operation,
  key,
  payload,
  result,
  session
) {
  await db.collection('mobile_requests').insertOne(
    {
      account_id: account.id,
      operation,
      key,
      hash: digest(payload),
      result,
      created_at: new Date(),
    },
    { session }
  );
  return result;
}
export async function rateLimit(key, maximum, seconds = 900) {
  const now = Date.now(),
    window = Math.floor(now / (seconds * 1000)),
    id = digest(`${key}:${window}`),
    row = await db.collection('mobile_limits').findOneAndUpdate(
      { _id: id },
      {
        $inc: { count: 1 },
        $setOnInsert: { expires_at: new Date((window + 1) * seconds * 1000) },
      },
      { upsert: true, returnDocument: 'after' }
    );
  if (row.count > maximum)
    throw fail(
      'Too many requests. Please try again later.',
      429,
      'RATE_LIMITED'
    );
}

export const operations = [];
export function route(
  router,
  method,
  path,
  summary,
  handler,
  {
    body,
    public: publicRoute = false,
    base = '/api/v1/patient-app',
    idempotent = false,
  } = {}
) {
  operations.push({
    method,
    path: base + path,
    summary,
    body,
    public: publicRoute,
    idempotent,
  });
  router[method](path, async (request, response, next) => {
    try {
      request.input = body ? body.parse(request.body ?? {}) : undefined;
      if (method === 'patch' && body)
        request.input = Object.fromEntries(
          Object.keys(request.body ?? {}).map((key) => [
            key,
            request.input[key],
          ])
        );
      await handler(request, response, next);
    } catch (error) {
      next(error);
    }
  });
}
