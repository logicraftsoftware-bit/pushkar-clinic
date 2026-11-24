import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID, randomInt, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db, transaction } from '../database.mjs';
import {hashPassword,verifyPassword} from '../security.mjs';
import {smsAvailable,smsSettings,sendGatewayOtp} from './sms-gateway.mjs';
import { config } from '../config.mjs';
import {verifyFirebasePhoneToken} from './firebase.mjs';
import {
  audit,
  equalSecret,
  fail,
  phone,
  rateLimit,
  route,
  safeProfile,
  secretHash,
  uuid,
} from './common.mjs';

const audience = 'careframe-patient-mobile',
  issuer = 'careframe-api';
const refreshToken = () => randomBytes(32).toString('base64url');
function accessToken(account, session) {
  return jwt.sign(
    { jti: session.id, version: session.version },
    config.JWT_SECRET,
    {
      issuer,
      audience,
      subject: account.id,
      algorithm: 'HS256',
      expiresIn: Math.min(
        900,
        Math.floor((session.expires_at.getTime() - Date.now()) / 1000)
      ),
    }
  );
}
async function issue(account, session) {
  const token = refreshToken(),
    row = {
      id: randomUUID(),
      account_id: account.id,
      refresh_hash: secretHash(token),
      version: 0,
      expires_at: new Date(Date.now() + 30 * 86400000),
      created_at: new Date(),
    };
  await db.collection('mobile_sessions').insertOne({ ...row }, { session });
  return {
    access_token: accessToken(account, row),
    refresh_token: token,
    token_type: 'Bearer',
    expires_in: 900,
  };
}
export async function validateSession(request) {
  let claims;
  try {
    claims = jwt.verify(
      request.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '',
      config.JWT_SECRET,
      { issuer, audience, algorithms: ['HS256'] }
    );
  } catch {
    throw fail('Patient session expired or invalid.', 401);
  }
  if (
    typeof claims !== 'object' ||
    typeof claims.sub !== 'string' ||
    typeof claims.jti !== 'string'
  )
    throw fail('Patient session expired or invalid.', 401);
  const [session, account] = await Promise.all([
    db.collection('mobile_sessions').findOne({
      id: claims.jti,
      account_id: claims.sub,
      version: claims.version,
      expires_at: { $gt: new Date() },
    }),
    db
      .collection('mobile_accounts')
      .findOne({ id: claims.sub, status: 'Active' }),
  ]);
  if (!session || !account) throw fail('Patient session access revoked.', 401);
  return { account, session };
}
export async function authenticate(request, response, next) {
  try {
    Object.assign(response.locals, await validateSession(request));
    await rateLimit(`api:${response.locals.account.id}`, 600, 60);
    next();
  } catch (error) {
    next(error);
  }
}

