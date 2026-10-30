import app from './app.mjs';
import { config } from './config.mjs';
import { client, initializeMongo } from './database.mjs';
await initializeMongo();
const server = app.listen(config.API_PORT, '0.0.0.0', () => console.log(`MongoDB API listening on port ${config.API_PORT}; workflow migration is incomplete.`));
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  server.close(() => { void client.close().then(() => process.exit(0), () => process.exit(1)); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
