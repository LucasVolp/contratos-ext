import { PrismaClient } from "../generated/prisma/client";
import { mapPurchaseResultStates, string } from "./mappers";
import { Raw, RecordSnapshot } from "./types";

export function linkedPurchaseCache(
  db: PrismaClient,
  identity: { purchaseExternalId?: string | null; purchasePncpId?: string | null },
) {
  if (identity.purchaseExternalId)
    return db.publicPurchase.findUnique({ where: { externalId: identity.purchaseExternalId } });
  if (identity.purchasePncpId)
    return db.publicPurchase.findFirst({ where: { pncpId: identity.purchasePncpId } });
  return Promise.resolve(null);
}

export function purchaseResultEvidence(
  snapshot: Partial<RecordSnapshot>,
  recordDetailsSyncedAt: Date | null,
  cached: { snapshot: unknown; detailsSyncedAt: Date | null; externalId?: string } | null,
) {
  const previousTime = snapshot.purchaseResultsSyncedAt === undefined
    ? (snapshot.purchaseResultStates ? recordDetailsSyncedAt?.toISOString() ?? null : null)
    : snapshot.purchaseResultsSyncedAt;
  const evidence = {
    states: snapshot.purchaseResultStates ?? [],
    syncedAt: previousTime,
  };
  const raw = cached?.snapshot as Raw | undefined;
  if (!cached?.detailsSyncedAt || !Array.isArray(raw?.rawItems) || !Array.isArray(raw?.rawResults))
    return evidence;
  if (previousTime && cached.detailsSyncedAt.getTime() <= Date.parse(previousTime))
    return evidence;
  const exact = (row: Raw) => !row.idCompra || string(row.idCompra) === cached.externalId;
  return {
    states: mapPurchaseResultStates(raw.rawItems.filter(exact), raw.rawResults.filter(exact)),
    syncedAt: cached.detailsSyncedAt.toISOString(),
  };
}
