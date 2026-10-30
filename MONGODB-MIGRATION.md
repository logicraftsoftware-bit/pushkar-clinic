# MongoDB conversion progress

This is an in-progress native MongoDB conversion, not a completed production release. The existing PostgreSQL workflows remain in `server/src/`. They must not be pointed at an Atlas URI. No existing-client records or users are imported.

## Implemented

`server/mongo/` contains a separate MongoDB backend with connection pooling, index initialization, a transaction helper, tenant-scoped repositories, scrypt password hashing, private first-administrator bootstrap, persistent login limits, revocable sessions, and native login/password-change/logout endpoints. Session validation checks current user activity, expiration, hospital status and session version. No SQL compatibility shim is used.

The native backend now includes authentication, plan/clinic provisioning, patient registration/editing/search/deletion, branch-scoped permissions, clinic branches/departments/wards/rooms/beds, staff accounts, doctor schedules, appointment queues/booking/check-in, IPD admission/bed transfer with bed-rate history, operational settings and receipt views. Laboratory catalog editing, branch-priced order billing, retry-safe payment collection, barcode generation and sample collection are written. Super Admin dashboard, clinic list/detail/edit/archive, subscriptions, module controls, settings and reports are also written. Unconverted routes explicitly fail rather than returning fake success. The full ERP is not ready to deploy.

## Cloud verification status

Both jobs passed for commit `611a7bb`: [successful cloud validation](https://github.com/logicraftsoftware-bit/pushkar-clinic/actions/runs/41114440759). That run verified the existing frontend/backend build and legacy tests, plus the native MongoDB authentication, patients, staff/scheduling, concurrent appointments/check-in, IPD deposits, duplicate-admission rollback and bed transfer.

The newer laboratory/settings and Super Admin extensions have syntax checks and dependency-free tests, but still need a successful cloud integration run. GitHub requested device sign-in again before their push could complete. No production Atlas connection or data was used.

## Still required before production

- Cloud validation and frontend review of the newly written Super Admin/settings features; complete master deletion, custom roles and staff screen parity.
- RBAC permissions, branch restrictions, access event streams and audit coverage for business operations.
- Complete the remaining patient/frontend compatibility checks and accounting integrations.
- Appointment editing, IPD admission edits and discharge clearance, nursing, doctor consultation, OT and dietary workflows.
- General invoices/payments, cancellation approvals/refunds, accounting dashboards, referral wallets and inventory transactions. OPD check-in, IPD admission collections and lab receipt posting are implemented, pending the verification boundaries above.
- Laboratory order edits, result entry, technician/doctor verification, QC, accreditation and report release/sharing. Catalog/order billing/payment/sample collection code must complete cloud validation before use.
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

Security helper tests run with Node's built-in test runner and require no database or dependency installation: `node --test server/mongo/tests/*.test.mjs`. GitHub CI also runs them. Syntax checks do not establish end-to-end compatibility. GitHub CI runs integration tests against a disposable MongoDB process on an Ubuntu runner, initialized as a replica set for authentication, atomic provisioning and rollback, patient duplicate/tenant isolation, staff credential storage, concurrent appointment booking/check-in, password revocation and suspended-clinic access. The baseline integration suite passed for the commit linked above; later extensions still require validation. Live connection testing requires private hosting configuration; no live credentials or database writes were used during this implementation.
