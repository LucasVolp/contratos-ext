import { randomUUID } from "node:crypto";
import { SqlConnection } from "../database";
import { NotFoundException } from "../errors";
// Identifiers come exclusively from repository constants, never from HTTP input.
export const quote = (identifier: string) =>
  '"' + identifier.replace(/"/g, '""') + '"';
export class Conditions {
  readonly values: unknown[] = [];
  readonly clauses: string[] = [];
  param(value: unknown) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
  add(clause: string) {
    this.clauses.push(clause);
  }
  search(term: unknown, columns: string[]) {
    if (!term) return;
    // Match literal text, including SQL wildcard characters.
    const pattern = this.param(
      "%" + String(term).replace(/[\\%_]/g, "\\$&") + "%",
    );
    this.add(
      "(" + columns.map((c) => `${c} ILIKE ${pattern}`).join(" OR ") + ")",
    );
  }
  get text() {
    return this.clauses.length ? this.clauses.join(" AND ") : "TRUE";
  }
}
export async function insert<T extends object>(
  db: SqlConnection,
  table: string,
  columns: readonly string[],
  data: Record<string, unknown>,
  conflict = "",
): Promise<T> {
  const fields = [
    "id",
    ...columns.filter((c) => data[c] !== undefined && c !== "id"),
  ];
  const values = fields.map((c) =>
    c === "id" ? (data.id ?? randomUUID()) : jsonValue(c, data[c]),
  );
  const rows = await db.query(
    `INSERT INTO ${quote(table)} (${fields.map(quote).join(", ")}) VALUES (${values.map((_, i) => "$" + (i + 1)).join(", ")}) ${conflict} RETURNING *`,
    values,
  );
  return rows[0] as T;
}
export async function update<T extends object>(
  db: SqlConnection,
  table: string,
  columns: readonly string[],
  id: string,
  data: Record<string, unknown>,
): Promise<T> {
  const fields = columns.filter((c) => data[c] !== undefined && c !== "id");
  const values = fields.map((c) => jsonValue(c, data[c]));
  values.push(id);
  const rows = await db.query(
    `UPDATE ${quote(table)} SET ${fields.map((c, i) => `${quote(c)}=$${i + 1}`).join(", ")} WHERE id=$${values.length}::uuid RETURNING *`,
    values,
  );
  if (!rows[0]) throw new NotFoundException("Registro não encontrado.");
  return rows[0] as T;
}
function jsonValue(column: string, value: unknown) {
  return ["summary", "snapshot", "data"].includes(column)
    ? JSON.stringify(value)
    : value;
}
