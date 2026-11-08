import Link from "next/link";
import { currency as money, date as calendar } from "@/lib/api";

export type DataRow = Record<string, unknown>;
export type Column = {
  key: string;
  label: string;
  money?: boolean;
  date?: boolean;
  /** Internal route for the cell value. */
  link?: (row: DataRow) => string;
  /** External URL opened in a new tab; the cell shows the value or `linkText`. */
  externalLink?: (row: DataRow) => string | null;
  linkText?: string;
  /** Custom text for values the shared formatters do not cover (e.g. lists). */
  format?: (value: unknown, row: DataRow) => string;
};

export { currency as money, date as calendar } from "@/lib/api";
export function display(value: unknown) {
  return value === null || value === undefined || value === ""
    ? "Não informado"
    : String(value);
}

function cell(row: DataRow, column: Column) {
  const value = row[column.key];
  if (column.link)
    return (
      <Link className="record-number" href={column.link(row)}>
        {display(value)}
      </Link>
    );
  const external = column.externalLink?.(row);
  if (external)
    return (
      <a href={external} target="_blank" rel="noopener noreferrer">
        {value ? String(value) : (column.linkText ?? external)}
        <span className="sr-only"> (abre em nova aba)</span>
      </a>
    );
  if (column.format) return column.format(value, row);
  if (column.money) return money(value);
  if (column.date) return calendar(value);
  return display(value);
}

/** Accessible, horizontally scrollable table shared by every domain. */
export function DataTable({
  rows,
  columns,
  caption,
}: {
  rows: DataRow[];
  columns: Column[];
  caption: string;
}) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className="finance-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.allocationId || row.externalId || row.id || i)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={c.money ? "finance-money" : undefined}
                >
                  {cell(row, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
