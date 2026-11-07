"use client";
import { useEffect, useState } from "react";
import { ErrorState, Loading, Pager } from "@/components/ui";
import { DataTable, type DataRow } from "@/components/ui/data-table";
import type { Page } from "@/lib/finance-types";
import {
  freshness,
  getContractSourcePart,
  hasRows,
  partColumns,
  partTitles,
  type SourcePart,
  type SourcePartState,
} from "@/lib/contract-source-api";

/** One part of the Contratos.gov.br replica (terms, items, invoices…). */
export function SourcePartSection({
  contractId,
  part,
  state,
}: {
  contractId: string;
  part: SourcePart;
  state: SourcePartState;
}) {
  const title = partTitles[part];
  const load = hasRows(state);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Page<DataRow> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    getContractSourcePart(contractId, part, page, controller.signal)
      .then(setResult)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [contractId, part, page, attempt, load]);

  const empty = state.status === "AVAILABLE" && state.rowCount === 0;
  return (
    <section className="detail-section" aria-label={title}>
      <div className="section-heading">
        <h3>{title}</h3>
        <p className="muted">{freshness(state)}</p>
      </div>
      {empty && <p className="empty">Nenhum registro informado pela fonte.</p>}
      {load && error && (
        <ErrorState
          message={error}
          retry={() => {
            setError("");
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {load && !error && !result && <Loading />}
      {load && !error && result && (
        <>
          <DataTable rows={result.data} columns={partColumns[part]} caption={`Tabela: ${title}`} />
          {result.total > result.limit && (
            <Pager page={result.page} total={result.total} limit={result.limit} onChange={setPage} />
          )}
        </>
      )}
    </section>
  );
}
