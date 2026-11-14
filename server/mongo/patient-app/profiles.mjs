import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, transaction } from '../database.mjs';
import { configuredPrefix } from '../settings.mjs';
import {
  accountProfile,
  audit,
  fail,
  linksFor,
  phone,
  profileFields,
  rateLimit,
  route,
  safeProfile,
  secretHash,
  text,
  uuid,
} from './common.mjs';

const address = z
  .object({
    line: z.string().max(300).prefault(''),
    city: z.string().max(100).prefault(''),
    state: z.string().max(100).prefault(''),
    pin: z
      .string()
      .regex(/^\d{6}$/)
      .or(z.literal(''))
      .prefault(''),
  })
  .strict();
export const profileInput = z
  .object({
    name: text(160).regex(
      /^[\p{L}][\p{L}\p{M} .'-]*$/u,
      'Enter a valid patient name.'
    ),
    date_of_birth: z
      .string()
      .date()
      .nullable()
      .refine(
        (v) => !v || new Date(v + 'T00:00:00Z') <= new Date(),
        'Date of birth cannot be in the future.'
      )
      .refine(
        (v) => !v || Date.now() - Date.parse(v) < 121 * 366 * 86400000,
        'Enter a valid date of birth.'
      )
      .prefault(null),
    sex: z.enum(['Male', 'Female', 'Other']).prefault('Other'),
    address: address.prefault({}),
    emergency_contact: z
      .object({
        name: z.string().max(160).prefault(''),
        phone: z.string().max(25).prefault(''),
      })
      .strict()
      .prefault({}),
    photo_upload_id: uuid.nullable().optional(),
  })
  .strict();
async function validatePhoto(account, profileId, id, session) {
  if (!id) return;
  const row = await db.collection('mobile_uploads').findOne(
    {
      id,
      account_id: account.id,
      profile_id: profileId,
      mime: { $in: ['image/jpeg', 'image/png', 'image/webp'] },
    },
    { session }
  );
  if (!row) throw fail('Select a photo uploaded for this patient.');
}

export async function clinicPatient(account, profile, tenant, branch, session) {
  await db
    .collection('mobile_profiles')
    .updateOne(
      { id: profile.id, account_id: account.id, active: true },
      { $inc: { link_version: 1 } },
      { session }
    );
  const linked = await db.collection('mobile_clinic_links').findOne(
    {
      account_id: account.id,
      profile_id: profile.id,
      tenant_id: tenant,
      active: true,
    },
    { session }
  );
  if (linked) {
    const patient = await db
      .collection('patients')
      .findOne(
        { tenant_id: tenant, id: linked.patient_id, deleted_at: null },
        { session }
      );
    if (!patient)
      throw fail(
        'Clinic patient record is unavailable. Contact reception.',
        409
      );
    return patient;
  }
  if (!profile.name || !profile.date_of_birth)
    throw fail(
      'Complete the patient name and date of birth before booking.',
      409,
      'PROFILE_INCOMPLETE'
    );
  // Never attach historical medical records by matching a shared phone number.
  const now = new Date(),
    counter = await db
      .collection('counters')
      .findOneAndUpdate(
        { _id: `${tenant}:patient` },
        { $inc: { value: 1 } },
        { session, upsert: true, returnDocument: 'after' }
      ),
    [first, ...rest] = profile.name.trim().split(/\s+/);
  const row = {
    id: randomUUID(),
    tenant_id: tenant,
    branch_id: branch,
    medical_record_number: `${await configuredPrefix(
      tenant,
      'uhid_prefix',
      'UHID',
      session
    )}-${String(counter.value).padStart(6, '0')}`,
    first_name: first,
    last_name: rest.join(' '),
    normalized_name: profile.name.toLowerCase().replace(/\s+/g, ' '),
    date_of_birth: profile.date_of_birth,
    sex: profile.sex,
    phone: account.phone.slice(-10),
    address: profile.address ?? {},
    emergency_contact: profile.emergency_contact ?? {},
    registration_fee: 0,
    maintenance_fee: 0,
    registration_addons: [],
    discount: 0,
    total_amount: 0,
    registration_payment_status: 'Unpaid',
    status: 'Active',
    source: 'Patient App',
    mobile_profile_id: profile.id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await db.collection('patients').insertOne({ ...row }, { session });
  const old = await db
    .collection('mobile_clinic_links')
    .findOne(
      { account_id: account.id, profile_id: profile.id, tenant_id: tenant },
      { session }
    );
  if (old)
    throw fail(
      'This patient already has a clinic link. Contact reception to restore it.',
      409
    );
  await db.collection('mobile_clinic_links').insertOne(
    {
      id: randomUUID(),
      account_id: account.id,
      profile_id: profile.id,
      tenant_id: tenant,
      patient_id: row.id,
      active: true,
      created_at: now,
      method: 'new_registration',
    },
    { session }
  );
  await audit(account, 'patient_app_registration', row.id, session, tenant);
  return row;
}

export function registerProfiles(router) {
  route(
    router,
    'get',
    '/me',
    'Get the current patient account and profile',
    async (_req, res) => {
      const a = res.locals.account;
      res.json({
        id: a.id,
        phone: a.phone,
        self_profile_id: a.self_profile_id,
        profile: safeProfile(await accountProfile(a)),
        preferences: a.preferences,
        created_at: a.created_at,
      });
    }
  );
  route(
    router,
    'patch',
    '/me',
    'Update the self patient profile',
    async (req, res) => {
      const a = res.locals.account;
      const saved = await transaction(async (session) => {
        const p = await accountProfile(a, null, session);
        await validatePhoto(a, p.id, req.input.photo_upload_id, session);
        const row = await db
          .collection('mobile_profiles')
          .findOneAndUpdate(
            { id: p.id, account_id: a.id, active: true },
            { $set: { ...req.input, updated_at: new Date() } },
            { session, returnDocument: 'after' }
          );
        await audit(a, 'patient_app_profile_updated', p.id, session);
        return safeProfile(row);
      });
      res.json(saved);
    },
    { body: profileInput.partial().strict() }
  );
  route(
    router,
    'get',
    '/family-members',
    'List active patient and family profiles',
    async (_req, res) => {
      const rows = await db
        .collection('mobile_profiles')
        .find(
          { account_id: res.locals.account.id, active: true },
          {
            projection: Object.fromEntries([
              ['_id', 0],
              ...profileFields.map((k) => [k, 1]),
            ]),
          }
        )
        .sort({ created_at: 1, id: 1 })
        .toArray();
      res.json({ data: rows });
    }
  );
  route(
    router,
    'post',
    '/family-members',
    'Add an authorized family profile',
    async (req, res) => {
      const a = res.locals.account;
      await rateLimit(`family:${a.id}`, 20, 86400);
      const result = await transaction(async (session) => {
        await db
          .collection('mobile_accounts')
          .updateOne(
            { id: a.id, status: 'Active' },
            { $inc: { profile_version: 1 } },
            { session }
          );
        if (
          (await db
            .collection('mobile_profiles')
            .countDocuments({ account_id: a.id, active: true }, { session })) >=
          20
        )
          throw fail('An account can manage at most 20 patient profiles.', 409);
        const now = new Date(),
          { consent, ...body } = req.input,
          row = {
            ...body,
            id: randomUUID(),
            account_id: a.id,
            active: true,
            consent_recorded_at: now,
            created_at: now,
            updated_at: now,
          };
        await db
          .collection('mobile_profiles')
          .insertOne({ ...row }, { session });
        await audit(a, 'patient_app_family_added', row.id, session);
        return safeProfile(row);
      });
      res.status(201).json(result);
    },
    {
      body: profileInput
        .omit({ photo_upload_id: true })
        .extend({
          relationship: z.enum([
            'Spouse',
            'Child',
            'Parent',
            'Sibling',
            'Other',
          ]),
          consent: z.literal(true),
        })
        .strict(),
    }
  );
  route(
    router,
    'patch',
    '/family-members/:id',
    'Edit an authorized family profile',
    async (req, res) => {
      const a = res.locals.account;
      res.json(
        await transaction(async (session) => {
          const p = await accountProfile(a, req.params.id, session);
          if (p.id === a.self_profile_id)
            throw fail('Use /me to update your own profile.');
          await validatePhoto(a, p.id, req.input.photo_upload_id, session);
          return safeProfile(
            await db
              .collection('mobile_profiles')
              .findOneAndUpdate(
                { id: p.id, account_id: a.id, active: true },
                { $set: { ...req.input, updated_at: new Date() } },
                { session, returnDocument: 'after' }
              )
          );
        })
      );
    },
    {
      body: profileInput
        .partial()
        .extend({
          relationship: z
            .enum(['Spouse', 'Child', 'Parent', 'Sibling', 'Other'])
            .optional(),
        })
        .strict(),
    }
  );
  route(
    router,
    'delete',
    '/family-members/:id',
    'Unlink a family profile without deleting clinic records',
    async (req, res) => {
      const a = res.locals.account;
      await transaction(async (session) => {
        const p = await accountProfile(a, req.params.id, session);
        if (p.id === a.self_profile_id)
          throw fail('Your own profile cannot be removed.');
        await db
          .collection('mobile_profiles')
          .updateOne(
            { id: p.id, account_id: a.id },
            { $set: { active: false, updated_at: new Date() } },
            { session }
          );
        await audit(a, 'patient_app_family_unlinked', p.id, session);
      });
      res.status(204).end();
    }
  );
  route(
    router,
    'get',
    '/clinic-links',
    'List reception-approved clinic record links',
    async (_req, res) => {
      const data = await linksFor(res.locals.account);
      res.json({
        data: data.map((row) =>
          Object.fromEntries(
            [
              'id',
              'profile_id',
              'tenant_id',
              'patient_id',
              'method',
              'created_at',
            ]
              .filter((key) => row[key] !== undefined)
              .map((key) => [key, row[key]])
          )
        ),
      });
    }
  );
  route(
    router,
    'post',
    '/clinic-links',
    'Redeem a reception-issued record-link code',
    async (req, res) => {
      const a = res.locals.account;
      await rateLimit(`link:${a.id}`, 10);
      res.status(201).json(
        await transaction(async (session) => {
          const p = await accountProfile(a, req.input.profile_id, session),
            code = await db.collection('mobile_link_codes').findOneAndUpdate(
              {
                hash: secretHash(req.input.code),
                phone: a.phone,
                used_at: null,
                expires_at: { $gt: new Date() },
              },
              { $set: { used_at: new Date(), account_id: a.id } },
              { session, returnDocument: 'after' }
            );
          if (!code) throw fail('Link code is invalid or expired.', 404);
          const patient = await db.collection('patients').findOne(
            {
              id: code.patient_id,
              tenant_id: code.tenant_id,
              deleted_at: null,
            },
            { session }
          );
          if (!patient) throw fail('Patient record is unavailable.', 404);
          if (
            patient.date_of_birth &&
            p.date_of_birth &&
            patient.date_of_birth !== p.date_of_birth
          )
            throw fail(
              'The selected profile date of birth does not match the clinic patient. Ask reception to verify the profile.',
              409,
              'PROFILE_IDENTITY_MISMATCH'
            );
          const prior = await db
            .collection('mobile_clinic_links')
            .findOne(
              { account_id: a.id, profile_id: p.id, tenant_id: code.tenant_id },
              { session }
            );
          if (prior && prior.patient_id !== patient.id)
            throw fail(
              'This profile is already linked to another clinic patient. Contact reception.',
              409
            );
          const row = {
            account_id: a.id,
            profile_id: p.id,
            tenant_id: code.tenant_id,
            patient_id: patient.id,
            active: true,
            method: 'reception_code',
            approved_by: code.created_by,
            updated_at: new Date(),
          };
          await db.collection('mobile_clinic_links').updateOne(
            { account_id: a.id, profile_id: p.id, tenant_id: code.tenant_id },
            {
              $set: row,
              $setOnInsert: { id: randomUUID(), created_at: new Date() },
            },
            { session, upsert: true }
          );
          await audit(
            a,
            'patient_app_clinic_linked',
            patient.id,
            session,
            code.tenant_id
          );
          return {
            profile_id: p.id,
            clinic_id: code.tenant_id,
            patient_id: patient.id,
            medical_record_number: patient.medical_record_number,
          };
        })
      );
    },
    {
      body: z
        .object({
          profile_id: uuid,
          code: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
        })
        .strict(),
    }
  );
}
export const newLinkCode = () => randomBytes(24).toString('base64url');
