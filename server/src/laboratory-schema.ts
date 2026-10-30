import type { Pool, PoolClient } from "pg";
export async function ensureLaboratorySchema(db: Pool | PoolClient) {
  await db.query(`CREATE TABLE IF NOT EXISTS lab_import_runs(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id),
    summary jsonb NOT NULL DEFAULT '{}',backup jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'Prepared',created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS lab_legacy_audit(
    id bigserial PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES hospitals(id),import_id uuid NOT NULL REFERENCES lab_import_runs(id),
    source_table text NOT NULL,source_key text NOT NULL,data jsonb NOT NULL,UNIQUE(import_id,source_table,source_key));
    CREATE TABLE IF NOT EXISTS lab_qc_controls(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id),branch_id uuid REFERENCES branches(id),
    name text NOT NULL,parameter_id uuid NOT NULL REFERENCES hospital_diagnostic_masters(id),lot text NOT NULL,level text NOT NULL,
    target numeric NOT NULL,sd numeric NOT NULL CHECK(sd>0),expires_on date NOT NULL,status text NOT NULL DEFAULT 'Active',created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS lab_qc_runs(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id),control_id uuid NOT NULL REFERENCES lab_qc_controls(id),
    value numeric NOT NULL,z_score numeric NOT NULL,status text NOT NULL,note text NOT NULL DEFAULT '',created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS lab_qc_runs_tenant_date ON lab_qc_runs(tenant_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS lab_workflow_tenant ON role_work_items(tenant_id,workspace,kind,status);`);
}
