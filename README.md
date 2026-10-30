# Careframe Hospital ERP

> Pushkar Clinic copy: read [HOSTINGER.md](HOSTINGER.md) before deploying. The requested MongoDB conversion is outstanding; this inherited backend still requires PostgreSQL. Previous-client records and VPS workflows have been removed.

A modern React and TypeScript foundation for a multi-role hospital operations platform.

## Development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

Set `VITE_API_URL` to connect the dashboard data layer to the backend API.

## PostgreSQL and API

Copy `.env.example` to `.env`, replace the development password, then start PostgreSQL:

```bash
docker compose up -d postgres
```

Install and run the API:

```bash
cd server
npm install
npm run dev
```

Verify the connection at `http://localhost:4000/api/v1/health`.

## Phase 1: Super Admin

The database-backed Super Admin panel is available at:

```text
http://localhost:5173/superadmin
```

It includes hospital provisioning, subscriptions, module controls, platform
settings, SaaS reports, monitoring, and authenticated platform analytics.

For Windows development without Docker, initialize a PostgreSQL 17 cluster on a
free local port and apply every SQL file in `database/migrations` in filename
order. The checked-in Docker Compose setup publishes PostgreSQL on port `5433`
to avoid conflicting with a default installation on `5432`.
