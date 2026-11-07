"use client";
import { useState } from "react";
import { Table2, X } from "lucide-react";
import { PageHead, Empty, ErrorState, Loading } from "@/components/ui";
import { useSession } from "@/lib/session";
import { financePath, loadBudgetRows } from "@/lib/finance-api";
import type {
  BudgetRow,
  BudgetSummary,
  FinancialReport,
} from "@/lib/finance-types";
import { FinanceTabs } from "./shared";
import { useFinanceQuery } from "./use-finance-query";
import { usePanelScope } from "./use-panel-scope";
import { PanelControls } from "./panel-controls";
import { PanelMetrics, PanelProvenance } from "./panel-metrics";
import { PanelDetailTable } from "./panel-detail-table";
import { BudgetCharts } from "./budget-charts";
export function BudgetPanel() {
  const { viewer } = useSession();
  const { scope, query, directory, change, selectedAction, selectedGroup } =
    usePanelScope("budgets");
  const ready = viewer.allInstitutions && !!scope.managementCode;
  const result = useFinanceQuery<FinancialReport<BudgetRow, BudgetSummary>>(
    ready ? financePath("budgets", query, { limit: "1" }) : null,
  );
  const optionsQuery = new URLSearchParams({
    subordinateAgencyCode: scope.managementCode,
    fiscalYear: scope.fiscalYear,
  }).toString();
  const options = useFinanceQuery<BudgetRow[]>(
    ready ? optionsQuery : null,
    loadBudgetRows,
  );
  const units = [
    ...new Map(
      (options.data || []).map((r) => [
        r.budgetaryUnitCode,
        { code: r.budgetaryUnitCode, name: r.budgetaryUnitName },
      ]),
    ).values(),
  ];
  const [details, setDetails] = useState(false);
  const [chartVersion, setChartVersion] = useState(0);
  const summary = result.data?.summary;
  return (
    <div className="finance-panel">
      <PageHead
        title="LOA institucional"
        description="Orçamento anual, ações e composição da despesa."
      />
      <FinanceTabs active="budgets" query={query} />
      {!viewer.allInstitutions ? (
        <ErrorState message="A consulta ao orçamento institucional está disponível ao gestor geral." />
      ) : (
        <>
          <PanelControls
            budget
            scope={scope}
            units={units}
            agencies={directory.data || []}
            onChange={change}
            busy={result.loading}
            onRefresh={() => {
              result.retry();
              options.retry();
              setChartVersion((n) => n + 1);
            }}
          />
          {(selectedAction || selectedGroup) && (
            <div className="panel-filter-tags">
              {selectedAction && <span>Ação {selectedAction}</span>}
              {selectedGroup && <span>Grupo {selectedGroup}</span>}
              <button
                className="panel-text-button"
                type="button"
                onClick={() => change({ actionCode: "", expenseGroupCode: "" })}
              >
                <X size={14} aria-hidden="true" />
                Remover filtros do gráfico
              </button>
            </div>
          )}
          {result.error && (
            <ErrorState
              message={
                result.data
                  ? `${result.error.message} Os dados da última consulta foram preservados.`
                  : result.error.message
              }
              retry={result.retry}
            />
          )}
          {options.error && (
            <ErrorState
              message="Não foi possível carregar a relação de unidades orçamentárias."
              retry={options.retry}
            />
          )}
          {!scope.managementCode ? (
            directory.loading ? (
              <Loading />
            ) : (
              <Empty
                kind="registro"
                href="/financeiro/loa"
                title="Informe a instituição da consulta."
                description="Use o campo de instituição para consultar o orçamento anual do órgão."
                actionLabel="Revisar filtros"
              />
            )
          ) : !result.data ? (
            !result.error && (
              <div className="panel-loading">
                <Loading />
              </div>
            )
          ) : (
            summary && (
              <div aria-busy={result.loading}>
                <div className="panel-scope-heading">
                  <div>
                    <span className="eyebrow">
                      ORÇAMENTO ANUAL · {scope.fiscalYear}
                    </span>
                    <h2>
                      {units.find((u) => u.code === scope.unit)?.name ||
                        "Orçamento institucional"}
                    </h2>
                  </div>
                  <span className="panel-source">Lei Orçamentária Anual</span>
                </div>
                <span className="sr-only" role="status">
                  Orçamento atualizado para o exercício {scope.fiscalYear},{" "}
                  {scope.unit
                    ? `unidade orçamentária ${scope.unit}`
                    : "todas as unidades orçamentárias"}
                  .
                </span>
                <PanelMetrics
                  metrics={[
                    {
                      key: "initialBudget",
                      label: "Inicial",
                      value: summary.initialBudget,
                      hint: "Dotação inicial do exercício",
                      tone: "budget",
                    },
                    {
                      key: "updatedBudget",
                      label: "Atualizado",
                      value: summary.updatedBudget,
                      hint: "Dotação após alterações",
                      tone: "budget",
                    },
                    {
                      key: "committedBudget",
                      label: "Empenhado",
                      value: summary.committedBudget,
                      hint: "Valor informado no orçamento anual",
                      tone: "committed",
                    },
                    {
                      key: "executedBudget",
                      label: "Executado",
                      value: summary.executedBudget,
                      hint: "Realizado na fonte orçamentária",
                      tone: "paid",
                    },
                  ]}
                />
                <PanelProvenance
                  importedAt={summary.lastImportedAt}
                  consultedAt={result.loadedAt}
                />
                <p className="panel-coverage-note">
                  A LOA é institucional. Os valores não identificam campus nem
                  distribuição interna por unidade gestora.
                </p>
                {summary.sourceRowCount === 0 ? (
                  <Empty
                    kind="registro"
                    href="/financeiro/loa"
                    title="Nenhum registro encontrado."
                    description="Não há orçamento disponível para esta instituição, unidade orçamentária e exercício. Ajuste os filtros para consultar outro recorte."
                    actionLabel="Limpar filtros"
                  />
                ) : (
                  <>
                    <BudgetCharts
                      refreshVersion={chartVersion}
                      query={query}
                      onChange={change}
                      selectedAction={selectedAction}
                      selectedGroup={selectedGroup}
                    />
                    <div className="panel-detail-action">
                      <button
                        className="button secondary"
                        type="button"
                        aria-expanded={details}
                        aria-controls="budget-details"
                        onClick={() => setDetails(!details)}
                      >
                        <Table2 size={15} aria-hidden="true" />
                        {details ? "Ocultar detalhamento" : "Ver detalhamento"}
                      </button>
                      <span>Valores de todo o orçamento filtrado.</span>
                    </div>
                    {details && (
                      <div id="budget-details">
                        <PanelDetailTable mode="budgets" query={query} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
