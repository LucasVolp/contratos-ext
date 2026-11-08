import { Badge } from "@/components/ui/badge";
import { currency, date } from "@/lib/api";
import type { ContractFacts } from "@/lib/contracts-api";
import { STALE_PART, daysLine, guaranteeLine, termLine } from "@/lib/contract-facts";
import { AmendmentMeter } from "./amendment-meter";
import { FactMethod } from "./fact-method";

const stale = (status: string) => status === "FAILED" && <small className="fact-note">{STALE_PART}</small>;

/** What the contracts sector needs before an extension or an amendment, explained. */
export function ContractFactsSummary({ facts }: { facts: ContractFacts }) {
  const { endDate, term, guarantee } = facts;
  const divergence = endDate.divergence;
  return (
    <section className="detail-section contract-facts" aria-labelledby="contract-facts-heading">
      <div className="section-heading">
        <h2 id="contract-facts-heading">Situação do contrato</h2>
      </div>
      <dl className="metadata">
        <div>
          <dt>Vigência</dt>
          <dd>
            <strong>{daysLine(endDate.daysLeft)}</strong>
            {endDate.value && (
              <small>
                Fim em {date(endDate.value)}
                {endDate.source === "TERM" ? ", conforme o último termo" : ""}
              </small>
            )}
            {divergence && (
              <small>
                Cabeçalho do Contratos.gov.br: {date(endDate.value)} · termo {divergence.termNumber ?? "sem número"}:{" "}
                {date(divergence.termEndDate)}
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>Tempo de vigência</dt>
          <dd>
            <span className="fact-line">
              {termLine(term)}
              {term.status === "ESTIMATED" && <Badge variant="outline">Estimativa</Badge>}
            </span>
          </dd>
        </div>
        <div>
          <dt>Aditivos</dt>
          <dd>
            <AmendmentMeter amendments={facts.amendments} />
            {stale(facts.historyPart)}
          </dd>
        </div>
        <div>
          <dt>Garantia</dt>
          <dd>
            {guaranteeLine(guarantee)}
            {stale(facts.guaranteesPart)}
          </dd>
        </div>
        <div>
          <dt>Saldo do contrato</dt>
          <dd>
            {currency(facts.remaining)}
            <small>
              <a href="#contract-commitments-heading">Ver empenhos por campus</a>
            </small>
          </dd>
        </div>
      </dl>
      <FactMethod facts={facts} />
    </section>
  );
}
