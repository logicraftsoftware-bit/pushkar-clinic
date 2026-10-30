// Single Node.js entry point for Hostinger managed hosting. No VPS/PM2 required.
import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('./dist/', import.meta.url));
const index = fileURLToPath(new URL('./dist/index.html', import.meta.url));
if (!existsSync(index) || !existsSync(new URL('./server/dist/index.js', import.meta.url))) {
  throw new Error('Build artifacts are missing. Run npm run build:hostinger on the hosting build service.');
}

const { config } = await import('./server/dist/config.js');
const { default: api } = await import('./server/dist/app.js');
const { pool } = await import('./server/dist/db.js');
const app = express();
app.disable('x-powered-by');
app.use(helmet());
// Keep the original /api prefix when delegating to the existing API application.
app.use((request, response, next) => {
  if (request.path === '/api' || request.path.startsWith('/api/')) {
    return api(request, response, next);
  }
  next();
});
app.use(express.static(frontend, { index: false }));
app.get('/{*path}', (request, response, next) => {
  if (!request.accepts('html')) return next();
  response.set('Cache-Control', 'no-store').sendFile(index);
});
const server = app.listen(config.API_PORT, '0.0.0.0', () => {
  console.log(`Pushkar Clinic listening on port ${config.API_PORT}`);
});
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  server.close(() => {
    void pool.end().then(() => process.exit(0), () => process.exit(1));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
