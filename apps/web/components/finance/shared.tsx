"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatSourceDecimal } from "@/lib/decimal-display";
import { currency, date } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFinanceQuery } from "./use-finance-query";
import { ApiError } from "@/lib/api";
import { ErrorState, Loading, Pager, Empty } from "@/components/ui";
import type { Page } from "@/lib/finance-types";

const operationLabels: Record<string, string> = {
  CANCELLATION: "Anulação",
  COMMITMENT: "Empenho",
  REINFORCEMENT: "Reforço",
};
export type FinancialRow = Record<string, string | number | boolean | null>;
export type Column = {
  key: string;
  label: string;
  money?: boolean;
  date?: boolean;
  link?: (row: FinancialRow) => string;
};
export const money = currency;
export function display(value: unknown) {
  return value === null || value === undefined || value === ""
    ? "Não informado"
    : String(value);
}
export const calendar = date;
export const useFinance = useFinanceQuery;
export function RequestState({
  error,
  retry,
}: {
  error?: Error;
  retry: () => void;
}) {
  return error ? (
    <ErrorState
      title={
        error instanceof ApiError && error.status === 404
          ? "Empenho não encontrado"
          : undefined
      }
      message={
        error.message +
        (error instanceof ApiError && Object.keys(error.fieldErrors).length
          ? ` ${Object.values(error.fieldErrors).join(" ")}`
          : "")
      }
      retry={retry}
    />
  ) : (
    <Loading />
  );
}
export function FinanceTabs({
  active,
  query = "",
}: {
  active: string;
  query?: string;
}) {
  const { viewer } = useSession();
  const params = new URLSearchParams(query);
  const scope = new URLSearchParams();
  const code =
    params.get("managementCode") || params.get("subordinateAgencyCode");
  const year = params.get("fiscalYear");
  if (year) scope.set("fiscalYear", year);
  return (
    <nav className="catalog-tabs" aria-label="Consultas financeiras">
      {[
        ["execution", "", "Visão geral"],
        ["commitments", "empenhos", "Empenhos"],
        ["budgets", "loa", "LOA institucional"],
      ]
        .filter(([key]) => key !== "budgets" || viewer.allInstitutions)
        .map(([key, route, label]) => {
          const q = new URLSearchParams(scope);
          if (code)
            q.set(
              key === "budgets" ? "subordinateAgencyCode" : "managementCode",
              code,
            );
          if (key !== "budgets") {
            const unit = params.get("managementUnitCode");
            if (unit) q.set("managementUnitCode", unit);
          }
          return (
            <Link
              key={key}
              href={`/financeiro/${route}${q.size ? `?${q}` : ""}`}
              aria-current={active === key ? "page" : undefined}
            >
              {label}
            </Link>
          );
        })}
    </nav>
  );
}
export function FinanceTable({
  rows,
  columns,
  caption,
}: {
  rows: FinancialRow[];
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
            <tr key={String(row.allocationId || row.id || i)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={c.money ? "finance-money" : undefined}
                >
                  {c.link ? (
                    <Link className="record-number" href={c.link(row)}>
                      {display(row[c.key])}
                    </Link>
                  ) : c.money ? (
                    money(row[c.key])
                  ) : c.date ? (
                    calendar(row[c.key])
                  ) : c.key === "quantity" ? (
                    formatSourceDecimal(row[c.key])
                  ) : c.key === "operationType" ? (
                    operationLabels[String(row[c.key])] || display(row[c.key])
                  ) : (
                    display(row[c.key])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function FinancePager({
  result,
  query,
  pageKey = "page",
}: {
  result: Page<unknown>;
  query: string;
  pageKey?: string;
}) {
  const router = useRouter();
  return (
    <Pager
      page={result.page}
      total={result.total}
      limit={result.limit}
      onChange={(page) => {
        const q = new URLSearchParams(query);
        q.set(pageKey, String(page));
        router.push(`?${q}`, { scroll: false });
      }}
    />
  );
}
export function FinanceEmpty() {
  return (
    <Empty
      kind="registro"
      href="/financeiro"
      title="Nenhum registro encontrado."
      description="Não há registros disponíveis nesta consulta. Revise os filtros ou consulte outro período."
      actionLabel="Voltar ao painel"
    />
  );
}
