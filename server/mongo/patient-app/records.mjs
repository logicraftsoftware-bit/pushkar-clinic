import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, transaction } from '../database.mjs';
import { resultRecord } from '../lab-result-record.mjs';
import { reportableLabTests } from '../lab-result-completion.mjs';
import { savedPrintableKeys } from '../lab-report-print-model.mjs';
import { canonicalReportPdf } from '../report-pdf.mjs';
import {
  laboratoryPrice,
  laboratoryTestAvailable,
} from '../lab-branch-pricing.mjs';
import {
  accountProfile,
  audit,
  clinicAccess,
  date,
  fail,
  linkFilter,
  linksFor,
  ownRow,
  page,
  pageInput,
  pick,
  remember,
  replay,
  requestKey,
  revision,
  route,
  text,
  uuid,
} from './common.mjs';
import { clinicPatient } from './profiles.mjs';
import { sendPdf, simplePdf } from './documents.mjs';
import { cents } from '../money.mjs';

export function reportReady(row) {
  return Boolean(
    row?.data?.collected_at &&
      ['Completed', 'Partially Completed'].includes(row.data.result_status) &&
      savedPrintableKeys(row.data).length &&
      !['Cancelled', 'Rejected', 'Refunded'].includes(row.status) &&
      !row.data.cancellation_request_id
  );
}
export function sourceCollection(kind) {
  return kind === 'consultation'
    ? 'doctor_clinical_records'
    : 'role_work_items';
}
export async function released(account, id, { source = false, kind } = {}) {
  const filter = {
      $and: [
        linkFilter(await linksFor(account)),
        {
          active: true,
          ...(source
            ? { source_id: uuid.parse(id), kind }
            : { id: uuid.parse(id) }),
        },
      ],
    },
    release = await db.collection('mobile_record_releases').findOne(filter);
  if (!release) throw fail('Record has not been released to the patient.', 404);
  const row = await ownRow(
    account,
    sourceCollection(release.kind),
    release.source_id
  );
  if (
    revision(row) !== release.source_revision ||
    (release.kind === 'consultation'
      ? row.data?.encounter_status !== 'Completed'
      : !reportReady(row))
  )
    throw fail(
      'The clinic is reviewing an updated version of this record.',
      404,
      'RELEASE_OUTDATED'
    );
  if (release.kind === 'lab' && release.require_payment) {
    const bill = row.data.bill_id
      ? await db.collection('finance_records').findOne({
          id: row.data.bill_id,
          tenant_id: row.tenant_id,
          patient_id: row.patient_id,
        })
      : null;
    if (!bill || bill.status !== 'Paid' || cents(bill.paid) < cents(bill.total))
      throw fail(
        'Complete the laboratory bill before downloading the report.',
        402
      );
  }
  return { release, row };
}
const clinicalData = (row) =>
  pick(row.data, [
    'chief_complaint',
    'complaints',
    'symptoms',
    'vitals',
    'diagnosis',
    'medicines',
    'advice',
    'instructions',
    'follow_up',
    'follow_up_date',
    'lab_tests',
    'radiology_tests',
    'investigation',
    'encounter_status',
  ]);
