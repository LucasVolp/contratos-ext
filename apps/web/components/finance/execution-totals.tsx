import { currency } from "@/lib/api";
import { executionColumns } from "@/lib/finance-presentation";
import type { ExecutionSummary } from "@/lib/finance-types";

export function ExecutionTotals({ summary }: { summary: ExecutionSummary }) {
  return (
    <dl className="execution-totals" aria-label="Totais do recorte">
      {executionColumns.map((stage) => (
        <div key={stage.key} data-metric={stage.key} className={stage.tone}>
          <dt>
            <i aria-hidden="true" />
            {stage.key === "priorYearPaidValue" ? (
              <abbr title="Restos a pagar pagos">{stage.label}</abbr>
            ) : (
              stage.label
            )}
          </dt>
          <dd>{currency(summary[stage.key])}</dd>
          {stage.key === "priorYearPaidValue" ? (
            <dd className="execution-payables-detail">
              <span>Restos a pagar pagos</span>
              <details>
                <summary>Detalhar restos a pagar</summary>
                <dl>
                  <div>
                    <dt>R.P. cancelados</dt>
                    <dd>{currency(summary.canceledPayablesValue)}</dd>
                  </div>
                  <div>
                    <dt>R.P. inscritos</dt>
                    <dd>{currency(summary.registeredPayablesValue)}</dd>
                  </div>
                </dl>
              </details>
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
