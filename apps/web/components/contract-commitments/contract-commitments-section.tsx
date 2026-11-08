"use client";
import { useEffect, useState } from "react";
import { ErrorState, Loading } from "@/components/ui";
import { freshness, hasRows, type SourcePartState } from "@/lib/contract-source-api";
import { getContractCommitments, type ContractCommitments } from "@/lib/contract-commitments-api";
import { CampusTotals } from "./campus-totals";
import { CommitmentLinks } from "./commitment-links";

const never: SourcePartState = { part: "commitments", status: "MISSING", capturedAt: null, lastAttemptAt: null, rowCount: 0 };

/** Commitments of the contract by issuing campus, as Contratos.gov.br lists them. */
export function ContractCommitmentsSection({ externalId, state = never }: { externalId: string; state?: SourcePartState }) {
  const load = hasRows(state);
  const empty = (state.status === "AVAILABLE" && state.rowCount === 0) || state.status === "NOT_FOUND";
  const [data, setData] = useState<ContractCommitments | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    getContractCommitments(externalId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError("");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [externalId, attempt, load]);

  return (
    <section className="detail-section" aria-labelledby="contract-commitments-heading">
      <div className="section-heading">
        <span className="eyebrow">EXECUÇÃO</span>
        <h2 id="contract-commitments-heading">Empenhos por campus</h2>
        <p className="muted">{freshness(state)}</p>
      </div>
      {empty && <p className="empty">O Contratos.gov.br não informa empenhos para este contrato.</p>}
      {load && error && (
        <ErrorState
          message={error}
          retry={() => {
            setError("");
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {load && !error && !data && <Loading />}
      {load && !error && data && (
        <>
          <p className="muted">
            Empenhos informados pelo Contratos.gov.br. Valores do Contratos.gov.br, incluindo restos a pagar.
          </p>
          <CampusTotals data={data} />
          <CommitmentLinks data={data} />
        </>
      )}
    </section>
  );
}
