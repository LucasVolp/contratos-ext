import { SqlConnection } from "../database";
import { PublicPurchase, PublicRecord, CatalogSupplement } from "../models";
import {
  publicPurchaseColumns,
  publicRecordColumns,
  catalogSupplementColumns,
} from "./columns";
import { Conditions, insert, update, quote } from "./sql";
export interface CatalogFilters {
  uasg?: string;
  scope?: string[] | null;
  from?: string;
  to?: string;
  search?: string;
}
function conditions(f: CatalogFilters, purchase: boolean) {
  const c = new Conditions();
  if (f.scope) c.add(`uasg=ANY(${c.param(f.scope)}::text[])`);
  if (f.uasg) c.add(`uasg=${c.param(f.uasg)}`);
  if (purchase) {
    if (f.from || f.to) c.add('"publishedAt" IS NOT NULL');
    if (f.from) c.add(`"publishedAt">=${c.param(f.from)}`);
    if (f.to) c.add(`"publishedAt"<=${c.param(f.to)}`);
  } else {
    if (f.from || f.to)
      c.add('"startDate" IS NOT NULL AND "endDate" IS NOT NULL');
    if (f.from) c.add(`"endDate">=${c.param(f.from)}`);
    if (f.to) c.add(`"startDate"<=${c.param(f.to)}`);
  }
  c.search(
    f.search,
    purchase
      ? [
          "number",
          "object",
          '"processNumber"',
          '"organizationName"',
          '"unitName"',
        ]
      : [
          "number",
          "object",
          '"organizationName"',
          '"unitName"',
          '"purchaseNumber"',
        ],
  );
  return c;
}
function upsertSummary<T extends object>(
  db: SqlConnection,
  table: string,
  columns: readonly string[],
  data: Record<string, unknown>,
) {
  // Summary imports deliberately leave existing detail snapshots untouched.
  const fields = columns.filter(
    (c) =>
      data[c] !== undefined &&
      !["createdAt", "snapshot", "detailsSyncedAt", "recordsSyncedAt"].includes(
        c,
      ),
  );
  return insert<T>(
    db,
    table,
    columns,
    data,
    `ON CONFLICT ("externalId") DO UPDATE SET ${fields.map((c) => `${quote(c)}=EXCLUDED.${quote(c)}`).join(", ")}`,
  );
}
export class PurchaseRepository {
  constructor(private readonly db: SqlConnection) {}
  async get(id: string) {
    return (
      (
        await this.db.query<PublicPurchase>(
          'SELECT * FROM "PublicPurchase" WHERE id=$1::uuid',
          [id],
        )
      )[0] ?? null
    );
  }
  async byExternalId(externalId: string) {
    return (
      (
        await this.db.query<PublicPurchase>(
          'SELECT * FROM "PublicPurchase" WHERE "externalId"=$1',
          [externalId],
        )
      )[0] ?? null
    );
  }
  async byPncpId(pncpId: string) {
    return (
      (
        await this.db.query<PublicPurchase>(
          'SELECT * FROM "PublicPurchase" WHERE "pncpId"=$1 ORDER BY id LIMIT 1',
          [pncpId],
        )
      )[0] ?? null
    );
  }
  list(f: CatalogFilters, page: number, limit: number) {
    const c = conditions(f, true),
      where = c.text;
    return this.db.query<PublicPurchase>(
      `SELECT * FROM "PublicPurchase" WHERE ${where} ORDER BY "publishedAt" DESC NULLS LAST, id ASC LIMIT ${c.param(limit)} OFFSET ${c.param((page - 1) * limit)}`,
      c.values,
    );
  }
  async stats(f: CatalogFilters) {
    const c = conditions(f, true);
    return (
      await this.db.query<{
        count: number;
        srpCount: number;
        estimatedValue: string | null;
        awardedValue: string | null;
        homologated: {
          count: number;
          estimatedValue: string | null;
          awardedValue: string | null;
        };
      }>(
        `SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE srp IS TRUE)::int AS "srpCount", SUM("estimatedValue") AS "estimatedValue", SUM("awardedValue") AS "awardedValue",jsonb_build_object('count',count(*) FILTER (WHERE "estimatedValue" IS NOT NULL AND "awardedValue" IS NOT NULL),'estimatedValue',(sum("estimatedValue") FILTER (WHERE "estimatedValue" IS NOT NULL AND "awardedValue" IS NOT NULL))::text,'awardedValue',(sum("awardedValue") FILTER (WHERE "estimatedValue" IS NOT NULL AND "awardedValue" IS NOT NULL))::text) AS homologated FROM "PublicPurchase" WHERE ${c.text}`,
        c.values,
      )
    )[0];
  }
  links(externalIds: string[], pncpIds: string[]) {
    return this.db.query<Pick<PublicPurchase, "id" | "externalId" | "pncpId">>(
      'SELECT id, "externalId", "pncpId" FROM "PublicPurchase" WHERE "externalId"=ANY($1::text[]) OR "pncpId"=ANY($2::text[])',
      [externalIds, pncpIds],
    );
  }
  upsert(data: Record<string, unknown>) {
    return upsertSummary<PublicPurchase>(
      this.db,
      "PublicPurchase",
      publicPurchaseColumns,
      data,
    );
  }
  update(id: string, data: Record<string, unknown>) {
    return update<PublicPurchase>(
      this.db,
      "PublicPurchase",
      publicPurchaseColumns,
      id,
      data,
    );
  }
  async mergeSnapshot(id: string, snapshot: unknown) {
    await this.db.query(
      'UPDATE "PublicPurchase" SET snapshot=snapshot || $1::jsonb WHERE id=$2::uuid',
      [JSON.stringify(snapshot), id],
    );
  }
}
export class PublicRecordRepository {
  constructor(private readonly db: SqlConnection) {}
  async get(id: string) {
    return (
      (
        await this.db.query<PublicRecord>(
          'SELECT * FROM "PublicRecord" WHERE id=$1::uuid',
          [id],
        )
      )[0] ?? null
    );
  }
  async byExternalId(id: string) {
    return (
      (
        await this.db.query<PublicRecord>(
          'SELECT * FROM "PublicRecord" WHERE "externalId"=$1',
          [id],
        )
      )[0] ?? null
    );
  }
  byExternalIds(ids: string[]) {
    return this.db.query<PublicRecord>(
      'SELECT * FROM "PublicRecord" WHERE "externalId"=ANY($1::text[])',
      [ids],
    );
  }
  linkedTo(purchase: { externalId: string; pncpId: string | null }) {
    return this.db.query<PublicRecord>(
      'SELECT * FROM "PublicRecord" WHERE "purchaseExternalId"=$1 OR ("purchaseExternalId" IS NULL AND "purchasePncpId"=$2) ORDER BY "startDate" DESC NULLS LAST',
      [purchase.externalId, purchase.pncpId],
    );
  }
  list(f: CatalogFilters, page: number, limit: number) {
    const c = conditions(f, false),
      where = c.text;
    return this.db.query<PublicRecord>(
      `SELECT * FROM "PublicRecord" WHERE ${where} ORDER BY "startDate" DESC NULLS LAST, id ASC LIMIT ${c.param(limit)} OFFSET ${c.param((page - 1) * limit)}`,
      c.values,
    );
  }
  async stats(f: CatalogFilters) {
    const c = conditions(f, false);
    const where = c.text;
    const today = new Date().toISOString().slice(0, 10);
    const boundary = new Date(today + "T00:00:00Z");
    boundary.setUTCDate(boundary.getUTCDate() + 90);
    const day = c.param(today),
      horizon = c.param(boundary.toISOString().slice(0, 10));
    const active = `"startDate"<=${day} AND "endDate">=${day}`;
    return (
      await this.db.query<{
        count: number;
        totalValue: string | null;
        vigency: {
          active: number;
          expiring: number;
          ended: number;
          activeValue: string | null;
        };
        withDocuments: number;
      }>(
        `
     SELECT count(*)::int AS count,sum("totalValue") AS "totalValue",
      jsonb_build_object('active',count(*) FILTER (WHERE ${active}),'expiring',count(*) FILTER (WHERE ${active} AND "endDate"<=${horizon}),'ended',count(*) FILTER (WHERE "endDate"<${day}),'activeValue',(sum("totalValue") FILTER (WHERE ${active}))::text) AS vigency,
      count(*) FILTER (WHERE EXISTS(SELECT 1 FROM "PriceRecord" r WHERE r."sourcePublicRecordId"="PublicRecord".id))::int AS "withDocuments"
     FROM "PublicRecord" WHERE ${where}`,
        c.values,
      )
    )[0];
  }
  upsert(data: Record<string, unknown>) {
    return upsertSummary<PublicRecord>(
      this.db,
      "PublicRecord",
      publicRecordColumns,
      data,
    );
  }
  update(id: string, data: Record<string, unknown>) {
    return update<PublicRecord>(
      this.db,
      "PublicRecord",
      publicRecordColumns,
      id,
      data,
    );
  }
}
export class SupplementRepository {
  constructor(private readonly db: SqlConnection) {}
  list(publicRecordId: string) {
    return this.db.query<CatalogSupplement>(
      'SELECT * FROM "CatalogSupplement" WHERE "publicRecordId"=$1::uuid',
      [publicRecordId],
    );
  }
  store(
    identity: {
      publicRecordId: string;
      itemNumber: string;
      kind: string;
    },
    changes: Record<string, unknown>,
  ) {
    const fields = catalogSupplementColumns.filter(
      (c) => changes[c] !== undefined,
    );
    return insert<CatalogSupplement>(
      this.db,
      "CatalogSupplement",
      catalogSupplementColumns,
      { ...identity, data: [], ...changes },
      `ON CONFLICT ("publicRecordId", "itemNumber", kind) DO UPDATE SET ${fields.map((c) => `${quote(c)}=EXCLUDED.${quote(c)}`).join(", ")}`,
    );
  }
}
