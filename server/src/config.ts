import dotenv from 'dotenv'
import { z } from 'zod'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: process.env.ENV_FILE ?? fileURLToPath(new URL('../../.env', import.meta.url)) })

const schema = z.object({
  DATABASE_URL: z.string().url().refine(value => /^postgres(?:ql)?:\/\//.test(value), 'This backend currently requires PostgreSQL; MongoDB is not yet supported'),
  API_PORT: z.coerce.number().int().positive().prefault(4000),
  FRONTEND_ORIGIN: z.string().url().prefault('http://localhost:5173'),
  JWT_SECRET: z.string().min(32),
  DATABASE_SSL: z.enum(['true', 'false']).optional(),
  GROQ_API_KEY: z.string().min(20).optional(),
  GROQ_MODEL: z.string().prefault('openai/gpt-oss-120b'),
  GROQ_VISION_MODEL: z.string().prefault('qwen/qwen3.6-27b'),
  CRM_API_BASE_URL: z.string().url().prefault('https://crm.hosmedai.com/api'),
  CRM_INTEGRATION_ENABLED: z.enum(['true', 'false']).prefault('false'),
  NODE_ENV: z.enum(['development', 'test', 'production']).prefault('development'),
})

const parsed = schema.parse({ ...process.env, API_PORT: process.env.PORT ?? process.env.API_PORT })
export const config = {
  ...parsed,
  DATABASE_SSL:
    parsed.DATABASE_SSL === undefined
      ? parsed.NODE_ENV === 'production'
      : parsed.DATABASE_SSL === 'true',
  // Groq retired the Llama 3 production IDs in August 2026. Keep older
  // deployments working when GROQ_MODEL still uses a retired model ID.
  GROQ_MODEL: ['llama-3.3-70b-versatile','llama-3.1-8b-instant'].includes(parsed.GROQ_MODEL)
    ? 'openai/gpt-oss-120b'
    : parsed.GROQ_MODEL,
}
