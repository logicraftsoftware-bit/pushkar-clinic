# Native MongoDB runtime

The deployment entry is `hosting.mjs`, which imports `hosting-mongo.mjs`: React static assets and the native API in `server/mongo/` run on one managed Hostinger port. The runtime does not load `server/dist/app.js`, PostgreSQL pools or a SQL emulation layer. Legacy TypeScript source remains for compatibility tests.

## Workflow coverage

- Authentication: scrypt passwords, first-owner bootstrap, persistent login limits, revocable sessions, current role/account checks and live access events.
- Administration: plans, modules, clinic provisioning, branches, roles, staff accounts, schedules, settings, profile, master setup, documents, activity history and print templates.
- Reception and clinical care: patients/UHIDs, duplicate checks, booking, capacity/availability, check-in, queues, IPD beds/deposits/transfers, doctor consultations, prescriptions, ward nursing, MAR, care plans, handovers and discharge clearance.
- Laboratory: catalogues, branch prices, new patients, clinician-request billing, edits, payment receipts, sample collection, barcodes, processing, result validation, reference snapshots, approval locks, reports, canonical PDF shares, retry-safe printing, QC and accreditation.
- Operations: invoices/payments/expenses/refunds, cancellation approvals, credit notes, insurance, HR/payroll/attendance, inventory purchases/transfers, pharmacy catalogues/purchases/batches/adjustments, prescription-to-POS billing, forecasts, OT, dietary and referral wallets/withdrawals.
- Portals: scoped staff overviews, protected task notes, broker login and explicitly UHID-linked patient accounts. Patient views exclude draft clinical notes, unapproved laboratory results and other patients' data.
- CRM: connection/key management, directory lookup, tenant-bound mappings, atomic synchronization and slot-safe appointment requests. Local clinical/financial records and UHIDs cannot be overwritten by arbitrary external data.
- AI: Groq chat, SOAP drafts, handwriting and accountant financial summaries. Inputs and responses are bounded; clinical drafts are not saved automatically; totals come from authorized native records.

## Preserved boundaries

Generating a pharmacy bill records an invoice; it does not itself dispense stock or collect payment. Purchases and stock adjustments are separate audited operations. No new automatic dispensing/return behavior was added merely by changing databases.

Direct IPD discharge is prohibited: doctor recommendation, nursing clearance and financial clearance must complete first. Direct cancellation is limited to admissions without treatment history or payments and preserves accrued ledger charges. Paid/treated cases use discharge and accounting reconciliation. Patient accounts require an explicit UHID link instead of ambiguous email/phone matching.

Device Integration task notes retain the original metadata workflow. A physical analyzer or PACS connection requires its actual device/provider contract; this migration does not simulate machine results or claim a hardware connection exists.

## Verification

[CI run 41179634972](https://github.com/logicraftsoftware-bit/pushkar-clinic/actions/runs/41179634972) passed the full build/compatibility job, 57 native test outcomes, mocked CRM/AI integration and native managed-hosting smoke checks at revision `001bee3`. Final entry-point and identity checks are also run on subsequent pushes; consult the latest GitHub Actions result for the deployed revision.

The dependency-free Node suite checks money, permissions, password verification, clinical invariants and provider error handling. Cloud integration tests use a disposable MongoDB replica set and synthetic records. They exercise concurrency, replay protection, stale edits, approval locks, tenant/branch isolation and transaction rollback. Provider requests in those tests are blocked unless explicitly mocked. Hosting checks cover API health, React routes, first-owner login and graceful shutdown through the real entry file.

These checks are not a complete manual browser acceptance review. Live Atlas connectivity, DNS/HTTPS and real CRM/Groq/Razorpay account behavior require private deployment configuration and a synthetic acceptance check on the hosted app. No real patient data, Atlas writes or real provider credentials were used for source verification. No application dependencies, local database or local app service were installed.

## Connection and first login

Follow [HOSTINGER.md](HOSTINGER.md) and [.env.example](.env.example). Use the new `pushkar_clinic` Atlas database and new application credentials. First-owner bootstrap can use private hPanel variables or the stdin-based server script; neither resets an existing owner. Configure this clinic's own accounts, masters, external CRM and provider keys after deployment. No previous-client patients, users, bills or operational records are imported.
