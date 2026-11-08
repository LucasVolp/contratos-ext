import { currency } from "@/lib/api";
import { executionStages } from "@/lib/finance-presentation";
import type { ExecutionSummary } from "@/lib/finance-types";

export function ExecutionTotals({ summary }: { summary: ExecutionSummary }) {
  return (
    <dl className="execution-totals" aria-label="Totais do recorte">
      {executionStages.map((stage) => (
        <div key={stage.key} data-metric={stage.key} className={stage.tone}>
          <dt>
            <i aria-hidden="true" />
            {stage.label}
          </dt>
          <dd>{currency(summary[stage.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExecutionPayables({ summary }: { summary: ExecutionSummary }) {
  const values = [
    ["Inscritos", summary.registeredPayablesValue],
    ["Cancelados", summary.canceledPayablesValue],
    ["Pagos", summary.priorYearPaidValue],
  ];
  return (
    <section
      className="execution-payables"
      aria-labelledby="execution-payables-title"
    >
      <h2 id="execution-payables-title">Restos a pagar</h2>
      <p>
        Movimentos de exercícios anteriores apresentados separadamente da
        execução corrente.
      </p>
      <dl className="execution-totals">
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{currency(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
