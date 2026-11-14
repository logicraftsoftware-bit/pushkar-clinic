import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { patientAppSettingsInput } from '../patient-app/settings-schema.mjs';
import {
  maskSettings,
  preserveSettingsSecrets,
  secretMask,
} from '../settings-secrets.mjs';

function check(overrides) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(
        new URL('../config.mjs', import.meta.url).href
      )});console.log('CONFIG_OK');`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ENV_FILE: new URL('./missing-patient-config.env', import.meta.url)
          .pathname,
        MONGODB_URI: 'mongodb://127.0.0.1:1/',
        MONGODB_DB: 'pushkar_test_patient_config',
        JWT_SECRET: 'synthetic-config-test-secret-not-for-production',
        FRONTEND_ORIGIN: 'https://tests.example.invalid',
        NODE_ENV: 'production',
        PATIENT_APP_OTP_MODE: 'disabled',
        PATIENT_APP_SMS_WEBHOOK_URL: '',
        PATIENT_APP_SMS_WEBHOOK_SECRET: '',
        PATIENT_APP_PUSH_WEBHOOK_URL: '',
        PATIENT_APP_PUSH_WEBHOOK_SECRET: '',
        ...overrides,
      },
    }
  );
}
// Empty optional settings must be absent, not empty strings, for strict URL validation.
function configResult(overrides) {
  const env = { ...overrides };
  for (const key of [
    'PATIENT_APP_SMS_WEBHOOK_URL',
    'PATIENT_APP_SMS_WEBHOOK_SECRET',
    'PATIENT_APP_PUSH_WEBHOOK_URL',
    'PATIENT_APP_PUSH_WEBHOOK_SECRET',
  ])
    if (!(key in env)) env[key] = undefined;
  return check(env);
}
test('production rejects development OTPs and provider setup is explicit', () => {
  assert.equal(configResult({}).status, 0);
  const unsafe = configResult({ PATIENT_APP_OTP_MODE: 'development' });
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /PATIENT_APP_OTP_MODE/);
  assert.ok(
    !unsafe.stderr.includes('synthetic-config-test-secret-not-for-production')
  );
  assert.equal(
    configResult({
      NODE_ENV: 'development',
      PATIENT_APP_OTP_MODE: 'development',
    }).status,
    0
  );
  assert.notEqual(configResult({ PATIENT_APP_OTP_MODE: 'webhook' }).status, 0);
  assert.equal(
    configResult({
      PATIENT_APP_OTP_MODE: 'webhook',
      PATIENT_APP_SMS_WEBHOOK_URL: 'https://sms.example.invalid/send',
      PATIENT_APP_SMS_WEBHOOK_SECRET: 'synthetic-sms-hook-secret-32-characters',
    }).status,
    0
  );
  assert.notEqual(
    configResult({
      PATIENT_APP_PUSH_WEBHOOK_URL: 'https://push.example.invalid/send',
    }).status,
    0
  );
  assert.notEqual(
    configResult({
      PATIENT_APP_OTP_MODE: 'webhook',
      PATIENT_APP_SMS_WEBHOOK_URL: 'http://sms.example.invalid/send',
      PATIENT_APP_SMS_WEBHOOK_SECRET: 'synthetic-sms-hook-secret-32-characters',
    }).status,
    0
  );
});
test('clinic publication settings reject undeclared values and gateway webhook secrets are masked', () => {
  assert.equal(
    patientAppSettingsInput.safeParse({
      enabled: true,
      public_profile: { password: 'not-public' },
    }).success,
    false
  );
  assert.equal(
    patientAppSettingsInput.safeParse({ booking_fee: -1 }).success,
    false
  );
  assert.equal(
    patientAppSettingsInput.safeParse({
      public_profile: {
        opening_hours: [{ day: 'Mon', opens: '29:00', closes: '18:00' }],
      },
    }).success,
    false
  );
  const privateSettings = {
    gateways: {
      Razorpay: {
        api_key: 'synthetic-key',
        password: 'synthetic-password',
        webhook_secret: 'synthetic-webhook-secret',
      },
    },
  };
  const safe = maskSettings(privateSettings);
  assert.equal(safe.gateways.Razorpay.webhook_secret, secretMask);
  assert.deepEqual(
    preserveSettingsSecrets(safe, privateSettings),
    privateSettings
  );
});
