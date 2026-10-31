import { Router, type NextFunction, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { config } from './config.js'
import { pool } from './db.js'
import { createHash, randomBytes } from 'node:crypto'
import { requireCrmIntegration } from './crm-integration-status.js'

type AdminToken = { sub: string; username: string; role: 'super_admin' }
type AdminRequest = Request & { admin?: AdminToken }

const router = Router()
const asyncRoute = (handler: (request: AdminRequest, response: Response) => Promise<void>) =>
  (request: AdminRequest, response: Response, next: NextFunction) =>
    handler(request, response).catch(next)

function authenticate(request: AdminRequest, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) {
    response.status(401).json({ error: 'Authentication required' })
    return
  }
  try {
    request.admin = jwt.verify(token, config.JWT_SECRET) as AdminToken
    next()
  } catch {
    response.status(401).json({ error: 'Session expired or invalid' })
  }
}

router.post('/auth/login', asyncRoute(async (request, response) => {
  const body = z.object({
    username: z.string().min(3).max(100),
    password: z.string().min(8).max(200),
  }).parse(request.body)

  const result = await pool.query<{
    id: string; username: string; display_name: string
  }>(
    `UPDATE super_admin_users
     SET last_login_at = now()
     WHERE username = $1
       AND is_active
       AND password_hash = crypt($2, password_hash)
     RETURNING id, username, display_name`,
    [body.username, body.password],
  )
  const admin = result.rows[0]
  if (!admin) {
    response.status(401).json({ error: 'Invalid username or password' })
    return
  }

  const token = jwt.sign(
    { sub: admin.id, username: admin.username, role: 'super_admin' } satisfies AdminToken,
    config.JWT_SECRET,
    { expiresIn: '8h', issuer: 'careframe-api', audience: 'careframe-superadmin' },
  )
  response.json({ token, user: { id: admin.id, username: admin.username, name: admin.display_name } })
}))

router.use(authenticate)

router.get('/me', asyncRoute(async (request, response) => {
  const result = await pool.query(
    'SELECT id, username, display_name AS name, last_login_at FROM super_admin_users WHERE id = $1',
    [request.admin!.sub],
  )
  response.json(result.rows[0])
}))

router.get('/crm-connections', asyncRoute(async (_request, response) => {
  const result = await pool.query(`
    SELECT h.id tenant_id,h.name hospital_name,h.code hospital_code,
      c.id,c.clinic_external_id,c.clinic_name,c.api_key_prefix,c.is_active,
      c.last_sync_at,c.last_sync_status,c.last_sync_summary,c.created_at
    FROM hospitals h LEFT JOIN call_centre_crm_connections c ON c.tenant_id=h.id
    WHERE h.deleted_at IS NULL ORDER BY h.name`)
  response.json(result.rows.map(row => ({ ...row, integration_enabled: config.CRM_INTEGRATION_ENABLED === 'true', is_active: config.CRM_INTEGRATION_ENABLED === 'true' && row.is_active })))
}))

router.get('/crm-clinics', requireCrmIntegration, asyncRoute(async (_request, response) => {
  const crmResponse = await fetch(`${config.CRM_API_BASE_URL.replace(/\/$/, '')}/patient/clinics`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  })
  if (!crmResponse.ok) {
    response.status(502).json({ error: `CareFlow360 clinic list returned HTTP ${crmResponse.status}` })
    return
  }
  const payload = await crmResponse.json() as { data?: unknown }
  const clinics = z.array(z.object({
    id: z.string(), name: z.string(), slug: z.string().optional(), city: z.string().optional(),
    state: z.string().optional(), address: z.string().optional(),
  })).parse(payload.data ?? [])
  const connected = await pool.query(`SELECT c.clinic_external_id,c.tenant_id,h.name hospital_name FROM call_centre_crm_connections c JOIN hospitals h ON h.id=c.tenant_id`)
  const mappings = new Map(connected.rows.map(row => [row.clinic_external_id, row]))
  response.json(clinics.map(clinic => ({ ...clinic, connectedTenantId: mappings.get(clinic.id)?.tenant_id ?? null, connectedHospitalName: mappings.get(clinic.id)?.hospital_name ?? null })))
}))

