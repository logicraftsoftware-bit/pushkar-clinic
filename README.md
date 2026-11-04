# Pushkar Clinic ERP

React/Vite frontend and native MongoDB Express API for `erp.pushkarpharmaceutical.com`.

Deployment, first-owner setup, Atlas, CRM and AI settings are in [HOSTINGER.md](HOSTINGER.md). [.env.example](.env.example) contains placeholders only; enter real values privately in Hostinger. No local application or database installation is needed.

Create new clinic users and configure this client's masters after first-owner login. No previous-client patients, accounts, bills or operational records are imported.

CI validates the build, legacy compatibility tests, native workflows on disposable MongoDB, mocked providers and managed-hosting startup. [MONGODB-MIGRATION.md](MONGODB-MIGRATION.md) records coverage and verification boundaries.

Build: `npm run build:hostinger`. Start: `npm start`. PostgreSQL source remains for compatibility tests, not for the native deployment's data store.

Staff instructions: [Clinic work process, appointment booking and doctor queue](docs/CLINIC-WORK-PROCESS.md). A [printable version](docs/CLINIC-WORK-PROCESS.html) is also included.
