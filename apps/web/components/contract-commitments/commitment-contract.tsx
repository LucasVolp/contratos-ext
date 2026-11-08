"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { maskDocument } from "@contracts/validation";
import { ErrorState, Loading } from "@/components/ui";
import { getCommitmentContracts, type CommitmentContract as Listing } from "@/lib/contract-commitments-api";

/** The contract(s) whose Contratos.gov.br commitments include this finance commitment. */
export function CommitmentContract({ commitmentId }: { commitmentId: string }) {
  const [contracts, setContracts] = useState<Listing[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getCommitmentContracts(commitmentId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setContracts(value.contracts);
        setError("");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [commitmentId, attempt]);

  return (
    <section className="detail-section" aria-label="Contrato">
      <div className="eyebrow">CONTRATO</div>
      {error ? (
        <ErrorState
          message={error}
          retry={() => {
            setError("");
            setAttempt((n) => n + 1);
          }}
        />
      ) : !contracts ? (
        <Loading />
      ) : contracts.length === 0 ? (
        <p className="empty">Sem contrato identificado.</p>
      ) : (
        <ul className="contract-links">
          {contracts.map((contract) => (
            <li key={`${contract.uasg}-${contract.number}`}>
              <strong>
                {contract.externalId ? (
                  <Link className="record-number" href={`/contratos/${contract.externalId}`}>
                    {contract.number}
                  </Link>
                ) : (
                  contract.number
                )}
              </strong>
              <p>
                {contract.supplierName || "Fornecedor não informado"}
                {contract.supplierDocument && <small className="muted"> · {maskDocument(contract.supplierDocument)}</small>}
              </p>
              <p className="muted">Informado pelo Contratos.gov.br</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
