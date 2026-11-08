import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { natureCode } from "@/lib/finance-presentation";
import type { ExecutionSummary } from "@/lib/finance-types";
import { ExecutionTotals } from "./execution-totals";
export function ExecutionContext({
  scopeLabel,
  fiscalYear,
  selectedCode,
  selectedName,
  summary,
  loading,
  onReset,
}: {
  scopeLabel: string;
  fiscalYear: string;
  selectedCode: string | null;
  selectedName?: string | null;
  summary?: ExecutionSummary;
  loading: boolean;
  onReset: () => void;
}) {
  return (
    <>
      <nav className="execution-breadcrumb" aria-label="Caminho da despesa">
        <Button type="button" variant="link" onClick={() => onReset()}>
          Todas as despesas
        </Button>
        {selectedCode ? (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{natureCode(selectedCode)}</span>
            <Button type="button" variant="link" onClick={() => onReset()}>
              <ArrowLeft size={14} aria-hidden="true" />
              Voltar
            </Button>
          </>
        ) : null}
      </nav>
      <header className="execution-context">
        <span>
          {scopeLabel} · Exercício {fiscalYear}
        </span>
        <h2>
          {selectedCode
            ? selectedName || `Elemento ${natureCode(selectedCode)}`
            : "Todas as despesas do recorte"}
        </h2>
      </header>
      {summary ? <ExecutionTotals summary={summary} /> : null}
      <span className="sr-only" role="status" aria-live="polite">
        {summary && !loading
          ? `Consulta disponível para ${scopeLabel}, exercício ${fiscalYear}${selectedCode ? `, elemento ${natureCode(selectedCode)}` : ""}.`
          : ""}
      </span>
    </>
  );
}
