import type { PoolClient } from "pg";
import { pool } from "./db.js";

export type BranchAuth = {
  sub: string;
  tenantId: string;
  branchId?: string;
  portal?: string;
};

export function hasHospitalWideAccess(auth: BranchAuth) {
  return auth.portal === "hospital_admin";
}

export async function accessibleBranchIds(auth: BranchAuth) {
  if (hasHospitalWideAccess(auth)) return null;
  const result = await pool.query<{ branch_id: string }>(
    `SELECT branch_id FROM user_branch_access WHERE tenant_id=$1 AND user_id=$2
     UNION SELECT branch_id FROM users WHERE tenant_id=$1 AND id=$2 AND branch_id IS NOT NULL`,
    [auth.tenantId, auth.sub],
  );
  return result.rows.map((row) => row.branch_id);
}

export async function assertBranchAccess(auth: BranchAuth, branchId: string) {
  const ids = await accessibleBranchIds(auth);
  if (ids !== null && !ids.includes(branchId)) {
    const error = new Error("You do not have access to the selected branch") as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

export async function replaceUserBranchAccess(
  client: PoolClient,
  tenantId: string,
  userId: string,
  branchIds: string[],
) {
  await client.query(
    `DELETE FROM user_branch_access WHERE tenant_id=$1 AND user_id=$2`,
    [tenantId, userId],
  );
  if (branchIds.length)
    await client.query(
      `INSERT INTO user_branch_access(tenant_id,user_id,branch_id)
       SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT DO NOTHING`,
      [tenantId, userId, branchIds],
    );
}
