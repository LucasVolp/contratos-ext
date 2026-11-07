"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { ErrorState, Loading } from "@/components/ui";
import type { Page } from "@/lib/finance-types";

export type FinancialRow = Record<string, string | number | boolean | null>;
export type Column = {
  key: string;
  label: string;
  money?: boolean;
  date?: boolean;
  link?: (row: FinancialRow) => string;
};
export function money(value: unknown) {
  if (value === null || value === undefined || value === "")
    return "Não informado";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return "Não informado";
  return `${match[1]}R$ ${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${(match[3] || "").padEnd(2, "0")}`;
}
export function display(value: unknown) {
  return value === null || value === undefined || value === ""
    ? "Não informado"
    : String(value);
}
export function calendar(value: unknown) {
  return value
    ? String(value).slice(0, 10).split("-").reverse().join("/")
    : "Não informada";
}
export function useFinance<T>(path: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    path: string | null;
    data?: T;
    error?: Error;
  }>({ path: null });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(`/finance/${path}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ path, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ path, error });
      });
    return () => controller.abort();
  }, [path, attempt]);
  return {
    data: state.path === path ? state.data : undefined,
    error: state.path === path ? state.error : undefined,
    retry: () => {
      setState({ path: null });
      setAttempt((n) => n + 1);
    },
  };
}
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
  const params = new URLSearchParams(query);
  const scope = new URLSearchParams();
  const code =
    params.get("managementCode") || params.get("subordinateAgencyCode");
  const year = params.get("fiscalYear");
  if (year) scope.set("fiscalYear", year);
  return (
    <nav className="catalog-tabs" aria-label="Consultas financeiras">
      {[
        ["commitments", "empenhos", "Empenhos"],
        ["execution", "execucao", "Execução mensal"],
        ["budgets", "loa", "LOA institucional"],
      ].map(([key, route, label]) => {
        const q = new URLSearchParams(scope);
        if (code)
          q.set(
            key === "budgets" ? "subordinateAgencyCode" : "managementCode",
            code,
          );
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
  function href(page: number) {
    const q = new URLSearchParams(query);
    q.set(pageKey, String(page));
    return `?${q}`;
  }
  return (
    <div className="pager">
      <span>
        {result.total
          ? `${Math.min((result.page - 1) * result.limit + 1, result.total)}–${Math.min(result.page * result.limit, result.total)}`
          : "0"}{" "}
        de {result.total} registros
      </span>
      <div>
        {result.page > 1 && (
          <Link
            className="button secondary"
            href={href(result.page - 1)}
            scroll={false}
          >
            Anterior
          </Link>
        )}
        <span>
          Página {result.page} de{" "}
          {Math.max(1, Math.ceil(result.total / result.limit))}
        </span>
        {result.page * result.limit < result.total && (
          <Link
            className="button secondary"
            href={href(result.page + 1)}
            scroll={false}
          >
            Próxima
          </Link>
        )}
      </div>
    </div>
  );
}
export function FinanceEmpty() {
  return (
    <div className="empty">
      <h2>Nenhum registro encontrado.</h2>
      <p>
        Revise os filtros ou consulte outro período. Os dados podem ainda não
        estar disponíveis.
      </p>
    </div>
  );
}
export function Metrics({
  values,
  columns,
}: {
  values: object;
  columns: Column[];
}) {
  const record = values as Record<string, unknown>;
  return (
    <dl className="finance-metrics">
      {columns.map((c) => (
        <div key={c.key}>
          <dt>{c.label}</dt>
          <dd>{money(record[c.key])}</dd>
        </div>
      ))}
    </dl>
  );
}
