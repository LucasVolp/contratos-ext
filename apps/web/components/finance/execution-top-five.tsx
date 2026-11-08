"use client";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { executionStages, natureCode } from "@/lib/finance-presentation";
import { expenseShare, rankExecutionNatures } from "@/lib/finance-chart";
import { currency } from "@/lib/api";
import type {
  ExecutionMetric,
  ExecutionNature,
  ExecutionSummary,
} from "@/lib/finance-types";

export function ExecutionTopFive({
  natures,
  summary,
  metric,
  onMetricChange,
  onSelect,
}: {
  natures: ExecutionNature[];
  summary: ExecutionSummary;
  metric: ExecutionMetric;
  onMetricChange: (metric: ExecutionMetric) => void;
  onSelect: (code: string) => void;
}) {
  const ranking = rankExecutionNatures(natures, metric);
  return (
    <section
      className="execution-top-five"
      aria-labelledby="execution-top-five-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="execution-top-five-title">Top 5 elementos de despesa</h2>
          <p>Os maiores valores da etapa selecionada em todo o recorte.</p>
        </div>
      </div>
      <div className="execution-ranking-control">
        <Label htmlFor="execution-ranking-metric">Ordenar elementos por</Label>
        <NativeSelect
          id="execution-ranking-metric"
          value={metric}
          onChange={(event) =>
            onMetricChange(event.target.value as ExecutionMetric)
          }
        >
          {executionStages.map((stage) => (
            <NativeSelectOption key={stage.key} value={stage.key}>
              {stage.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div aria-live="polite">
        {ranking.rows.length ? (
          <ol>
            {ranking.rows.map((node, index) => (
              <li key={node.code}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Explorar elemento ${natureCode(node.code)}`}
                  onClick={() => onSelect(node.code)}
                >
                  <span
                    className="execution-ranking-position"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <span className="execution-ranking-name">
                    <small>{natureCode(node.code)}</small>
                    <strong>
                      {node.name || `Elemento ${natureCode(node.code)}`}
                    </strong>
                  </span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                  <span className="execution-ranking-value">
                    <strong>{currency(node.summary[metric])}</strong>
                    <small>
                      {expenseShare(node.summary[metric], summary[metric])
                        ? `${expenseShare(node.summary[metric], summary[metric])} do total do recorte`
                        : "Participação não disponível"}
                    </small>
                  </span>
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="execution-composition-unavailable">
            Valores não informados para esta etapa.
          </p>
        )}
        {ranking.missingCount > 0 && ranking.rows.length ? (
          <p className="execution-chart-note">
            {ranking.missingCount} elementos com valor não informado nesta etapa
            não entram no ranking.
          </p>
        ) : null}
      </div>
    </section>
  );
}
