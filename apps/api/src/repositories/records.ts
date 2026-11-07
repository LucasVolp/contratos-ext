import { readiness } from "../domain";
import { Database, SqlConnection } from "../database";
import { PriceRecord, RecordItem, DocumentExport } from "../models";
import {
  priceRecordColumns,
  recordItemColumns,
  documentExportColumns,
} from "./columns";
import { Conditions, insert, update } from "./sql";
type RecordDetail = PriceRecord & {
  items: RecordItem[];
  exports?: ExportSummary[];
};
type ExportSummary = Pick<
  DocumentExport,
  "id" | "format" | "templateVersion" | "createdAt" | "itemNumber"
>;
function searchCondition(search?: string, scope: string[] | null = null) {
  const c = new Conditions();
  if (scope) c.add(`r.uasg=ANY(${c.param(scope)}::text[])`);
  c.search(search, [
    "r.number",
    "r.object",
    'r."supplierName"',
    'r."organizationName"',
    "r.uasg",
  ]);
  return c;
}
export class RecordRepository {
  constructor(private readonly db: Database) {}
  async get(id: string): Promise<RecordDetail | null> {
    const row = (
      await this.db.query<PriceRecord>(
        'SELECT * FROM "PriceRecord" WHERE id=$1::uuid',
        [id],
      )
    )[0];
    if (!row) return null;
    const [items, exports] = await Promise.all([
      this.items([id]),
      new ExportRepository(this.db).list(id),
    ]);
    return { ...row, items, exports };
  }
  private items(ids: string[]) {
    return this.db.query<RecordItem>(
      'SELECT * FROM "RecordItem" WHERE "recordId"=ANY($1::uuid[]) ORDER BY number ASC',
      [ids],
    );
  }
  async bySource(id: string, supplier: string) {
    return (
      (
        await this.db.query<PriceRecord>(
          'SELECT * FROM "PriceRecord" WHERE "sourcePublicRecordId"=$1::uuid AND "sourceSupplierDocument"=$2',
          [id, supplier],
        )
      )[0] ?? null
    );
  }
  byIdentity(number: string, uasg: string) {
    return this.db.query<PriceRecord>(
      'SELECT * FROM "PriceRecord" WHERE number=$1 AND uasg=$2',
      [number, uasg],
    );
  }
  async list(
    search: string | undefined,
    page: number,
    limit: number,
    scope: string[] | null = null,
  ): Promise<RecordDetail[]> {
    const c = searchCondition(search, scope),
      where = c.text;
    const rows = await this.db.query<PriceRecord>(
      `SELECT r.* FROM "PriceRecord" r WHERE ${where} ORDER BY r."updatedAt" DESC, r.id ASC LIMIT ${c.param(limit)} OFFSET ${c.param((page - 1) * limit)}`,
      c.values,
    );
    const items = rows.length ? await this.items(rows.map((r) => r.id)) : [];
    return rows.map((row) => ({
      ...row,
      items: items.filter((item) => item.recordId === row.id),
    }));
  }
  async stats(search?: string, scope: string[] | null = null) {
    const c = searchCondition(search, scope);
    const result = (
      await this.db.query<{
        count: number;
        totalValue: string;
        exportsCount: number;
        exported: number;
      }>(
        `SELECT COUNT(*)::int AS count,
      COALESCE(SUM((SELECT SUM(i.quantity*i."unitPrice") FROM "RecordItem" i WHERE i."recordId"=r.id)),0) AS "totalValue",
      COALESCE(SUM((SELECT COUNT(*) FROM "DocumentExport" e WHERE e."recordId"=r.id)),0)::int AS "exportsCount",
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "DocumentExport" e WHERE e."recordId"=r.id))::int AS exported
      FROM "PriceRecord" r WHERE ${c.text}`,
        c.values,
      )
    )[0];
    const rows = await this.list(search, 1, 2147483647, scope);
    return {
      ...result,
      ready: rows.filter((row) => readiness(row).ready).length,
    };
  }
  save(
    id: string | null,
    fields: Record<string, unknown>,
    items: (Pick<
      RecordItem,
      "number" | "quantity" | "minimumQuantity" | "unitPrice"
    > &
      Partial<RecordItem>)[],
  ) {
    return this.db.transaction(async (tx) => {
      const data = { ...fields, updatedAt: new Date() };
      const record = id
        ? await update<PriceRecord>(
            tx,
            "PriceRecord",
            priceRecordColumns,
            id,
            data,
          )
        : await insert<PriceRecord>(
            tx,
            "PriceRecord",
            priceRecordColumns,
            data,
          );
      if (id)
        await tx.query('DELETE FROM "RecordItem" WHERE "recordId"=$1::uuid', [
          id,
        ]);
      const savedItems = [];
      for (const item of items)
        savedItems.push(
          await insert<RecordItem>(tx, "RecordItem", recordItemColumns, {
            ...item,
            recordId: record.id,
          }),
        );
      return {
        ...record,
        items: savedItems.sort((a, b) => a.number - b.number),
      };
    });
  }
  async remove(id: string) {
    await this.db.query('DELETE FROM "PriceRecord" WHERE id=$1::uuid', [id]);
  }
}
export class ExportRepository {
  constructor(private readonly db: SqlConnection) {}
  list(recordId: string) {
    return this.db.query<ExportSummary>(
      'SELECT id, format, "templateVersion", "createdAt", "itemNumber" FROM "DocumentExport" WHERE "recordId"=$1::uuid ORDER BY "createdAt" DESC',
      [recordId],
    );
  }
  create(data: Record<string, unknown>) {
    return insert<DocumentExport>(
      this.db,
      "DocumentExport",
      documentExportColumns,
      data,
    );
  }
}
