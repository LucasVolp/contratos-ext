"use client";
import { ErrorState } from "@/components/ui";
import { useSearchParams } from "next/navigation";
import { financePath } from "@/lib/finance-api";
import type { Page } from "@/lib/finance-types";
import {
  FinanceTable,
  FinancePager,
  FinanceEmpty,
  RequestState,
  type FinancialRow,
  type Column,
} from "./shared";
import { useFinanceQuery } from "./use-finance-query";
const flow: Column[] = [
  { key: "committedValue", label: "Empenhado", money: true },
  { key: "liquidatedValue", label: "Liquidado", money: true },
  { key: "paidValue", label: "Pago", money: true },
];
const columns: Record<string, Column[]> = {
  execution: [
    { key: "unitName", label: "Unidade" },
    { key: "expenseNature", label: "Natureza" },
    { key: "expenseElementName", label: "Descrição" },
    ...flow,
  ],
  budgets: [
    { key: "budgetaryUnitName", label: "Unidade orçamentária" },
    { key: "actionCode", label: "Ação" },
    { key: "actionName", label: "Descrição da ação" },
    { key: "expenseElementName", label: "Elemento" },
    { key: "initialBudget", label: "Inicial", money: true },
    { key: "updatedBudget", label: "Atualizado", money: true },
    { key: "executedBudget", label: "Executado", money: true },
  ],
};
export function PanelDetailTable({
  mode,
  query,
}: {
  mode: "execution" | "budgets";
  query: string;
}) {
  const params = useSearchParams();
  const { data, error, retry, loading } = useFinanceQuery<Page<FinancialRow>>(
    financePath(mode, query, { page: params.get("page") || "1", limit: "20" }),
    undefined,
    0,
    financePath(mode, query),
  );
  return (
    <section
      className="registry panel-detail-table"
      aria-label="Detalhamento do painel"
      aria-busy={loading}
    >
      <div className="registry-top">
        <h2>Detalhamento</h2>
        {data && <span>{data.total} agrupamentos</span>}
      </div>
      {error && <ErrorState message={error.message} retry={retry} />}
      {!data ? (
        !error && <RequestState retry={retry} />
      ) : (
        <>
          {data.data.length ? (
            <FinanceTable
              rows={data.data}
              columns={columns[mode]}
              caption="Registros do recorte selecionado"
            />
          ) : (
            <FinanceEmpty />
          )}
          <FinancePager
            result={data}
            query={query}
            loading={loading}
            requestedPage={params.get("page") || "1"}
          />
        </>
      )}
    </section>
  );
}
