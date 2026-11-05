/**
 * Admin mutations for fase 2. Each checks the permission server-side and
 * writes its audit event in the same transaction as the change (PRD-13).
 */
import type { Db } from "./client.ts";
import { queueCatalogImport } from "./catalog-import.ts";
import { requirePermission, writeAudit, type Identity } from "./identity.ts";

export async function requestCatalogImport(db: Db, actor: Pick<Identity, "id" | "permissions">, provider: string, reason: string, requestId?: string) {
  requirePermission(actor, "catalog.import");
  const why = reason.trim() || "Handmatige import vanuit beheer";
  return db.transaction(async (tx) => {
    const result = await queueCatalogImport(tx, provider, actor.id);
    if (!result.alreadyActive) {
      await writeAudit(tx, {
        actorId: actor.id, actorKind: "ADMIN", action: "CATALOG_IMPORT_QUEUED", reason: why,
        entityType: "import_run", entityId: result.runId, related: { provider }, requestId: requestId ?? null,
      });
    }
    return result;
  });
}
