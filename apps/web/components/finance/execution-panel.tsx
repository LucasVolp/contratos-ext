"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Empty, ErrorState, Loading, PageHead } from "@/components/ui";
import { useSidebarPreference } from "@/lib/use-sidebar-preference";
import { financePath, loadExecutionNatures } from "@/lib/finance-api";
import type {
  ExecutionMetric,
  ExecutionNatures,
  ExecutionRow,
  ExecutionSummary,
  FinancialReport,
} from "@/lib/finance-types";
import {
  type ExecutionPurpose,
  type ExecutionView,
} from "@/lib/finance-presentation";
import { FinanceTabs } from "./shared";
import { useFinanceQuery } from "./use-finance-query";
import { usePanelScope } from "./use-panel-scope";
import { PanelControls } from "./panel-controls";
import {
  ExecutionPurposeTabs,
  ExecutionViewTabs,
  ExecutionNavigator,
} from "./execution-navigation";
import { ExecutionPayables } from "./execution-totals";
import { ExecutionContext } from "./execution-context";
import { ExecutionSource } from "./execution-source";
import { ExecutionLedger } from "./execution-ledger";
import { ExecutionPurposeUnavailable } from "./execution-capabilities";
import { ExecutionElementDetail } from "./execution-element-detail";
import { ExecutionTopFive } from "./execution-top-five";
import { ExecutionComparison } from "./execution-comparison";

