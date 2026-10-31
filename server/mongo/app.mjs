import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.mjs';
import { db, initializeMongo, transaction } from './database.mjs';
import { activeAccount, hashPassword, verifyPassword, authorizedPortal } from './security.mjs';
import provisioning from './provisioning.mjs';
import patients from './patients.mjs';
import management from './management.mjs';
import clinical from './clinical.mjs';
import inpatient from './inpatient.mjs';
import settings from './settings.mjs';
import finance from './finance.mjs';
import diagnosticMasters from './diagnostic-masters.mjs';
import laboratory from './laboratory.mjs';
import platform from './platform.mjs';
import labResults from './lab-results.mjs';
import labReports,{publicReports} from './lab-reports.mjs';
import accessControl from './access-control.mjs';
import {accessEvents} from './live-access.mjs';
import inventory from './inventory.mjs';
import financePosting from './finance-posting.mjs';
import workforce from './workforce.mjs';
import cancellations from './cancellations.mjs';
import doctor from './doctor.mjs';
import {doctorDischarge,receptionDischarge,nursingTasks} from './discharge.mjs';
import nursing from './nursing.mjs';
import pharmacyStock,{pharmacyMasters} from './pharmacy-stock.mjs';
import { hasActiveRole } from './access.mjs';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
app.use(async (_request, response, next) => {
  try { await initializeMongo(); next(); }
  catch { response.status(503).json({ code: 'DATABASE_UNAVAILABLE', error: 'Database unavailable. Check the server configuration.' }); }
});
app.use(async(request,response,next)=>{
  if(request.path.startsWith('/api/v1/admin')||['/api/v1/health','/api/v1/branding'].includes(request.path))return next();
  const setting=await db.collection('platform_settings').findOne({key:'maintenance_mode'});
  if(setting?.value===true)return response.status(503).json({code:'MAINTENANCE',error:'The clinic service is temporarily under maintenance.'});
  next();
});

const loginSchema = z.object({ identifier: z.string().trim().min(3).max(200), password: z.string().min(8).max(200), portal: z.string().min(1).max(40) });
async function rateLimit(request, response, next) {
  const window = Math.floor(Date.now() / 900000);
  const id = createHash('sha256').update(`${request.ip}:${window}`).digest('hex');
  const entry = await db.collection('login_limits').findOneAndUpdate({ _id: id }, {
    $inc: { attempts: 1 }, $setOnInsert: { expires_at: new Date((window + 1) * 900000) },
  }, { upsert: true, returnDocument: 'after' });
  if (entry.attempts > 10) return response.set('Retry-After', '900').status(429).json({ error: 'Too many login attempts. Try again later.' });
  next();
}
async function issueSession(account, audience, claims) {
  const setting=await db.collection('platform_settings').findOne({key:'session_timeout_minutes'});
  const minutes=Number(setting?.value??480);
  const duration=Number.isInteger(minutes)&&minutes>=5&&minutes<=1440?minutes:480;
  const jti = randomUUID(), expires_at = new Date(Date.now() + duration * 60000);
  await db.collection('sessions').insertOne({ _id: jti, user_id: account.id, audience, tenant_id: account.tenant_id ?? null, expires_at });
  return jwt.sign({ ...claims, jti, version: account.session_version ?? 0 }, config.JWT_SECRET, {
    subject: account.id, expiresIn: duration*60, issuer: 'careframe-api', audience, algorithm: 'HS256',
  });
}
function authenticate(audience) {
  return async (request, response, next) => {
    let claims;
    try {
      claims = jwt.verify(request.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '', config.JWT_SECRET, {
        issuer: 'careframe-api', audience, algorithms: ['HS256'],
      });
    } catch { return response.status(401).json({ error: 'Session expired or invalid.' }); }
    if (typeof claims !== 'object' || typeof claims.sub !== 'string' || typeof claims.jti !== 'string') return response.status(401).json({ error: 'Session expired or invalid.' });
    const session = await db.collection('sessions').findOne({ _id: claims.jti, user_id: claims.sub, audience, expires_at: { $gt: new Date() } });
    const admin = audience === 'careframe-superadmin';
    const account = await db.collection(admin ? 'super_admin_users' : 'users').findOne({ id: claims.sub, ...(admin ? {} : { tenant_id: claims.tenantId }) });
    if (!session || !account?.is_active || account.deleted_at || (account.session_version ?? 0) !== claims.version) return response.status(401).json({ error: 'Account access revoked.' });
    if (!admin) {
      if (claims.role !== account.role || claims.branchId !== account.branch_id) return response.status(401).json({ error: 'Account access changed. Sign in again.' });
      if (!authorizedPortal(account, claims.portal)) return response.status(401).json({ error: 'Workspace access revoked.' });
      if (!await hasActiveRole(account)) return response.status(401).json({ error: 'Role access revoked.' });
      const branch = await db.collection('branches').findOne({ id: account.branch_id, tenant_id: account.tenant_id, is_active: true });
      if (!branch) return response.status(401).json({ error: 'Branch access revoked.' });
      const hospital = await db.collection('hospitals').findOne({ id: account.tenant_id });
      if (!activeAccount(account, hospital)) return response.status(401).json({ error: 'Account access revoked.' });
      if (account.force_password_change && !['/api/v1/auth/change-password','/api/v1/auth/logout'].includes(request.path)) return response.status(403).json({ code: 'PASSWORD_CHANGE_REQUIRED', error: 'Change your temporary password before continuing.' });
    }
    response.locals.account = account;
    response.locals.claims = claims;
    next();
  };
}

