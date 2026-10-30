import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { config } from './config.mjs';
import { tenantFilter } from './security.mjs';

export const client = new MongoClient(config.MONGODB_URI, {
  maxPoolSize: 20, minPoolSize: 0, serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000, appName: 'pushkar-clinic',
});
export const db = client.db(config.MONGODB_DB);
let ready;
export function initializeMongo() {
  ready ??= (async () => {
    await client.connect();
    await db.command({ ping: 1 });
    for (const name of ['super_admin_users','hospitals','users','branches','patients','login_activity','audit_events','staff_members','departments','wards','rooms','beds','clinical_appointments','finance_records']) {
      await db.collection(name).createIndex({ id: 1 }, { unique: true });
    }
    // No patients, staff, partners or sample hospital records are seeded.
    for (const [collection, keys, settings] of [
      ['super_admin_users', { username: 1 }, { unique: true }],
      ['hospitals', { code: 1 }, { unique: true }],
      ['users', { email: 1 }, { unique: true }],
      ['users', { tenant_id: 1, branch_id: 1 }, {}],
      ['branches', { tenant_id: 1, code: 1 }, { unique: true }],
      ['patients', { tenant_id: 1, medical_record_number: 1 }, { unique: true }],
      ['patients', { tenant_id: 1, branch_id: 1, created_at: -1 }, {}],
      ['patients', { tenant_id: 1, normalized_name: 1, phone: 1 }, {}],
      ['rbac_roles', { tenant_id: 1, code: 1 }, { unique: true }],
      ['user_branch_access', { tenant_id: 1, user_id: 1, branch_id: 1 }, { unique: true }],
      ['staff_members', { tenant_id: 1, branch_id: 1, staff_type: 1 }, {}],
      ['departments', { tenant_id: 1, code: 1 }, { unique: true }],
      ['wards', { tenant_id: 1, code: 1 }, { unique: true }],
      ['rooms', { tenant_id: 1, branch_id: 1, room_number: 1 }, { unique: true }],
      ['beds', { tenant_id: 1, branch_id: 1, bed_number: 1 }, { unique: true }],
      ['users', { username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } }],
      ['clinical_appointments', { tenant_id: 1, appointment_number: 1 }, { unique: true }],
      ['clinical_appointments', { tenant_id: 1, doctor_id: 1, appointment_date: 1, appointment_time: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['Booked','Confirmed','Checked In','Waiting','In Consultation','Completed'] } } }],
      ['finance_records', { tenant_id: 1, record_number: 1 }, { unique: true }],
      ['platform_settings', { key: 1 }, { unique: true }],
      ['subscription_plans', { id: 1 }, { unique: true }],
      ['subscription_plans', { code: 1 }, { unique: true }],
      ['platform_modules', { id: 1 }, { unique: true }],
      ['platform_modules', { code: 1 }, { unique: true }],
      ['subscriptions', { tenant_id: 1, status: 1 }, {}],
      ['login_activity', { tenant_id: 1, user_id: 1, login_time: -1 }, {}],
      ['audit_events', { tenant_id: 1, created_at: -1 }, {}],
      ['sessions', { expires_at: 1 }, { expireAfterSeconds: 0 }],
      ['login_limits', { expires_at: 1 }, { expireAfterSeconds: 0 }],
    ]) await db.collection(collection).createIndex(keys, settings);
    // Product capabilities only; no clinic, account, pricing or patient data.
    for (const [code,name] of [['opd','OPD & Appointments'],['ipd','IPD & Bed Management'],['laboratory','Laboratory'],['radiology','Radiology'],['pharmacy','Pharmacy'],['billing','Billing & Finance'],['hr','HR & Payroll'],['patient_portal','Patient Portal']]) {
      await db.collection('platform_modules').updateOne({code},{$setOnInsert:{id:randomUUID(),code,name,is_active:true,created_at:new Date()}},{upsert:true});
    }
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}
export async function transaction(operation) {
  await initializeMongo();
  return client.withSession(session => session.withTransaction(() => operation(session), {
    readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
  }));
}
export function tenantCollection(name, tenantId, session) {
  const collection = db.collection(name);
  return {
    find: filter => collection.find(tenantFilter(tenantId, filter), { session, projection: { _id: 0 } }),
    findOne: filter => collection.findOne(tenantFilter(tenantId, filter), { session, projection: { _id: 0 } }),
    async insert(record) {
      if ('tenant_id' in record || '_id' in record || 'id' in record) throw new Error('Identity fields are server-managed.');
      const now = new Date();
      const document = { ...record, id: randomUUID(), tenant_id: tenantId, created_at: now, updated_at: now };
      await collection.insertOne({ ...document }, { session });
      return document;
    },
    update(id, changes) {
      if (Object.keys(changes).some(key => ['id','_id','tenant_id','created_at'].includes(key) || key.startsWith('$') || key.includes('.'))) throw new Error('Identity and operator fields cannot be changed.');
      return collection.findOneAndUpdate(tenantFilter(tenantId, { id }), { $set: { ...changes, updated_at: new Date() } }, {
        session, returnDocument: 'after', projection: { _id: 0 },
      });
    },
  };
}
