import type { PoolClient } from "pg";
import { z } from "zod";

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

// Call inside the record transaction. Lock in UUID order to serialize stock changes.
export async function postInventoryMovement(client: Pick<PoolClient, "query">, tenantId: string,
  kind: string, body: {item_id: string; branch_id: string; quantity: number; data: Record<string, unknown>},
  branchIds: string[] | null) {
  if (!["purchases", "stock-transfers", "purchase-orders"].includes(kind)) return;
  const sourceId = z.string().uuid().parse(body.item_id);
  z.number().finite().positive().parse(body.quantity);
  const transfer = kind === "stock-transfers";
  const destinationId = transfer ? z.string().uuid().parse(body.data.destination_item_id) : null;
  const destinationBranch = transfer ? z.string().uuid().parse(body.data.to_branch) : null;
  const result = await client.query(
    `SELECT * FROM inventory_records WHERE tenant_id=$1 AND kind='items' AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [tenantId, [sourceId, ...(destinationId ? [destinationId] : [])]],
  );
  const source = result.rows.find(row => row.id === sourceId);
  if (!source) invalid("Select an existing inventory item.");
  for (const row of result.rows) {
    if (branchIds !== null && (!row.branch_id || !branchIds.includes(row.branch_id))) {
      throw Object.assign(new Error("You do not have access to the item branch."), {status: 403});
    }
  }
  if (body.branch_id && body.branch_id !== source.branch_id) invalid("The source branch must match the selected item.");
  body.branch_id = source.branch_id ?? "";
  if (kind === "purchase-orders") return;
  if (transfer) {
    const destination = result.rows.find(row => row.id === destinationId);
    if (!destination || destination.id === source.id || destination.branch_id === source.branch_id || destination.branch_id !== destinationBranch) {
      invalid("Select a destination item in a different branch matching the destination branch.");
    }
    if (source.data.name !== destination.data.name || (source.data.unit ?? "") !== (destination.data.unit ?? "")) {
      invalid("Source and destination items must have the same name and unit.");
    }
    if (Number(source.quantity) < body.quantity) invalid("Insufficient stock for this transfer.");
    await client.query("UPDATE inventory_records SET quantity=quantity-$1,updated_at=now() WHERE tenant_id=$2 AND id=$3", [body.quantity, tenantId, sourceId]);
    await client.query("UPDATE inventory_records SET quantity=quantity+$1,updated_at=now() WHERE tenant_id=$2 AND id=$3", [body.quantity, tenantId, destinationId]);
  } else {
    await client.query("UPDATE inventory_records SET quantity=quantity+$1,updated_at=now() WHERE tenant_id=$2 AND id=$3", [body.quantity, tenantId, sourceId]);
  }
}
