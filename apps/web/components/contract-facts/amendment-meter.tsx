import { Badge } from "@/components/ui/badge";
import type { ContractFacts } from "@/lib/contracts-api";
import { flaggedLine, marginLine, meterWidth, notComputableLine, percent } from "@/lib/contract-facts";

/** Cumulative additions and suppressions against the 25% limit, kept apart. */
export function AmendmentMeter({
  amendments,
  historyPart,
}: {
  amendments: ContractFacts["amendments"];
  historyPart: string;
}) {
  if (amendments.status === "NOT_APPLICABLE") return <p>Não se aplica a este tipo de instrumento</p>;
  if (amendments.status === "NOT_COMPUTABLE" || amendments.additionsPct === null)
    return <p>{notComputableLine(amendments.base, historyPart)}</p>;
  const flagged = amendments.terms.filter((term) => term.counted !== null && term.flags.length > 0).length;
  const limit = amendments.limitPct;
  const none = amendments.terms.every((term) => term.counted === null);
  return (
    <div className="fact-amendments">
      <p className="fact-line">
        <Badge variant="outline">Estimativa</Badge>
        {amendments.nearLimit && (
          <Badge variant="outline" className="fact-warning">
            {amendments.margin?.startsWith("-") ? "Acima do limite" : "Perto do limite"}
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
      {flagged > 0 && <p className="fact-note">{flaggedLine(flagged)}</p>}
    </div>
  );
}
