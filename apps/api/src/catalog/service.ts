import {
  BadRequestException,
  BadGatewayException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  PrismaClient,
  Prisma,
  PublicPurchase,
  PublicRecord,
} from "../generated/prisma/client";
import { pagination } from "../domain";
import { CatalogClient } from "./client";
import { Raw, PurchaseSnapshot, RecordSnapshot } from "./types";
import {
  mapPurchase,
  mapPurchaseItems,
  mapPurchaseResultStates,
  mapPublicRecord,
  mapRecordItems,
  linkedToPurchase,
  requireIdentity,
  string,
} from "./mappers";
import { asJson, plain, filters, syncRange, linkedWhere } from "./helpers";
import { linkedPurchaseCache, purchaseResultEvidence } from "./purchase-evidence";
import { CatalogDrafts } from "./drafts";
import { CatalogSupplements, presentSupplement } from "./supplements";

export class CatalogService {
  constructor(
    readonly db: PrismaClient,
    readonly client: CatalogClient = new CatalogClient(),
  ) {}
  async purchases(query: Raw) {
    filters(query);
    const { page, limit } = pagination(query);
    const where: Prisma.PublicPurchaseWhereInput = {};
    if (query.uasg) where.uasg = String(query.uasg);
    if (query.from || query.to)
      where.publishedAt = {
        not: null,
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    if (query.search)
      where.OR = [
        "number",
        "object",
        "processNumber",
        "organizationName",
        "unitName",
      ].map((key) => ({
        [key]: { contains: String(query.search), mode: "insensitive" },
      }));
    const [rows, stats, srpCount] = await Promise.all([
      this.db.publicPurchase.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      }),
      this.db.publicPurchase.aggregate({
        where,
        _count: { _all: true },
        _sum: { estimatedValue: true, awardedValue: true },
      }),
      this.db.publicPurchase.count({ where: { AND: [where, { srp: true }] } }),
    ]);
    return plain({
      data: rows.map((row) => this.purchaseSummary(row)),
      total: stats._count._all,
      page,
      limit,
      stats: {
        count: stats._count._all,
        srpCount,
        estimatedValue: stats._sum.estimatedValue?.toString() ?? null,
        awardedValue: stats._sum.awardedValue?.toString() ?? null,
      },
    });
  }
  purchaseSummary(row: PublicPurchase) {
    const { summary, snapshot, ...result } = row;
    return result;
  }
  async purchaseRow(id: string) {
    const row = await this.db.publicPurchase.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException(
        "Pregão não encontrado no catálogo local. Consulte a UASG e o período para importar.",
      );
    return row;
  }
  async purchase(id: string) {
    const row = await this.purchaseRow(id);
    const linked = await this.db.publicRecord.findMany({
      where: linkedWhere(row),
      orderBy: { startDate: "desc" },
    });
    const linkedRecords = await this.recordSummaries(linked);
    return plain({
      ...this.purchaseSummary(row),
      items: (row.snapshot as Raw).items ?? [],
      linkedRecords,
    });
  }
  async syncPurchases(body: Raw) {
    const { uasg, from, to } = syncRange(body, 366);
    const fetched = await this.client.purchases(uasg, from, to);
    const rows = [
      ...new Map(
        fetched
          .filter((raw) => !raw.contratacaoExcluida)
          .map((raw) => {
            const data = mapPurchase(raw);
            requireIdentity(data.externalId, "contratação");
            return [data.externalId, { data, raw }] as const;
          }),
      ).values(),
    ];
    return this.db.$transaction(
      async (tx) => {
        let created = 0,
          updated = 0;
        for (const row of rows) {
          const existing = await tx.publicPurchase.findUnique({
            where: { externalId: row.data.externalId },
          });
          const data = {
            ...row.data,
            lastSyncedAt: new Date(),
            summary: asJson(row.raw),
          };
          await tx.publicPurchase.upsert({
            where: { externalId: row.data.externalId },
            create: data,
            update: data,
          });
          existing ? updated++ : created++;
        }
        return { created, updated, total: rows.length };
      },
      { timeout: 60000 },
    );
  }
  async refreshPurchase(id: string) {
    const row = await this.purchaseRow(id),
      response = await this.client.purchase(row.externalId);
    const header = response.headers.find(
      (r) => string(r.idCompra) === row.externalId,
    );
    if (!header)
      throw new NotFoundException(
        "O pregão não foi localizado na consulta pública. A última consulta local foi preservada.",
      );
    const items = response.items.filter(
        (r) => !r.idCompra || string(r.idCompra) === row.externalId,
      ),
      results = response.results.filter(
        (r) => !r.idCompra || string(r.idCompra) === row.externalId,
      );
    const snapshot: PurchaseSnapshot = {
      items: mapPurchaseItems(items, results),
      rawItems: items,
      rawResults: results,
    };
    await this.db.publicPurchase.update({
      where: { id },
      data: {
        ...mapPurchase(header),
        summary: asJson(header),
        snapshot: asJson(snapshot),
        lastSyncedAt: new Date(),
        detailsSyncedAt: new Date(),
      },
    });
    return this.purchase(id);
  }
  async recordSummaries(rows: PublicRecord[]) {
    const externalIds = rows
        .map((row) => row.purchaseExternalId)
        .filter((id): id is string => !!id),
      pncpIds = rows
        .filter((r) => !r.purchaseExternalId)
        .map((row) => row.purchasePncpId)
        .filter((id): id is string => !!id);
    const purchases = rows.length
      ? await this.db.publicPurchase.findMany({
          where: {
            OR: [
              { externalId: { in: externalIds } },
              { pncpId: { in: pncpIds } },
            ],
          },
          select: { id: true, externalId: true, pncpId: true },
        })
      : [];
    return rows.map((row) => {
      const { summary, snapshot, ...result } = row;
      const purchase = purchases.find((p) => linkedToPurchase(row, p));
      return { ...result, linkedPurchaseId: purchase?.id ?? null };
    });
  }
  async records(query: Raw) {
    filters(query);
    const { page, limit } = pagination(query);
    const where: Prisma.PublicRecordWhereInput = {};
    if (query.uasg) where.uasg = String(query.uasg);
    if (query.from || query.to)
      where.AND = [
        { startDate: { not: null } },
        { endDate: { not: null } },
        ...(query.from ? [{ endDate: { gte: String(query.from) } }] : []),
        ...(query.to ? [{ startDate: { lte: String(query.to) } }] : []),
      ];
    if (query.search)
      where.OR = [
        "number",
        "object",
        "organizationName",
        "unitName",
        "purchaseNumber",
      ].map((key) => ({
        [key]: { contains: String(query.search), mode: "insensitive" },
      }));
    const [rows, stats] = await Promise.all([
      this.db.publicRecord.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ startDate: "desc" }, { id: "asc" }],
      }),
      this.db.publicRecord.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalValue: true },
      }),
    ]);
    return plain({
      data: await this.recordSummaries(rows),
      total: stats._count._all,
      page,
      limit,
      stats: {
        count: stats._count._all,
        totalValue: stats._sum.totalValue?.toString() ?? null,
      },
    });
  }
  async recordRow(id: string) {
    const row = await this.db.publicRecord.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException(
        "Ata publicada não encontrada no catálogo local.",
      );
    return row;
  }
  async record(id: string) {
    const row = await this.recordRow(id),
      snapshot = row.snapshot as Raw;
    const summaries = await this.recordSummaries([row]);
    const supplements = await this.db.catalogSupplement.findMany({
      where: { publicRecordId: id },
    });
    const items = (snapshot.items ?? []).map((item: Raw) => ({
      ...item,
      supplement: presentSupplement(supplements, item.key),
    }));
    const suppliers = [
      ...new Map(
        items
          .filter((item: Raw) => item.supplierDocument)
          .map((item: Raw) => [
            item.supplierDocument,
            { document: item.supplierDocument, name: item.supplierName },
          ]),
      ).values(),
    ];
    return plain({
      ...summaries[0],
      items,
      suppliers,
      processNumber: snapshot.processNumber ?? "",
      organizationDocument: snapshot.organizationDocument ?? "",
      city: snapshot.city ?? "",
      state: snapshot.state ?? "",
    });
  }
  private async storeRecords(tx: Prisma.TransactionClient, rows: Raw[]) {
    let created = 0,
      updated = 0;
    for (const raw of rows) {
      const mapped = mapPublicRecord(raw);
      const existing = await tx.publicRecord.findUnique({
        where: { externalId: mapped.externalId },
      });
      const data = {
        ...mapped,
        summary: asJson(raw),
        lastSyncedAt: new Date(),
      };
      await tx.publicRecord.upsert({
        where: { externalId: mapped.externalId },
        create: data,
        update: data,
      });
      existing ? updated++ : created++;
    }
    return { created, updated, total: rows.length };
  }
  private uniqueRecords(rows: Raw[]) {
    return [
      ...new Map(
        rows
          .filter((raw) => !raw.ataExcluido)
          .map((raw) => {
            const id = mapPublicRecord(raw).externalId;
            requireIdentity(id, "ata");
            return [id, raw] as const;
          }),
      ).values(),
    ];
  }
  async syncRecords(body: Raw) {
    const { uasg, from, to } = syncRange(body);
    const rows = this.uniqueRecords(await this.client.records(uasg, from, to));
    return this.db.$transaction((tx) => this.storeRecords(tx, rows), {
      timeout: 60000,
    });
  }
  async refreshLinkedRecords(id: string, body: Raw = {}) {
    const purchase = await this.purchaseRow(id);
    if (purchase.srp !== true)
      throw new UnprocessableEntityException(
        purchase.srp === false
          ? "Esta contratação não utiliza registro de preços (SRP)."
          : "O caráter SRP desta contratação não está confirmado. Atualize os dados públicos antes de consultar atas vinculadas.",
      );
    const year =
      purchase.year ??
      (purchase.publishedAt ? Number(purchase.publishedAt.slice(0, 4)) : null);
    if (!year && (!body.from || !body.to))
      throw new UnprocessableEntityException(
        "Informe o período: a fonte não informou o ano da compra ou a publicação.",
      );
    const from = body.from ?? `${year}-01-01`,
      to = body.to ?? `${Number(year) + 1}-12-31`;
    filters({ from, to });
    if (!from || !to || from > to)
      throw new BadRequestException("Informe um período válido.");
    const fetched = await this.client.records(purchase.uasg, from, to);
    const rows = this.uniqueRecords(fetched).filter((raw) =>
      linkedToPurchase(mapPublicRecord(raw), purchase),
    );
    await this.db.$transaction(
      async (tx) => {
        await this.storeRecords(tx, rows);
        await tx.publicPurchase.update({
          where: { id },
          data: { recordsSyncedAt: new Date() },
        });
      },
      { timeout: 60000 },
    );
    const records = await this.db.publicRecord.findMany({
      where: {
        externalId: { in: rows.map((raw) => mapPublicRecord(raw).externalId) },
      },
    });
    return plain({
      total: records.length,
      records: await this.recordSummaries(records),
      from,
      to,
    });
  }
  async refreshRecord(id: string) {
    const row = await this.recordRow(id),
      response = await this.client.record(row.externalId);
    const header = response.headers.find(
      (r) => string(r.numeroControlePncpAta) === row.externalId,
    );
    if (!header)
      throw new NotFoundException(
        "A ata não foi localizada na consulta pública. A última consulta local foi preservada.",
      );
    const mapped = mapPublicRecord(header),
      old = row.snapshot as Raw;
    const rawItems = response.items.filter(
      (r) =>
        !r.numeroControlePncpAta ||
        string(r.numeroControlePncpAta) === row.externalId,
    );
    let purchaseHeader: Raw | undefined,
      purchaseItems: Raw[] = [];
    const cached = await linkedPurchaseCache(this.db, mapped);
    let evidence = purchaseResultEvidence(old, row.detailsSyncedAt, cached);
    if (cached) {
      purchaseHeader = cached.summary as Raw;
      purchaseItems = (cached.snapshot as Raw).rawItems ?? [];
    }
    if (mapped.purchaseExternalId) {
      try {
        const purchase = await this.client.purchase(mapped.purchaseExternalId);
        purchaseHeader =
          purchase.headers.find(
            (p) => string(p.idCompra) === mapped.purchaseExternalId,
          ) ?? purchaseHeader;
        purchaseItems = purchase.items.filter(
          (p) =>
            !p.idCompra || string(p.idCompra) === mapped.purchaseExternalId,
        );
        evidence = {
          states: mapPurchaseResultStates(
            purchaseItems,
            purchase.results.filter(
              (r) => !r.idCompra || string(r.idCompra) === mapped.purchaseExternalId,
            ),
          ),
          syncedAt: new Date().toISOString(),
        };
      } catch {
        /* Enrichment is optional: retain the last confirmed metadata and unit correspondence. */
      }
    }
    const purchase = purchaseHeader ? mapPurchase(purchaseHeader) : null;
    const name = string(
      purchaseHeader?.modalidadeNome ?? header.nomeModalidadeCompra,
    )
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const code = Number(
      purchaseHeader?.codigoModalidade ?? header.codigoModalidadeCompra,
    );
    const modality = name.includes("dispensa")
      ? "DISPENSA"
      : name.includes("pregao")
        ? "PREGAO"
        : !name && code === 6
          ? "DISPENSA"
          : !name && code === 5
            ? "PREGAO"
            : null;
    const mappedItems = mapRecordItems(rawItems, purchaseItems).map(
      (item, index) => ({
        ...item,
        unit:
          item.unit ||
          (old.items ?? []).find(
            (previous: Raw) =>
              previous.key === item.key &&
              previous.supplierDocument === item.supplierDocument,
          )?.unit ||
          "",
      }),
    );
    const snapshot: RecordSnapshot = {
      items: mappedItems,
      rawItems,
      purchaseResultStates: evidence.states,
      purchaseResultsSyncedAt: evidence.syncedAt,
      processNumber: purchase?.processNumber || old.processNumber || "",
      organizationDocument:
        purchase?.organizationDocument || old.organizationDocument || "",
      city: purchase?.city || old.city || "",
      state: purchase?.state || old.state || "",
      modality: modality ?? old.modality ?? null,
      purchaseSrp: purchase?.srp ?? old.purchaseSrp ?? null,
    };
    await this.db.publicRecord.update({
      where: { id },
      data: {
        ...mapped,
        organizationName: purchase?.organizationName || mapped.organizationName,
        summary: asJson(header),
        snapshot: asJson(snapshot),
        lastSyncedAt: new Date(),
        detailsSyncedAt: new Date(),
      },
    });
    return this.record(id);
  }
  draft(id: string, body: Raw) {
    return new CatalogDrafts(this.db).create(id, body);
  }
  refreshSupplement(id: string, item: string) {
    return new CatalogSupplements(this.db, this.client).refresh(id, item);
  }
}
