import { SqlConnection } from "../database";
import { Contract } from "../models";
import { contractColumns } from "./columns";
import { Conditions, insert, update, quote } from "./sql";
export interface ContractFilters {
  uasg?: string;
  search?: string;
  from?: string | null;
  to?: string | null;
  status?: string;
  today: string;
  boundary: string;
}
// Status conditions share the same date boundaries as the domain presenter.
function statusSql(
  status: string | undefined,
  today: string,
  boundary: string,
  c: Conditions,
): string {
  const known = '"startDate" IS NOT NULL AND "endDate" IS NOT NULL';
  switch (status) {
    case "UNKNOWN":
      return '("startDate" IS NULL OR "endDate" IS NULL)';
    case "UPCOMING":
      return `(${known} AND "startDate">${c.param(today)})`;
    case "EXPIRED":
      return `(${known} AND "endDate"<${c.param(today)})`;
    case "EXPIRING":
      return `(${known} AND "startDate"<=${c.param(today)} AND "endDate">=${c.param(today)} AND "endDate"<=${c.param(boundary)})`;
    case "ACTIVE":
      return `(${known} AND "startDate"<=${c.param(today)} AND "endDate">${c.param(boundary)})`;
    default:
      return "TRUE";
  }
}
function conditions(f: ContractFilters) {
  const c = new Conditions();
  if (f.uasg) c.add(`uasg=${c.param(f.uasg)}`);
  c.search(f.search, [
    "number",
    "object",
    '"supplierName"',
    '"supplierDocument"',
    '"unitName"',
  ]);
  if (f.from || f.to)
    c.add('"startDate" IS NOT NULL AND "endDate" IS NOT NULL');
  if (f.from) c.add(`"endDate">=${c.param(f.from)}`);
  if (f.to) c.add(`"startDate"<=${c.param(f.to)}`);
  c.add(statusSql(f.status, f.today, f.boundary, c));
  return c;
}
export class ContractRepository {
  constructor(private readonly db: SqlConnection) {}
  async get(id: string) {
    return (
      (
        await this.db.query<Contract>(
          'SELECT * FROM "Contract" WHERE id=$1::uuid',
          [id],
        )
      )[0] ?? null
    );
  }
  async byIdentity(number: string, uasg: string) {
    return (
      (
        await this.db.query<Contract>(
          'SELECT * FROM "Contract" WHERE number=$1 AND uasg=$2',
          [number, uasg],
        )
      )[0] ?? null
    );
  }
  list(f: ContractFilters, page: number, limit: number) {
    const c = conditions(f),
      where = c.text;
    return this.db.query<Contract>(
      `SELECT * FROM "Contract" WHERE ${where} ORDER BY "updatedAt" DESC, id ASC LIMIT ${c.param(limit)} OFFSET ${c.param((page - 1) * limit)}`,
      c.values,
    );
  }
  async stats(f: ContractFilters) {
    const c = conditions(f),
      where = c.text,
      expiring = statusSql("EXPIRING", f.today, f.boundary, c);
    return (
      await this.db.query<{
        count: number;
        totalValue: string;
        expiringCount: number;
      }>(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM("globalValue"),0) AS "totalValue", COUNT(*) FILTER (WHERE ${expiring})::int AS "expiringCount" FROM "Contract" WHERE ${where}`,
        c.values,
      )
    )[0];
  }
  create(data: Record<string, unknown>) {
    return insert<Contract>(this.db, "Contract", contractColumns, {
      ...data,
      updatedAt: new Date(),
    });
  }
  update(id: string, data: Record<string, unknown>) {
    return update<Contract>(this.db, "Contract", contractColumns, id, {
      ...data,
      updatedAt: new Date(),
    });
  }
  upsert(data: Record<string, unknown>) {
    const fields = contractColumns.filter(
      (c) => data[c] !== undefined && c !== "createdAt",
    );
    return insert<Contract>(
      this.db,
      "Contract",
      contractColumns,
      { ...data, updatedAt: new Date() },
      `ON CONFLICT (number, uasg) DO UPDATE SET ${[...fields, "updatedAt"]
        .filter((c, i, a) => a.indexOf(c) === i)
        .map((c) => `${quote(c)}=EXCLUDED.${quote(c)}`)
        .join(", ")}`,
    );
  }
  async remove(id: string) {
    await this.db.query('DELETE FROM "Contract" WHERE id=$1::uuid', [id]);
  }
}
