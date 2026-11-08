import { Database } from "lucide-react";
import { date } from "@/lib/api";
import type { ExecutionSummary } from "@/lib/finance-types";

export function ExecutionSource({
  summary,
  consultedAt,
  requestedMonths,
}: {
  summary?: ExecutionSummary;
  consultedAt?: string;
  requestedMonths: number;
}) {
  return (
    <details className="execution-source">
      <summary>
        <Database size={14} aria-hidden="true" />
        Cobertura diária não informada
      </summary>
      <div>
        <strong>Origem e cobertura da consulta</strong>
        <dl>
          <div>
            <dt>Fonte</dt>
            <dd>Portal da Transparência · execução mensal</dd>
          </div>
          <div>
            <dt>Importação</dt>
            <dd>{date(summary?.lastImportedAt)}</dd>
          </div>
          <div>
            <dt>Consulta</dt>
            <dd>
              {consultedAt
                ? new Date(consultedAt).toLocaleString("pt-BR")
                : "Não consultado"}
            </dd>
          </div>
          {summary ? (
            <div>
              <dt>Presença mensal</dt>
              <dd>
                {summary.observedMonthCount} de {requestedMonths} meses com
                registros
              </dd>
            </div>
          ) : null}
        </dl>
        <p>
          A presença de registros em um mês não confirma a extração de todos os
          dias. O QDD por subelemento depende das despesas diárias e da
          conferência da cobertura do exercício.
        </p>
      </div>
    </details>
  );
}
