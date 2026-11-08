// Derived facts of one contract, computed on read from the Contratos.gov.br
// replica (header, history terms, guarantees and part statuses). Nothing is
// stored; each fact carries enough of its inputs for the screen to explain it.
// Design: docs/superpowers/specs/2026-11-08-contract-derived-facts-design.md §4.

export type FactStatus = "COMPUTED" | "ESTIMATED" | "NOT_COMPUTABLE" | "NOT_APPLICABLE";
export type GuaranteeStatus = "COVERS" | "BEFORE_END" | "NONE_INFORMED" | "NOT_CONSULTED" | "NOT_COMPARABLE";
export type Law = "8666" | "14133" | "UNKNOWN";
export type LawSource = "LEGAL_BASIS" | "SIGNATURE_DATE" | "NONE";

export interface FactHeader {
  typeName: string | null;
  category: string | null;
  legalBasis: string | null;
  signatureDate: string | null;
  startDate: string | null;
  endDate: string | null;
  initialValue: string | null;
}

export interface FactTerm {
  externalId: string;
  number: string | null;
  typeName: string | null;
  qualifications: string[];
  observation: string | null;
  signatureDate: string | null;
  startDate: string | null;
  endDate: string | null;
  globalValue: string | null;
}

export interface FactGuarantee {
  externalId: string;
  dueDate: string | null;
}

export interface FactInput {
  header: FactHeader;
  history: FactTerm[];
  guarantees: FactGuarantee[];
  /** contract_parts status of each part; "MISSING" when the part row is absent. */
  parts: { history: string; guarantees: string };
}

export interface TermFact {
  externalId: string;
  number: string | null;
  typeName: string | null;
  signatureDate: string | null;
  globalValue: string | null;
  delta: string | null;
  counted: "ADDITION" | "SUPPRESSION" | null;
  reason: string | null;
  flags: string[];
}

export interface ContractFacts {
  endDate: {
    value: string | null;
    source: "HEADER" | "TERM" | null;
    daysLeft: number | null;
    divergence: { termEndDate: string; termExternalId: string; termNumber: string | null } | null;
  };
  term: {
    status: FactStatus;
    startDate: string | null;
    months: number | null;
    capMonths: number | null;
    law: Law;
    lawSource: LawSource;
  };
  amendments: {
    status: FactStatus;
    base: string | null;
    additions: string | null;
    suppressions: string | null;
    additionsPct: string | null;
    suppressionsPct: string | null;
    limitPct: "25";
    margin: string | null;
    limitUsedRatio: string | null;
    nearLimit: boolean;
    terms: TermFact[];
  };
  guarantee: { status: GuaranteeStatus; dueDate: string | null; daysBeforeEnd: number | null; count: number };
  /** Contract balance from the commitments totals; filled by the service. */
  remaining: string | null;
  historyPart: string;
  guaranteesPart: string;
}

export const ADDITIVE = "Termo Aditivo";
export const APOSTILLE = "Termo de Apostilamento";
export const RESCISSION = "Termo de Rescisão";
const AMENDMENT_TYPES = new Set([ADDITIVE, APOSTILLE, RESCISSION]);
const SCOPE_CATEGORIES = new Set(["Compras", "Obras"]);
const CAP_MONTHS: Record<Law, number | null> = { "8666": 60, "14133": 120, UNKNOWN: null };
// Law 14.133 took effect on 2021-04-01; Law 8.666 could be chosen until 2023-12-30.
const NEW_LAW_FROM = "2021-04-01";
const OLD_LAW_UNTIL = "2023-12-30";

/** History terms by signature date (undated last), then by numeric external id. */
export function sortTerms(history: FactTerm[]): FactTerm[] {
  return [...history].sort((a, b) => {
    if (a.signatureDate !== b.signatureDate) {
      if (a.signatureDate === null) return 1;
      if (b.signatureDate === null) return -1;
      return a.signatureDate < b.signatureDate ? -1 : 1;
    }
    return BigInt(a.externalId) < BigInt(b.externalId) ? -1 : BigInt(a.externalId) > BigInt(b.externalId) ? 1 : 0;
  });
}

const epochDay = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) => Math.round(epochDay(to) - epochDay(from));

