import { readJsonResponse } from '../http-response'
import {ADMIN_SESSION_KEY,readTabSession,writeTabSession,clearTabSession} from '../tab-session'
const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? '' : 'http://localhost:4000')
const TOKEN_KEY = ADMIN_SESSION_KEY

export const auth = {
  token: () => readTabSession(TOKEN_KEY),
  set: (token: string) => writeTabSession(TOKEN_KEY, token),
  clear: () => clearTabSession(TOKEN_KEY),
}

export async function adminApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1/admin${path}`, {
    signal: AbortSignal.timeout(30000),
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(auth.token() ? { Authorization: `Bearer ${auth.token()}` } : {}),
      ...options.headers,
    },
  })
  if (response.status === 401) auth.clear()
  const payload = await readJsonResponse(response)
  if (!response.ok) throw new Error(payload?.error ?? 'Request failed')
  return payload as T
}
