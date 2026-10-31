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
  let stage='connect';
  ready ??= (async () => {
    await client.connect();
    stage='ping';await db.command({ ping: 1 });
    for (const name of ['super_admin_users','hospitals','users','branches','patients','login_activity','audit_events','staff_members','departments','wards','rooms','beds','clinical_appointments','finance_records']) {
      stage=`indexes:${name}`;await db.collection(name).createIndex({ id: 1 }, { unique: true });
    }
    // No patients, staff, partners or sample hospital records are seeded.
    for (const [collection, keys, settings] of [
      ['super_admin_users', { username: 1 }, { unique: true }],
      ['ai_limits',{expires_at:1},{expireAfterSeconds:0}],
      ['call_centre_crm_connections',{id:1},{unique:true}],
      ['call_centre_crm_connections',{tenant_id:1},{unique:true}],
      ['call_centre_crm_connections',{clinic_external_id:1},{unique:true}],
      ['call_centre_crm_connections',{api_key_hash:1},{unique:true}],
      ['call_centre_crm_mappings',{connection_id:1,entity_type:1,external_id:1},{unique:true}],
      ['hospitals', { code: 1 }, { unique: true }],
      ['users', { email: 1 }, { unique: true }],
      ['users', { tenant_id: 1, branch_id: 1 }, {}],
      ['users',{tenant_id:1,patient_id:1},{unique:true,partialFilterExpression:{role:'patient',patient_id:{$type:'string'}}}],
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
      ['finance_records', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['finance_records', { tenant_id: 1, kind: 1, 'data.admission_id': 1 }, { unique: true, partialFilterExpression: { kind: 'invoices', 'data.admission_id': { $type: 'string' } } }],
      ['inventory_records', { id: 1 }, { unique: true }],
      ['hospital_documents', { id: 1 }, { unique: true }],
      ['hospital_documents', { tenant_id: 1, branch_id: 1, created_at: -1 }, {}],
      ['lab_qc_controls', { id: 1 }, { unique: true }],
      ['lab_qc_controls', { tenant_id: 1, branch_id: 1, created_at: -1 }, {}],
      ['lab_qc_runs', { id: 1 }, { unique: true }],
      ['lab_qc_runs', { tenant_id: 1, branch_id: 1, created_at: -1 }, {}],
      ['inventory_records', { tenant_id: 1, record_code: 1 }, { unique: true }],
      ['inventory_records', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['inventory_records', { tenant_id: 1, branch_id: 1, kind: 1 }, {}],
      ['hr_records', { tenant_id: 1, record_number: 1 }, { unique: true }],
      ['hr_records', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['hr_records', { tenant_id: 1, kind: 1, employee_id: 1, record_date: 1 }, { unique: true, partialFilterExpression: { kind: { $in: ['attendance','payroll'] } } }],
      ['insurance_claims', { tenant_id: 1, claim_number: 1 }, { unique: true }],
      ['insurance_claims', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['cancellation_requests', { tenant_id: 1, request_number: 1 }, { unique: true }],
      ['cancellation_requests', { tenant_id: 1, bill_type: 1, target_id: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['Pending','Approved','Partially Refunded','Completed'] } } }],
      ['cancellation_events', { tenant_id: 1, request_id: 1, created_at: 1 }, {}],
      ['doctor_clinical_records', { id: 1 }, { unique: true }],
      ['doctor_clinical_records', { tenant_id: 1, appointment_id: 1 }, { unique: true, partialFilterExpression: { record_type: 'consultation', appointment_id: { $type: 'string' } } }],
      ['doctor_clinical_records', { tenant_id: 1, branch_id: 1, patient_id: 1, created_at: -1 }, {}],
      ['role_work_items', { tenant_id: 1, workspace: 1, 'data.consultation_record_id': 1 }, { unique: true, partialFilterExpression: { 'data.consultation_record_id': { $type: 'string' } } }],
      ['role_work_items', { tenant_id: 1, workspace: 1, kind: 1, 'data.admission_id': 1 }, { unique: true, partialFilterExpression: { workspace: 'reception', kind: 'ipd_discharge', status: 'Pending' } }],
      ['role_work_items', { tenant_id: 1, 'data.plan_id': 1, 'data.scheduled_at': 1 }, { unique: true, partialFilterExpression: { workspace: 'nurse', kind: 'medication-administration' } }],
      ['finance_records', { tenant_id: 1, 'data.refund_payment_key': 1 }, { unique: true, partialFilterExpression: { kind: 'refunds', 'data.refund_payment_key': { $type: 'string' } } }],
      ['ipd_admissions', { id: 1 }, { unique: true }],
      ['ipd_admissions', { tenant_id: 1, ipd_number: 1 }, { unique: true }],
      ['ipd_admissions', { tenant_id: 1, patient_id: 1 }, { unique: true, partialFilterExpression: { active: true } }],
      ['ipd_admissions', { tenant_id: 1, bed_id: 1 }, { unique: true, partialFilterExpression: { active: true, bed_id: { $type: 'string' } } }],
      ['ipd_bed_stays', { tenant_id: 1, admission_id: 1, started_at: 1 }, {}],
      ['ipd_transfer_history', { tenant_id: 1, admission_id: 1, created_at: -1 }, {}],
      ['platform_settings', { key: 1 }, { unique: true }],
      ['ot_cases', { id: 1 }, { unique: true }],
      ['ot_cases', { tenant_id: 1, case_number: 1 }, { unique: true }],
      ['ot_cases', { tenant_id: 1, planned_start: 1, status: 1 }, {}],
      ['ot_cases', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['ot_rooms', { tenant_id: 1, branch_id: 1, name: 1 }, { unique: true }],
      ['ot_consumables', { tenant_id: 1, case_id: 1 }, {}],
      ['ot_consumables', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['ot_case_events', { tenant_id: 1, case_id: 1, created_at: -1 }, {}],
      ['hospital_operation_masters', { tenant_id: 1, kind: 1, name: 1 }, { unique: true }],
      ['hospital_charge_masters', { tenant_id: 1, kind: 1, name: 1 }, { unique: true }],
      ['bed_masters', { tenant_id: 1, kind: 1, name: 1 }, { unique: true }],
      ['hospital_print_templates', { tenant_id: 1, document_type: 1 }, { unique: true }],
      ['dietary_menu', { tenant_id: 1, item_code: 1 }, { unique: true }],
      ['patient_diets', { tenant_id: 1, admission_id: 1 }, { unique: true, partialFilterExpression: { active: true } }],
      ['dietary_meal_holds', { tenant_id: 1, admission_id: 1 }, { unique: true, partialFilterExpression: { active: true } }],
      ['dietary_package_rules', { tenant_id: 1, package_key: 1, meal_key: 1, order_key: 1 }, { unique: true, partialFilterExpression: { active: true } }],
      ['dietary_meal_schedules', { tenant_id: 1, meal_type: 1 }, { unique: true }],
      ['dietary_orders', { tenant_id: 1, order_number: 1 }, { unique: true }],
      ['dietary_orders', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['dietary_orders', { tenant_id: 1, branch_id: 1, admission_id: 1, menu_id: 1, meal_date: 1, order_type: 1 }, { unique: true, partialFilterExpression: { kitchen_status: { $in: ['Order Placed','Kitchen Accepted','Preparing','Ready','Out for Delivery','Delivered'] } } }],
      ['dietary_audit', { tenant_id: 1, branch_id: 1, created_at: -1 }, {}],
      ['referral_partners', { id: 1 }, { unique: true }],
      ['referral_partners', { tenant_id: 1, partner_code: 1 }, { unique: true }],
      ['referral_partners', { tenant_id: 1, phone: 1 }, { unique: true }],
      ['referral_commissions', { tenant_id: 1, invoice_id: 1, partner_id: 1 }, { unique: true }],
      ['referral_wallet_transactions', { tenant_id: 1, commission_id: 1, transaction_type: 1 }, { unique: true, partialFilterExpression: { commission_id: { $type: 'string' } } }],
      ['referral_wallet_transactions', { tenant_id: 1, withdrawal_id: 1 }, { unique: true, partialFilterExpression: { withdrawal_id: { $type: 'string' } } }],
      ['referral_wallet_transactions', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['referral_withdrawals', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['self_registration_links', { id: 1 }, { unique: true }],
      ['self_registration_links', { expires_at: 1 }, { expireAfterSeconds: 0 }],
      ['public_registration_limits', { expires_at: 1 }, { expireAfterSeconds: 0 }],
      ['self_registration_records', { tenant_id: 1, link_id: 1, request_id: 1 }, { unique: true }],
      ['self_registration_payments', { tenant_id: 1, order_id: 1 }, { unique: true, partialFilterExpression: { order_id: { $type: 'string' } } }],
      ['self_registration_payments', { tenant_id: 1, payment_id: 1 }, { unique: true, partialFilterExpression: { payment_id: { $type: 'string' } } }],
      ['hospital_settings', { tenant_id: 1, section: 1, key: 1 }, { unique: true }],
      ['hospital_diagnostic_masters', { id: 1 }, { unique: true }],
      ['hospital_diagnostic_masters', { tenant_id: 1, domain: 1, kind: 1, name: 1 }, { unique: true }],
      ['hospital_pharmacy_masters', { id: 1 }, { unique: true }],
      ['hospital_pharmacy_masters', { tenant_id: 1, kind: 1, name: 1 }, { unique: true }],
      ['pharmacy_stock_adjustments', { tenant_id: 1, request_id: 1 }, { unique: true, partialFilterExpression: { request_id: { $type: 'string' } } }],
      ['pharmacy_stock_adjustments', { tenant_id: 1, batch_id: 1, created_at: -1 }, {}],
      ['hospital_refer_pharmacies', { id: 1 }, { unique: true }],
      ['hospital_refer_pharmacies', { tenant_id: 1, name: 1 }, { unique: true }],
      ['role_work_items', { id: 1 }, { unique: true }],
      ['role_work_items', { tenant_id: 1, branch_id: 1, workspace: 1, kind: 1, occurred_at: -1 }, {}],
      ['report_print_events', { tenant_id: 1, order_id: 1, request_id: 1 }, { unique: true }],
      ['report_shares', { token_hash: 1 }, { unique: true }],
      ['report_shares', { expires_at: 1 }, { expireAfterSeconds: 0 }],
      ['subscription_plans', { id: 1 }, { unique: true }],
      ['subscription_plans', { code: 1 }, { unique: true }],
      ['platform_modules', { id: 1 }, { unique: true }],
      ['platform_modules', { code: 1 }, { unique: true }],
      ['subscriptions', { tenant_id: 1, status: 1 }, {}],
      ['login_activity', { tenant_id: 1, user_id: 1, login_time: -1 }, {}],
      ['audit_events', { tenant_id: 1, created_at: -1 }, {}],
      ['sessions', { expires_at: 1 }, { expireAfterSeconds: 0 }],
      ['login_limits', { expires_at: 1 }, { expireAfterSeconds: 0 }],
    ]) {stage=`indexes:${collection}`;await db.collection(collection).createIndex(keys, settings);}
    // Product capabilities only; no clinic, account, pricing or patient data.
    stage='system-modules';for (const [code,name] of [['opd','OPD & Appointments'],['ipd','IPD & Bed Management'],['laboratory','Laboratory'],['radiology','Radiology'],['pharmacy','Pharmacy'],['billing','Billing & Finance'],['hr','HR & Payroll'],['patient_portal','Patient Portal']]) {
      await db.collection('platform_modules').updateOne({code},{$setOnInsert:{id:randomUUID(),code,name,is_active:true,created_at:new Date()}},{upsert:true});
    }
  })().catch(error => { ready = undefined; error.initializationStage=stage;throw error; });
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
