import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
dotenv.config({ path: process.env.ENV_FILE ?? fileURLToPath(new URL('../../.env', import.meta.url)) });

// Report field names only. Zod error input must never expose a connection URI.
const parsed = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  MONGODB_DB: z.string().regex(/^[A-Za-z0-9_-]+$/).default('pushkar_clinic'),
  JWT_SECRET: z.string().min(32).refine(value=>!/^replace_/i.test(value)),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY_HOPS:z.coerce.number().int().min(0).max(5).default(0),
  FRONTEND_ORIGIN: z.string().url(),
  NODE_ENV: z.enum(['development','test','production']).default('production'),
  GROQ_API_KEY:z.string().default(''),
  GROQ_MODEL:z.string().min(1).default('openai/gpt-oss-120b'),
  GROQ_VISION_MODEL:z.string().min(1).default('qwen/qwen3.8-27b'),
  CRM_INTEGRATION_ENABLED:z.enum(['true','false']).default('false'),
  CRM_API_BASE_URL:z.string().url().regex(/^https:\/\//).optional(),
  BOOTSTRAP_ADMIN_USERNAME:z.string().trim().min(3).max(100).optional(),
  BOOTSTRAP_ADMIN_PASSWORD:z.string().min(12).max(200).optional(),
  BOOTSTRAP_ADMIN_NAME:z.string().trim().min(2).max(160).default('Clinic Owner'),
}).superRefine((value,context)=>{if(Boolean(value.BOOTSTRAP_ADMIN_USERNAME)!==Boolean(value.BOOTSTRAP_ADMIN_PASSWORD))context.addIssue({code:'custom',path:['BOOTSTRAP_ADMIN_USERNAME'],message:'Both private bootstrap fields are required.'});}).safeParse({ ...process.env, API_PORT: process.env.PORT ?? process.env.API_PORT });
if (!parsed.success) throw new Error(`Invalid backend environment: ${[...new Set(parsed.error.issues.map(issue => issue.path.join('.')))].join(', ')}`);
export const config = parsed.data;
