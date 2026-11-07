"use client";
import { ErrorState, Loading } from "@/components/ui";
import { loadBudgetBreakdowns } from "@/lib/finance-api";
import type { BudgetBreakdowns } from "@/lib/finance-types";
import { RankingChart } from "./ranking-chart";
import { useFinanceQuery } from "./use-finance-query";
export function BudgetCharts({
  query,
  onChange,
  selectedAction,
  selectedGroup,
  refreshVersion,
}: {
  query: string;
  onChange: (changes: Record<string, string>) => void;
  selectedAction: string | null;
  selectedGroup: string | null;
  refreshVersion: number;
}) {
  const { data, error, retry, loading } = useFinanceQuery<BudgetBreakdowns>(
    query,
    loadBudgetBreakdowns,
    refreshVersion,
  );
  return (
    <div className="panel-charts" aria-busy={loading}>
      {error && <ErrorState message={error.message} retry={retry} />}{" "}
      {!data && !error ? (
        <Loading />
      ) : (
        data && (
          <div className="panel-chart-pair">
            <section
              className="panel-chart"
              aria-labelledby="budget-actions-title"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">ORÇAMENTO ATUALIZADO</span>
                  <h2 id="budget-actions-title">Por ação orçamentária</h2>
                </div>
                <span className="panel-count">{data.actions.length}</span>
              </div>
              <RankingChart
                items={data.actions.map((row) => ({
                  id: row.code,
                  name: row.name || `Ação ${row.code}`,
                  caption: row.code,
                  value: row.summary.updatedBudget,
                  filterValue: row.code,
                }))}
                selected={selectedAction || undefined}
                onSelect={(row) => onChange({ actionCode: row.filterValue! })}
              />
            </section>
            <section
              className="panel-chart"
              aria-labelledby="budget-groups-title"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">COMPOSIÇÃO DO ORÇAMENTO</span>
                  <h2 id="budget-groups-title">Por grupo de despesa</h2>
                </div>
                <span className="panel-count">{data.groups.length}</span>
              </div>
              <RankingChart
                items={data.groups.map((row) => ({
                  id: row.code,
                  name: row.name || `Grupo ${row.code}`,
                  caption: row.code,
                  value: row.summary.updatedBudget,
                  filterValue: row.code,
                }))}
                selected={selectedGroup || undefined}
                onSelect={(row) =>
                  onChange({ expenseGroupCode: row.filterValue! })
                }
              />
            </section>
          </div>
        )
      )}
    </div>
  );
}
