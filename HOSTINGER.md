# Hostinger Cloud deployment

Use the managed **Node.js web app** on Cloud Startup for `erp.pushkarpharmaceutical.com`. No VPS, Docker, PM2 or local installation is needed.

| Setting | Value |
| --- | --- |
| Repository / branch | `logicraftsoftware-bit/pushkar-clinic` / `production` |
| Root | Repository root |
| Framework | Express / Other |
| Node.js | 22 |
| Install | `npm ci --include=dev` |
| Build | `npm run build:hostinger` |
| Start | `npm start` |
| Entry if requested | `hosting.mjs` |
| Health check | `/api/v1/health` |

## Automatic deployment

`.github/workflows/deploy.yml` promotes the latest `main` revision to `production` only after **Validate project** passes. Older CI runs cannot promote over a newer main revision; promotion is fast-forward only. In hPanel, change the connected branch to **production** and enable auto-deployment. Hostinger's GitHub App handles deployment when this branch changes; no VPS action, SSH password or Hostinger API token is needed. The repository workflow cannot change your private hPanel setting.

`npm run build` and `npm run build:hostinger` both build the frontend, install server dependencies and compile compatibility sources. Build-time type declarations are included in production dependencies because hosting may omit devDependencies when `NODE_ENV=production`. CI explicitly checks this installation mode.

The server serves React and the MongoDB API on one port. Hostinger supplies `PORT`. Set `TRUST_PROXY_HOPS=1` for the hosting reverse proxy so login limits use the forwarded client IP; adjust only if Hostinger specifies a different proxy chain. Keep `VITE_API_URL` unset. Use Hostinger's [Node.js guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/) and [private environment settings](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/).

The HTTP listener starts before database initialization to meet Hostinger's three-second startup limit. React pages can load during an Atlas outage; API requests return a JSON 503 until connection, indexes and first-owner setup finish. Initialization retries automatically. TLS/SSL server-selection failures require checking Atlas Network Access for the hosting server's outbound IP and the private Atlas URI; adding your computer's IP does not allow the hosting server. See [Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/).

## Atlas and first owner

Set `MONGODB_URI`, `MONGODB_DB=pushkar_clinic`, `FRONTEND_ORIGIN=https://erp.pushkarpharmaceutical.com`, a new random `JWT_SECRET` of at least 32 characters, and `NODE_ENV=production`. The URI template is in [.env.example](.env.example). Enter values without surrounding quotes.

Use a new Atlas application user with `readWrite` restricted to `pushkar_clinic`; URL-encode reserved characters in its password. Add Hostinger's outbound IP addresses to Atlas Network Access. Ask Hostinger for them if the dashboard does not show them. `DATABASE_URL` is not the native database variable. Never put secrets in `VITE_*` variables or GitHub.

For the first deployment, privately set `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` (at least 12 characters), and `BOOTSTRAP_ADMIN_NAME`. Startup creates one owner only on an empty database. It never resets an existing owner. Sign in at `/superadmin`, then remove the bootstrap variables from hPanel and apply changes. Create this client's plan, clinic and clinic administrator in the app.

Startup initializes indexes and system module definitions, not old patients, users, bills or workflow events. No existing-client records or credentials are needed. Server-terminal `mongodb:check` and stdin-based `mongodb:bootstrap` scripts remain available as alternatives.

## CRM

Set `CRM_INTEGRATION_ENABLED=true` and `CRM_API_BASE_URL` to **this client's** HTTPS CRM API base. Its clinic directory is `<base>/patient/clinics`. Connect the clinic in Super Admin and save the once-displayed integration key privately in the CRM. Rotation invalidates the old key.

Send JSON to `POST /api/v1/crm-sync/bootstrap` using `x-api-key` or Bearer authentication. Arrays are `branches`, `departments`, `doctors`, `patients`, `appointments`; fields are in `server/mongo/crm-schema.mjs`. Dependencies must be mapped first or included earlier in the same payload. Doctors and appointments require mapped branches and departments; schedules use `HH:MM`, and appointment timestamps include an offset.

Sync is restricted to one clinic, ignores identical/older records and rolls back failed payloads. External medical record numbers are stored separately from immutable local UHIDs. Paid, checked-in or completed encounters cannot be overwritten. Availability and slot locks apply. Do not connect to another client's CRM data source.

## AI

Set `GROQ_API_KEY` privately. `GROQ_MODEL` controls chat, SOAP and financial summaries; `GROQ_VISION_MODEL` controls handwriting. Example IDs are in `.env.example`; availability depends on your provider account. See Groq's [chat API](https://console.groq.com/docs/api-reference) and [vision documentation](https://console.groq.com/docs/vision).

SOAP and handwriting return editable drafts; clinical saving still requires normal validation. SOAP needs an assigned encounter. Chat uses role-scoped aggregates without individual patient identifiers. Accountant reports use authorized branch records. Without a key, generation returns a configuration error; verified financial reporting remains available without generated prose.

The requested transcript or handwriting image is sent to Groq when an AI action is used. The patient database is not automatically uploaded.

## Domain and live checks

Select `erp.pushkarpharmaceutical.com` for this Node.js app. Complete ownership verification and the **erp-specific DNS records** Hostinger supplies. Keep the main website and mail records unchanged. Wait for HTTPS before signing in.

After deployment, check `/api/v1/health` reports MongoDB. Create the new clinic accounts and masters, then check synthetic registration, booking, lab results, billing and receipts before using real records. Check CRM with a new-client test payload and AI with synthetic text/images after adding provider settings.

CI uses disposable MongoDB and mocked providers. Live Atlas, domain and provider checks remain deployment steps; no real account or patient data is used in source verification. Legacy PostgreSQL source is retained for compatibility tests and is not the native runtime's data store.