export const authRouter = Router();
route(
  authRouter,
  'post',
  '/auth/otp/request',
  'Request a patient login OTP',
  async (req, res) => {
    if (!await smsAvailable() && config.PATIENT_APP_OTP_MODE !== 'development')
      throw fail('SMS login is not configured yet.', 503, 'SMS_NOT_CONFIGURED');
    const mobile = req.input.phone;
    await rateLimit(`otp-ip:${req.ip}`, 20);
    await rateLimit(`otp-phone:${mobile}`, 5);
    const purpose=req.input.purpose;
    let pending;
    if(purpose==='register'){
      if(!req.input.name||!req.input.password)throw fail('Enter your name and password.');
      pending={name:req.input.name,email:req.input.email??'',password_hash:await hashPassword(req.input.password)};
    }
    const existing=await db.collection('mobile_accounts').findOne({phone:mobile});
    const eligible=purpose==='legacy'||purpose==='register'?!existing||purpose==='legacy':existing?.status==='Active';
    // Do not return a fake OTP challenge when no SMS will be sent. Keep the
    // guidance the same for login, registration, and recovery to avoid exposing
    // whether a number is registered.
    if(!eligible)throw fail('No OTP was sent. If this is your first time using the app, choose Register / Create Account. Otherwise, check that you entered the mobile number used for your patient-app account.',400,'OTP_ACCOUNT_ACTION_REQUIRED');
    const now = new Date(),
      cooldown = await db
        .collection('mobile_otp_cooldowns')
        .findOneAndUpdate(
          { _id: secretHash(mobile), next_at: { $lte: now } },
          { $set: { next_at: new Date(Date.now() + 60000) } },
          { returnDocument: 'after' }
        );
    if (!cooldown) {
      try {
        await db.collection('mobile_otp_cooldowns').insertOne({
          _id: secretHash(mobile),
          next_at: new Date(Date.now() + 60000),
        });
      } catch (error) {
        if (error.code === 11000)
          throw fail('Wait 60 seconds before requesting another OTP.', 429);
        throw error;
      }
    }
    const id = randomUUID(),
      code = String(randomInt(100000, 1000000)),
      expires_at = new Date(Date.now() + 300000);
    await db.collection('mobile_otps').insertOne({
      id,
      phone: mobile,
      code_hash: secretHash(id + ':' + code),
      attempts: 0,
      consumed_at: null,
      expires_at,
      state: 'Sending',
      purpose,pending,eligible,
    });
    if ((await smsSettings())?.enabled || config.PATIENT_APP_OTP_MODE === 'webhook') {
      try {
        if(eligible && (await smsSettings())?.enabled)await sendGatewayOtp(mobile,code);
        else if(eligible){
        const result = await fetch(config.PATIENT_APP_SMS_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.PATIENT_APP_SMS_WEBHOOK_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phone: mobile,
            code,
            challenge_id: id,
            expires_in: 300,
            language: req.input.language,
          }),
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        });
        if (!result.ok) throw Error('SMS rejected');
        }
      } catch {
        await db
          .collection('mobile_otps')
          .updateOne({ id }, { $set: { state: 'Failed' } });
        throw fail(
          'OTP delivery failed. Try again after one minute.',
          503,
          'SMS_DELIVERY_FAILED'
        );
      }
    }
    await db
      .collection('mobile_otps')
      .updateMany(
        { phone: mobile, id: { $ne: id }, consumed_at: null },
        { $set: { state: 'Superseded' } }
      );
    await db
      .collection('mobile_otps')
      .updateOne({ id }, { $set: { state: 'Ready' } });
    res.status(202).json({
      challenge_id: id,
      expires_in: 300,
      resend_after: 60,
      phone: mobile.slice(0, 3) + '******' + mobile.slice(-4),
      ...(config.PATIENT_APP_OTP_MODE === 'development' &&
      config.NODE_ENV !== 'production'
        ? { development_code: code }
        : {}),
    });
  },
  {
    public: true,
    body: z
      .object({ phone, language: z.enum(['en', 'hi', 'bn']).prefault('en'),purpose:z.enum(['legacy','login','register','reset']).prefault('legacy'),name:z.string().trim().min(2).max(120).optional(),email:z.string().email().max(200).optional(),password:z.string().min(12).max(128).optional() })
      .strict(),
  }
);

route(
  authRouter,
  'post',
  '/auth/otp/verify',
  'Verify OTP and create a patient session',
  async (req, res) => {
    await rateLimit(`otp-verify:${req.ip}`, 30);
    const input = req.input,
      challenge = await db.collection('mobile_otps').findOneAndUpdate(
        {
          id: input.challenge_id,
          state: 'Ready',
          consumed_at: null,
          expires_at: { $gt: new Date() },
          attempts: { $lt: 5 },
        },
        { $inc: { attempts: 1 } },
        { returnDocument: 'after' }
      );
    // Attempts are committed outside the transaction, including on invalid codes.
    if (
      !challenge ||
      !equalSecret(
        challenge.code_hash,
        secretHash(challenge.id + ':' + input.code)
      )
    )
      throw fail('OTP is invalid or expired.', 401, 'INVALID_OTP');
    const result = await transaction(async (session) => {
      const consumed = await db.collection('mobile_otps').updateOne(
        {
          id: challenge.id,
          state: 'Ready',
          consumed_at: null,
          expires_at: { $gt: new Date() },
        },
        { $set: { consumed_at: new Date() } },
        { session }
      );
      if (!consumed.modifiedCount) throw fail('OTP was already used.', 401);
      if(challenge.eligible===false)throw fail('Unable to verify this account. Check the number or use Register / Login as appropriate.',401);
      await db.collection('workflow_locks').updateOne({_id:`mobile-auth:${secretHash(challenge.phone)}`},{$inc:{version:1}},{session,upsert:true});
      const existing=await db.collection('mobile_accounts').findOne({phone:challenge.phone},{session});
      if(challenge.purpose==='reset'){
        if(!existing||existing.status!=='Active')throw fail('Unable to reset this account.',401);
        const token=refreshToken();
        await db.collection('mobile_password_resets').insertOne({_id:secretHash(token),account_id:existing.id,expires_at:new Date(Date.now()+300000),consumed_at:null},{session});
        return {reset_token:token,expires_in:300};
      }
      if(challenge.purpose==='register'){
        if(existing)throw fail('This mobile number already has an account. Use Login or Forgot password.',409);
        const result=await patientLogin(challenge.phone,session);
        await db.collection('mobile_accounts').updateOne({id:result.account.id},{$set:{password_hash:challenge.pending.password_hash,email:challenge.pending.email}},{session});
        await db.collection('mobile_profiles').updateOne({id:result.account.self_profile_id},{$set:{name:challenge.pending.name}},{session});
        result.profile.name=challenge.pending.name;return result;
      }
      if(challenge.purpose==='login'&&!existing)throw fail('Create an account first.',401);
      return patientLogin(challenge.phone, session);
    });
    res.json(result);
  },
  {
    public: true,
    body: z
      .object({ challenge_id: uuid, code: z.string().regex(/^\d{6}$/) })
      .strict(),
  }
);