router.post('/crm-connections', requireCrmIntegration, asyncRoute(async (request, response) => {
  const body = z.object({
    tenantId: z.string().uuid(),
    clinicExternalId: z.string().trim().min(1).max(200),
    clinicName: z.string().trim().max(200).prefault(''),
  }).parse(request.body)
  const rawKey = `cfc_${randomBytes(32).toString('base64url')}`
  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const keyPrefix = rawKey.slice(0, 12)
  const result = await pool.query(`
    INSERT INTO call_centre_crm_connections(tenant_id,clinic_external_id,clinic_name,api_key_prefix,api_key_hash,is_active)
    VALUES($1,$2,$3,$4,$5,true)
    ON CONFLICT(tenant_id) DO UPDATE SET clinic_external_id=excluded.clinic_external_id,
      clinic_name=excluded.clinic_name,api_key_prefix=excluded.api_key_prefix,
      api_key_hash=excluded.api_key_hash,is_active=true,updated_at=now()
    RETURNING id,tenant_id,clinic_external_id,clinic_name,api_key_prefix,is_active`,
    [body.tenantId, body.clinicExternalId, body.clinicName, keyPrefix, keyHash])
  await pool.query(`INSERT INTO platform_events(tenant_id,severity,source,message,event_type,metadata) VALUES($1,'info','Call Centre CRM',$2,'crm_connected',$3)`, [body.tenantId, `Call Centre CRM connected to clinic ${body.clinicName || body.clinicExternalId}.`, { clinicExternalId: body.clinicExternalId }])
  response.status(201).json({ ...result.rows[0], apiKey: rawKey })
}))

router.patch('/crm-connections/:id/status', requireCrmIntegration, asyncRoute(async (request, response) => {
  const body = z.object({ isActive: z.boolean() }).parse(request.body)
  const result = await pool.query(`UPDATE call_centre_crm_connections SET is_active=$1,updated_at=now() WHERE id=$2 RETURNING id,is_active`, [body.isActive, request.params.id])
  if (!result.rows[0]) return void response.status(404).json({ error: 'CRM connection not found' })
  response.json(result.rows[0])
}))

router.get('/dashboard', asyncRoute(async (_request, response) => {
  const [hospitals, subscriptions, users, modules, growth, plans, activity] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (WHERE status = 'trial')::int AS trial,
      count(*) FILTER (WHERE status = 'suspended')::int AS suspended
      FROM hospitals WHERE deleted_at IS NULL`),
    pool.query(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (WHERE expires_at BETWEEN now() AND now() + interval '30 days')::int AS expiring,
      coalesce(sum(monthly_amount) FILTER (WHERE status = 'active'), 0)::numeric AS monthly_revenue
      FROM subscriptions`),
    pool.query(`SELECT count(*)::int AS total FROM users`),
    pool.query(`SELECT count(*) FILTER (WHERE is_active)::int AS active FROM platform_modules`),
    pool.query(`SELECT to_char(month, 'Mon') AS month, total FROM (
      SELECT date_trunc('month', created_at) AS month, count(*)::int AS total
      FROM hospitals WHERE created_at >= now() - interval '6 months'
      GROUP BY 1 ORDER BY 1) growth`),
    pool.query(`SELECT plan_code AS name, count(*)::int AS value
      FROM subscriptions GROUP BY plan_code ORDER BY value DESC`),
    pool.query(`SELECT pe.id, pe.severity, pe.source, pe.message, pe.created_at,
      h.name AS hospital_name FROM platform_events pe
      LEFT JOIN hospitals h ON h.id = pe.tenant_id ORDER BY pe.created_at DESC LIMIT 8`),
  ])
  response.json({
    hospitals: hospitals.rows[0],
    subscriptions: subscriptions.rows[0],
    users: users.rows[0],
    modules: modules.rows[0],
    growth: growth.rows,
    planDistribution: plans.rows,
    activity: activity.rows,
    generatedAt: new Date().toISOString(),
  })
}))