export function ExecutionPanel() {
  const { scope, query, urlQuery, directory, units, change } = usePanelScope();
  const params = new URLSearchParams(urlQuery);
  const metric: ExecutionMetric =
    params.get("rankingMetric") === "liquidatedValue"
      ? "liquidatedValue"
      : params.get("rankingMetric") === "paidValue"
        ? "paidValue"
        : "committedValue";
  const [collapsed, toggleNavigator] = useSidebarPreference("finance");
  const view: ExecutionView =
    params.get("view") === "overview"
      ? "overview"
      : params.get("view") === "payables"
        ? "payables"
        : "explore";
  const purpose: ExecutionPurpose =
    params.get("purpose") === "own"
      ? "own"
      : params.get("purpose") === "campus"
        ? "campus"
        : "all";
  const element = params.get("element") || params.get("expenseNature");
  const [revision, setRevision] = useState(0);
  const key = scope.managementCode && purpose === "all" ? query : null;
  const result = useFinanceQuery<
    FinancialReport<ExecutionRow, ExecutionSummary>
  >(key ? financePath("execution", key, { limit: "1" }) : null);
  const breakdown = useFinanceQuery<ExecutionNatures>(
    key,
    loadExecutionNatures,
    revision,
  );
  const nodes = breakdown.data?.natures || [];
  const selected = nodes.find((node) => node.code === element);
  const selectedCode = view === "explore" ? element : null;
  const summary = selectedCode ? selected?.summary : result.data?.summary;
  const scopeLabel = scope.unit
    ? units.find((unit) => unit.code === scope.unit)?.name ||
      `Unidade ${scope.unit}`
    : "Todas as unidades do recorte";
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view === "explore" && element) {
      canvas.current?.focus({ preventScroll: true });
      if (matchMedia("(max-width: 700px)").matches)
        canvas.current?.scrollIntoView({ block: "start" });
    }
  }, [view, element]);
  function select(code: string) {
    change({
      element: code,
      expenseNature: "",
      view: "explore",
      document: "",
      documentPage: "",
      sourcePage: "",
      sourceKind: "",
      subelementPage: "",
    });
  }
  function refresh() {
    result.retry();
    directory.retry();
    setRevision((value) => value + 1);
  }
  const documents = new URLSearchParams({
    managementCode: scope.managementCode,
    fiscalYear: scope.fiscalYear,
  });
  if (scope.unit) documents.set("managementUnitCode", scope.unit);
  const allDocuments = `/financeiro/empenhos?${documents}`;
  if (selectedCode) documents.set("expenseNature", selectedCode);
  return (
    <div className="finance-panel finance-workspace">
      <PageHead
        title="Execução da despesa"
        description="Do panorama do exercício aos elementos e documentos disponíveis."
      >
        <Link className="button secondary" href={allDocuments}>
          Consultar empenhos
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </PageHead>
      <FinanceTabs active="execution" query={query} />
      <PanelControls
        scope={scope}
        units={units.map((unit) => ({ code: unit.code, name: unit.name }))}
        agencies={directory.data || []}
        busy={result.loading || breakdown.loading}
        onChange={change}
        onRefresh={refresh}
      />
      <ExecutionPurposeTabs
        purpose={purpose}
        onChange={(value) => change({ purpose: value })}
      />
      <div className="execution-modebar">
        <ExecutionViewTabs
          view={view}
          onChange={(value) => change({ view: value })}
        />
        <ExecutionSource
          summary={result.data?.summary}
          consultedAt={result.loadedAt}
          requestedMonths={Number(scope.toMonth) - Number(scope.fromMonth) + 1}
        />
      </div>
      {directory.error ? (
        <ErrorState message={directory.error.message} retry={directory.retry} />
      ) : null}
      {purpose !== "all" ? (
        <ExecutionPurposeUnavailable purpose={purpose} />
      ) : (
        <>
          {result.error ? (
            <ErrorState
              message={
                result.error.message +
                (result.data
                  ? " Os dados da última consulta foram preservados."
                  : "")
              }
              retry={refresh}
            />
          ) : null}
          {breakdown.error && !result.error ? (
            <ErrorState
              title="Não foi possível atualizar o detalhamento"
              message={
                breakdown.error.message +
                (breakdown.data
                  ? " Os dados da última consulta foram preservados."
                  : "")
              }
              retry={refresh}
            />
          ) : null}
          {!scope.managementCode ? (
            directory.loading ? (
              <Loading />
            ) : (
              <Empty
                kind="registro"
                href="/financeiro"
                title="Informe a instituição da consulta."
                description="Escolha o órgão nos filtros para consultar a execução."
                actionLabel="Revisar filtros"
              />
            )
          ) : !result.data ? (
            !result.error ? (
              <Loading />
            ) : null
          ) : view === "payables" ? (
            <ExecutionPayables summary={result.data.summary} />
          ) : (
            <div
              className={`execution-workspace ${view === "overview" ? "is-overview" : ""} ${collapsed ? "is-navigator-collapsed" : ""}`}
            >
              {view === "explore" && nodes.length > 0 ? (
                <ExecutionNavigator
                  collapsed={collapsed}
                  onToggle={toggleNavigator}
                  natures={nodes}
                  selected={element}
                  search={params.get("natureSearch") || ""}
                  onSearch={(value) => change({ natureSearch: value })}
                  onSelect={select}
                />
              ) : null}
              <div
                className="execution-canvas"
                ref={canvas}
                tabIndex={-1}
                aria-busy={result.loading || breakdown.loading}
              >
                <ExecutionContext
                  scopeLabel={scopeLabel}
                  fiscalYear={scope.fiscalYear}
                  selectedCode={selectedCode}
                  selectedName={selected?.name}
                  summary={summary}
                  loading={result.loading}
                  onReset={() => select("")}
                />
                {result.data.summary.sourceRowCount === 0 ? (
                  <Empty
                    kind="registro"
                    href="/financeiro"
                    title="Nenhum registro encontrado."
                    description="Não há registros disponíveis para este recorte. Ajuste os filtros para consultar outro período."
                    actionLabel="Revisar filtros"
                  />
                ) : selectedCode ? (
                  breakdown.loading && !breakdown.data ? (
                    <Loading />
                  ) : selected ? (
                    <ExecutionElementDetail
                      revision={revision}
                      scopeQuery={query}
                      documentQuery={documents.toString()}
                      urlQuery={urlQuery}
                      onChange={change}
                      key={documents.toString()}
                    />
                  ) : !breakdown.error ? (
                    <Empty
                      kind="elemento"
                      href={`/financeiro?${query}`}
                      title="Elemento não encontrado neste recorte."
                      description="Selecione outro elemento ou revise os filtros."
                      actionLabel="Todas as despesas"
                    />
                  ) : null
                ) : breakdown.loading && !breakdown.data ? (
                  <Loading />
                ) : breakdown.data ? (
                  <>
                    <div className="execution-insights">
                      <ExecutionComparison summary={result.data.summary} />
                      <ExecutionTopFive
                        natures={nodes}
                        summary={result.data.summary}
                        metric={metric}
                        onMetricChange={(value) =>
                          change({ rankingMetric: value })
                        }
                        onSelect={select}
                      />
                    </div>
                    <ExecutionLedger
                      natures={nodes}
                      page={params.get("elementPage")}
                      onPageChange={(value) =>
                        change({ elementPage: String(value) })
                      }
                      onSelect={select}
                      unclassifiedCount={breakdown.data.unclassifiedCount}
                    />
                  </>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