app.get('/api/v1/health', async (_request, response) => {
  await db.command({ ping: 1 });
  response.json({ status: 'ok', service: 'pushkar-clinic-api', database: 'mongodb', migration_complete: false });
});
app.get('/api/v1/branding', async (_request, response) => {
  const settings = await db.collection('platform_settings').find({ is_public: true, key: { $in: ['platform_name','platform_logo'] } }).toArray();
  const values = Object.fromEntries(settings.map(row => [row.key, row.value]));
  response.json({ name: values.platform_name ?? 'Pushkar Clinic', logo: values.platform_logo ?? '' });
});
app.post('/api/v1/admin/auth/login', rateLimit, async (request, response) => {
  const body = z.object({ username: z.string().trim().min(3).max(100), password: z.string().min(8).max(200) }).parse(request.body);
  const account = await db.collection('super_admin_users').findOne({ username: body.username.toLowerCase(), is_active: true });
  if (!account || !await verifyPassword(body.password, account.password_hash)) return response.status(401).json({ error: 'Invalid username or password.' });
  const token = await issueSession(account, 'careframe-superadmin', { username: account.username, role: 'super_admin' });
  await db.collection('super_admin_users').updateOne({ id: account.id }, { $set: { last_login_at: new Date() } });
  response.json({ token, user: { id: account.id, username: account.username, name: account.display_name } });
});
app.get('/api/v1/admin/me', authenticate('careframe-superadmin'), (_request, response) => {
  const account = response.locals.account;
  response.json({ id: account.id, username: account.username, name: account.display_name });
});
app.post('/api/v1/auth/login', rateLimit, async (request, response) => {
  const body = loginSchema.parse(request.body);
  const identifier = body.identifier.toLowerCase();
  const candidates = await db.collection('users').find({ $or: [{ email: identifier }, { phone: body.identifier }], is_active: true }).limit(2).toArray();
  const account = candidates.length === 1 ? candidates[0] : null;
  const hospital = account ? await db.collection('hospitals').findOne({ id: account.tenant_id }) : null;
  const branch = account ? await db.collection('branches').findOne({ id: account.branch_id, tenant_id: account.tenant_id, is_active: true }) : null;
  const portal = authorizedPortal(account, body.portal);
  if (!account || !branch || !activeAccount(account, hospital) || !portal || !await hasActiveRole(account) || !await verifyPassword(body.password, account.password_hash)) return response.status(401).json({ error: 'Invalid login details, role, or hospital access.' });
  const token = await issueSession(account, 'careframe-portal', { tenantId: account.tenant_id, branchId: account.branch_id, role: account.role, portal });
  const activityId = randomUUID();
  await db.collection('login_activity').insertOne({ id: activityId, tenant_id: account.tenant_id, user_id: account.id, role: account.role, branch_id: account.branch_id, login_status: 'Success', login_time: new Date() });
  const modules=await db.collection('platform_modules').find({code:{$in:hospital.modules??[]},is_active:true},{projection:{code:1}}).toArray();
  response.json({ token, forcePasswordChange: Boolean(account.force_password_change), loginActivityId: activityId,
    user: { id: account.id, name: `${account.first_name} ${account.last_name}`.trim(), email: account.email, phone: account.phone, role: account.role, portal },
    hospital: { id: hospital.id, name: hospital.name, code: hospital.code, logoUrl: hospital.logo_url ?? '', status: hospital.status, branchId: branch.id, branchName: branch.name, settings: hospital.settings ?? {} },
    modules: modules.map(row=>row.code),
  });
});
app.post('/api/v1/auth/change-password', authenticate('careframe-portal'), async (request, response) => {
  const body = z.object({ currentPassword: z.string().min(8).max(200), newPassword: z.string().min(12).max(200) }).parse(request.body);
  const account = response.locals.account;
  if (body.currentPassword === body.newPassword || !await verifyPassword(body.currentPassword, account.password_hash)) return response.status(400).json({ error: 'Verify the current password and choose a different new password.' });
  const password_hash = await hashPassword(body.newPassword);
  await transaction(async session => {
    const result = await db.collection('users').updateOne({ id: account.id, tenant_id: account.tenant_id, password_hash: account.password_hash }, {
      $set: { password_hash, force_password_change: false, updated_at: new Date() }, $inc: { session_version: 1 },
    }, { session });
    if (!result.matchedCount) throw Object.assign(new Error('Account changed. Sign in again.'), { status: 409 });
    await db.collection('sessions').deleteMany({ user_id: account.id }, { session });
    await db.collection('audit_events').insertOne({ id: randomUUID(), tenant_id: account.tenant_id, actor_id: account.id, action: 'password_changed', created_at: new Date() }, { session });
  });
  response.status(204).end();
});
app.post('/api/v1/auth/logout', authenticate('careframe-portal'), async (_request, response) => {
  await db.collection('sessions').deleteOne({ _id: response.locals.claims.jti, user_id: response.locals.account.id });
  response.status(204).end();
});
app.post('/api/v1/admin/auth/logout', authenticate('careframe-superadmin'), async (_request, response) => {
  await db.collection('sessions').deleteOne({ _id: response.locals.claims.jti, user_id: response.locals.account.id });
  response.status(204).end();
});
app.use('/api/v1/admin', authenticate('careframe-superadmin'), provisioning,platform);
app.use('/api/v1/access-control',authenticate('careframe-portal'),accessControl);
app.get('/api/v1/session/events',authenticate('careframe-portal'),accessEvents);
app.use('/api/v1/patients',authenticate('careframe-portal'),patients);
app.use('/api/v1/hospital-management',authenticate('careframe-portal'),pharmacyMasters,diagnosticMasters,management);
app.use('/api/v1/clinical',authenticate('careframe-portal'),clinical,inpatient,receptionDischarge);
app.use('/api/v1/hospital-admin',authenticate('careframe-portal'),settings);
app.use('/api/v1/operations',authenticate('careframe-portal'),finance,financePosting,inventory,pharmacyStock);
app.use('/api/v1/workforce',authenticate('careframe-portal'),workforce);
app.use('/api/v1/cancellations',authenticate('careframe-portal'),cancellations);
app.use('/api/v1/doctor',authenticate('careframe-portal'),doctor,doctorDischarge);
app.use('/api/v1/workspaces',authenticate('careframe-portal'),laboratory,labResults,labReports,nursing,nursingTasks);
app.use('/api/v1/lab-report-shares',publicReports);
// Never route unconverted workflows into PostgreSQL or return fake empty success.
app.use('/api', (_request, response) => response.status(501).json({ code: 'MONGODB_WORKFLOW_PENDING', error: 'This workflow is not yet converted to MongoDB. This build is not ready for clinic use.' }));
app.use((error, _request, response, _next) => {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Check the submitted values.', fields: error.issues.map(issue => issue.path.join('.')) });
  if (error?.code === 11000) return response.status(409).json({ error: 'A record with these details already exists.' });
  if (error instanceof SyntaxError && 'body' in error) return response.status(400).json({ error: 'Invalid JSON.' });
  if ([400,401,403,404,409,422,429,501,503].includes(error?.status)) return response.status(error.status).json({ error: error.message, ...(error.code?{code:error.code}:{}),...error.details });
  // Driver error messages can contain hosts or credentials. Do not print them.
  console.error('MongoDB request failed', error?.name ?? 'Error');
  response.status(500).json({ error: 'Request failed. Check the server configuration.' });
});
export default app;
