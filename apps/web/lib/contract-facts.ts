import { currency, date } from "@/lib/api";
import type { ContractFacts } from "@/lib/contracts-api";

/** Why a history term was left out of the amendment estimate. */
export const reasonLabels: Record<string, string> = {
  ORIGINAL: "Contrato original",
  APOSTILLE: "Apostilamento: não conta",
  RESCISSION: "Rescisão: não conta",
  OTHER_TYPE: "Outro tipo de termo: não conta",
  NO_GLOBAL_VALUE: "Sem valor global na fonte: não conta",
  NO_VALUE_CHANGE: "Sem alteração de valor",
  EXTENSION_ONLY: "Só prorrogação de vigência: não conta",
  PRICE_ADJUSTMENT_ONLY: "Só reajuste: não conta",
};
export const countedLabels: Record<string, string> = {
  ADDITION: "Acréscimo",
  SUPPRESSION: "Supressão",
};
/** Warnings next to counted terms: they may not be quantitative changes. */
export const flagLabels: Record<string, string> = {
  NO_QUALIFICATION: "Sem qualificação na fonte: pode não ser acréscimo ou supressão quantitativo",
  INCLUDES_PRICE_ADJUSTMENT: "Qualificação inclui reajuste: pode conter reajuste",
  MIGRATED_RECORD: "Registro migrado de sistema anterior: pode ser prorrogação ou reajuste",
  TEXT_MENTIONS_ADJUSTMENT: "Texto menciona reajuste, repactuação ou prorrogação: pode não ser acréscimo quantitativo",
  APOSTILLE_TEXT_MENTIONS_ADDITION: "Texto do apostilamento menciona acréscimo",
};

const lawNames = { "8666": "Lei 8.666/1993", "14133": "Lei 14.133/2021" } as const;

export function lawLabel(law: ContractFacts["term"]["law"], source: ContractFacts["term"]["lawSource"]) {
  if (law === "UNKNOWN") return "Lei não identificada na fonte";
  return source === "LEGAL_BASIS"
    ? `${lawNames[law]}, conforme o fundamento legal`
    : `${lawNames[law]}, deduzida pela data de assinatura`;
}

export function daysLine(daysLeft: number | null) {
  if (daysLeft === null) return "Vigência não informada";
  if (daysLeft === 0) return "Vence hoje";
  if (daysLeft === 1) return "Vence amanhã";
  if (daysLeft > 1) return `Vence em ${daysLeft} dias`;
  return daysLeft === -1 ? "Encerrado há 1 dia" : `Encerrado há ${-daysLeft} dias`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function duration(months: number) {
  const years = Math.floor(months / 12),
    rest = months % 12;
  if (!years) return plural(rest, "mês", "meses");
  return rest ? `${plural(years, "ano", "anos")} e ${plural(rest, "mês", "meses")}` : plural(years, "ano", "anos");
}

export function termLine(term: ContractFacts["term"]) {
  if (term.status === "NOT_APPLICABLE") return "Não se aplica a este tipo de instrumento";
  if (term.status === "NOT_COMPUTABLE" || term.months === null) return "Não calculável: início ou fim da vigência não informado";
  const cap =
    term.capMonths === null
      ? "60 meses (Lei 8.666) ou 10 anos (Lei 14.133)"
      : term.capMonths === 60
        ? "60 meses"
        : duration(term.capMonths);
  return `${duration(term.months)} de ${cap}`;
}

export function guaranteeLine(guarantee: ContractFacts["guarantee"]) {
  switch (guarantee.status) {
    case "BEFORE_END":
      return `A garantia vence em ${date(guarantee.dueDate)}, ${plural(guarantee.daysBeforeEnd ?? 0, "dia", "dias")} antes do contrato`;
    case "COVERS":
      return `Garantia válida até ${date(guarantee.dueDate)}`;
    case "NONE_INFORMED":
      return "Nenhuma garantia informada pelo Contratos.gov.br";
    case "NO_DUE_DATE":
      return "Garantia informada sem data de vencimento";
    case "NOT_CONSULTED":
      return "Garantias não consultadas no Contratos.gov.br";
    default:
      return "Sem data de fim para comparar com a garantia";
  }
}

/** "22.0000" → "22", "12.3456" → "12,35"; rounds half up on the decimal text. */
export function percent(value: string) {
  const negative = value.startsWith("-");
  const [integer, fraction = ""] = value.replace("-", "").split(".");
  const cents = BigInt(integer + (fraction + "00").slice(0, 2)) + ((fraction[2] ?? "0") >= "5" ? BigInt(1) : BigInt(0));
  const digits = cents.toString().padStart(3, "0");
  const decimals = digits.slice(-2).replace(/0+$/, "");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}${decimals ? "," + decimals : ""}`;
}

/** Share of the limit used ("0.8800") as a CSS width capped at 100% ("88%"). */
export function meterWidth(ratio: string) {
  const [integer, fraction = ""] = ratio.split(".");
  const scaled = `${integer}${(fraction + "00").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  if (ratio.startsWith("-")) return "0%";
  // Leading zeros are stripped, so three or more digits means 100% or more.
  return scaled.length >= 3 ? "100%" : `${scaled}%`;
}

export function marginLine(margin: string) {
  return margin.startsWith("-")
    ? `Acréscimos excedem o limite em ${currency(margin.slice(1))}`
    : `Ainda cabe acrescer ${currency(margin)}`;
}

/** Why the amendment estimate could not be computed: missing base or history, by part status. */
export function notComputableLine(base: string | null, historyPart: string) {
  if (base === null || /^0*(\.0*)?$/.test(base)) return "Não calculável: valor inicial não informado pelo Contratos.gov.br";
  if (historyPart === "FAILED") return "Não calculável: a consulta ao histórico do contrato falhou";
  if (historyPart === "MISSING") return "Não calculável: o histórico do contrato ainda não foi consultado";
  return "Não calculável: o Contratos.gov.br não informa o histórico deste contrato";
}

/** Counted terms carrying a warning, said on the summary so the estimate is read with its caveat. */
export function flaggedLine(count: number) {
  return count === 1
    ? "1 termo contado tem aviso: pode não ser acréscimo ou supressão quantitativo. Confira em Como calculamos."
    : `${count} termos contados têm aviso: podem não ser acréscimos ou supressões quantitativos. Confira em Como calculamos.`;
}

export const STALE_PART = "Pode estar desatualizado: a última consulta ao Contratos.gov.br falhou";
