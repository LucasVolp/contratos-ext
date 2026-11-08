import { Badge } from "@/components/ui/badge";
import type { ContractFacts } from "@/lib/contracts-api";
import { marginLine, meterWidth, percent } from "@/lib/contract-facts";

/** Cumulative additions and suppressions against the 25% limit, kept apart. */
export function AmendmentMeter({ amendments }: { amendments: ContractFacts["amendments"] }) {
  if (amendments.status === "NOT_APPLICABLE") return <p>Não se aplica a este tipo de instrumento</p>;
  if (amendments.status === "NOT_COMPUTABLE" || amendments.additionsPct === null)
    return <p>Não calculável: o histórico do contrato não foi informado</p>;
  const limit = amendments.limitPct;
  const none = amendments.terms.every((term) => term.counted === null);
  return (
    <div className="fact-amendments">
      <p className="fact-line">
        <Badge variant="outline">Estimativa</Badge>
        {amendments.nearLimit && (
          <Badge variant="outline" className="fact-warning">
            Perto do limite
          </Badge>
        )}
      </p>
      {none ? (
        <p>0% — nenhum termo de acréscimo ou supressão identificado</p>
      ) : (
        <>
          <p>
            Acréscimos: {percent(amendments.additionsPct)}% de {limit}%
          </p>
          <span className="fact-meter" aria-hidden="true">
            <span style={{ width: meterWidth(amendments.limitUsedRatio ?? "0") }} />
          </span>
          <p>
            Supressões: {percent(amendments.suppressionsPct ?? "0")}% de {limit}%
          </p>
        </>
      )}
      {amendments.margin !== null && <p>{marginLine(amendments.margin)}</p>}
    </div>
  );
}
