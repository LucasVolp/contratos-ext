"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageBar, Empty, ErrorState, Loading } from "@/components/ui";
import { financePath } from "@/lib/finance-api";
import type { CommitmentSummary, Page } from "@/lib/finance-types";
import { FinanceTabs, FinanceTable, FinancePager, type Column } from "./shared";
import { usePanelScope } from "./use-panel-scope";
import { PanelControls } from "./panel-controls";
import { CommitmentFilters } from "./commitment-filters";
import { useFinanceQuery } from "./use-finance-query";
export function CommitmentList() {
  const params = useSearchParams();
  const { scope, query, directory, units, change } =
    usePanelScope("commitments");
  const page = params.get("page") || "1";
  const result = useFinanceQuery<Page<CommitmentSummary>>(
    scope.managementCode
      ? financePath("commitments", query, { page, limit: "20" })
      : null,
  );
  const returnTo = `/financeiro/empenhos?${query}&page=${encodeURIComponent(page)}`;
  const columns: Column[] = [
    {
      key: "documentCode",
      label: "Empenho",
      link: (row) =>
        `/financeiro/empenhos/${row.id}?returnTo=${encodeURIComponent(returnTo)}`,
    },
    { key: "favoredName", label: "Favorecido" },
    { key: "unitName", label: "Unidade" },
    { key: "emissionDate", label: "Emissão", date: true },
    { key: "committedValue", label: "Empenhado", money: true },
    { key: "liquidatedValue", label: "Liquidado", money: true },
    { key: "paidValue", label: "Pago", money: true },
  ];
  return (
    <div className="finance-panel">
      <PageBar
        context={
          <div>
            <h1 className="panel-list-title">Empenhos</h1>
            <p className="panel-list-description">
              Consulte os documentos e acompanhe seus itens e movimentos.
            </p>
          </div>
        }
      >
        <Link href={`/financeiro?${query}`} className="button secondary">
          <ArrowLeft size={15} aria-hidden="true" />
          Voltar ao painel
        </Link>
      </PageBar>
      <FinanceTabs active="commitments" query={query} />
      <PanelControls
        scope={scope}
        units={units.map((u) => ({ code: u.code, name: u.name }))}
        agencies={directory.data || []}
        showPeriod={false}
        busy={result.loading}
        onChange={change}
        onRefresh={result.retry}
      />
      <CommitmentFilters
        key={query}
        query={query}
        onChange={change}
        error={result.error}
      />
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
            href="/financeiro/empenhos"
            title="Informe a instituição da consulta."
            description="Use o campo de instituição para escolher o órgão."
            actionLabel="Revisar filtros"
          />
        )
      ) : !result.data ? (
        !result.error && <Loading />
      ) : (
        <section
          className="registry"
          aria-label="Resultados da consulta"
          aria-busy={result.loading}
        >
          <div className="registry-top">
            <h2>
              {result.data.total}{" "}
              {result.data.total === 1 ? "empenho" : "empenhos"}
            </h2>
            <span className="panel-source">Documentos financeiros</span>
          </div>
          <span className="sr-only" role="status">
            {result.data.total} empenhos encontrados.
          </span>
          {result.data.data.length ? (
            <FinanceTable
              columns={columns}
              rows={result.data.data.map((row) => ({ ...row }))}
              caption="Empenhos do recorte selecionado"
            />
          ) : (
            <Empty
              kind="registro"
              href="/financeiro/empenhos"
              title="Nenhum registro encontrado."
              description="Ajuste a unidade, o exercício ou a busca para consultar outro recorte."
              actionLabel="Limpar filtros"
            />
          )}
          <FinancePager result={result.data} query={query} />
        </section>
      )}
      {result.loadedAt && (
        <p className="panel-footnote">
          Consulta: {new Date(result.loadedAt).toLocaleString("pt-BR")}. Valores
          de restos a pagar e identificação completa estão no detalhe de cada
          empenho.
        </p>
      )}
    </div>
  );
}