route(
  authRouter,
  'post',
  '/auth/refresh',
  'Rotate patient refresh and access tokens',
  async (req, res) => {
    await rateLimit(`refresh:${req.ip}`, 60, 60);
    const result = await transaction(async (session) => {
      const old = await db.collection('mobile_sessions').findOne(
        {
          refresh_hash: secretHash(req.input.refresh_token),
          expires_at: { $gt: new Date() },
        },
        { session }
      );
      if (!old) throw fail('Refresh token expired or invalid.', 401);
      const account = await db
        .collection('mobile_accounts')
        .findOne({ id: old.account_id, status: 'Active' }, { session });
      if (!account) throw fail('Account access revoked.', 401);
      const fresh = refreshToken(),
        changed = await db.collection('mobile_sessions').findOneAndUpdate(
          {
            id: old.id,
            version: old.version,
            refresh_hash: old.refresh_hash,
          },
          { $set: { refresh_hash: secretHash(fresh) }, $inc: { version: 1 } },
          { session, returnDocument: 'after' }
        );
      if (!changed) throw fail('Refresh token was already used.', 401);
      return {
        access_token: accessToken(account, changed),
        refresh_token: fresh,
        token_type: 'Bearer',
        expires_in: Math.min(
          900,
          Math.floor((changed.expires_at.getTime() - Date.now()) / 1000)
        ),
      };
    });
    res.json(result);
  },
  {
    public: true,
    body: z
      .object({ refresh_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict(),
  }
);

export function registerLogout(router) {
  route(
    router,
    'post',
    '/auth/logout',
    'Revoke the current patient session',
    async (_req, res) => {
      await db.collection('mobile_sessions').deleteOne({
        id: res.locals.session.id,
        account_id: res.locals.account.id,
      });
      await db.collection('mobile_devices').deleteMany({
        account_id: res.locals.account.id,
        session_id: res.locals.session.id,
      });
      res.status(204).end();
    }
  );
}

// Reuse the same account, profile and session lifecycle for both verified phone providers.
async function patientLogin(mobile, session) {
      let account = await db
        .collection('mobile_accounts')
        .findOne({ phone: mobile }, { session });
      if (account && account.status !== 'Active')
        throw fail('Account is not active. Contact support.', 403);
      if (!account) {
        const now = new Date(),
          profileId = randomUUID();
        account = {
          id: randomUUID(),
          phone: mobile,
          status: 'Active',
          self_profile_id: profileId,
          preferences: {
            language: 'en',
            push_enabled: true,
            appointment_reminders: true,
            queue_alerts: true,
          },
          created_at: now,
          updated_at: now,
        };
        await db
          .collection('mobile_accounts')
          .insertOne({ ...account }, { session });
        await db.collection('mobile_profiles').insertOne(
          {
            id: profileId,
            account_id: account.id,
            name: '',
            date_of_birth: null,
            sex: 'Other',
            address: {},
            emergency_contact: {},
            relationship: 'Self',
            active: true,
            created_at: now,
            updated_at: now,
          },
          { session }
        );
      }
      await audit(account, 'patient_app_login', account.id, session);
      return {
        ...(await issue(account, session)),
        account: {
          id: account.id,
          phone: account.phone,
          self_profile_id: account.self_profile_id,
        },
        profile: safeProfile(
          await db
            .collection('mobile_profiles')
            .findOne(
              { id: account.self_profile_id, account_id: account.id },
              { session }
            )
        ),
      };
}
route(authRouter,'post','/auth/firebase','Exchange Firebase phone authentication for a patient session',async(req,res)=>{
  await rateLimit(`firebase-login:${req.ip}`,30);
  if(config.PATIENT_APP_FIREBASE_ENABLED!=='true'||!config.PATIENT_APP_FIREBASE_PROJECT_ID)throw fail('Firebase sign-in is not configured.',503);
  const identity=await verifyFirebasePhoneToken(req.input.id_token,config.PATIENT_APP_FIREBASE_PROJECT_ID);
  const mobile=phone.parse(identity.phone_number);
  const result=await transaction(async session=>{
    const account=await db.collection('mobile_accounts').findOne({phone:mobile},{session});
    if(account?.firebase_uid&&account.firebase_uid!==identity.sub)throw fail('Phone identity has changed. Contact support.',403);
    const response=await patientLogin(mobile,session);
    await db.collection('mobile_accounts').updateOne({id:response.account.id},{$set:{firebase_uid:identity.sub}},{session});
    return response;
  });
  res.json(result);
},{public:true,body:z.object({id_token:z.string().min(100).max(10000)}).strict()});

route(authRouter,'post','/auth/password/login','Sign in with mobile and password',async(req,res)=>{
  await rateLimit(`password-ip:${req.ip}`,20);await rateLimit(`password-phone:${secretHash(req.input.phone)}`,10);
  const account=await db.collection('mobile_accounts').findOne({phone:req.input.phone});
  const dummy='scrypt-v1$'+'0'.repeat(32)+'$'+'0'.repeat(128);
  const valid=await verifyPassword(req.input.password,account?.password_hash??dummy);
  if(!valid||account?.status!=='Active')throw fail('Mobile number or password is incorrect. You can also use Login with OTP.',401);
  const result=await transaction(async session=>{
    await db.collection('workflow_locks').updateOne({_id:`mobile-auth:${secretHash(req.input.phone)}`},{$inc:{version:1}},{session,upsert:true});
    const current=await db.collection('mobile_accounts').findOne({id:account.id},{session});
    if(current?.password_hash!==account.password_hash)throw fail('Password has changed. Sign in again.',401);
    return patientLogin(req.input.phone,session);
  });res.json(result);
},{public:true,body:z.object({phone,password:z.string().min(1).max(128)}).strict()});
route(authRouter,'post','/auth/password/reset','Set a new password after phone OTP verification',async(req,res)=>{
  await rateLimit(`password-reset:${req.ip}`,15);
  const password_hash=await hashPassword(req.input.password);
  const result=await transaction(async session=>{
    const grant=await db.collection('mobile_password_resets').findOneAndUpdate({_id:secretHash(req.input.reset_token),consumed_at:null,expires_at:{$gt:new Date()}},{$set:{consumed_at:new Date()}},{session,returnDocument:'before'});
    if(!grant)throw fail('Password reset expired or already used. Request a new OTP.',401);
    const account=await db.collection('mobile_accounts').findOne({id:grant.account_id,status:'Active'},{session});
    if(!account)throw fail('Account is not available.',401);
    await db.collection('workflow_locks').updateOne({_id:`mobile-auth:${secretHash(account.phone)}`},{$inc:{version:1}},{session,upsert:true});
    await db.collection('mobile_accounts').updateOne({id:account.id},{$set:{password_hash,updated_at:new Date()}},{session});
    await db.collection('mobile_sessions').deleteMany({account_id:account.id},{session});
    await db.collection('mobile_devices').deleteMany({account_id:account.id},{session});
    await db.collection('mobile_password_resets').updateMany({account_id:account.id,consumed_at:null},{$set:{consumed_at:new Date()}},{session});
    await audit(account,'patient_password_reset',account.id,session);
    return patientLogin(account.phone,session);
  });res.json(result);
},{public:true,body:z.object({reset_token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),password:z.string().min(12).max(128)}).strict()});
