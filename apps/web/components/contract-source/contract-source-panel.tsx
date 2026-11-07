import {
  freshness,
  sourceParts,
  type SourcePartState,
} from "@/lib/contract-source-api";
import { SourcePartSection } from "./source-part-section";

/** The step 2 parts of a contract (terms, items, invoices…), read from the daily replica. */
export function ContractSourcePanel({
  externalId,
  parts,
}: {
  externalId: string;
  parts: SourcePartState[];
}) {
  const header = parts.find((p) => p.part === "header");
  const captured = sourceParts.some((part) =>
    parts.some((p) => p.part === part),
  );
  return (
    <section
      className="detail-section"
      aria-labelledby="contract-source-heading"
    >
      <div className="section-heading">
        <span className="eyebrow">Consulta pública</span>
        <h2 id="contract-source-heading">Registros do Contratos.gov.br</h2>
        {header && <p className="muted">{freshness(header)}</p>}
      </div>
      {captured ? (
        sourceParts.map((part) => (
          <SourcePartSection
            key={part}
            externalId={externalId}
            part={part}
            state={
              parts.find((p) => p.part === part) ?? {
                part,
                status: "MISSING",
                capturedAt: null,
                lastAttemptAt: null,
                rowCount: 0,
              }
            }
          />
        ))
      ) : (
        <p className="empty">
          Os registros deste contrato no Contratos.gov.br ainda não estão
          disponíveis.
        </p>
      )}
    </section>
  );
}
