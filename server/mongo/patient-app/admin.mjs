import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db, transaction } from '../database.mjs';
import { config } from '../config.mjs';
import {
  assertBranch,
  permissionsFor,
  scopeFor,
  writeAudit,
} from '../access.mjs';
import { requireModule } from '../subscription-access.mjs';
import { releaseRecord as authorizedLabRelease } from '../lab-reports.mjs';
import {
  clinicSettings,
  fail,
  page,
  phone,
  pick,
  revision,
  route,
  secretHash,
  text,
  uuid,
} from './common.mjs';
import { newLinkCode } from './profiles.mjs';
import { patientAppSettingsInput } from './settings-schema.mjs';

export const patientAppAdmin = Router(),
  base = '/api/v1/patient-app-admin';
patientAppAdmin.use((_req, res, next) =>
  res.locals.account.role === 'patient'
    ? res.status(403).json({ error: 'Clinic staff access is required.' })
    : next()
);
async function permission(res, code) {
  const granted = await permissionsFor(res.locals.account);
  if (!granted.includes('*') && !granted.includes(code))
    throw fail('Permission required: ' + code, 403);
}
route(
  patientAppAdmin,
  'get',
  '/settings',
  'Get patient app publishing and booking settings',
  async (_req, res) => {
    await permission(res, 'settings.view');
    res.json(await clinicSettings(res.locals.account.tenant_id));
  },
  { base }
);
route(
  patientAppAdmin,
  'patch',
  '/settings',
  'Publish clinic information and configure patient app policies',
  async (req, res) => {
    await permission(res, 'settings.manage');
    if (
      res.locals.claims.portal !== 'hospital_admin' ||
      res.locals.account.role !== 'hospital_admin'
    )
      throw fail('Clinic-wide publishing requires Clinic Admin.', 403);
    if (req.input.enabled === true)
      await requireModule(res.locals.account.tenant_id, 'patient_portal');
    await transaction(async (session) => {
      for (const [key, value] of Object.entries(req.input))
        await db.collection('hospital_settings').updateOne(
          {
            tenant_id: res.locals.account.tenant_id,
            section: 'PatientApp',
            key,
          },
          {
            $set: {
              value,
              updated_by: res.locals.account.id,
              updated_at: new Date(),
            },
          },
          { session, upsert: true }
        );
      await writeAudit(res, 'patient_app_settings_updated', null, session, {
        keys: Object.keys(req.input),
      });
    });
    res.json(await clinicSettings(res.locals.account.tenant_id));
  },
  { base, body: patientAppSettingsInput }
);
route(
  patientAppAdmin,
  'post',
  '/link-codes',
  'Issue a one-time phone-bound link to existing patient records',
  async (req, res) => {
    await permission(res, 'patient.update');
    await requireModule(res.locals.account.tenant_id, 'patient_portal');
    if (
      !['hospital_admin', 'branch_admin', 'receptionist'].includes(
        res.locals.account.role
      )
    )
      throw fail(
        'Reception or clinic administrator approval is required.',
        403
      );
    const code = newLinkCode(),
      expires_at = new Date(Date.now() + 10 * 60000);
    await transaction(async (session) => {
      const row = await db
        .collection('patients')
        .findOne(
          await scopeFor(
            res,
            { id: req.input.patient_id, deleted_at: null },
            session
          ),
          { session }
        );
      if (!row) throw fail('Patient not found in your branch access.', 404);
      await db.collection('mobile_link_codes').insertOne(
        {
          id: randomUUID(),
          hash: secretHash(code),
          phone: req.input.phone,
          patient_id: row.id,
          tenant_id: row.tenant_id,
          branch_id: row.branch_id,
          created_by: res.locals.account.id,
          consent_confirmed: true,
          used_at: null,
          created_at: new Date(),
          expires_at,
        },
        { session }
      );
      await writeAudit(res, 'patient_app_link_code_issued', row.id, session);
    });
    res.status(201).json({ code, expires_at, phone: req.input.phone });
  },
  {
    base,
    body: z
      .object({ patient_id: uuid, phone, consent_confirmed: z.literal(true) })
      .strict(),
  }
);
route(
  patientAppAdmin,
  'post',
  '/check-in-codes',
  'Generate a short-lived clinic arrival QR payload',
  async (req, res) => {
    await permission(res, 'appointment.update');
    await requireModule(res.locals.account.tenant_id, 'patient_portal');
    await assertBranch(res, req.input.branch_id);
    const token = jwt.sign(
      {
        tenant_id: res.locals.account.tenant_id,
        branch_id: req.input.branch_id,
      },
      config.JWT_SECRET,
      {
        issuer: 'careframe-api',
        audience: 'patient-clinic-check-in',
        algorithm: 'HS256',
        expiresIn: 300,
      }
    );
    res.json({ qr_payload: token, expires_in: 300 });
  },
  { base, body: z.object({ branch_id: uuid }).strict() }
);
route(
  patientAppAdmin,
  'post',
  '/validate-pass',
  'Validate an appointment QR within staff branch access',
  async (req, res) => {
    await permission(res, 'appointment.view');
    let claims;
    try {
      claims = jwt.verify(req.input.qr_payload, config.JWT_SECRET, {
        issuer: 'careframe-api',
        audience: 'patient-appointment-pass',
        algorithms: ['HS256'],
      });
    } catch {
      throw fail('Appointment pass is invalid or expired.');
    }
    if (claims.tenant_id !== res.locals.account.tenant_id)
      throw fail('Appointment pass not found.', 404);
    const row = await db
      .collection('clinical_appointments')
      .findOne(await scopeFor(res, { id: claims.appointment_id }));
    if (!row) throw fail('Appointment not found in your branch access.', 404);
    res.json(
      pick(row, [
        'id',
        'patient_id',
        'appointment_number',
        'appointment_date',
        'appointment_time',
        'token_number',
        'status',
        'payment_status',
      ])
    );
  },
  { base, body: z.object({ qr_payload: z.string().max(5000) }).strict() }
);

