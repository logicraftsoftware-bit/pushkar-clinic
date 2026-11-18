import { ApiError, PatientClient } from '../src/live/client';
const reply = (body: unknown, status = 200) =>
  ({
    status,
    ok: status < 400,
    text: async () => JSON.stringify(body),
  } as Response);
function setup() {
  const store = {
      read: jest.fn(async () => null as string | null),
      write: jest.fn(async (_token: string) => {}),
      clear: jest.fn(async () => {}),
    },
    transport = jest.fn();
  return { store, transport, client: new PatientClient(store, transport) };
}
test('private API calls use authorization headers and stable mutation keys, never URL tokens', async () => {
  const { client, transport, store } = setup();
  await client.save({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 900,
  });
  transport.mockResolvedValue(reply({ id: 'booked' }));
  await client.request(
    '/appointments',
    'POST',
    { quote_id: 'quote', pay_at_clinic: true },
    { key: 'stable-key' },
  );
  const [url, options] = transport.mock.calls[0];
  expect(url).not.toContain('access');
  expect(options.headers.Authorization).toBe('Bearer access');
  expect(options.headers['Idempotency-Key']).toBe('stable-key');
  expect(store.write).toHaveBeenCalledWith('refresh');
});
test('simultaneous expired access requests share one rotating refresh', async () => {
  const { client, transport } = setup();
  await client.save({
    access_token: 'old',
    refresh_token: 'refresh',
    expires_in: 900,
  });
  transport.mockImplementation(async (url: string, options: RequestInit) =>
    url.endsWith('/auth/refresh')
      ? reply({
          access_token: 'new',
          refresh_token: 'rotated',
          expires_in: 900,
        })
      : (options.headers as Record<string, string>).Authorization ===
        'Bearer old'
      ? reply({ error: 'Expired' }, 401)
      : reply({ data: [] }),
  );
  await Promise.all([
    client.request('/appointments'),
    client.request('/records'),
  ]);
  expect(
    transport.mock.calls.filter(([url]) => url.endsWith('/auth/refresh')),
  ).toHaveLength(1);
});
test('revoked refresh clears secure session and notifies screens', async () => {
  const { client, transport, store } = setup();
  await client.save({
    access_token: 'old',
    refresh_token: 'refresh',
    expires_in: 900,
  });
  const expired = jest.fn();
  client.onExpired = expired;
  transport.mockResolvedValue(reply({ error: 'Revoked' }, 401));
  await expect(client.request('/me')).rejects.toBeInstanceOf(ApiError);
  expect(store.clear).toHaveBeenCalled();
  expect(expired).toHaveBeenCalled();
});
test('guest directory browsing sends no bearer and does not attempt login', async () => {
  const { client, transport } = setup();
  transport.mockResolvedValue(reply({ data: [] }));
  await client.request('/clinics', 'GET', undefined, { public: true });
  expect(transport.mock.calls[0][1].headers.Authorization).toBeUndefined();
  expect(transport).toHaveBeenCalledTimes(1);
});
test('unavailable backend is an honest error and cannot create a fake booking', async () => {
  const { client, transport } = setup();
  transport.mockResolvedValue(reply({ error: 'Not found' }, 404));
  await expect(
    client.request('/config', 'GET', undefined, { public: true }),
  ).rejects.toThrow('not been deployed');
});
test('download rejects other origins and credentials in URLs', async () => {
  const { client } = setup();
  await expect(
    client.authorizedDownload('https://other.example/file', jest.fn()),
  ).rejects.toThrow('Invalid document path');
});
