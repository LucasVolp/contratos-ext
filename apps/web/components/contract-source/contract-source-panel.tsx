"use client";
import { useEffect, useState } from "react";
import { ErrorState, Loading } from "@/components/ui";
import { calendar, display, money } from "@/components/ui/data-table";
import {
  freshness,
  getContractSource,
  sourceParts,
  type SourceSummary,
} from "@/lib/contract-source-api";
import { SourcePartSection } from "./source-part-section";

/** What Contratos.gov.br reports about this contract, read from the local replica. */
export function ContractSourcePanel({ contractId }: { contractId: string }) {
  const [summary, setSummary] = useState<SourceSummary | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getContractSource(contractId, controller.signal)
      .then(setSummary)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [contractId, attempt]);

  function retry() {
    setError("");
    setSummary(null);
    setAttempt((n) => n + 1);
  }
  const header = summary?.parts.find((p) => p.part === "header");
  return (
    <section className="detail-section contract-source" aria-labelledby="contract-source-heading">
      <div className="section-heading">
        <span className="eyebrow">Consulta pública</span>
        <h2 id="contract-source-heading">Dados do Contratos.gov.br</h2>
        {header && <p className="muted">{freshness(header)}</p>}
      </div>
      {error && <ErrorState message={error} retry={retry} />}
      {!error && !summary && <Loading />}
      {summary?.resolution === "NOT_FOUND" && (
        <p className="empty">
          Este contrato ainda não foi encontrado nos dados do Contratos.gov.br para a UASG informada.
        </p>
      )}
      {summary?.resolution === "AMBIGUOUS" && (
        <p className="empty">
          Há {summary.candidateCount} contratos com este número e UASG no Contratos.gov.br. A vinculação precisa de revisão.
        </p>
      )}
      {summary?.resolution === "RESOLVED" && summary.source && (
        <>
          <dl className="metadata">
            <div>
              <dt>Situação na fonte</dt>
              <dd>{display(summary.source.status)}</dd>
            </div>
            <div>
              <dt>Vigência na fonte</dt>
              <dd>
                {calendar(summary.source.startDate)} a {calendar(summary.source.endDate)}
              </dd>
            </div>
            <div>
              <dt>Valor global na fonte</dt>
              <dd>{money(summary.source.globalValue)}</dd>
            </div>
            <div>
              <dt>Processo</dt>
              <dd>{display(summary.source.processNumber)}</dd>
            </div>
            <div>
              <dt>Modalidade</dt>
              <dd>{display(summary.source.modality)}</dd>
            </div>
          </dl>
          {sourceParts.map((part) => {
            const state = summary.parts.find((p) => p.part === part) ?? {
              part,
              status: "MISSING" as const,
              capturedAt: null,
              lastAttemptAt: null,
              rowCount: 0,
            };
            return <SourcePartSection key={part} contractId={contractId} part={part} state={state} />;
          })}
        </>
      )}
    </section>
  );
}
