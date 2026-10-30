import { client, db } from './database.mjs';
try {
  await client.connect();
  await db.command({ ping: 1 });
  console.log('MongoDB connection successful. No application records were created.');
} catch {
  console.error('MongoDB connection failed. Check credentials, Atlas Network Access and the hosting outbound IP.');
  process.exitCode = 1;
} finally { await client.close(); }