const planInput = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().max(1000).prefault(''),
  monthlyPrice: z.coerce.number().nonnegative(),
  yearlyPrice: z.coerce.number().nonnegative(),
  trialDays: z.coerce.number().int().min(0).max(365),
  maxBranches: z.coerce.number().int().positive(),
  maxUsers: z.coerce.number().int().positive(),
  maxDoctors: z.coerce.number().int().positive(),
  storageLimitGb: z.coerce.number().int().positive(),
  aiUsageLimit: z.coerce.number().int().nonnegative(),
  moduleIds: z.array(z.string().uuid()).prefault([]),
  status: z.enum(['active', 'inactive']),
})

router.get('/plans', asyncRoute(async (_request, response) => {
  const result = await pool.query(
    `SELECT p.*, coalesce(json_agg(json_build_object('id', m.id, 'name', m.name, 'code', m.code))
       FILTER (WHERE m.id IS NOT NULL), '[]') AS modules,
       count(DISTINCT s.tenant_id)::int AS hospital_count
     FROM subscription_plans p
     LEFT JOIN subscription_plan_modules pm ON pm.plan_id = p.id
     LEFT JOIN platform_modules m ON m.id = pm.module_id
     LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status IN ('active', 'trial')
     GROUP BY p.id ORDER BY p.created_at DESC`,
  )
  response.json(result.rows)
}))

router.get('/plans/:id', asyncRoute(async (request, response) => {
  const result = await pool.query(
    `SELECT p.*, coalesce(array_agg(pm.module_id) FILTER (WHERE pm.module_id IS NOT NULL), '{}') AS module_ids
     FROM subscription_plans p LEFT JOIN subscription_plan_modules pm ON pm.plan_id = p.id
     WHERE p.id = $1 GROUP BY p.id`,
    [request.params.id],
  )
  if (!result.rows[0]) { response.status(404).json({ error: 'Plan not found' }); return }
  response.json(result.rows[0])
}))

