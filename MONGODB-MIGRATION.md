# MongoDB conversion progress

This is an in-progress native MongoDB conversion, not a completed production release. The existing PostgreSQL workflows remain in `server/src/`. They must not be pointed at an Atlas URI. No existing-client records or users are imported.

## Implemented

`server/mongo/` contains a separate MongoDB backend with connection pooling, index initialization, a transaction helper, tenant-scoped repositories, scrypt password hashing, private first-administrator bootstrap, persistent login limits, revocable sessions, and native login/password-change/logout endpoints. Session validation checks current user activity, expiration, hospital status and session version. No SQL compatibility shim is used.

The native backend now includes authentication, plan and clinic provisioning, patient registration/detail editing/search/deletion, branch-scoped access, clinic branches/departments/wards/rooms/beds, staff login provisioning, doctor schedules, appointment slot lookup/booking, and transactional check-in/receipt posting. Duplicate patient overrides are audited; UHIDs are allocated from transactional counters. Unconverted endpoints still return HTTP 501. The full ERP is not ready to deploy.

## Still required before production

- Remaining Super Admin dashboard/reports, settings/module management, clinic editing, master deletion, custom roles and full staff frontend parity.
- RBAC permissions, branch restrictions, access event streams and audit coverage for business operations.
- Complete the remaining patient/frontend compatibility checks and accounting integrations.
- Appointment editing/search parity, IPD admission/transfer/discharge, nursing, doctor consultation, OT and dietary workflows.
- Invoices, payments, refunds, accounting, referral wallets and inventory transactions.
- Laboratory catalogs, order/sample/result/verification workflows and report sharing.
- Pharmacy, purchasing, HR, insurance and reporting.
- Full route compatibility and tenant-isolation tests against a disposable MongoDB database.
- Hostinger startup switch only after those checks pass.

## Atlas connection (when testing is requested)

Use the Atlas cluster already created for this project. Enter secrets only in the hosting server's private environment configuration:

```dotenv
MONGODB_URI=mongodb+srv://USERNAME:URL_ENCODED_PASSWORD@pushkar-clinic.z23i30y.mongodb.net/pushkar_clinic
MONGODB_DB=pushkar_clinic
FRONTEND_ORIGIN=https://erp.pushkarpharmaceutical.com
JWT_SECRET=REPLACE_WITH_A_NEW_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
NODE_ENV=production
```

Use a database user restricted to `pushkar_clinic` and allow the hosting server's outbound IP in Atlas Network Access. The automatic Atlas Admin user shown during onboarding is not the intended permanent application identity. Never commit these credentials or place them in a `VITE_*` variable. No real URI is required for source conversion.

After server dependencies are installed by the hosting build, `npm --prefix server run mongodb:check` pings Atlas without initializing records or indexes. This does not start a local database. Do not run it against production until the private hosting configuration is available.

`npm --prefix server run mongodb:bootstrap` accepts a single JSON object on stdin with `username`, `password` and `displayName`. Use a password of at least 12 characters. Supply it through a private server-side input mechanism; never place it in command arguments, repository files, CI logs or chat. Bootstrap creates one administrator only and refuses to reset an existing account. It initializes indexes and writes to Atlas, so connection checking alone should be used first.

The development command `npm --prefix server run start:mongo` starts only the incomplete MongoDB API; it is not a command to deploy the full ERP. The existing root Hostinger start command continues using the legacy backend until the workflow conversion is complete.

## Verification boundaries

Security helper tests run with Node's built-in test runner and require no database or dependency installation: `node --test server/mongo/tests/*.test.mjs`. GitHub CI also runs them. Syntax checks do not establish end-to-end compatibility. GitHub CI is configured to run integration tests against a disposable replica set for authentication, atomic provisioning and rollback, patient duplicate/tenant isolation, staff credential storage, concurrent appointment booking/check-in, password revocation and suspended-clinic access. This integration suite has not yet run. Live connection testing still requires private hosting configuration; no live credentials or database writes were used during this implementation.
