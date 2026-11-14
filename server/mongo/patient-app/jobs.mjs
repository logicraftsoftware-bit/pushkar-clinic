import { db } from '../database.mjs';
import { config } from '../config.mjs';
import { syncNotifications } from './account.mjs';
import { ownRow } from './common.mjs';
import { released } from './records.mjs';

let cursor = null;
export async function runPatientAppJobs() {
  const accounts = await db
    .collection('mobile_accounts')
    .find({ status: 'Active', ...(cursor ? { id: { $gt: cursor } } : {}) })
    .sort({ id: 1 })
    .limit(50)
    .toArray();
  for (const account of accounts) await syncNotifications(account);
  cursor = accounts.length === 50 ? accounts.at(-1).id : null;
  if (!config.PATIENT_APP_PUSH_WEBHOOK_URL) return;
  for (let i = 0; i < 50; i++) {
    const now = new Date(),
      job = await db.collection('mobile_push_outbox').findOneAndUpdate(
        {
          state: { $in: ['Pending', 'Retry', 'Sending'] },
          attempts: { $lt: 5 },
          $or: [
            { lease_until: { $exists: false } },
            { lease_until: { $lte: now } },
          ],
        },
        {
          $set: {
            state: 'Sending',
            lease_until: new Date(Date.now() + 60000),
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' }
      );
    if (!job) break;
    const account = await db
        .collection('mobile_accounts')
        .findOne({ id: job.account_id, status: 'Active' }),
      notice = await db
        .collection('mobile_notifications')
        .findOne({ id: job.notification_id, account_id: job.account_id });
    if (!account || account.preferences?.push_enabled === false || !notice) {
      await db
        .collection('mobile_push_outbox')
        .updateOne({ _id: job._id }, { $set: { state: 'Suppressed' } });
      continue;
    }
    try {
      if (notice.target?.appointment_id)
        await ownRow(
          account,
          'clinical_appointments',
          notice.target.appointment_id
        );
      if (notice.target?.record_id)
        await released(account, notice.target.record_id);
    } catch (error) {
      if (![401, 402, 403, 404].includes(error.status)) throw error;
      await db
        .collection('mobile_push_outbox')
        .updateOne({ _id: job._id }, { $set: { state: 'Suppressed' } });
      continue;
    }
    const sessions = await db
        .collection('mobile_sessions')
        .find(
          { account_id: account.id, expires_at: { $gt: now } },
          { projection: { id: 1 } }
        )
        .toArray(),
      devices = await db
        .collection('mobile_devices')
        .find({
          account_id: account.id,
          session_id: { $in: sessions.map((s) => s.id) },
        })
        .toArray();
    if (!devices.length) {
      await db.collection('mobile_push_outbox').updateOne(
        { _id: job._id },
        {
          $set: {
            state: 'Pending',
            lease_until: new Date(Date.now() + 3600000),
          },
        }
      );
      continue;
    }
    try {
      const response = await fetch(config.PATIENT_APP_PUSH_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.PATIENT_APP_PUSH_WEBHOOK_SECRET}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': notice.id,
        },
        body: JSON.stringify({
          notification_id: notice.id,
          title: notice.title,
          message: notice.message,
          target: notice.target,
          devices: devices.map((d) => ({
            token: d.token,
            platform: d.platform,
          })),
        }),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok) throw Error('Push delivery failed');
      await db
        .collection('mobile_push_outbox')
        .updateOne(
          { _id: job._id },
          { $set: { state: 'Sent', sent_at: new Date() } }
        );
    } catch {
      await db.collection('mobile_push_outbox').updateOne(
        { _id: job._id },
        {
          $set: {
            state: 'Retry',
            lease_until: new Date(
              Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000
            ),
          },
        }
      );
    }
  }
}
