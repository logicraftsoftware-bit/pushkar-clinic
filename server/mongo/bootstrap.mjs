// Run only on the hosting server. Input comes privately from stdin, never arguments.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { client, db, initializeMongo } from './database.mjs';
import { hashPassword } from './security.mjs';

try {
  const input = z.object({ username: z.string().trim().min(3).max(100), password: z.string().min(12).max(200), displayName: z.string().trim().min(2).max(160) }).parse(JSON.parse(readFileSync(0, 'utf8')));
  await initializeMongo();
  const password_hash = await hashPassword(input.password);
  // Fixed singleton identity prevents concurrent first-run bootstrap races.
  const result = await db.collection('super_admin_users').updateOne({ _id: 'initial-administrator' }, { $setOnInsert: {
    id: randomUUID(), username: input.username.toLowerCase(), display_name: input.displayName,
    password_hash, is_active: true, session_version: 0, created_at: new Date(),
  } }, { upsert: true });
  if (!result.upsertedCount) throw new Error('Initial administrator already exists. Bootstrap never resets a password.');
  console.log('Administrator created. No clinic or patient data was imported.');
} catch {
  console.error('Administrator setup failed. Check private input, database access and whether bootstrap already ran.');
  process.exitCode = 1;
} finally { await client.close(); }