/** Whole months from start to end; the last month counts when its day is reached. */
function wholeMonths(start: string, end: string) {
  const [sy, sm, sd] = start.split("-").map(Number),
    [ey, em, ed] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) - (ed < sd ? 1 : 0);
}

function law(header: FactHeader): { law: Law; lawSource: LawSource } {
  const basis = header.legalBasis ?? "";
  if (/14\.?133/.test(basis)) return { law: "14133", lawSource: "LEGAL_BASIS" };
  if (/8\.?666/.test(basis)) return { law: "8666", lawSource: "LEGAL_BASIS" };
  const signed = header.signatureDate;
  if (!signed) return { law: "UNKNOWN", lawSource: "NONE" };
  if (signed < NEW_LAW_FROM) return { law: "8666", lawSource: "SIGNATURE_DATE" };
  if (signed > OLD_LAW_UNTIL) return { law: "14133", lawSource: "SIGNATURE_DATE" };
  return { law: "UNKNOWN", lawSource: "SIGNATURE_DATE" };
}

function endDate(header: FactHeader, sorted: FactTerm[], today: string): ContractFacts["endDate"] {
  const latest = sorted.filter((t) => t.typeName !== APOSTILLE && t.endDate !== null).at(-1) ?? null;
  const value = header.endDate ?? latest?.endDate ?? null;
  const source = header.endDate ? "HEADER" : latest ? "TERM" : null;
  const divergence =
    header.endDate && latest && latest.endDate !== header.endDate
      ? { termEndDate: latest.endDate!, termExternalId: latest.externalId, termNumber: latest.number }
      : null;
  return { value, source, daysLeft: value ? daysBetween(today, value) : null, divergence };
}

function guarantee(input: FactInput, end: string | null): ContractFacts["guarantee"] {
  const count = input.guarantees.length;
  const empty = (status: GuaranteeStatus) => ({ status, dueDate: null, daysBeforeEnd: null, count });
  if (!count) return empty(["MISSING", "FAILED"].includes(input.parts.guarantees) ? "NOT_CONSULTED" : "NONE_INFORMED");
  const dues = input.guarantees.map((g) => g.dueDate).filter((d): d is string => d !== null);
  if (!dues.length) return empty("NONE_INFORMED");
  if (!end) return empty("NOT_COMPARABLE");
  const dueDate = dues.reduce((a, b) => (a > b ? a : b));
  return dueDate < end
    ? { status: "BEFORE_END", dueDate, daysBeforeEnd: daysBetween(dueDate, end), count }
    : { status: "COVERS", dueDate, daysBeforeEnd: null, count };
}

export function computeFacts(input: FactInput, today: string): ContractFacts {
  const { header } = input;
  const sorted = sortTerms(input.history);
  const isContract = header.typeName === "Contrato";
  const original = sorted.find((t) => !AMENDMENT_TYPES.has(t.typeName ?? "")) ?? null;
  const end = endDate(header, sorted, today);
  const { law: contractLaw, lawSource } = law(header);
  const startDate = original?.startDate ?? header.startDate;

  let termStatus: FactStatus = "ESTIMATED";
  if (!isContract || SCOPE_CATEGORIES.has(header.category ?? "")) termStatus = "NOT_APPLICABLE";
  else if (!startDate || !end.value) termStatus = "NOT_COMPUTABLE";
  const estimated = termStatus === "ESTIMATED";

  return {
    endDate: end,
    term: {
      status: termStatus,
      startDate,
      months: estimated ? wholeMonths(startDate!, end.value!) : null,
      capMonths: estimated ? CAP_MONTHS[contractLaw] : null,
      law: contractLaw,
      lawSource,
    },
    amendments: {
      status: isContract ? "NOT_COMPUTABLE" : "NOT_APPLICABLE",
      base: header.initialValue,
      additions: null,
      suppressions: null,
      additionsPct: null,
      suppressionsPct: null,
      limitPct: "25",
      margin: null,
      limitUsedRatio: null,
      nearLimit: false,
      terms: [],
    },
    guarantee: guarantee(input, end.value),
    remaining: null,
    historyPart: input.parts.history,
    guaranteesPart: input.parts.guarantees,
  };
}
