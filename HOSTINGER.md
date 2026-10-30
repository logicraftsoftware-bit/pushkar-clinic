# Pushkar Clinic deployment status

This checkout is a React/Vite frontend and an Express/TypeScript API inherited from another clinic. **It is not ready for MongoDB production deployment.** No database, account, service, or dependency has been installed locally.

## Hostinger Cloud Hosting

Use hPanel's **Node.js web app** deployment, not a static-only website upload. Hostinger supports managed Node.js apps on eligible Business and Cloud plans:
https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/

After the database conversion and validation are complete, use these application settings:

| Setting | Value |
| --- | --- |
| Repository | `https://github.com/logicraftsoftware-bit/pushkar-clinic.git` |
| Project root | Repository root |
| Node.js | 22 |
| Install command | `npm ci --include=dev` |
| Build command | `npm run build:hostinger` |
| Start command | `npm start` |
| Entry point, if requested | `hosting.mjs` |
| Health endpoint | `/api/v1/health` |

The entry point serves `dist/` and delegates `/api/*` to the backend on one port. React routes such as `/superadmin` load the SPA. Hostinger's `PORT` environment variable takes precedence over `API_PORT`. Leave `VITE_API_URL` unset to use the same origin. Keep both root and server build artifacts in the deployment. The server build needs dev dependencies for TypeScript.

Do not enable live deployment yet. These settings prepare the packaging; they do not make the current PostgreSQL backend work with MongoDB.

## Database conversion required

There is no MongoDB driver, model layer, or MongoDB account in this source. `DATABASE_URL` is used by the PostgreSQL driver. Replacing it with an Atlas URI will fail; configuration now rejects this clearly.

The requested MongoDB conversion must replace more than 1,000 SQL call sites, SQL migrations, PostgreSQL `crypt()` password verification, joins, tenant transaction context, triggers/audit logging, enums, and LISTEN/NOTIFY access events. This includes authentication, patients, appointments, billing, laboratory, pharmacy, inventory, HR, reporting, and admin APIs. MongoDB tenant filtering, unique indexes, transactional money/inventory updates, and live account revocation need equivalent behavior and tests.

Use a separate MongoDB Atlas project/database and application user for this client. Enter its eventual connection URI only in Hostinger's private environment settings, never in source or any `VITE_*` variable. No MongoDB account was created or changed in this task. Do not reuse another client's database or copy patient records.

## Configuration after conversion

- `NODE_ENV=production`
- `FRONTEND_ORIGIN=https://YOUR-CLINIC-DOMAIN`
- `JWT_SECRET`: a new, random secret of at least 32 characters, unique to this clinic
- Database URI: configure the variable implemented by the completed MongoDB adapter; it does not exist yet
- `CRM_INTEGRATION_ENABLED=false` until this client's integration is configured
- Optional Groq API key/models only if this client needs AI functionality; omit unused optional keys

The existing `.env.example` describes the **legacy PostgreSQL backend**, not the requested MongoDB deployment. Do not upload that file unchanged as production credentials.

## Client-data cleanup

Old catalogs, embedded doctor rosters, referral partner records, user-account seeds, sample hospital data, patient-specific discharge repairs, old work summaries and previous-client deployment workflows were removed. Startup no longer imports the old catalogs. Reusable UI, API workflows and schema definitions remain. No user or patient records are bundled. Tests that depended on the removed spreadsheets were removed or replaced with synthetic fixtures.

New users, patients, doctors, partners, prices and hospital details must be entered for this clinic after MongoDB conversion. Do not run the legacy PostgreSQL migrations against MongoDB.

## Verification

No local application or database was started and no dependencies were installed. A GitHub CI workflow builds both packages and runs the existing tests on GitHub runners. Review its results before deployment. Full functional testing on the new MongoDB database remains required; this preparation does not claim that the application is production-ready.
