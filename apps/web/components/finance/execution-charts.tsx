"use client";
import { useState } from "react";
import { ErrorState, Loading } from "@/components/ui";
import { loadExecutionBreakdowns } from "@/lib/finance-api";
import type { ExecutionBreakdowns, ExecutionMetric } from "@/lib/finance-types";
import { useFinanceQuery } from "./use-finance-query";
import { RankingChart } from "./ranking-chart";
import { TrendChart, executionStages } from "./trend-chart";
export function ExecutionCharts({
  query,
  onChange,
  selectedNature,
  refreshVersion,
}: {
  query: string;
  onChange: (changes: Record<string, string>) => void;
  selectedNature: string | null;
  refreshVersion: number;
}) {
  const { data, error, retry, loading } = useFinanceQuery<ExecutionBreakdowns>(
    query,
    loadExecutionBreakdowns,
    refreshVersion,
  );
  const [metric, setMetric] = useState<ExecutionMetric>("committedValue");
  return (
    <div className="panel-charts" aria-busy={loading}>
      {error && (
        <ErrorState
          message={
            data
              ? `${error.message} Os gráficos da última consulta foram preservados.`
              : error.message
          }
          retry={retry}
        />
      )}
      {!data && !error ? (
        <Loading />
      ) : (
        data && (
          <>
            <section
              className="panel-chart panel-chart-wide"
              aria-labelledby="trend-title"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">AO LONGO DO ANO</span>
                  <h2 id="trend-title">Evolução mensal</h2>
                </div>
                <span className="panel-chart-unit">Valores em reais</span>
              </div>
              <TrendChart rows={data.monthly} />
            </section>
            <div className="panel-chart-comparison">
              <span>Comparar por</span>
              <div
                className="panel-metric-switch"
                role="group"
                aria-label="Valor usado nas comparações"
              >
                {executionStages.map((s) => (
                  <button
                    type="button"
                    key={s.key}
                    aria-pressed={metric === s.key}
                    onClick={() => setMetric(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel-chart-pair">
              <section className="panel-chart" aria-labelledby="units-title">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">POR UNIDADE</span>
                    <h2 id="units-title">Execução nas unidades</h2>
                  </div>
                  <span className="panel-count">{data.units.length}</span>
                </div>
                <RankingChart
                  items={data.units.map((row) => ({
                    id: row.code,
                    name: row.name || `Unidade ${row.code}`,
                    caption: row.code,
                    value: row.summary[metric],
                    filterValue: row.code,
                  }))}
                  onSelect={(row) =>
                    onChange({ managementUnitCode: row.filterValue! })
                  }
                />
                {data.unassignedUnitCount > 0 && (
                  <p className="panel-footnote">
                    Há lançamentos sem unidade informada na fonte. Seus valores
                    permanecem nos totais institucionais.
                  </p>
                )}
                <p className="panel-footnote">
                  Selecione uma unidade para detalhar o painel.
                </p>
              </section>
              <section className="panel-chart" aria-labelledby="natures-title">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">POR NATUREZA</span>
                    <h2 id="natures-title">Naturezas de despesa</h2>
                  </div>
                  <span className="panel-count">{data.natures.length}</span>
                </div>
                <RankingChart
                  items={data.natures.map((row) => ({
                    id: row.code,
                    name: row.name || `Natureza ${row.code}`,
                    caption: row.code,
                    value: row.summary[metric],
                    filterValue: row.code,
                  }))}
                  selected={selectedNature || undefined}
                  onSelect={(row) =>
                    onChange({ expenseNature: row.filterValue! })
                  }
                />
                {data.unclassifiedCount > 0 && (
                  <p className="panel-footnote">
                    Há classificações sem natureza completa. Seus valores
                    permanecem nos totais do painel.
                  </p>
                )}
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}
