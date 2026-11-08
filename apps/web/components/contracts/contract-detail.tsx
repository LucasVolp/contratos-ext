"use client";
import { useEffect, useState } from "react";
import { maskDocument } from "@contracts/validation";
import { currency, date } from "@/lib/api";
import {
  dateTime,
  getContract,
  vigency,
  type ContractDetail as Contract,
  type ContractRecord,
} from "@/lib/contracts-api";
import { ErrorState, Loading, PageHead, Status } from "../ui";
import { display } from "../ui/data-table";
import { ContractSourcePanel } from "../contract-source/contract-source-panel";
import { ContractCommitmentsSection } from "../contract-commitments/contract-commitments-section";
import { ContractNotes } from "./contract-notes";

/** Read-only record of one replicated contract, its source parts and the team's notes. */
export function ContractDetail({ externalId }: { externalId: string }) {
  const [data, setData] = useState<ContractRecord | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getContract(externalId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError("");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [externalId, attempt]);
  if (error)
    return (
      <>
        <PageHead title="Contrato" back="/contratos" />
        <ErrorState
          message={error}
          retry={() => {
            setError("");
            setAttempt((n) => n + 1);
          }}
        />
      </>
    );
  if (!data) return <Loading />;
  const { contract } = data;
  return (
    <>
      <PageHead
        title={contract.number}
        description="Ficha do contrato no Contratos.gov.br"
        back="/contratos"
      />
      <div className="detail-layout single">
        <ContractHeader contract={contract} />
        <ContractCommitmentsSection
          externalId={externalId}
          state={data.parts.find((p) => p.part === "commitments")}
        />
        <ContractNotes externalId={externalId} initial={data.notes} />
        <ContractSourcePanel externalId={externalId} parts={data.parts} />
      </div>
    </>
  );
}

function ContractHeader({ contract }: { contract: Contract }) {
  return (
    <>
      <section className="detail-section">
        <div className="section-heading">
          <span className="eyebrow">COMPROMISSO</span>
          <Status status={contract.status} />
        </div>
        <h2 className="object-title">{contract.object || "Objeto não informado"}</h2>
        <dl className="metadata">
          <div>
            <dt>UASG</dt>
            <dd>
              {contract.uasg}
              <small>{contract.unitName}</small>
            </dd>
          </div>
          <div>
            <dt>Vigência</dt>
            <dd>{vigency(contract.startDate, contract.endDate)}</dd>
          </div>
          <div>
            <dt>Processo</dt>
            <dd>{display(contract.processNumber)}</dd>
          </div>
          <div>
            <dt>Modalidade</dt>
            <dd>{display(contract.modality)}</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>
              {display(contract.typeName)}
              {contract.category && <small>{contract.category}</small>}
            </dd>
          </div>
          <div>
            <dt>Assinatura</dt>
            <dd>{date(contract.signatureDate)}</dd>
          </div>
          <div>
            <dt>Situação na fonte</dt>
            <dd>{display(contract.sourceStatus)}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>
              Contratos.gov.br
              <small>Capturado em {dateTime(contract.capturedAt)}</small>
            </dd>
          </div>
        </dl>
      </section>
      <section className="detail-section">
        <div className="eyebrow">FORNECEDOR</div>
        <h2>{contract.supplierName || "Não informado"}</h2>
        <p className="muted">
          {contract.supplierDocument
            ? maskDocument(contract.supplierDocument)
            : "Documento não informado"}
        </p>
      </section>
      <section className="value-summary" aria-label="Valores do contrato">
        <div>
          <span>VALOR INICIAL</span>
          <strong>{currency(contract.initialValue)}</strong>
        </div>
        <div>
          <span>VALOR GLOBAL</span>
          <strong>{currency(contract.globalValue)}</strong>
        </div>
        <div>
          <span>VALOR ACUMULADO</span>
          <strong>{currency(contract.accumulatedValue)}</strong>
        </div>
      </section>
    </>
  );
}
