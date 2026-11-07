import {
  BadRequestException,
  BadGatewayException,
  NotFoundException,
  UnprocessableEntityException,
} from "../errors";
import { Repositories } from "../repositories";
import { PublicPurchase, PublicRecord } from "../models";
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
import { asJson, plain, filters, syncRange } from "./helpers";
import {
  linkedPurchaseCache,
  purchaseResultEvidence,
} from "./purchase-evidence";
import { AutomaticRefresh, fresh } from "./automatic";
import { CatalogDrafts } from "./drafts";
import { CatalogSupplements, presentSupplement } from "./supplements";
import { assertUasg, inScope, narrowScope, Scope } from "../auth/access";
import { AuthRepository } from "../auth/repository";
export class CatalogService {
  private readonly automatic = new AutomaticRefresh();
  private readonly supplements: CatalogSupplements;
  constructor(
    readonly db: Repositories,
    readonly client: CatalogClient = new CatalogClient(),
  ) {
    this.supplements = new CatalogSupplements(db, client);
  }
  async purchases(query: Raw, scope: Scope = null) {
    filters(query);
    const { page, limit } = pagination(query);
    const [rows, stats] = await Promise.all([
      this.db.purchases.list(
        { ...query, scope: narrowScope(scope, query.uasgs) },
        page,
        limit,
      ),
      this.db.purchases.stats({
        ...query,
        scope: narrowScope(scope, query.uasgs),
      }),
    ]);
    return plain({
      data: rows.map((row) => this.purchaseSummary(row)),
      total: stats.count,
      page,
      limit,
      stats,
    });
  }
  purchaseSummary(row: PublicPurchase) {
    const { summary, snapshot, ...result } = row;
    return {
      ...result,
      recordsLookup: (snapshot as Raw).recordsLookup ?? null,
    };
  }
  async authorizePurchase(id: string, scope: Scope) {
    const row = await this.db.purchases.get(id);
    if (row && !inScope(scope, row.uasg))
      throw new NotFoundException("Pregão não encontrado no catálogo local.");
  }
  async authorizeRecord(id: string, scope: Scope) {
    const row = await this.db.publicRecords.get(id);
    if (row && !inScope(scope, row.uasg))
      throw new NotFoundException(
        "Ata publicada não encontrada no catálogo local.",
      );
  }
  async purchaseRow(id: string) {
    const row = await this.db.purchases.get(id);
    if (!row)
      throw new NotFoundException(
        "Pregão não encontrado no catálogo local. Consulte a UASG e o período para importar.",
      );
    return row;
  }
  async purchase(id: string) {
    const row = await this.purchaseRow(id);
    const linked = await this.db.publicRecords.linkedTo(row);
    const linkedRecords = await this.recordSummaries(linked);
    return plain({
      ...this.purchaseSummary(row),
      items: (row.snapshot as Raw).items ?? [],
      linkedRecords,
    });
  }
  async syncPurchases(body: Raw, scope: Scope = null) {
    const { uasg, from, to } = syncRange(body, 366);
    assertUasg(scope, uasg);
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
    return this.db.transaction(
      async (tx) => {
        let created = 0,
          updated = 0;
        for (const row of rows) {
          const existing = await tx.purchases.byExternalId(row.data.externalId);
          const data = {
            ...row.data,
            lastSyncedAt: new Date(),
            summary: asJson(row.raw),
          };
          await tx.purchases.upsert(data);
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
    await this.db.transaction(async (tx) => {
      await tx.purchases.update(id, {
        ...mapPurchase(header),
        summary: asJson(header),
        lastSyncedAt: new Date(),
        detailsSyncedAt: new Date(),
      });
      // Merge independent snapshot sections so detail refresh cannot erase
      // the result of a concurrent linked-record lookup.
      await tx.purchases.mergeSnapshot(id, snapshot);
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
      ? await this.db.purchases.links(externalIds, pncpIds)
      : [];
    return rows.map((row) => {
      const { summary, snapshot, ...result } = row;
      const purchase = purchases.find((p) => linkedToPurchase(row, p));
      return { ...result, linkedPurchaseId: purchase?.id ?? null };
    });
  }
  async records(query: Raw, scope: Scope = null) {
    filters(query);
    const { page, limit } = pagination(query);
    const [rows, stats] = await Promise.all([
      this.db.publicRecords.list(
        { ...query, scope: narrowScope(scope, query.uasgs) },
        page,
        limit,
      ),
      this.db.publicRecords.stats({
        ...query,
        scope: narrowScope(scope, query.uasgs),
      }),
    ]);
    return plain({
      data: await this.recordSummaries(rows),
      total: stats.count,
      page,
      limit,
      stats,
    });
  }
  async recordRow(id: string) {
    const row = await this.db.publicRecords.get(id);
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
    const supplements = await this.db.supplements.list(id);
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
  private async storeRecords(tx: Repositories, rows: Raw[]) {
    let created = 0,
      updated = 0;
    for (const raw of rows) {
      const mapped = mapPublicRecord(raw);
      const existing = await tx.publicRecords.byExternalId(mapped.externalId);
      const data = {
        ...mapped,
        summary: asJson(raw),
        lastSyncedAt: new Date(),
      };
      await tx.publicRecords.upsert(data);
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
  async syncRecords(body: Raw, scope: Scope = null) {
    const { uasg, from, to } = syncRange(body);
    assertUasg(scope, uasg);
    const fetched = (await this.client.records(uasg, from, to)).filter(
      (raw) => !raw.ataExcluido,
    );
    const rows = this.uniqueRecords(
      fetched.filter((raw) => string(raw.numeroControlePncpAta).trim()),
    );
    const incompleteRecords = fetched
      .filter((raw) => !string(raw.numeroControlePncpAta).trim())
      .map((raw) => ({ number: string(raw.numeroAtaRegistroPreco) }));
    const stored = await this.db.transaction(
      (tx) => this.storeRecords(tx, rows),
      { timeout: 60000 },
    );
    return { ...stored, incompleteRecords };
  }
  async syncReach(kind: "purchases" | "records", body: Raw, scope: Scope) {
    const requested = narrowScope(scope, body?.uasgs);
    const institutions = await this.db.institutions(requested);
    const names = new Map(institutions.map((i) => [i.uasg, i.name]));
    const uasgs = (requested ?? institutions.map((i) => i.uasg))
      .slice()
      .sort((a, b) =>
        (names.get(a) ?? a).localeCompare(names.get(b) ?? b, "pt-BR"),
      );
    if (!uasgs.length)
      throw new UnprocessableEntityException(
        "Nenhuma UASG para atualizar. Vincule instituições ao seu perfil ou cadastre instituições.",
      );
    // Validate the period once, with field errors, before any public request.
    const { from, to } = syncRange(
      { uasg: uasgs[0], from: body?.from, to: body?.to },
      kind === "purchases" ? 366 : undefined,
    );
    const results: Array<{
      uasg: string;
      name: string | null;
      created: number;
      updated: number;
      total: number;
      incomplete: number;
      error: string | null;
    }> = [];
    const queue = [...uasgs];
    // A few units at a time keeps the public API load modest and the wait short.
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        for (let uasg = queue.shift(); uasg; uasg = queue.shift()) {
          const base = { uasg, name: names.get(uasg) ?? null };
          try {
            const result =
              kind === "purchases"
                ? await this.syncPurchases({ uasg, from, to }, scope)
                : await this.syncRecords({ uasg, from, to }, scope);
            results.push({
              ...base,
              created: result.created,
              updated: result.updated,
              total: result.total,
              incomplete:
                (result as { incompleteRecords?: unknown[] }).incompleteRecords
                  ?.length ?? 0,
              error: null,
            });
          } catch (error) {
            results.push({
              ...base,
              created: 0,
              updated: 0,
              total: 0,
              incomplete: 0,
              error:
                error instanceof Error && "statusCode" in error
                  ? error.message
                  : "Não foi possível consultar esta UASG no Compras.gov. Os dados salvos foram preservados.",
            });
          }
        }
      }),
    );
    results.sort((a, b) => uasgs.indexOf(a.uasg) - uasgs.indexOf(b.uasg));
    const sum = (key: "created" | "updated" | "total" | "incomplete") =>
      results.reduce((total, row) => total + row[key], 0);
    return {
      from,
      to,
      created: sum("created"),
      updated: sum("updated"),
      total: sum("total"),
      incomplete: sum("incomplete"),
      failed: results.filter((row) => row.error).length,
      results,
    };
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
    // ARP listing spans the entire unit; unrelated incomplete rows must not
    // prevent this purchase's lookup from completing.
    const matching = fetched.filter(
      (raw) =>
        !raw.ataExcluido && linkedToPurchase(mapPublicRecord(raw), purchase),
    );
    const recordsLookup = {
      incompleteRecords: matching
        .filter((raw) => !string(raw.numeroControlePncpAta).trim())
        .map((raw) => ({ number: string(raw.numeroAtaRegistroPreco) })),
    };
    const rows = this.uniqueRecords(
      matching.filter((raw) => string(raw.numeroControlePncpAta).trim()),
    );
    await this.db.transaction(
      async (tx) => {
        await this.storeRecords(tx, rows);
        await tx.purchases.update(id, { recordsSyncedAt: new Date() });
        await tx.purchases.mergeSnapshot(id, { recordsLookup });
      },
      { timeout: 60000 },
    );
    const records = await this.db.publicRecords.byExternalIds(
      rows.map((raw) => mapPublicRecord(raw).externalId),
    );
    return plain({
      total: records.length,
      records: await this.recordSummaries(records),
      recordsLookup,
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
              (r) =>
                !r.idCompra || string(r.idCompra) === mapped.purchaseExternalId,
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
    await this.db.publicRecords.update(id, {
      ...mapped,
      organizationName: purchase?.organizationName || mapped.organizationName,
      summary: asJson(header),
      snapshot: asJson(snapshot),
      lastSyncedAt: new Date(),
      detailsSyncedAt: new Date(),
    });
    return this.record(id);
  }
  ensurePurchase(id: string, body: Raw = {}) {
    return this.automatic.run(`purchase:${id}`, async () => {
      let row = await this.purchaseRow(id);
      const errors: {
        details?: string;
        records?: string;
      } = {};
      if (body.force === true || !fresh(row.detailsSyncedAt)) {
        const error = await this.automatic.stage(
          `purchase-details:${id}`,
          body.force === true,
          "Não foi possível atualizar os detalhes do pregão no Compras.gov. A última consulta salva foi preservada.",
          () => this.refreshPurchase(id),
        );
        if (error) errors.details = error;
      }
      row = await this.purchaseRow(id);
      if (
        row.srp === true &&
        (body.force === true || !fresh(row.recordsSyncedAt))
      ) {
        const error = await this.automatic.stage(
          `purchase-records:${id}`,
          body.force === true,
          "Não foi possível consultar as atas vinculadas no Compras.gov. A última consulta salva foi preservada.",
          () => this.refreshLinkedRecords(id),
        );
        if (error) errors.records = error;
      }
      return { data: await this.purchase(id), errors };
    });
  }
  ensureRecord(id: string, body: Raw = {}) {
    return this.automatic.run(`record:${id}`, async () => {
      const row = await this.recordRow(id);
      const errors: {
        details?: string;
      } = {};
      if (body.force === true || !fresh(row.detailsSyncedAt)) {
        const error = await this.automatic.stage(
          `record-details:${id}`,
          body.force === true,
          "Não foi possível atualizar os detalhes da ata no Compras.gov. A última consulta salva foi preservada.",
          () => this.refreshRecord(id),
        );
        if (error) errors.details = error;
      }
      return { data: await this.record(id), errors };
    });
  }
  refreshSupplements(id: string, body: Raw = {}) {
    return this.automatic.run(`supplements:${id}`, async () => {
      const summary = await this.supplements.refreshAll(
        id,
        body.force === true,
      );
      return {
        data: await this.record(id),
        errors: summary.failed
          ? {
              supplements:
                "Não foi possível atualizar todas as partes dos itens no Compras.gov. A última consulta salva foi preservada.",
            }
          : {},
        summary,
      };
    });
  }
  draft(id: string, body: Raw) {
    return new CatalogDrafts(this.db).create(id, body);
  }
  refreshSupplement(id: string, item: string) {
    return this.supplements.refresh(id, item);
  }
}
