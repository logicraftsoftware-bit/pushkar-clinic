-- Support the accounting ledger's ordering and first-payment lookup.
CREATE INDEX IF NOT EXISTS finance_accounting_date_idx
  ON finance_records (tenant_id, record_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS finance_accounting_payment_idx
  ON finance_records (tenant_id, invoice_id, created_at, id) WHERE kind = 'payments';

-- Ledger metadata stores related identifiers as text. Match the existing joins
-- without casting arbitrary historical JSON values to UUID.
CREATE INDEX IF NOT EXISTS appointments_accounting_lookup_idx
  ON clinical_appointments (tenant_id, (id::text));
CREATE INDEX IF NOT EXISTS admissions_accounting_lookup_idx
  ON ipd_admissions (tenant_id, (id::text));
CREATE INDEX IF NOT EXISTS work_items_accounting_lookup_idx
  ON role_work_items (tenant_id, (id::text));
