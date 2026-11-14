import { Router } from 'express';
import { z } from 'zod';
import { rateLimit, operations } from './common.mjs';
import { authenticate, authRouter, registerLogout } from './auth.mjs';
import { registerDirectory } from './directory.mjs';
import { registerProfiles } from './profiles.mjs';
import { registerBookings } from './bookings.mjs';
import { registerPayments } from './payments.mjs';
import { registerRecords } from './records.mjs';
import { registerAccount } from './account.mjs';
export { patientAppAdmin } from './admin.mjs';
export { paymentWebhookRouter } from './payments.mjs';

export function patientAppOpenAPI() {
  const paths = {};
  for (const operation of operations) {
    const path = operation.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}'),
      parameters = [
        ...operation.path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g),
      ].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
    if (operation.idempotent)
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      });
    if (path.includes('/webhooks/'))
      parameters.push({
        name: 'X-Razorpay-Signature',
        in: 'header',
        required: true,
        schema: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
      });
    (paths[path] ??= {})[operation.method] = {
      summary: operation.summary,
      operationId:
        operation.method + '_' + operation.path.replace(/[^a-z0-9]/gi, '_'),
      tags: [
        path.includes('patient-app-admin')
          ? 'Clinic administration'
          : path.includes('/webhooks/')
          ? 'Payment webhook'
          : path.split('/')[4] ?? 'Patient app',
      ],
      security: operation.public
        ? []
        : [
            {
              [path.includes('patient-app-admin')
                ? 'StaffBearer'
                : 'PatientBearer']: [],
            },
          ],
      ...(parameters.length ? { parameters } : {}),
      ...(operation.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: z.toJSONSchema(operation.body, {
                    io: 'input',
                    unrepresentable: 'any',
                  }),
                },
              },
            },
          }
        : {}),
      responses: {
        200: {
          description:
            'Success; some creation routes return 201 or 202 and deletion routes return 204. See the API guide.',
        },
        400: { description: 'Validation failed' },
        401: { description: 'Invalid or revoked session/signature' },
        403: { description: 'Access is not allowed' },
        404: { description: 'Resource unavailable or not owned' },
        409: {
          description:
            'Expired hold, stale data, idempotency conflict or workflow restriction',
        },
        429: { description: 'Rate limit exceeded' },
        503: { description: 'Provider not configured or unavailable' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Pushkar Clinic Patient App API',
      version: '1.0.0',
      description:
        'Patient APIs for all 24 mobile screens. Patient and staff JWT audiences are separate. All clinical access requires an explicit profile-to-clinic link. Providers are disabled until configured.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        PatientBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Patient access_token from OTP verification; staff tokens are not accepted.',
        },
        StaffBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Existing clinic staff login token, with per-route role, permission, module and branch checks.',
        },
      },
    },
    paths,
  };
}
const router = Router();
router.use(async (req, _res, next) => {
  try {
    await rateLimit('patient-app-ip:' + req.ip, 600, 60);
    next();
  } catch (error) {
    next(error);
  }
});
registerDirectory(router);
router.use(authRouter);
router.get('/openapi.json', (_req, res) => res.json(patientAppOpenAPI()));
router.use(authenticate);
registerProfiles(router);
registerBookings(router);
registerPayments(router);
registerRecords(router);
registerAccount(router);
registerLogout(router);
export default router;
