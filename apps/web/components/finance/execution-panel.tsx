"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Table2, X } from "lucide-react";
import { PageHead, Empty, ErrorState, Loading } from "@/components/ui";
import { financePath } from "@/lib/finance-api";
import type {
  ExecutionRow,
  ExecutionSummary,
  FinancialReport,
} from "@/lib/finance-types";
import { FinanceTabs } from "./shared";
import { useFinanceQuery } from "./use-finance-query";
import { usePanelScope } from "./use-panel-scope";
import { PanelControls } from "./panel-controls";
import { PanelMetrics, PanelProvenance } from "./panel-metrics";
import { PanelDetailTable } from "./panel-detail-table";
import { ExecutionCharts } from "./execution-charts";
export function ExecutionPanel() {
  const { scope, query, directory, units, change, selectedNature } =
    usePanelScope();
  const result = useFinanceQuery<
    FinancialReport<ExecutionRow, ExecutionSummary>
  >(
    scope.managementCode
      ? financePath("execution", query, { limit: "1" })
      : null,
  );
  const [details, setDetails] = useState(false);
  const [chartVersion, setChartVersion] = useState(0);
  const summary = result.data?.summary;
  const selectedName = units.find((u) => u.code === scope.unit)?.name;
  return (
    <div className="finance-panel">
      <PageHead
        title="Visão financeira"
        description="Empenhos, liquidações e pagamentos no período selecionado."
      >
        <Link
          href={`/financeiro/empenhos?${query}`}
          className="button secondary"
        >
          Consultar empenhos
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </PageHead>
      <FinanceTabs active="execution" query={query} />
      <PanelControls
        scope={scope}
        units={units.map((u) => ({ code: u.code, name: u.name }))}
        agencies={directory.data || []}
        busy={result.loading}
        onChange={change}
        onRefresh={() => {
          result.retry();
          directory.retry();
          setChartVersion((n) => n + 1);
        }}
      />
      {selectedNature && (
        <div className="panel-filter-tags">
          <span>Natureza {selectedNature}</span>
          <button
            className="panel-text-button"
            onClick={() => change({ expenseNature: "" })}
            type="button"
          >
            <X size={14} aria-hidden="true" />
            Remover filtro de natureza
          </button>
        </div>
      )}
      {directory.error && (
        <ErrorState message={directory.error.message} retry={directory.retry} />
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
      {!scope.managementCode ? (
        directory.loading ? (
          <Loading />
        ) : (
          <Empty
            kind="registro"
            href="/financeiro"
            title="Informe a instituição da consulta."
            description="Use o campo de instituição para escolher o órgão no Portal da Transparência."
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
                  EXECUÇÃO MENSAL · {scope.fiscalYear}
                </span>
                <h2>
                  {scope.unit
                    ? selectedName || `Unidade ${scope.unit}`
                    : "Todas as unidades"}
                </h2>
              </div>
              <span className="panel-source">Portal da Transparência</span>
            </div>
            <span className="sr-only" role="status">
              Painel atualizado para{" "}
              {scope.unit ? selectedName || scope.unit : "todas as unidades"},
              exercício {scope.fiscalYear}.
            </span>
            <PanelMetrics
              metrics={[
                {
                  key: "committedValue",
                  label: "Empenhado",
                  value: summary.committedValue,
                  hint: "Compromissos registrados no período",
                  tone: "committed",
                },
                {
                  key: "liquidatedValue",
                  label: "Liquidado",
                  value: summary.liquidatedValue,
                  hint: "Despesas reconhecidas no período",
                  tone: "liquidated",
                },
                {
                  key: "paidValue",
                  label: "Pago",
                  value: summary.paidValue,
                  hint: "Pagamentos registrados no período",
                  tone: "paid",
                },
              ]}
            />
            <PanelProvenance
              importedAt={summary.lastImportedAt}
              consultedAt={result.loadedAt}
              months={summary.observedMonthCount}
              requestedMonths={
                Number(scope.toMonth) - Number(scope.fromMonth) + 1
              }
            />
            {summary.observedMonthCount <
              Number(scope.toMonth) - Number(scope.fromMonth) + 1 && (
              <p className="panel-coverage-note">
                Há meses sem registros neste recorte. Os totais refletem os
                dados disponíveis.
              </p>
            )}
            {summary.sourceRowCount === 0 ? (
              <Empty
                kind="registro"
                href="/financeiro"
                title="Nenhum registro encontrado."
                description="Não há registros disponíveis para esta unidade e período. Ajuste os filtros para consultar outro recorte."
                actionLabel="Limpar filtros"
              />
            ) : (
              <>
                <ExecutionCharts
                  refreshVersion={chartVersion}
                  query={query}
                  onChange={change}
                  selectedNature={selectedNature}
                />
                <section
                  className="panel-prior-year"
                  aria-labelledby="prior-year-title"
                >
                  <div>
                    <span className="eyebrow">EXERCÍCIOS ANTERIORES</span>
                    <h2 id="prior-year-title">Restos a pagar</h2>
                    <p>
                      Movimentos apresentados separadamente da execução
                      corrente.
                    </p>
                  </div>
                  <PanelMetrics
                    metrics={[
                      {
                        key: "registeredPayablesValue",
                        label: "Inscritos",
                        value: summary.registeredPayablesValue,
                        hint: "Inscrições registradas",
                        tone: "budget",
                      },
                      {
                        key: "canceledPayablesValue",
                        label: "Cancelados",
                        value: summary.canceledPayablesValue,
                        hint: "Cancelamentos registrados",
                        tone: "budget",
                      },
                      {
                        key: "priorYearPaidValue",
                        label: "Pagos",
                        value: summary.priorYearPaidValue,
                        hint: "Pagamentos de exercícios anteriores",
                        tone: "paid",
                      },
                    ]}
                  />
                </section>
                <div className="panel-detail-action">
                  <button
                    className="button secondary"
                    type="button"
                    aria-expanded={details}
                    aria-controls="execution-details"
                    onClick={() => setDetails(!details)}
                  >
                    <Table2 size={15} aria-hidden="true" />
                    {details ? "Ocultar detalhamento" : "Ver detalhamento"}
                  </button>
                  <span>
                    Totais e gráficos consideram todo o recorte selecionado.
                  </span>
                </div>
                {details && (
                  <div id="execution-details">
                    <PanelDetailTable mode="execution" query={query} />
                  </div>
                )}
              </>
            )}
          </div>
        )
      )}
    </div>
  );
}
