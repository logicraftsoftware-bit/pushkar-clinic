# MongoDB conversion progress

This is an in-progress native MongoDB conversion, not a completed production release. The existing PostgreSQL workflows remain in `server/src/`. They must not be pointed at an Atlas URI. No existing-client records or users are imported.

## Implemented

`server/mongo/` contains a separate MongoDB backend with connection pooling, index initialization, a transaction helper, tenant-scoped repositories, scrypt password hashing, private first-administrator bootstrap, persistent login limits, revocable sessions, and native login/password-change/logout endpoints. Session validation checks current user activity, expiration, hospital status and session version. No SQL compatibility shim is used.

The native backend includes authentication, plan/clinic provisioning, patient registration/editing/search/deletion, branch-scoped custom roles and account administration, live access refresh, clinic setup, staff accounts, doctor schedules and appointment queues/booking/editing/check-in. IPD admission/editing, deposits, bed transfers, billing snapshots, doctor discharge recommendations, nursing clearance and reception discharge are implemented. Doctor consultations preserve completed records and synchronize diagnostic/prescription orders. Nursing supports ward assignments, charts, medication schedules and duplicate-safe administration outcomes, notes, care plans, handover and departmental requests.

Laboratory catalogues, branch-priced billing, collection, barcodes, measured results, reference snapshots, technician/doctor approval, canonical server-generated PDF sharing and retry-safe print confirmation are implemented. General invoices, receipts, expenses, tracked insurance claims, HR/payroll/attendance, inventory purchases/transfers, cancellation approvals, credit notes and approved refunds are implemented. Super Admin administration and operational settings are included. Pharmacy catalogues, suppliers, purchases, batches and audited stock adjustments are written; pharmacy sales/dispensing remain outstanding. These statements describe backend implementation and test coverage, not a complete frontend acceptance review. Unconverted routes explicitly fail. The full ERP is not ready to deploy.

## Cloud verification status

Both jobs passed for `1c81b8c`: [cloud validation](https://github.com/logicraftsoftware-bit/pushkar-clinic/actions/runs/41166728720). This verified the frontend/backend build and legacy tests, plus native MongoDB authentication, laboratory PDFs, custom roles, appointment editing, inventory movements, finance posting, HR/insurance tracking, cancellation/refunds, doctor consultations, ward nursing and discharge clearance. Tests exercise transactions, concurrent retries, stale edits, tenant/branch restrictions, approval locks and rollback. Pharmacy stock extensions passed their native MongoDB integration job at `8611548`; the full build and frontend retry-ID changes still need the corresponding successful run.

GitHub authentication and pushing work. No production Atlas connection, real account or existing-client data was used. No application dependencies or database server were installed locally.

## Still required before production

- Pharmacy prescription billing, POS, dispensing/returns and forecasting; complete pharmacy frontend acceptance checks.
- Laboratory order edits and billing of clinician-requested orders, remaining queue filters, QC, accreditation and device workflows.
- OT, dietary, referral partners/wallets, public self-registration and external integrations.
- Hospital/role dashboards, remaining reports, document/notification screens, charge/operation/bed master parity and print-template administration.
- Full frontend route compatibility, stale-edit handling and tenant/branch acceptance checks across the implemented modules; complete any workflow-specific gaps found by that audit.
- Optional clinical AI requires an explicitly configured provider. Its native routes currently return a configuration error and do not fabricate clinical text.
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

Policy tests run with Node's built-in test runner and require no database or dependency installation: `node --test server/mongo/tests/*.test.mjs`. GitHub CI runs those tests, the frontend/backend build, legacy tests and native integration tests against a disposable MongoDB replica set on an Ubuntu runner. Syntax checks alone do not establish workflow compatibility, and passing the implemented integration suite does not make unconverted routes production ready. Live Atlas connection testing requires private hosting configuration; no live credentials or database writes were used during this implementation.
