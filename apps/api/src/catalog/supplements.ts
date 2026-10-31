import {
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaClient, CatalogSupplement } from "../generated/prisma/client";
import { CatalogClient } from "./client";
import { ItemSupplement, Raw, SupplementKind, SupplementPart } from "./types";
import { mapUnits, mapCommitments, mapAdhesions } from "./mappers";
import { asJson, plain } from "./helpers";
const kinds: SupplementKind[] = ["units", "commitments", "adhesions"];
export function presentSupplement(
  rows: CatalogSupplement[],
  item: string,
): ItemSupplement {
  const part = (kind: SupplementKind): SupplementPart<any> => {
    const row = rows.find(
      (r) =>
        r.kind === kind &&
        r.itemNumber === (kind === "commitments" ? "*" : item),
    );
    if (!row)
      return {
        status: "not_loaded",
        data: [],
        lastSyncedAt: null,
        error: null,
      };
    return {
      status: row.status as SupplementPart<any>["status"],
      data:
        kind === "commitments"
          ? mapCommitments(row.data as Raw[], item)
          : (row.data as Raw[]),
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      error: row.error,
    };
  };
  return {
    units: part("units"),
    commitments: part("commitments"),
    adhesions: part("adhesions"),
  };
}
export class CatalogSupplements {
  constructor(
    private readonly db: PrismaClient,
    private readonly client: CatalogClient,
  ) {}
  async refresh(id: string, item: string) {
    const record = await this.db.publicRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException("Ata publicada não encontrada.");
    if (!record.detailsSyncedAt)
      throw new UnprocessableEntityException(
        "Atualize o detalhe da ata antes de consultar seus itens.",
      );
    const snapshot = record.snapshot as Raw;
    if (
      !Array.isArray(snapshot.items) ||
      !snapshot.items.some((row: Raw) => row.key === item)
    )
      throw new NotFoundException("Item não encontrado nesta ata.");
    const results = await Promise.allSettled([
      this.client.units(record.number, record.uasg, item),
      this.client.commitments(record.number, record.uasg),
      this.client.adhesions(record.number, record.uasg, item),
    ]);
    for (let index = 0; index < kinds.length; index++) {
      const kind = kinds[index],
        result = results[index],
        itemNumber = kind === "commitments" ? "*" : item;
      const identity = { publicRecordId: id, itemNumber, kind };
      if (result.status === "fulfilled") {
        const data =
          kind === "units"
            ? mapUnits(result.value)
            : kind === "adhesions"
              ? mapAdhesions(result.value)
              : result.value;
        const update = {
          data: asJson(data),
          status: "loaded",
          lastSyncedAt: new Date(),
          error: null,
        };
        await this.db.catalogSupplement.upsert({
          where: { publicRecordId_itemNumber_kind: identity },
          create: { ...identity, ...update },
          update,
        });
      } else {
        const update = {
          status: "error",
          error:
            "Não foi possível atualizar esta parte no Compras.gov. A última consulta salva foi preservada.",
        };
        await this.db.catalogSupplement.upsert({
          where: { publicRecordId_itemNumber_kind: identity },
          create: { ...identity, ...update, data: [] },
          update,
        });
      }
    }
    const rows = await this.db.catalogSupplement.findMany({
      where: { publicRecordId: id },
    });
    return plain<ItemSupplement>(presentSupplement(rows, item));
  }
}
