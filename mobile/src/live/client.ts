export const API_BASE =
  'https://erp.pushkarpharmaceutical.com/api/v1/patient-app';
export type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};
export type Store = {
  read: () => Promise<string | null>;
  write: (token: string) => Promise<void>;
  clear: () => Promise<void>;
};
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}
// A single rotating refresh request serves all simultaneous screen requests.
export class PatientClient {
  private access = '';
  private refreshToken = '';
  private rotating: Promise<void> | null = null;
  private generation = 0;
  onExpired = () => {};
  constructor(
    private store: Store,
    private transport: typeof fetch = fetch,
    private base = API_BASE,
  ) {
    if (!base.startsWith('https://'))
      throw Error('Patient APIs require HTTPS.');
  }
  async save(tokens: Tokens) {
    await this.store.write(tokens.refresh_token);
    this.access = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
  }
  async restore() {
    this.refreshToken = (await this.store.read()) ?? '';
    if (!this.refreshToken) return false;
    await this.refresh();
    return true;
  }
  async clear() {
    this.generation++;
    this.access = '';
    this.refreshToken = '';
    await this.store.clear();
  }
  private async refresh() {
    if (this.rotating) return this.rotating;
    const generation = this.generation;
    this.rotating = (async () => {
      if (!this.refreshToken) throw new ApiError('Sign in to continue.', 401);
      const tokens = await this.raw<Tokens>(
        '/auth/refresh',
        'POST',
        { refresh_token: this.refreshToken },
        false,
      );
      if (generation !== this.generation)
        throw new ApiError('Session ended.', 401);
      await this.save(tokens);
    })()
      .catch(async error => {
        if (error instanceof ApiError && error.status === 401) {
          await this.clear();
          this.onExpired();
        }
        throw error;
      })
      .finally(() => {
        this.rotating = null;
      });
    return this.rotating;
  }
  async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    options: { public?: boolean; key?: string } = {},
  ): Promise<T> {
    try {
      return await this.raw<T>(
        path,
        method,
        body,
        !options.public,
        options.key,
      );
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.status !== 401 ||
        options.public
      )
        throw error;
      if (!this.refreshToken) {
        this.onExpired();
        throw error;
      }
      await this.refresh();
      return this.raw<T>(path, method, body, true, options.key);
    }
  }
  private async raw<T>(
    path: string,
    method: string,
    body: unknown,
    auth: boolean,
    key?: string,
  ): Promise<T> {
    if (!/^\/[a-z0-9/?=&%_.:-]*$/i.test(path) || path.startsWith('//'))
      throw Error('Invalid API path.');
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.transport(this.base + path, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(auth && this.access
            ? { Authorization: `Bearer ${this.access}` }
            : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      let result: { error?: string; code?: string };
      try {
        result = JSON.parse(text);
      } catch {
        throw new ApiError(
          'The patient service is unavailable. Please try again later.',
          response.status,
        );
      }
      if (!response.ok)
        throw new ApiError(
          response.status === 404 && path === '/config'
            ? 'The patient API has not been deployed on the server yet.'
            : result.error ?? 'Request failed. Please retry.',
          response.status,
          result.code,
        );
      return result as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        'Could not reach the clinic. Check your internet connection and retry.',
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  // Downloads use only this fixed API origin. Never put patient credentials in a URL.
  async authorizedDownload(
    path: string,
    download: (url: string, token: string) => Promise<void>,
  ) {
    if (
      !/^\/(appointments|records|uploads|invoices)\/[A-Za-z0-9-]+\/(download|pass)(\?format=pdf)?$/.test(
        path,
      )
    )
      throw Error('Invalid document path.');
    await this.refresh();
    await download(this.base + path, this.access);
  }
}
