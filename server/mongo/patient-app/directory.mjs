import { z } from 'zod';
import { db } from '../database.mjs';
import { slotsFor } from '../clinical.mjs';
import { cents } from '../money.mjs';
import { escapeSearch } from '../search.mjs';
import {
  clinicSettings,
  date,
  fail,
  page,
  pageInput,
  pick,
  publicClinic,
  route,
  selectedDoctor,
  uuid,
} from './common.mjs';

export function clinicView(hospital, settings) {
  const p = settings.public_profile ?? {};
  return {
    id: hospital.id,
    name: hospital.name,
    type: p.type ?? hospital.hospital_type ?? 'Clinic',
    logo_url: hospital.logo_url ?? '',
    description: p.description ?? '',
    photos: p.photos ?? [],
    phone: p.phone ?? hospital.phone ?? '',
    address: p.address ?? hospital.address ?? '',
    city: hospital.city ?? '',
    state: hospital.state ?? '',
    pin_code: hospital.pin_code ?? '',
    opening_hours: p.opening_hours ?? [],
    facilities: p.facilities ?? [],
    services: p.services ?? [],
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    announcements: p.announcements ?? [],
    manual_check_in: settings.manual_check_in === true,
    pay_at_clinic: settings.pay_at_clinic !== false,
  };
}
export async function doctorView(row, branchId) {
  const u = await db.collection('users').findOne({
    id: row.user_id,
    tenant_id: row.tenant_id,
    role: 'doctor',
    is_active: true,
    deleted_at: null,
  });
  if (!u) return null;
  const assigned = await db
    .collection('branches')
    .find(
      {
        id: { $in: row.branch_ids ?? [u.branch_id] },
        tenant_id: row.tenant_id,
        is_active: true,
      },
      { projection: { id: 1 } }
    )
    .toArray();
  if (!assigned.length) return null;
  branchId =
    branchId ??
    (assigned.some((b) => b.id === u.branch_id) ? u.branch_id : assigned[0].id);
  if (!assigned.some((b) => b.id === branchId)) return null;
  const p = {
      ...row.professional,
      ...row.professional?.branch_fees?.[branchId],
    },
    dept = await db.collection('departments').findOne({
      tenant_id: row.tenant_id,
      id: p.department_id ?? row.department_id,
      is_active: true,
    });
  if (!dept) return null;
  return {
    id: u.id,
    clinic_id: row.tenant_id,
    branch_ids: assigned.map((b) => b.id),
    department_id: dept.id,
    name: `${u.first_name} ${u.last_name}`.trim(),
    specialty: dept.name,
    qualification: p.qualification ?? p.doctor_qualification ?? '',
    experience_years: Number(p.experience_years) || 0,
    languages: p.languages ?? [],
    photo_url: p.photo_url ?? '',
    consultation_fee: cents(p.consultation_fee ?? 0) / 100,
    currency: 'INR',
    about: p.patient_app_bio ?? '',
    schedule: (p.appointment_schedule ?? []).map((day) =>
      pick(day, [
        'appointment_date',
        'from_time',
        'to_time',
        'slot_mode',
        'max_slots',
      ])
    ),
    default_schedule: p.appointment_default_schedule
      ? pick(p.appointment_default_schedule, [
          'from_time',
          'to_time',
          'slot_mode',
          'max_slots',
          'start_date',
          'end_date',
        ])
      : null,
  };
}
async function publishedIds() {
  const ids = await db.collection('hospital_settings').distinct('tenant_id', {
    section: 'PatientApp',
    key: 'enabled',
    value: true,
  });
  return db.collection('hospitals').distinct('id', {
    id: { $in: ids },
    deleted_at: null,
    status: { $in: ['active', 'trial'] },
  });
}
export function registerDirectory(router) {
  route(
    router,
    'get',
    '/config',
    'Get patient app branding and integration capabilities',
    async (_req, res) => {
      const data = await db
          .collection('platform_settings')
          .find({
            is_public: true,
            key: {
              $in: [
                'platform_name',
                'platform_logo',
                'patient_app_terms_url',
                'patient_app_privacy_url',
              ],
            },
          })
          .toArray(),
        values = Object.fromEntries(data.map((r) => [r.key, r.value]));
      res.json({
        name: values.platform_name ?? 'JibonCare',
        logo_url: values.platform_logo ?? '/branding/pushkar-logo.png',
        languages: ['en', 'hi', 'bn'],
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        sms_login_configured: process.env.PATIENT_APP_OTP_MODE === 'webhook',
        terms_url: values.patient_app_terms_url ?? null,
        privacy_url: values.patient_app_privacy_url ?? null,
        online_payment_provider: 'Razorpay',
        push_configured: Boolean(process.env.PATIENT_APP_PUSH_WEBHOOK_URL),
      });
    },
    { public: true }
  );
  route(
    router,
    'get',
    '/clinics',
    'Search published clinics',
    async (req, res) => {
      const input = z
        .object({
          q: z.string().trim().max(100).prefault(''),
          type: z.string().max(60).optional(),
          lat: z.coerce.number().min(-90).max(90).optional(),
          lng: z.coerce.number().min(-180).max(180).optional(),
        })
        .parse(req.query);
      if ((input.lat === undefined) !== (input.lng === undefined))
        throw fail('Provide both latitude and longitude.');
      const ids = await publishedIds(),
        filter = {
          id: { $in: ids },
          deleted_at: null,
          status: { $in: ['active', 'trial'] },
          ...(input.q
            ? {
                $or: ['name', 'city', 'address'].map((k) => ({
                  [k]: { $regex: escapeSearch(input.q), $options: 'i' },
                })),
              }
            : {}),
        };
      // Filtering uses only explicitly published information, never staff or billing data.
      const rows = await db
        .collection('hospitals')
        .find(filter)
        .sort({ name: 1, id: 1 })
        .toArray();
      let data = [];
      for (const row of rows) {
        const item = clinicView(row, await clinicSettings(row.id));
        if (input.type && item.type.toLowerCase() !== input.type.toLowerCase())
          continue;
        if (
          input.lat !== undefined &&
          item.latitude !== null &&
          item.longitude !== null
        ) {
          const rad = (n) => (n * Math.PI) / 180,
            a =
              Math.sin(rad(item.latitude - input.lat) / 2) ** 2 +
              Math.cos(rad(input.lat)) *
                Math.cos(rad(item.latitude)) *
                Math.sin(rad(item.longitude - input.lng) / 2) ** 2;
          item.distance_km =
            Math.round(
              6371 *
                2 *
                Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) *
                10
            ) / 10;
        }
        data.push(item);
      }
      if (input.lat !== undefined)
        data.sort(
          (a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)
        );
      const { page: current, page_size } = pageInput.parse(req.query),
        total = data.length;
      res.json({
        data: data.slice((current - 1) * page_size, current * page_size),
        total,
        page: current,
        page_size,
      });
    },
    { public: true }
  );
  route(
    router,
    'get',
    '/clinics/:id',
    'Get a published clinic and active branches',
    async (req, res) => {
      const { hospital, settings } = await publicClinic(req.params.id),
        branches = await db
          .collection('branches')
          .find(
            { tenant_id: hospital.id, is_active: true },
            { projection: { _id: 0, id: 1, name: 1, address: 1, phone: 1 } }
          )
          .toArray();
      res.json({ ...clinicView(hospital, settings), branches });
    },
    { public: true }
  );
  route(
    router,
    'get',
    '/specialties',
    'List specialties at published clinics',
    async (req, res) => {
      const tenant = req.query.clinic_id
          ? uuid.parse(req.query.clinic_id)
          : null,
        ids = await publishedIds();
      if (tenant && !ids.includes(tenant)) throw fail('Clinic not found.', 404);
      const result = await page(
        'departments',
        { tenant_id: tenant ?? { $in: ids }, is_active: true },
        req.query,
        { _id: 0, id: 1, name: 1, tenant_id: 1, branch_id: 1 },
        { name: 1, id: 1 }
      );
      res.json(result);
    },
    { public: true }
  );
  const listDoctors = async (req, res) => {
    const clinic = req.params.clinicId ?? req.query.clinic_id,
      tenant = clinic ? uuid.parse(clinic) : null,
      ids = await publishedIds();
    if (tenant && !ids.includes(tenant)) throw fail('Clinic not found.', 404);
    const branch = req.query.branch_id ? uuid.parse(req.query.branch_id) : null,
      specialty = req.query.specialty_id
        ? uuid.parse(req.query.specialty_id)
        : null,
      q = z
        .string()
        .trim()
        .max(100)
        .prefault('')
        .parse(req.query.q)
        .toLowerCase();
    const filter = {
        tenant_id: tenant ?? { $in: ids },
        staff_type: 'Doctor',
        status: 'Active',
        ...(branch ? { branch_ids: branch } : {}),
      },
      rows = await db
        .collection('staff_members')
        .find(filter)
        .sort({ id: 1 })
        .toArray(),
      items = [];
    for (const row of rows) {
      const item = await doctorView(row, branch);
      if (
        item &&
        (!specialty || item.department_id === specialty) &&
        (!q || `${item.name} ${item.specialty}`.toLowerCase().includes(q))
      )
        items.push(item);
    }
    const { page: current, page_size } = pageInput.parse(req.query);
    res.json({
      data: items.slice((current - 1) * page_size, current * page_size),
      total: items.length,
      page: current,
      page_size,
    });
  };
  route(
    router,
    'get',
    '/doctors',
    'Search doctors at published clinics',
    listDoctors,
    { public: true }
  );
  route(
    router,
    'get',
    '/clinics/:clinicId/doctors',
    'List clinic doctors',
    listDoctors,
    { public: true }
  );
  route(
    router,
    'get',
    '/doctors/:id',
    'Get a doctor public profile',
    async (req, res) => {
      const row = await db.collection('staff_members').findOne({
        user_id: uuid.parse(req.params.id),
        staff_type: 'Doctor',
        status: 'Active',
      });
      if (!row) throw fail('Doctor not found.', 404);
      await publicClinic(row.tenant_id);
      const item = await doctorView(
        row,
        req.query.branch_id ? uuid.parse(req.query.branch_id) : undefined
      );
      if (!item) throw fail('Doctor not found.', 404);
      const ratings = await db
        .collection('mobile_reviews')
        .aggregate([
          {
            $match: {
              doctor_id: item.id,
              tenant_id: row.tenant_id,
              status: 'Published',
            },
          },
          {
            $group: {
              _id: null,
              rating: { $avg: '$rating' },
              count: { $sum: 1 },
            },
          },
        ])
        .next();
      res.json({
        ...item,
        rating: ratings?.rating ?? null,
        review_count: ratings?.count ?? 0,
      });
    },
    { public: true }
  );
  route(
    router,
    'get',
    '/doctors/:id/reviews',
    'List moderated doctor reviews',
    async (req, res) => {
      const doctor = await db.collection('staff_members').findOne({
        user_id: uuid.parse(req.params.id),
        staff_type: 'Doctor',
        status: 'Active',
      });
      if (!doctor) throw fail('Doctor not found.', 404);
      await publicClinic(doctor.tenant_id);
      res.json(
        await page(
          'mobile_reviews',
          {
            doctor_id: doctor.user_id,
            tenant_id: doctor.tenant_id,
            status: 'Published',
          },
          req.query,
          {
            _id: 0,
            id: 1,
            rating: 1,
            comment: 1,
            created_at: 1,
            display_name: 1,
          }
        )
      );
    },
    { public: true }
  );
  route(
    router,
    'get',
    '/doctors/:id/availability',
    'Get bookable doctor slots including temporary holds',
    async (req, res) => {
      const input = z
          .object({ clinic_id: uuid, branch_id: uuid, date })
          .parse(req.query),
        doctor = await selectedDoctor(
          input.clinic_id,
          input.branch_id,
          uuid.parse(req.params.id)
        );
      res.json({
        doctor_id: doctor.user.id,
        clinic_id: input.clinic_id,
        branch_id: input.branch_id,
        date: input.date,
        consultation_fee:
          cents(doctor.professional.consultation_fee ?? 0) / 100,
        slots: await slotsFor(doctor, input.date),
      });
    },
    { public: true }
  );
}
