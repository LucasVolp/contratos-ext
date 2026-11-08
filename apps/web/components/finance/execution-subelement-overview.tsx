"use client";
import Link from "next/link";
import { ArrowLeftRight, ChevronDown } from "lucide-react";
import { ErrorState, Loading, Pager } from "@/components/ui";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { financePath } from "@/lib/finance-api";
import { date } from "@/lib/api";
import { executionStages, natureCode } from "@/lib/finance-presentation";
import type { ExecutionMetric, SubelementReport } from "@/lib/finance-types";
import { FinanceTable } from "./shared";
import { ExpenseBars } from "./expense-bars";
import { useFinanceQuery } from "./use-finance-query";

export function ExecutionSubelementOverview({
  query,
  documentQuery,
  urlQuery,
  onChange,
  revision,
}: {
  query: string;
  documentQuery: string;
  urlQuery: string;
  onChange: (values: Record<string, string>) => void;
  revision: number;
}) {
  const params = new URLSearchParams(urlQuery);
  const metric: ExecutionMetric =
    params.get("subelementMetric") === "liquidatedValue"
      ? "liquidatedValue"
      : params.get("subelementMetric") === "paidValue"
        ? "paidValue"
        : "committedValue";
  const requested = params.get("subelementPage") || "1";
  const page = /^[1-9]\d{0,5}$/.test(requested) ? requested : "1";
  const nature = new URLSearchParams(documentQuery).get("expenseNature") || "";
  const result = useFinanceQuery<SubelementReport>(
    financePath("subelements", query, {
      expenseNature: nature,
      metric,
      page,
      limit: "6",
    }),
    undefined,
    revision,
  );
  const report = result.data;
  return (
    <section
      className="execution-subelement-overview"
      aria-labelledby="execution-subelement-overview-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="execution-subelement-overview-title">
            Gasto por subelemento
          </h2>
          <p>
            Consolidado dos registros diários disponíveis para este elemento.
          </p>
        </div>
        <Link
          className="button secondary"
          href={`/financeiro/empenhos?${documentQuery}`}
        >
          Consultar empenhos deste elemento
        </Link>
      </div>
      {result.error ? (
        <ErrorState message={result.error.message} retry={result.retry} />
      ) : null}
      {!report ? (
        !result.error ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="execution-subelement-toolbar">
            <div className="execution-ranking-control">
              <Label htmlFor="subelement-metric">Visualizar gasto por</Label>
              <NativeSelect
                id="subelement-metric"
                value={metric}
                onChange={(event) =>
                  onChange({
                    subelementMetric: event.target.value,
                    subelementPage: "",
                  })
                }
              >
                {executionStages.map((stage) => (
                  <NativeSelectOption key={stage.key} value={stage.key}>
                    {stage.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <details className="execution-source-method">
              <summary>
                Sobre estes dados <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <p className="execution-data-note">
                Empenhado: valor atual dos itens dos empenhos emitidos no
                período. Liquidado e pago: vínculos pela data de emissão do
                documento. Restos a pagar ficam separados. Os totais diários
                podem diferir da fonte mensal acima e não são somados a ela.
              </p>
            </details>
          </div>
          <div className="execution-subelement-composition" aria-live="polite">
            {report.chart.length ? (
              <ExpenseBars
                slices={report.chart.map((slice) => ({
                  label: slice.other
                    ? "Demais registros"
                    : `${natureCode(slice.code || "")} · ${slice.name || "Descrição não informada"}`,
                  value: slice.value,
                }))}
                total={report.summary[metric]}
                metric={metric}
              />
            ) : (
              <p className="execution-composition-unavailable">
                Não há valores suficientes para compor o gráfico desta etapa.
              </p>
            )}
            <p className="execution-chart-note">
              Até cinco subelementos e demais registros de todo o recorte.
              Comprimento proporcional ao maior valor exibido.
            </p>
          </div>
          <div className="execution-subelement-table">
            <p className="execution-table-hint">
              <ArrowLeftRight size={14} aria-hidden="true" /> Role a tabela para
              o lado para ver todas as colunas.
            </p>
            {report.data.length ? (
              <FinanceTable
                caption="Detalhamento do gasto por subelemento"
                rows={report.data.map((row) => ({
                  ...row,
                  classification: row.code
                    ? natureCode(row.code)
                    : "Sem subelemento identificado",
                }))}
                columns={[
                  { key: "classification", label: "Subelemento" },
                  { key: "name", label: "Descrição" },
                  ...executionStages.map((stage) => ({
                    key: stage.key,
                    label: stage.label,
                    money: true,
                  })),
                ]}
              />
            ) : (
              <p className="execution-data-note">
                Nenhum registro diário encontrado para este elemento no período
                selecionado.
              </p>
            )}
            <Pager
              page={report.page}
              total={report.total}
              limit={report.limit}
              onChange={(value) => onChange({ subelementPage: String(value) })}
            />
          </div>
          <p className="execution-data-note">
            Cobertura diária não verificada · {report.summary.documentCount}{" "}
            documentos · {report.summary.observedDayCount} dias com registros.
            Importação: {date(report.summary.lastImportedAt)}. Fonte: Portal da
            Transparência. Consulta:{" "}
            {result.loadedAt
              ? new Date(result.loadedAt).toLocaleString("pt-BR")
              : "Não consultado"}
            .
          </p>
        </>
      )}
    </section>
  );
}