async function sourceFor(res, kind, id, session) {
  if (kind === 'lab') return (await authorizedLabRelease(res, id, session)).row;
  await permission(res, 'opd.create');
  await requireModule(res.locals.account.tenant_id, 'opd');
  const row = await db
    .collection('doctor_clinical_records')
    .findOne(
      await scopeFor(res, { id, record_type: 'consultation' }, session),
      { session }
    );
  if (!row) throw fail('Consultation not found.', 404);
  if (
    res.locals.account.role === 'doctor' &&
    row.doctor_id !== res.locals.account.id
  )
    throw fail('Release only your own consultations.', 403);
  if (row.data?.encounter_status !== 'Completed')
    throw fail('Complete the consultation before releasing it.', 409);
  return row;
}
route(
  patientAppAdmin,
  'post',
  '/releases',
  'Release a completed consultation or approved laboratory report to linked patients',
  async (req, res) => {
    await requireModule(res.locals.account.tenant_id, 'patient_portal');
    const result = await transaction(async (session) => {
      const row = await sourceFor(
        res,
        req.input.kind,
        req.input.source_id,
        session
      );
      if (!row.updated_at)
        throw fail('Record must be saved before release.', 409);
      const settings = await clinicSettings(row.tenant_id, session),
        saved = await db.collection('mobile_record_releases').findOneAndUpdate(
          {
            tenant_id: row.tenant_id,
            kind: req.input.kind,
            source_id: row.id,
          },
          {
            $set: {
              active: true,
              patient_id: row.patient_id,
              branch_id: row.branch_id,
              title:
                req.input.title ??
                (req.input.kind === 'lab'
                  ? 'Laboratory Report'
                  : 'Consultation / Prescription'),
              record_date: new Date(row.created_at).toISOString().slice(0, 10),
              source_revision: revision(row),
              source_updated_at: row.updated_at,
              require_payment:
                req.input.kind === 'lab' &&
                settings.lab_reports_require_payment !== false,
              released_by: res.locals.account.id,
              updated_at: new Date(),
            },
            $setOnInsert: { id: randomUUID(), created_at: new Date() },
          },
          { session, upsert: true, returnDocument: 'after' }
        );
      await writeAudit(res, 'patient_app_record_released', row.id, session, {
        kind: req.input.kind,
      });
      return pick(saved, [
        'id',
        'source_id',
        'kind',
        'active',
        'record_date',
        'updated_at',
      ]);
    });
    res.status(201).json(result);
  },
  {
    base,
    body: z
      .object({
        kind: z.enum(['consultation', 'lab']),
        source_id: uuid,
        title: text(200).optional(),
      })
      .strict(),
  }
);
route(
  patientAppAdmin,
  'delete',
  '/releases/:kind/:id',
  'Revoke a patient app document release',
  async (req, res) => {
    const kind = z.enum(['consultation', 'lab']).parse(req.params.kind);
    await transaction(async (session) => {
      const row = await sourceFor(
        res,
        kind,
        uuid.parse(req.params.id),
        session
      );
      await db
        .collection('mobile_record_releases')
        .updateOne(
          { tenant_id: row.tenant_id, kind, source_id: row.id },
          { $set: { active: false, updated_at: new Date() } },
          { session }
        );
      await writeAudit(
        res,
        'patient_app_record_release_revoked',
        row.id,
        session
      );
    });
    res.status(204).end();
  },
  { base }
);
route(
  patientAppAdmin,
  'get',
  '/uploads/:id/download',
  'Download a patient-consented appointment attachment within staff scope',
  async (req, res) => {
    await permission(res, 'patient.view');
    const row = await db.collection('mobile_uploads').findOne({
      id: uuid.parse(req.params.id),
      clinic_shares: {
        $elemMatch: { tenant_id: res.locals.account.tenant_id },
      },
    });
    if (!row) throw fail('Shared file not found.', 404);
    let allowed = false;
    for (const share of row.clinic_shares.filter(
      (s) => s.tenant_id === res.locals.account.tenant_id
    )) {
      try {
        await assertBranch(res, share.branch_id);
        if (
          res.locals.account.role === 'doctor' &&
          !(await db.collection('clinical_appointments').findOne({
            id: share.appointment_id,
            tenant_id: share.tenant_id,
            doctor_id: res.locals.account.id,
          }))
        )
          continue;
        allowed = true;
        break;
      } catch (error) {
        if (error.status !== 403) throw error;
      }
    }
    if (!allowed) throw fail('Shared file not found in your assignments.', 404);
    res.set({
      'Content-Type': row.mime,
      'Content-Disposition': `attachment; filename="${row.filename}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(
      Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes.buffer)
    );
  },
  { base }
);
route(
  patientAppAdmin,
  'get',
  '/reviews',
  'List clinic feedback awaiting moderation',
  async (req, res) => {
    await permission(res, 'settings.manage');
    res.json(
      await page(
        'mobile_reviews',
        await scopeFor(res, {
          status: z
            .enum(['Pending', 'Published', 'Rejected'])
            .prefault('Pending')
            .parse(req.query.status),
        }),
        req.query,
        {
          _id: 0,
          id: 1,
          doctor_id: 1,
          appointment_id: 1,
          rating: 1,
          comment: 1,
          status: 1,
          created_at: 1,
        }
      )
    );
  },
  { base }
);
route(
  patientAppAdmin,
  'patch',
  '/reviews/:id',
  'Publish or reject clinic patient feedback',
  async (req, res) => {
    await permission(res, 'settings.manage');
    const row = await db.collection('mobile_reviews').findOneAndUpdate(
      await scopeFor(res, { id: uuid.parse(req.params.id) }),
      {
        $set: {
          status: req.input.status,
          moderated_by: res.locals.account.id,
          updated_at: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
    if (!row) throw fail('Review not found.', 404);
    res.json(pick(row, ['id', 'status']));
  },
  {
    base,
    body: z.object({ status: z.enum(['Published', 'Rejected']) }).strict(),
  }
);
route(
  patientAppAdmin,
  'get',
  '/support-tickets',
  'List support requests addressed to this clinic',
  async (req, res) => {
    await permission(res, 'settings.manage');
    if (res.locals.account.role !== 'hospital_admin')
      throw fail('Clinic-wide support requires Clinic Admin.', 403);
    res.json(
      await page(
        'mobile_support_tickets',
        { tenant_id: res.locals.account.tenant_id },
        req.query,
        { _id: 0, account_id: 0 }
      )
    );
  },
  { base }
);
route(
  patientAppAdmin,
  'patch',
  '/support-tickets/:id',
  'Reply to a clinic support request',
  async (req, res) => {
    await permission(res, 'settings.manage');
    if (res.locals.account.role !== 'hospital_admin')
      throw fail('Clinic-wide support requires Clinic Admin.', 403);
    const row = await db.collection('mobile_support_tickets').findOneAndUpdate(
      {
        id: uuid.parse(req.params.id),
        tenant_id: res.locals.account.tenant_id,
      },
      {
        $set: { status: req.input.status, updated_at: new Date() },
        $push: {
          messages: {
            by: 'clinic',
            message: req.input.message,
            created_at: new Date(),
          },
        },
      },
      { returnDocument: 'after' }
    );
    if (!row) throw fail('Support request not found.', 404);
    res.json(pick(row, ['id', 'subject', 'messages', 'status', 'updated_at']));
  },
  {
    base,
    body: z
      .object({
        status: z.enum(['Open', 'In Progress', 'Resolved']),
        message: text(4000),
      })
      .strict(),
  }
);
