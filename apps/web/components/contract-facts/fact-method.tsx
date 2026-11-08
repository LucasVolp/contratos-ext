import { DataTable, type Column } from "@/components/ui/data-table";
import { currency } from "@/lib/api";
import type { ContractFacts, TermFact } from "@/lib/contracts-api";
import { countedLabels, flagLabels, lawLabel, reasonLabels } from "@/lib/contract-facts";

const columns: Column[] = [
  { key: "number", label: "Número" },
  { key: "typeName", label: "Tipo" },
  { key: "signatureDate", label: "Assinatura", date: true },
  { key: "globalValue", label: "Valor global", money: true },
  { key: "delta", label: "Variação", format: (value) => (value === null ? "Não se aplica" : currency(value)) },
  {
    key: "counted",
    label: "Contado como",
    format: (_value, row) => {
      const term = row as unknown as TermFact;
      return term.counted ? countedLabels[term.counted] : (reasonLabels[term.reason ?? ""] ?? "Não conta");
    },
  },
  {
    key: "flags",
    label: "Avisos",
    format: (value) => ((value as string[]).length ? (value as string[]).map((f) => flagLabels[f] ?? f).join("; ") : "Nenhum"),
  },
];

/** How the summary was computed: the method and every history term weighed. */
export function FactMethod({ facts }: { facts: ContractFacts }) {
  const { amendments, term } = facts;
  return (
    <details className="fact-method">
      <summary>Como calculamos</summary>
      <p>
        A vigência atual é a data de fim informada pelo Contratos.gov.br; quando um termo indica outra data, as duas
        aparecem. O tempo de vigência conta do início do contrato original até essa data e é comparado com o limite
        para serviços contínuos ({lawLabel(term.law, term.lawSource)}). A fonte não informa se o serviço é contínuo,
        por isso é uma estimativa.
      </p>
      <p>
        Acréscimos e supressões são somados separadamente sobre o valor inicial registrado
        {amendments.base ? ` (${currency(amendments.base)})` : ""} e comparados com o limite de {amendments.limitPct}%.
        Cada termo aditivo conta pela variação do valor global em relação ao termo anterior. Apostilamentos,
        prorrogações e reajustes puros não contam. Na dúvida, o termo conta e recebe um aviso. 50% para reforma de
        edifício ou equipamento não é identificado na fonte.
      </p>
      {amendments.terms.length > 0 && (
        <DataTable rows={amendments.terms} columns={columns} caption="Termos considerados na estimativa" />
      )}
    </details>
  );
}
