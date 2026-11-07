import {
  ArrowDownToLine,
  CheckCheck,
  FileCheck2,
  Landmark,
} from "lucide-react";
import { compactCurrency, currency, date } from "@/lib/api";
export interface FinancialMetric {
  key: string;
  label: string;
  value: string | null;
  hint: string;
  tone: "committed" | "liquidated" | "paid" | "budget";
}
const icons = {
  committed: FileCheck2,
  liquidated: CheckCheck,
  paid: ArrowDownToLine,
  budget: Landmark,
};
export function PanelMetrics({ metrics }: { metrics: FinancialMetric[] }) {
  return (
    <dl className="panel-metrics">
      {metrics.map((metric) => {
        const Icon = icons[metric.tone];
        return (
          <div className={`panel-metric ${metric.tone}`} key={metric.key}>
            <dt>
              <span>{metric.label}</span>
              <Icon size={18} aria-hidden="true" />
            </dt>
            <dd title={currency(metric.value)}>
              {compactCurrency(metric.value)}
            </dd>
            {metric.value !== null &&
              currency(metric.value) !== compactCurrency(metric.value) && (
                <p className="panel-metric-exact">{currency(metric.value)}</p>
              )}
            <small>{metric.hint}</small>
          </div>
        );
      })}
    </dl>
  );
}
export function PanelProvenance({
  importedAt,
  consultedAt,
  months,
  requestedMonths,
}: {
  importedAt: string | null;
  consultedAt?: string;
  months?: number;
  requestedMonths?: number;
}) {
  return (
    <div className="panel-provenance">
      <span>Fonte: Portal da Transparência</span>
      <span>Importação: {date(importedAt)}</span>
      <span>
        Consulta:{" "}
        {consultedAt
          ? new Date(consultedAt).toLocaleString("pt-BR")
          : "Não consultado"}
      </span>
      {months !== undefined && (
        <strong className="panel-coverage">
          {months} de {requestedMonths} meses com registros
        </strong>
      )}
    </div>
  );
}
