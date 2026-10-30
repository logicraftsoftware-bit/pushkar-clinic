import express from "express";
import {jsonCompression} from './json-compression.js';
import {patientNameResponse} from './patient-name-response.js';
import cancellationRouter from './cancellation-router.js';
import siteAuditRouter,{trackSiteRequest} from './site-audit.js';
import {enforceLiveAccount,liveAccessRouter} from './live-access.js';
import cors from "cors";
import helmet from "helmet";
import { ZodError } from "zod";
import { config } from "./config.js";
import { pool, queryOne } from "./db.js";
import { initializeDb } from "./db-init.js";
import superAdminRouter from "./super-admin.js";
import portalAuthRouter from "./portal-auth.js";
import hospitalManagementRouter from "./hospital-management.js";
import accessControlRouter from "./access-control.js";
import patientManagementRouter from "./patient-management.js";
import clinicalOperationsRouter from "./clinical-operations.js";
import financeInventoryRouter from "./finance-inventory.js";
import hrInsuranceRouter from "./hr-insurance.js";
import adminOperationsRouter from "./admin-operations.js";
import otModuleRouter from "./ot-module.js";
import referralSystemRouter from "./referral-system.js";
import hospitalDashboardRouter from "./hospital-dashboard.js";
import doctorPanelRouter from "./doctor-panel.js";
import rolePanelsRouter from "./role-panels.js";
import aiAssistantRouter from "./ai-assistant.js";
import selfRegistrationRouter from "./self-registration.js";
import dietaryRouter from "./dietary.js";
import crmIntegrationRouter from "./crm-integration.js";
import {publicReportRouter} from "./lab-report-sharing.js";

const app = express();

app.disable("x-powered-by");
app.set('trust proxy','loopback');
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.use(jsonCompression);
app.use(patientNameResponse);

// Block request processing until database is fully initialized
app.use(async (_req, response, next) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      initializeDb(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Database initialization is still in progress'), {code:'STARTUP_PENDING'})), 10000);
      }),
    ]);
    next();
  } catch (error) {
    if ((error as {code?: string}).code === 'STARTUP_PENDING') {
      response.set('Retry-After', '10').status(503).json({error:'The service is starting. Please try again shortly.'});
      return;
    }
    next(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
});

app.get("/api/v1/branding", async (_request, response) => {
  const result = await pool.query<{ key: string; value: unknown }>(
    `SELECT key::text, value FROM platform_settings
     WHERE is_public = true AND key IN ('platform_name', 'platform_logo')`,
  );
  const settings = Object.fromEntries(
    result.rows.map((row) => [row.key, row.value]),
  );
  response.set("Cache-Control", "no-store, max-age=0");
  response.json({
    name: settings.platform_name ?? "careframe",
    logo: settings.platform_logo ?? "",
  });
});

app.use(enforceLiveAccount);
app.use(trackSiteRequest);
app.use('/api/v1/session',liveAccessRouter);
app.use('/api/v1/activity',siteAuditRouter);
app.use("/api/v1/admin", superAdminRouter);
app.use("/api/v1/auth", portalAuthRouter);
app.use("/api/v1/self-registration", selfRegistrationRouter);
app.use("/api/v1/hospital-management", hospitalManagementRouter);
app.use("/api/v1/access-control", accessControlRouter);
app.use("/api/v1/patients", patientManagementRouter);
app.use("/api/v1/clinical", clinicalOperationsRouter);
app.use("/api/v1/operations", financeInventoryRouter);
app.use('/api/v1/cancellations',cancellationRouter);
app.use("/api/v1/workforce", hrInsuranceRouter);
app.use("/api/v1/hospital-admin", adminOperationsRouter);
app.use("/api/v1/ot", otModuleRouter);
app.use("/api/v1/referrals", referralSystemRouter);
app.use("/api/v1/dashboard", hospitalDashboardRouter);
app.use("/api/v1/doctor", doctorPanelRouter);
app.use("/api/v1/workspaces", rolePanelsRouter);
app.use("/api/v1/lab-report-shares",publicReportRouter);
app.use("/api/v1/ai-assistant", aiAssistantRouter);
app.use("/api/v1/dietary", dietaryRouter);
app.use("/api/v1/crm-sync", crmIntegrationRouter);

app.get("/api/v1/health", async (_request, response) => {
  const database = await queryOne<{ current_time: string; database: string }>(
    "SELECT now() AS current_time, current_database() AS database",
  );
  response.json({ status: "ok", service: "careframe-api", database });
});

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API endpoint not found' });
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      response.status(400).json({
        code: "VALIDATION_ERROR",
        error: issue?.message || "Please check the submitted values.",
        field: issue?.path?.join(".") || undefined,
        issues: error.issues.map(({ path, message, code }) => ({
          field: path.join("."),
          message,
          code,
        })),
      });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({
        code: "INVALID_JSON",
        error: "The request body contains invalid JSON.",
      });
      return;
    }
    const databaseError = error as {
      code?: string;
      constraint?: string;
    };
    if (databaseError?.code === "23505") {
      response.status(409).json({
        code: "DUPLICATE_RECORD",
        error: databaseError.constraint?.includes('email') ? 'This email is already registered. Use the existing account or a different email.' : databaseError.constraint?.includes('phone') ? 'This phone number is already registered. Find the existing patient or staff record.' : databaseError.constraint?.includes('rbac_roles') ? 'A role with this code already exists. Edit that role or choose a different code.' : 'This record already exists. Find the existing record before creating another.',
      });
      return;
    }
    const known = error as {status?:number;message?:string};
    if(known?.status && known.status>=400 && known.status<500){response.status(known.status).json({error:known.message});return;}
    console.error(error);
    response.status(500).json({ error: "Internal server error" });
  },
);

export default app;
