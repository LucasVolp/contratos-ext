"use client";
import { ExpenseDonut } from "./expense-donut";
import { executionComposition } from "@/lib/finance-chart";
import type { ExecutionSummary } from "@/lib/finance-types";

export function ExecutionComparison({
  summary,
}: {
  summary: ExecutionSummary;
}) {
  const composition = executionComposition(summary);
  return (
    <section
      className="execution-comparison"
      aria-labelledby="execution-chart-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="execution-chart-title">Situação da execução</h2>
          <p>Composição do valor empenhado no recorte selecionado.</p>
        </div>
      </div>
      {composition.status === "ready" ? (
        <ExpenseDonut
          parts={composition.parts}
          total={summary.committedValue}
          totalLabel="Total empenhado"
          label="Composição da execução do recorte"
        />
      ) : (
        <p className="execution-composition-unavailable" role="status">
          {composition.status === "missing"
            ? "A composição depende dos três valores informados: empenhado, liquidado e pago. Consulte os totais disponíveis acima."
            : composition.status === "zero"
              ? "O total empenhado informado é zero. Não há parcelas para representar na rosca."
              : "Os valores deste recorte não permitem uma composição por saldo. Consulte os totais acima, que preservam os movimentos negativos e os valores de origem."}
        </p>
      )}
      <p className="execution-chart-note">
        As parcelas são distintas: pago, liquidado a pagar e empenhado a
        liquidar.
      </p>
    </section>
  );
}