router.post('/plans', asyncRoute(async (request, response) => {
  const body = planInput.parse(request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const plan = (await client.query(
      `INSERT INTO subscription_plans (name, code, description, monthly_price, yearly_price,
       trial_days, max_branches, max_users, max_doctors, storage_limit_gb, ai_usage_limit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [body.name, body.code, body.description, body.monthlyPrice, body.yearlyPrice, body.trialDays,
        body.maxBranches, body.maxUsers, body.maxDoctors, body.storageLimitGb, body.aiUsageLimit, body.status],
    )).rows[0]
    if (body.moduleIds.length) await client.query(
      `INSERT INTO subscription_plan_modules (plan_id, module_id) SELECT $1, unnest($2::uuid[])`,
      [plan.id, body.moduleIds],
    )
    await client.query('COMMIT')
    response.status(201).json(plan)
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}))

router.put('/plans/:id', asyncRoute(async (request, response) => {
  const body = planInput.parse(request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const plan = (await client.query(
      `UPDATE subscription_plans SET name=$1, code=$2, description=$3, monthly_price=$4,
       yearly_price=$5, trial_days=$6, max_branches=$7, max_users=$8, max_doctors=$9,
       storage_limit_gb=$10, ai_usage_limit=$11, status=$12 WHERE id=$13 RETURNING *`,
      [body.name, body.code, body.description, body.monthlyPrice, body.yearlyPrice, body.trialDays,
        body.maxBranches, body.maxUsers, body.maxDoctors, body.storageLimitGb, body.aiUsageLimit,
        body.status, request.params.id],
    )).rows[0]
    if (!plan) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Plan not found' }); return }
    await client.query('DELETE FROM subscription_plan_modules WHERE plan_id=$1', [request.params.id])
    if (body.moduleIds.length) await client.query(
      `INSERT INTO subscription_plan_modules (plan_id, module_id) SELECT $1, unnest($2::uuid[])`,
      [request.params.id, body.moduleIds],
    )
    await client.query('COMMIT')
    response.json(plan)
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}))

router.delete('/plans/:id', asyncRoute(async (request, response) => {
  const inUse = await pool.query(
    `SELECT 1 FROM subscriptions WHERE plan_id=$1 AND status IN ('active','trial') LIMIT 1`,
    [request.params.id],
  )
  if (inUse.rowCount) { response.status(409).json({ error: 'Deactivate this plan instead; it is assigned to a hospital.' }); return }
  await pool.query(
    `UPDATE subscriptions SET plan_id=NULL WHERE plan_id=$1 AND status NOT IN ('active','trial')`,
    [request.params.id],
  )
  const result = await pool.query('DELETE FROM subscription_plans WHERE id=$1 RETURNING id', [request.params.id])
  if (!result.rowCount) { response.status(404).json({ error: 'Plan not found' }); return }
  response.status(204).end()
}))

router.get('/hospitals', asyncRoute(async (request, response) => {
  const page = Math.max(Number(request.query.page) || 1, 1)
  const limit = Math.min(Math.max(Number(request.query.limit) || 10, 1), 100)
  const search = String(request.query.search ?? '')
  const status = String(request.query.status ?? '')
  const offset = (page - 1) * limit
  const values: unknown[] = [`%${search}%`, status || null, limit, offset]
  const result = await pool.query(
    `SELECT h.id, h.name, h.code, h.status, h.created_at,
      count(DISTINCT b.id)::int AS branches,
      count(DISTINCT u.id)::int AS users,
      s.plan_code, s.status AS subscription_status, s.expires_at,
      count(*) OVER()::int AS total_count
     FROM hospitals h
     LEFT JOIN branches b ON b.tenant_id = h.id
     LEFT JOIN users u ON u.tenant_id = h.id
     LEFT JOIN LATERAL (
       SELECT plan_code, status, expires_at FROM subscriptions
       WHERE tenant_id = h.id ORDER BY created_at DESC LIMIT 1
     ) s ON true
     WHERE h.deleted_at IS NULL
       AND (h.name ILIKE $1 OR h.code ILIKE $1)
       AND ($2::text IS NULL OR h.status::text = $2)
     GROUP BY h.id, s.plan_code, s.status, s.expires_at
     ORDER BY h.created_at DESC LIMIT $3 OFFSET $4`,
    values,
  )
  response.json({ data: result.rows, page, limit, total: result.rows[0]?.total_count ?? 0 })
}))

router.get('/hospitals/:id', asyncRoute(async (request, response) => {
  const result = await pool.query(
    `SELECT h.*, b.id AS branch_id, b.name AS branch_name,
      s.id AS subscription_id, s.plan_id, s.starts_at AS subscription_start_date,
      s.billing_cycle, s.trial_days, s.status AS subscription_status,
      u.id AS admin_id, concat(u.first_name, ' ', u.last_name) AS admin_name,
      u.email AS admin_email, u.phone AS admin_phone
     FROM hospitals h
     LEFT JOIN LATERAL (SELECT * FROM branches WHERE tenant_id=h.id ORDER BY created_at LIMIT 1) b ON true
     LEFT JOIN LATERAL (SELECT * FROM subscriptions WHERE tenant_id=h.id ORDER BY created_at DESC LIMIT 1) s ON true
     LEFT JOIN LATERAL (SELECT * FROM users WHERE tenant_id=h.id AND role='hospital_admin' ORDER BY created_at LIMIT 1) u ON true
     WHERE h.id=$1 AND h.deleted_at IS NULL`,
    [request.params.id],
  )
  if (!result.rows[0]) { response.status(404).json({ error: 'Hospital not found' }); return }
  response.json(result.rows[0])
}))

const hospitalInput = z.object({
  name: z.string().min(2).max(160),
  code: z.string().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  logoUrl: z.string().max(900_000).optional().nullable(),
  hospitalType: z.string().min(2).max(80),
  registrationNumber: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().min(7).max(30),
  emergencyPhone: z.string().min(7).max(30),
  address: z.string().min(3).max(500),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  pinCode: z.string().min(3).max(20),
  country: z.string().min(2).max(100),
  gstin: z.string().max(30).prefault(''),
  branchName: z.string().min(2).max(160),
  planId: z.string().uuid(),
  subscriptionStartDate: z.string().date(),
  billingCycle: z.enum(['monthly', 'yearly']),
  trialDays: z.coerce.number().int().min(0).max(365),
  status: z.enum(['active', 'trial', 'suspended', 'inactive']),
  adminName: z.string().min(2).max(160),
  adminEmail: z.string().email(),
  adminPhone: z.string().min(7).max(30),
  password: z.string().min(8).max(200).optional(),
})

router.post('/hospitals', asyncRoute(async (request, response) => {
  const body = hospitalInput.extend({ password: z.string().min(8).max(200) }).parse(request.body)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const plan = (await client.query('SELECT * FROM subscription_plans WHERE id=$1 AND status=$2', [body.planId, 'active'])).rows[0]
    if (!plan) { await client.query('ROLLBACK'); response.status(400).json({ error: 'Select an active subscription plan.' }); return }
    const hospital = (await client.query(
      `INSERT INTO hospitals (name, code, status, logo_url, hospital_type, registration_number,
       email, phone, emergency_phone, address_line, city, state, pin_code, country, gstin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, name, code, status, created_at`,
      [body.name, body.code, body.status, body.logoUrl ?? null, body.hospitalType,
        body.registrationNumber, body.email, body.phone, body.emergencyPhone, body.address,
        body.city, body.state, body.pinCode, body.country, body.gstin || null],
    )).rows[0]
    const branch = (await client.query(
      `INSERT INTO branches (tenant_id, name, code, phone, address)
       VALUES ($1,$2,'MAIN',$3,jsonb_build_object('line',$4::text,'city',$5::text,'state',$6::text,'pinCode',$7::text,'country',$8::text))
       RETURNING id`, [hospital.id, body.branchName, body.phone, body.address, body.city, body.state, body.pinCode, body.country],
    )).rows[0]
    const nameParts = body.adminName.trim().split(/\s+/)
    const firstName = nameParts.shift()!
    const lastName = nameParts.join(' ') || '-'
    await client.query(
      `INSERT INTO users (tenant_id, branch_id, email, password_hash, first_name, last_name, role, phone)
       VALUES ($1,$2,$3,crypt($4,gen_salt('bf',12)),$5,$6,'hospital_admin',$7)`,
      [hospital.id, branch.id, body.adminEmail, body.password, firstName, lastName, body.adminPhone],
    )
    const amount = body.billingCycle === 'monthly' ? plan.monthly_price : plan.yearly_price
    await client.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, plan_code, status, starts_at, expires_at,
       monthly_amount, billing_cycle, trial_days) VALUES ($1,$2,$3,$4,$5::date,
       $5::date + CASE WHEN $6='monthly' THEN interval '1 month' ELSE interval '1 year' END,$7,$6,$8)`,
      [hospital.id, plan.id, plan.code, body.status === 'trial' ? 'trial' : 'active',
        body.subscriptionStartDate, body.billingCycle, amount, body.trialDays],
    )
    await client.query(
      `INSERT INTO hospital_modules (tenant_id, module_id)
       SELECT $1, module_id FROM subscription_plan_modules WHERE plan_id=$2`,
      [hospital.id, plan.id],
    )
    await client.query(
      `INSERT INTO platform_events (tenant_id, severity, source, event_type, message, metadata)
       VALUES ($1, 'info', 'tenants', 'hospital_created', $2, jsonb_build_object('plan', $3::text))`,
      [hospital.id, `${body.name} was registered on the platform.`, plan.code],
    )
    await client.query('COMMIT')
    response.status(201).json(hospital)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

router.put('/hospitals/:id', asyncRoute(async (request, response) => {
  const body = hospitalInput.parse(request.body)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const plan = (await client.query('SELECT * FROM subscription_plans WHERE id=$1', [body.planId])).rows[0]
    if (!plan) { await client.query('ROLLBACK'); response.status(400).json({ error: 'Subscription plan not found.' }); return }
    const hospital = (await client.query(
      `UPDATE hospitals SET name=$1,code=$2,status=$3,logo_url=$4,hospital_type=$5,
       registration_number=$6,email=$7,phone=$8,emergency_phone=$9,address_line=$10,
       city=$11,state=$12,pin_code=$13,country=$14,gstin=$15 WHERE id=$16 AND deleted_at IS NULL RETURNING id`,
      [body.name, body.code, body.status, body.logoUrl ?? null, body.hospitalType, body.registrationNumber,
        body.email, body.phone, body.emergencyPhone, body.address, body.city, body.state,
        body.pinCode, body.country, body.gstin || null, request.params.id],
    )).rows[0]
    if (!hospital) { await client.query('ROLLBACK'); response.status(404).json({ error: 'Hospital not found' }); return }
    await client.query(
      `UPDATE branches SET name=$1,phone=$2,address=jsonb_build_object('line',$3::text,'city',$4::text,'state',$5::text,'pinCode',$6::text,'country',$7::text)
       WHERE id=(SELECT id FROM branches WHERE tenant_id=$8 ORDER BY created_at LIMIT 1)`,
      [body.branchName, body.phone, body.address, body.city, body.state, body.pinCode, body.country, request.params.id],
    )
    const parts = body.adminName.trim().split(/\s+/), firstName = parts.shift()!, lastName = parts.join(' ') || '-'
    const adminUpdate = await client.query(
      `UPDATE users SET first_name=$1,last_name=$2,email=$3,phone=$4,
       password_hash=CASE WHEN $5::text IS NULL THEN password_hash ELSE crypt($5,gen_salt('bf',12)) END
       WHERE id=(SELECT id FROM users WHERE tenant_id=$6 AND role='hospital_admin' ORDER BY created_at LIMIT 1)
       RETURNING id`,
      [firstName, lastName, body.adminEmail, body.adminPhone, body.password || null, request.params.id],
    )
    if (!adminUpdate.rowCount) {
      if (!body.password) {
        await client.query('ROLLBACK')
        response.status(400).json({ error: 'A password is required to create this hospital administrator.' })
        return
      }
      const branch = (await client.query(
        `SELECT id FROM branches WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`,
        [request.params.id],
      )).rows[0]
      await client.query(
        `INSERT INTO users (tenant_id,branch_id,email,password_hash,first_name,last_name,role,phone)
         VALUES ($1,$2,$3,crypt($4,gen_salt('bf',12)),$5,$6,'hospital_admin',$7)`,
        [request.params.id, branch.id, body.adminEmail, body.password, firstName, lastName, body.adminPhone],
      )
    }
    const amount = body.billingCycle === 'monthly' ? plan.monthly_price : plan.yearly_price
    await client.query(
      `UPDATE subscriptions SET plan_id=$1,plan_code=$2,status=$3,starts_at=$4::date,
       expires_at=$4::date+CASE WHEN $5='monthly' THEN interval '1 month' ELSE interval '1 year' END,
       monthly_amount=$6,billing_cycle=$5,trial_days=$8 WHERE id=(SELECT id FROM subscriptions WHERE tenant_id=$7 ORDER BY created_at DESC LIMIT 1)`,
      [plan.id, plan.code, body.status === 'trial' ? 'trial' : 'active', body.subscriptionStartDate,
        body.billingCycle, amount, request.params.id, body.trialDays],
    )
    await client.query('DELETE FROM hospital_modules WHERE tenant_id=$1', [request.params.id])
    await client.query(`INSERT INTO hospital_modules (tenant_id,module_id) SELECT $1,module_id FROM subscription_plan_modules WHERE plan_id=$2`, [request.params.id, plan.id])
    await client.query('COMMIT')
    response.json({ id: request.params.id })
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}))

router.delete('/hospitals/:id', asyncRoute(async (request, response) => {
  const result = await pool.query(
    `UPDATE hospitals SET deleted_at=now(),status='inactive' WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
    [request.params.id],
  )
  if (!result.rowCount) { response.status(404).json({ error: 'Hospital not found' }); return }
  await pool.query(`UPDATE users SET is_active=false WHERE tenant_id=$1`, [request.params.id])
  await pool.query(`UPDATE subscriptions SET status='cancelled' WHERE tenant_id=$1 AND status IN ('active','trial')`, [request.params.id])
  response.status(204).end()
}))

router.patch('/hospitals/:id/status', asyncRoute(async (request, response) => {
  const body = z.object({ status: z.enum(['trial', 'active', 'suspended', 'inactive']) }).parse(request.body)
  const result = await pool.query(
    `UPDATE hospitals SET status = $1 WHERE id = $2 AND deleted_at IS NULL
     RETURNING id, name, status`,
    [body.status, request.params.id],
  )
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Hospital not found' })
    return
  }
  response.json(result.rows[0])
}))

router.get('/subscriptions', asyncRoute(async (_request, response) => {
  const result = await pool.query(
    `SELECT s.id, s.tenant_id, h.name AS hospital_name, s.plan_code, s.status,
      s.starts_at, s.expires_at, s.monthly_amount
     FROM subscriptions s JOIN hospitals h ON h.id = s.tenant_id
     ORDER BY s.expires_at`,
  )
  response.json(result.rows)
}))

router.post('/subscriptions', asyncRoute(async (request, response) => {
  const body = z.object({
    tenantId: z.string().uuid(), planCode: z.string().min(2),
    monthlyAmount: z.coerce.number().nonnegative(), months: z.coerce.number().int().min(1).max(60),
  }).parse(request.body)
  const result = await pool.query(
    `INSERT INTO subscriptions (tenant_id, plan_code, status, starts_at, expires_at, monthly_amount)
     VALUES ($1, $2, 'active', now(), now() + ($3 || ' months')::interval, $4)
     RETURNING *`,
    [body.tenantId, body.planCode, body.months, body.monthlyAmount],
  )
  await pool.query(`UPDATE hospitals SET status = 'active' WHERE id = $1`, [body.tenantId])
  response.status(201).json(result.rows[0])
}))

router.get('/modules', asyncRoute(async (_request, response) => {
  const result = await pool.query(
    `SELECT m.*, count(hm.tenant_id) FILTER (WHERE hm.is_enabled)::int AS enabled_hospitals
     FROM platform_modules m LEFT JOIN hospital_modules hm ON hm.module_id = m.id
     GROUP BY m.id ORDER BY m.name`,
  )
  response.json(result.rows)
}))

router.post('/modules', asyncRoute(async (request, response) => {
  const body = z.object({
    code: z.string().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().min(2).max(100), description: z.string().max(500).prefault(''),
  }).parse(request.body)
  const result = await pool.query(
    `INSERT INTO platform_modules (code, name, description) VALUES ($1, $2, $3) RETURNING *`,
    [body.code, body.name, body.description],
  )
  response.status(201).json(result.rows[0])
}))

router.patch('/modules/:id', asyncRoute(async (request, response) => {
  const body = z.object({
    isActive: z.boolean().optional(),
    code: z.string().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
    name: z.string().min(2).max(100).optional(),
    description: z.string().max(500).optional(),
  }).refine(value => Object.values(value).some(item => item !== undefined), 'At least one field is required').parse(request.body)
  const result = await pool.query(
    `UPDATE platform_modules SET
       is_active = coalesce($1::boolean, is_active),
       code = coalesce($2::text, code),
       name = coalesce($3::text, name),
       description = coalesce($4::text, description)
     WHERE id = $5 RETURNING *`,
    [body.isActive ?? null, body.code ?? null, body.name ?? null, body.description ?? null, request.params.id],
  )
  if (!result.rows[0]) { response.status(404).json({ error: 'Module not found' }); return }
  response.json(result.rows[0])
}))

router.put('/hospitals/:id/modules', asyncRoute(async (request, response) => {
  const body = z.object({ moduleId: z.string().uuid(), enabled: z.boolean() }).parse(request.body)
  await pool.query(
    `INSERT INTO hospital_modules (tenant_id, module_id, is_enabled, enabled_at, disabled_at)
     VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END, CASE WHEN $3 THEN NULL ELSE now() END)
     ON CONFLICT (tenant_id, module_id) DO UPDATE SET
       is_enabled = EXCLUDED.is_enabled,
       enabled_at = CASE WHEN EXCLUDED.is_enabled THEN now() ELSE hospital_modules.enabled_at END,
       disabled_at = CASE WHEN EXCLUDED.is_enabled THEN NULL ELSE now() END`,
    [request.params.id, body.moduleId, body.enabled],
  )
  response.status(204).end()
}))

router.get('/settings', asyncRoute(async (_request, response) => {
  const result = await pool.query(`SELECT * FROM platform_settings ORDER BY category, key`)
  response.json(result.rows)
}))

router.put('/settings/:key', asyncRoute(async (request, response) => {
  const body = z.object({ value: z.unknown() }).parse(request.body)
  const settingKey = Array.isArray(request.params.key) ? request.params.key[0] : request.params.key
  if (!settingKey) {
    response.status(400).json({ error: 'Setting key is required' })
    return
  }
  const settingDefaults: Record<string, { category: string; description: string; isPublic: boolean }> = {
    platform_logo: {
      category: 'branding',
      description: 'Logo displayed in the Super Admin navigation and platform branding.',
      isPublic: true,
    },
  }
  const defaults = settingDefaults[settingKey] ?? {
    category: 'general',
    description: '',
    isPublic: false,
  }
  const result = await pool.query(
    `INSERT INTO platform_settings (key, value, category, description, is_public, updated_by)
     VALUES ($3, $1::jsonb, $4, $5, $6, $2)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`,
    [JSON.stringify(body.value), request.admin!.sub, settingKey, defaults.category, defaults.description, defaults.isPublic],
  )
  response.json(result.rows[0])
}))

router.get('/monitoring', asyncRoute(async (_request, response) => {
  const [health, events] = await Promise.all([
    pool.query(`SELECT current_database() AS database, pg_database_size(current_database())::bigint AS database_bytes,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
      extract(epoch FROM (now() - pg_postmaster_start_time()))::bigint AS uptime_seconds`),
    pool.query(`SELECT pe.*, h.name AS hospital_name FROM platform_events pe
      LEFT JOIN hospitals h ON h.id = pe.tenant_id ORDER BY pe.created_at DESC LIMIT 50`),
  ])
  response.json({ health: health.rows[0], events: events.rows })
}))

router.get('/reports', asyncRoute(async (_request, response) => {
  const [registrations, revenue, statuses, expiring] = await Promise.all([
    pool.query(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS period, count(*)::int AS hospitals
      FROM hospitals GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT to_char(date_trunc('month', starts_at), 'YYYY-MM') AS period,
      coalesce(sum(monthly_amount), 0)::numeric AS revenue FROM subscriptions GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT status, count(*)::int AS total FROM hospitals WHERE deleted_at IS NULL GROUP BY status`),
    pool.query(`SELECT h.name AS hospital, s.plan_code, s.expires_at,
      extract(day FROM s.expires_at - now())::int AS days_remaining
      FROM subscriptions s JOIN hospitals h ON h.id = s.tenant_id
      WHERE s.expires_at BETWEEN now() AND now() + interval '60 days' ORDER BY s.expires_at`),
  ])
  response.json({ registrations: registrations.rows, revenue: revenue.rows, statuses: statuses.rows, expiring: expiring.rows })
}))

export default router
