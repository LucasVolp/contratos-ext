import {
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaClient, CatalogSupplement } from "../generated/prisma/client";
import { CatalogClient } from "./client";
import { ItemSupplement, Raw, SupplementKind, SupplementPart } from "./types";
import { mapUnits, mapCommitments, mapAdhesions } from "./mappers";
import { AutomaticRefresh, fresh } from "./automatic";
import { asJson, plain } from "./helpers";
export function itemIdentity(item: string): string | null {
  return /^\d+$/.test(item) ? BigInt(item).toString() : null;
}
const kinds: SupplementKind[] = ["units", "commitments", "adhesions"];
export function presentSupplement(
  rows: CatalogSupplement[],
  item: string,
): ItemSupplement {
  const part = (kind: SupplementKind): SupplementPart<any> => {
    const row = rows.find(
      (r) =>
        r.kind === kind &&
        (kind === "commitments"
          ? r.itemNumber === "*"
          : r.itemNumber === item ||
            (itemIdentity(item) !== null &&
              itemIdentity(r.itemNumber) === itemIdentity(item))),
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
  private readonly automatic = new AutomaticRefresh();
  constructor(
    private readonly db: PrismaClient,
    private readonly client: CatalogClient,
  ) {}
  private async record(id: string) {
    const record = await this.db.publicRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException("Ata publicada não encontrada.");
    if (
      !record.detailsSyncedAt ||
      !Array.isArray((record.snapshot as Raw).items)
    )
      throw new UnprocessableEntityException(
        "Atualize o detalhe da ata antes de consultar seus itens.",
      );
    return record;
  }
  private async load(
    id: string,
    record: { number: string; uasg: string },
    item: string,
    kind: SupplementKind,
    rows: CatalogSupplement[],
    force: boolean,
  ) {
    const itemNumber = kind === "commitments" ? "*" : item;
    // Keep the original provider key in storage while comparing only item numbers numerically.
    const existing = rows.filter(
      (r) =>
        r.kind === kind &&
        (r.itemNumber === itemNumber ||
          (kind !== "commitments" &&
            itemIdentity(r.itemNumber) !== null &&
            itemIdentity(r.itemNumber) === itemIdentity(item))),
    );
    if (
      !force &&
      existing.length &&
      existing.every((r) => r.status === "loaded" && fresh(r.lastSyncedAt))
    )
      return;
    const key = `${id}:${kind}:${kind === "commitments" ? "*" : (itemIdentity(item) ?? item)}`;
    await this.automatic.run(key, async () => {
      const message = await this.automatic.stage(
        key,
        force,
        "Não foi possível atualizar esta parte no Compras.gov. A última consulta salva foi preservada.",
        async () => {
          const raw = await (kind === "units"
            ? this.client.units(record.number, record.uasg, item)
            : kind === "adhesions"
              ? this.client.adhesions(record.number, record.uasg, item)
              : this.client.commitments(record.number, record.uasg));
          const data =
            kind === "units"
              ? mapUnits(raw)
              : kind === "adhesions"
                ? mapAdhesions(raw)
                : raw;
          await this.store(id, existing, itemNumber, kind, {
            data: asJson(data),
            status: "loaded",
            lastSyncedAt: new Date(),
            error: null,
          });
        },
      );
      if (message)
        await this.store(id, existing, itemNumber, kind, {
          status: "error",
          error: message,
        });
    });
  }
  private async store(
    id: string,
    existing: CatalogSupplement[],
    itemNumber: string,
    kind: SupplementKind,
    update: any,
  ) {
    for (const key of new Set(
      existing.length ? existing.map((r) => r.itemNumber) : [itemNumber],
    )) {
      const identity = { publicRecordId: id, itemNumber: key, kind };
      await this.db.catalogSupplement.upsert({
        where: { publicRecordId_itemNumber_kind: identity },
        create: { ...identity, data: [], ...update },
        update,
      });
    }
  }
  async refreshAll(id: string, force = false) {
    return this.automatic.run(`bulk:${id}`, async () => {
      const record = await this.record(id);
      const items = [
        ...new Map<string, string>(
          (record.snapshot as Raw).items
            .filter((row: Raw) => itemIdentity(String(row.key)) !== null)
            .map((row: Raw) => [
              itemIdentity(String(row.key))!,
              String(row.key),
            ]),
        ).values(),
      ];
      if (!items.length && (record.snapshot as Raw).items.length)
        throw new UnprocessableEntityException(
          "A fonte não informou números de item válidos para consultar os dados complementares.",
        );
      const rows = await this.db.catalogSupplement.findMany({
        where: { publicRecordId: id },
      });
      if (items.length)
        await Promise.all([
          this.load(id, record, items[0], "commitments", rows, force),
          ...items.flatMap((item) => [
            this.load(id, record, item, "units", rows, force),
            this.load(id, record, item, "adhesions", rows, force),
          ]),
        ]);
      const updated = await this.db.catalogSupplement.findMany({
        where: { publicRecordId: id },
      });
      const states = items.map((item) => presentSupplement(updated, item));
      return {
        items: items.length,
        loaded: states.filter((parts) =>
          kinds.every((kind) => parts[kind].status === "loaded"),
        ).length,
        failed: states.filter((parts) =>
          kinds.some((kind) => parts[kind].status === "error"),
        ).length,
      };
    });
  }
  async refresh(id: string, item: string) {
    const record = await this.record(id);
    if (!(record.snapshot as Raw).items.some((row: Raw) => row.key === item))
      throw new NotFoundException("Item não encontrado nesta ata.");
    const rows = await this.db.catalogSupplement.findMany({
      where: { publicRecordId: id },
    });
    await Promise.all(
      kinds.map((kind) => this.load(id, record, item, kind, rows, true)),
    );
    return plain<ItemSupplement>(
      presentSupplement(
        await this.db.catalogSupplement.findMany({
          where: { publicRecordId: id },
        }),
        item,
      ),
    );
  }
}