export async function recordFeed(account, query = {}) {
  const profiles = await db
      .collection('mobile_profiles')
      .find(
        {
          account_id: account.id,
          active: true,
          ...(query.patient_id
            ? { id: (await accountProfile(account, query.patient_id)).id }
            : {}),
        },
        { projection: { id: 1 } }
      )
      .toArray(),
    ids = profiles.map((p) => p.id),
    links = await linksFor(account, query.patient_id),
    filter = linkFilter(links),
    { page: current, page_size } = pageInput.parse(query),
    type = z
      .enum(['all', 'prescription', 'report', 'uploaded', 'visit'])
      .prefault('all')
      .parse(query.type);
  const match = {
    $and: [
      filter,
      { active: true },
      ...(type === 'prescription' || type === 'visit'
        ? [{ kind: 'consultation' }]
        : type === 'report'
        ? [{ kind: 'lab' }]
        : type === 'uploaded'
        ? [{ id: { $in: [] } }]
        : []),
    ],
  };
  const pipeline = [{ $match: match }];
  for (const [kind, collection, alias] of [
    ['consultation', 'doctor_clinical_records', 'consultation'],
    ['lab', 'role_work_items', 'lab'],
  ])
    pipeline.push({
      $lookup: {
        from: collection,
        let: {
          source: '$source_id',
          tenant: '$tenant_id',
          patient: '$patient_id',
          kind: '$kind',
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$$kind', kind] },
                  { $eq: ['$id', '$$source'] },
                  { $eq: ['$tenant_id', '$$tenant'] },
                  { $eq: ['$patient_id', '$$patient'] },
                ],
              },
            },
          },
          {
            $project: {
              _id: 0,
              updated_at: 1,
              'data.encounter_status': 1,
              status: 1,
            },
          },
        ],
        as: alias,
      },
    });
  pipeline.push(
    {
      $set: {
        source: {
          $arrayElemAt: [{ $concatArrays: ['$consultation', '$lab'] }, 0],
        },
      },
    },
    {
      $match: { $expr: { $eq: ['$source.updated_at', '$source_updated_at'] } },
    },
    {
      $match: {
        $or: [
          { kind: 'consultation', 'source.data.encounter_status': 'Completed' },
          {
            kind: 'lab',
            'source.status': { $nin: ['Cancelled', 'Rejected', 'Refunded'] },
          },
        ],
      },
    },
    {
      $project: {
        _id: 0,
        id: 1,
        source_id: 1,
        kind: 1,
        title: 1,
        record_date: 1,
        created_at: 1,
        clinic_id: '$tenant_id',
      },
    }
  );
  if (['all', 'uploaded'].includes(type))
    pipeline.push({
      $unionWith: {
        coll: 'mobile_records',
        pipeline: [
          { $match: { account_id: account.id, profile_id: { $in: ids } } },
          {
            $project: {
              _id: 0,
              id: 1,
              kind: 1,
              title: 1,
              record_date: 1,
              created_at: 1,
              profile_id: 1,
            },
          },
        ],
      },
    });
  if (query.from || query.to)
    pipeline.push({
      $match: {
        record_date: {
          ...(query.from ? { $gte: date.parse(query.from) } : {}),
          ...(query.to ? { $lte: date.parse(query.to) } : {}),
        },
      },
    });
  pipeline.push(
    { $sort: { record_date: -1, id: -1 } },
    {
      $facet: {
        data: [{ $skip: (current - 1) * page_size }, { $limit: page_size }],
        total: [{ $count: 'count' }],
      },
    }
  );
  const result = await db
    .collection('mobile_record_releases')
    .aggregate(pipeline)
    .next();
  return {
    data: (result?.data ?? []).map((r) => ({
      ...r,
      download_path: `/api/v1/patient-app/records/${r.id}/download`,
    })),
    total: result?.total?.[0]?.count ?? 0,
    page: current,
    page_size,
  };
}
function uploadBytes(body) {
  const bytes = Buffer.from(body.content_base64, 'base64');
  if (
    !bytes.length ||
    bytes.length > 3 * 1024 * 1024 ||
    bytes.toString('base64') !== body.content_base64
  )
    throw fail('Upload a valid base64 file no larger than 3 MB.');
  const mime = body.mime;
  const valid =
    mime === 'application/pdf'
      ? bytes.subarray(0, 5).toString() === '%PDF-'
      : mime === 'image/png'
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === 'image/jpeg'
      ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : bytes.subarray(0, 4).toString() === 'RIFF' &&
        bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw fail('File contents do not match the declared file type.');
  return bytes;
}
async function downloadUpload(account, id, res) {
  const row = await db
    .collection('mobile_uploads')
    .findOne({ id: uuid.parse(id), account_id: account.id });
  if (!row) throw fail('File not found.', 404);
  await accountProfile(account, row.profile_id);
  res.set({
    'Content-Type': row.mime,
    'Content-Disposition': `attachment; filename="${row.filename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  res.send(
    Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes.buffer)
  );
}
export function registerRecords(router) {
  route(
    router,
    'post',
    '/uploads',
    'Upload a private patient file (PDF, JPEG, PNG, WebP; maximum 3 MB)',
    async (req, res) => {
      const a = res.locals.account,
        bytes = uploadBytes(req.input),
        row = await transaction(async (session) => {
          const p = await accountProfile(a, req.input.profile_id, session);
          await db
            .collection('mobile_accounts')
            .updateOne(
              { id: a.id },
              { $inc: { upload_version: 1 } },
              { session }
            );
          const total = await db
            .collection('mobile_uploads')
            .aggregate(
              [
                { $match: { account_id: a.id } },
                { $group: { _id: null, bytes: { $sum: '$size' } } },
              ],
              { session }
            )
            .next();
          if ((total?.bytes ?? 0) + bytes.length > 50 * 1024 * 1024)
            throw fail('This account has reached its 50 MB upload limit.', 409);
          const r = {
            id: randomUUID(),
            account_id: a.id,
            profile_id: p.id,
            filename: req.input.filename.replace(/[^A-Za-z0-9_.-]/g, '_'),
            mime: req.input.mime,
            bytes,
            size: bytes.length,
            share_with_clinic: req.input.share_with_clinic,
            clinic_shares: [],
            created_at: new Date(),
          };
          await db
            .collection('mobile_uploads')
            .insertOne({ ...r }, { session });
          return r;
        });
      res.status(201).json({
        ...pick(row, [
          'id',
          'filename',
          'mime',
          'size',
          'profile_id',
          'share_with_clinic',
          'created_at',
        ]),
        download_path: `/api/v1/patient-app/uploads/${row.id}/download`,
      });
    },
    {
      body: z
        .object({
          profile_id: uuid,
          filename: text(120),
          mime: z.enum([
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
          ]),
          content_base64: z.string().min(4).max(4194304),
          share_with_clinic: z.boolean().prefault(false),
        })
        .strict(),
    }
  );
  route(
    router,
    'get',
    '/uploads/:id/download',
    'Download an account-owned private upload',
    async (req, res) => downloadUpload(res.locals.account, req.params.id, res)
  );
  route(
    router,
    'post',
    '/records',
    'Add an uploaded document to personal medical records',
    async (req, res) => {
      const a = res.locals.account,
        key = requestKey(req),
        input = req.input;
      res.status(201).json(
        await transaction(async (session) => {
          const old = await replay(a, 'record', key, input, session);
          if (old) return old;
          const p = await accountProfile(a, input.profile_id, session),
            upload = await db
              .collection('mobile_uploads')
              .findOne(
                { id: input.upload_id, account_id: a.id, profile_id: p.id },
                { session }
              );
          if (!upload) throw fail('Upload not found for this patient.', 404);
          const row = {
            id: randomUUID(),
            account_id: a.id,
            profile_id: p.id,
            upload_id: upload.id,
            title: input.title,
            record_date: input.record_date,
            kind: 'uploaded',
            created_at: new Date(),
          };
          await db
            .collection('mobile_records')
            .insertOne({ ...row }, { session });
          return remember(
            a,
            'record',
            key,
            input,
            pick(row, ['id', 'title', 'record_date', 'kind', 'created_at']),
            session
          );
        })
      );
    },
    {
      idempotent: true,
      body: z
        .object({
          profile_id: uuid,
          upload_id: uuid,
          title: text(200),
          record_date: date,
        })
        .strict(),
    }
  );
  route(
    router,
    'get',
    '/records',
    'List personal uploads and current clinic-released records',
    async (req, res) =>
      res.json(await recordFeed(res.locals.account, req.query))
  );
  route(
    router,
    'get',
    '/records/:id/download',
    'Download an authorized current record or laboratory report',
    async (req, res) => {
      const a = res.locals.account,
        personal = await db
          .collection('mobile_records')
          .findOne({ id: uuid.parse(req.params.id), account_id: a.id });
      if (personal) {
        await accountProfile(a, personal.profile_id);
        return downloadUpload(a, personal.upload_id, res);
      }
      const { row, release } = await released(a, req.params.id);
      await audit(
        a,
        'patient_app_record_downloaded',
        row.id,
        undefined,
        row.tenant_id
      );
      if (release.kind === 'lab')
        return sendPdf(
          res,
          'Laboratory-Report.pdf',
          await canonicalReportPdf(await resultRecord(row))
        );
      const data = clinicalData(row);
      sendPdf(
        res,
        'Prescription.pdf',
        await simplePdf('Consultation / Prescription', [
          `Visit: ${row.created_at.toISOString().slice(0, 10)}`,
          `Diagnosis: ${data.diagnosis ?? ''}`,
          ...(data.medicines ?? []).map(
            (m) =>
              `${m.name} ${m.dose ?? m.dosage ?? ''} ${m.frequency ?? ''} ${
                m.duration ?? ''
              }`
          ),
          `Advice: ${data.advice ?? data.instructions ?? ''}`,
          `Follow-up: ${data.follow_up_date ?? data.follow_up ?? ''}`,
        ])
      );
    }
  );
  const consultation = async (req, res) => {
    const { row, release } = await released(res.locals.account, req.params.id, {
        source: true,
        kind: 'consultation',
      }),
      doctor = await db
        .collection('users')
        .findOne({ id: row.doctor_id, tenant_id: row.tenant_id });
    res.json({
      id: row.id,
      clinic_id: row.tenant_id,
      patient_id: row.patient_id,
      appointment_id: row.appointment_id,
      date: row.created_at,
      doctor_name: doctor
        ? `${doctor.first_name} ${doctor.last_name}`.trim()
        : '',
      data: clinicalData(row),
      record_id: release.id,
      download_path: `/api/v1/patient-app/records/${release.id}/download`,
    });
  };
  route(
    router,
    'get',
    '/visits/:id',
    'View a current clinic-released consultation summary',
    consultation
  );
  route(
    router,
    'get',
    '/prescriptions/:id',
    'View a current clinic-released prescription',
    consultation
  );
  route(
    router,
    'get',
    '/lab-tests',
    'List patient-bookable tests and branch prices',
    async (req, res) => {
      const input = z
        .object({
          clinic_id: uuid,
          branch_id: uuid,
          q: z.string().max(100).prefault(''),
        })
        .parse(req.query);
      await clinicAccess(input.clinic_id, { module: 'laboratory' });
      if (
        !(await db.collection('branches').findOne({
          id: input.branch_id,
          tenant_id: input.clinic_id,
          is_active: true,
        }))
      )
        throw fail('Branch not found.', 404);
      const rows = await db
        .collection('hospital_diagnostic_masters')
        .find({
          tenant_id: input.clinic_id,
          domain: 'pathology',
          kind: 'test',
          'data.patient_app_bookable': true,
        })
        .sort({ name: 1, id: 1 })
        .toArray();
      const data = rows
          .filter(
            (r) =>
              laboratoryTestAvailable(r.data, input.branch_id) &&
              r.name.toLowerCase().includes(input.q.toLowerCase())
          )
          .map((r) => ({
            id: r.id,
            name: r.name,
            amount: laboratoryPrice(r.data, input.branch_id),
            currency: 'INR',
            instructions: r.data.patient_instructions ?? '',
            requires_clinic_confirmation: true,
          })),
        { page: current, page_size } = pageInput.parse(req.query);
      res.json({
        data: data.slice((current - 1) * page_size, current * page_size),
        total: data.length,
        page: current,
        page_size,
      });
    }
  );
  route(
    router,
    'post',
    '/lab-bookings',
    'Request clinic confirmation for patient-bookable laboratory tests',
    async (req, res) => {
      const a = res.locals.account,
        key = requestKey(req),
        input = req.input;
      res.status(201).json(
        await transaction(async (session) => {
          const prior = await replay(a, 'lab-booking', key, input, session);
          if (prior) return prior;
          await clinicAccess(input.clinic_id, {
            session,
            module: 'laboratory',
          });
          const profile = await accountProfile(a, input.profile_id, session),
            branch = await db.collection('branches').findOne(
              {
                id: input.branch_id,
                tenant_id: input.clinic_id,
                is_active: true,
              },
              { session }
            );
          if (!branch) throw fail('Branch not found.', 404);
          const testIds = [...new Set(input.test_ids)],
            tests = [];
          for (const id of testIds) {
            const master = await db
              .collection('hospital_diagnostic_masters')
              .findOne(
                {
                  id,
                  tenant_id: input.clinic_id,
                  domain: 'pathology',
                  kind: 'test',
                  'data.patient_app_bookable': true,
                },
                { session }
              );
            if (
              !master ||
              !laboratoryTestAvailable(master.data, input.branch_id)
            )
              throw fail(
                'A selected test is not available for patient booking.',
                409
              );
            tests.push({
              test_id: id,
              name: master.name,
              test_type: master.data.test_type ?? 'Pathology',
              amount: laboratoryPrice(master.data, input.branch_id),
            });
          }
          const patient = await clinicPatient(
              a,
              profile,
              input.clinic_id,
              input.branch_id,
              session
            ),
            now = new Date(),
            row = {
              id: randomUUID(),
              tenant_id: input.clinic_id,
              branch_id: input.branch_id,
              patient_id: patient.id,
              workspace: 'laboratory',
              kind: 'orders',
              title: 'Patient App Lab Request',
              status: 'Pending',
              priority: 'Normal',
              created_by: a.id,
              data: {
                tests,
                source: 'Patient App',
                requires_clinic_confirmation: true,
                requested_collection_date: input.requested_date ?? null,
                notes: input.notes ?? '',
              },
              occurred_at: now,
              created_at: now,
              updated_at: now,
            };
          await db
            .collection('role_work_items')
            .insertOne({ ...row }, { session });
          const result = {
            id: row.id,
            status: 'Pending clinic confirmation',
            tests,
            total: tests.reduce((sum, t) => sum + cents(t.amount), 0) / 100,
            currency: 'INR',
          };
          await audit(
            a,
            'patient_app_lab_requested',
            row.id,
            session,
            input.clinic_id
          );
          return remember(a, 'lab-booking', key, input, result, session);
        })
      );
    },
    {
      idempotent: true,
      body: z
        .object({
          profile_id: uuid,
          clinic_id: uuid,
          branch_id: uuid,
          test_ids: z.array(uuid).min(1).max(30),
          requested_date: date.optional(),
          notes: z.string().max(1000).optional(),
        })
        .strict(),
    }
  );
  const labView = async (a, row) => {
    let report = null;
    try {
      const { release } = await released(a, row.id, {
        source: true,
        kind: 'lab',
      });
      report = {
        id: release.id,
        download_path: `/api/v1/patient-app/records/${release.id}/download`,
      };
    } catch (error) {
      if (![402, 404].includes(error.status)) throw error;
    }
    return {
      id: row.id,
      clinic_id: row.tenant_id,
      patient_id: row.patient_id,
      status: row.status,
      result_status: row.data?.result_status ?? 'Pending',
      created_at: row.created_at,
      collected_at: row.data?.collected_at ?? null,
      tests: (row.data?.tests ?? []).map((t) =>
        pick(t, ['test_id', 'name', 'amount', 'test_type'])
      ),
      report,
    };
  };
  route(
    router,
    'get',
    '/lab-orders',
    'List patient laboratory requests and progress',
    async (req, res) => {
      const a = res.locals.account,
        result = await page(
          'role_work_items',
          {
            $and: [
              linkFilter(await linksFor(a, req.query.patient_id)),
              { workspace: 'laboratory' },
            ],
          },
          req.query
        );
      res.json({
        ...result,
        data: await Promise.all(result.data.map((row) => labView(a, row))),
      });
    }
  );
  route(
    router,
    'get',
    '/lab-orders/:id',
    'View an authorized laboratory order and any released report',
    async (req, res) => {
      const a = res.locals.account,
        row = await ownRow(a, 'role_work_items', req.params.id, {
          workspace: 'laboratory',
        }),
        view = await labView(a, row);
      if (view.report) {
        const record = await resultRecord(row);
        view.results = reportableLabTests(record.tests, record.data).map((t) =>
          pick(t, ['test_id', 'name', 'parameters', 'notes', 'summaries'])
        );
      }
      res.json(view);
    }
  );
}
