// Derived facts of one contract, computed on read from the Contratos.gov.br
// replica (header, history terms, guarantees and part statuses). Nothing is
// stored; each fact carries enough of its inputs for the screen to explain it.
// Design: docs/superpowers/specs/2026-11-08-contract-derived-facts-design.md §4.
import Decimal from "decimal.js";

export type FactStatus = "COMPUTED" | "ESTIMATED" | "NOT_COMPUTABLE" | "NOT_APPLICABLE";
export type GuaranteeStatus =
  | "COVERS"
  | "BEFORE_END"
  | "NONE_INFORMED"
  | "NO_DUE_DATE"
  | "NOT_CONSULTED"
  | "NOT_COMPARABLE";
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

/** Whole months in force; the end date is the last day in force, so it counts. */
function wholeMonths(start: string, end: string) {
  const after = new Date(`${end}T00:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = [after.getUTCFullYear(), after.getUTCMonth() + 1, after.getUTCDate()];
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
  // Undated terms sort last but cannot be placed in time: use them only when no dated term has an end date.
  const withEnd = sorted.filter((t) => t.typeName !== APOSTILLE && t.endDate !== null);
  const latest = withEnd.filter((t) => t.signatureDate !== null).at(-1) ?? withEnd.at(-1) ?? null;
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
  if (!dues.length) return empty("NO_DUE_DATE");
  if (!end) return empty("NOT_COMPARABLE");
  const dueDate = dues.reduce((a, b) => (a > b ? a : b));
  return dueDate < end
    ? { status: "BEFORE_END", dueDate, daysBeforeEnd: daysBetween(dueDate, end), count }
    : { status: "COVERS", dueDate, daysBeforeEnd: null, count };
}

const LIMIT_PCT = new Decimal(25);
const NEAR_LIMIT_RATIO = new Decimal("0.8");
const EXTENSION = "VIGÊNCIA";
const PRICE_ADJUSTMENT = "REAJUSTE";
const MIGRATED = ["ACRÉSCIMO / SUPRESSÃO", "INFORMATIVO", EXTENSION];
const sameSet = (set: Set<string>, values: string[]) => set.size === values.length && values.every((v) => set.has(v));

/** Why a counted term may not be a quantitative change, or why a term was left out. */
function classify(row: FactTerm, delta: Decimal): Pick<TermFact, "counted" | "reason" | "flags"> {
  const q = new Set(row.qualifications);
  if (delta.isZero()) return { counted: null, reason: "NO_VALUE_CHANGE", flags: [] };
  if (sameSet(q, [EXTENSION])) return { counted: null, reason: "EXTENSION_ONLY", flags: [] };
  if (sameSet(q, [PRICE_ADJUSTMENT]) || sameSet(q, [PRICE_ADJUSTMENT, EXTENSION]))
    return { counted: null, reason: "PRICE_ADJUSTMENT_ONLY", flags: [] };
  const flags: string[] = [];
  if (!q.size) flags.push("NO_QUALIFICATION");
  if (q.has(PRICE_ADJUSTMENT)) flags.push("INCLUDES_PRICE_ADJUSTMENT");
  if (sameSet(q, MIGRATED)) flags.push("MIGRATED_RECORD");
  if (/reajust|repactua|prorroga|renova/i.test(row.observation ?? "")) flags.push("TEXT_MENTIONS_ADJUSTMENT");
  return { counted: delta.isPositive() ? "ADDITION" : "SUPPRESSION", reason: null, flags };
}

/**
 * Cumulative additions and suppressions over the initial value, kept apart.
 * The change of each Termo Aditivo is its global value minus the previous
 * valued row's (apostilles included, so price adjustments move the reference);
 * qualifications are unreliable, so any change is counted unless the term is a
 * pure extension or a pure price adjustment ("when in doubt, count").
 */
function amendments(
  sorted: FactTerm[],
  original: FactTerm | null,
  header: FactHeader,
): ContractFacts["amendments"] {
  const result: ContractFacts["amendments"] = {
    status: "NOT_COMPUTABLE",
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
  };
  if (header.typeName !== "Contrato") return { ...result, status: "NOT_APPLICABLE" };
  const base = header.initialValue === null ? null : new Decimal(header.initialValue);
  if (!sorted.length || !base || base.isZero()) return result;

  let reference: Decimal | null = null,
    additions = new Decimal(0),
    suppressions = new Decimal(0);
  for (const row of sorted) {
    const value = row.globalValue === null ? null : new Decimal(row.globalValue);
    const fact: TermFact = {
      externalId: row.externalId,
      number: row.number,
      typeName: row.typeName,
      signatureDate: row.signatureDate,
      globalValue: row.globalValue,
      delta: null,
      counted: null,
      reason: null,
      flags: [],
    };
    if (row === original) fact.reason = "ORIGINAL";
    else if (row.typeName === APOSTILLE) {
      fact.reason = "APOSTILLE";
      if (/acr[eé]scimo/i.test(row.observation ?? "")) fact.flags.push("APOSTILLE_TEXT_MENTIONS_ADDITION");
    } else if (row.typeName === RESCISSION) fact.reason = "RESCISSION";
    else if (row.typeName !== ADDITIVE) fact.reason = "OTHER_TYPE";
    else if (!value) fact.reason = "NO_GLOBAL_VALUE";
    else {
      const delta = value.minus(reference ?? base);
      Object.assign(fact, { delta: delta.toFixed(2) }, classify(row, delta));
      if (fact.counted === "ADDITION") additions = additions.plus(delta);
      if (fact.counted === "SUPPRESSION") suppressions = suppressions.plus(delta.abs());
    }
    if (value) reference = value;
    result.terms.push(fact);
  }
  const additionsPct = additions.div(base).times(100),
    ratio = additionsPct.div(LIMIT_PCT);
  return {
    ...result,
    status: "ESTIMATED",
    additions: additions.toFixed(2),
    suppressions: suppressions.toFixed(2),
    additionsPct: additionsPct.toFixed(4),
    suppressionsPct: suppressions.div(base).times(100).toFixed(4),
    margin: base.times(LIMIT_PCT).div(100).minus(additions).toFixed(2),
    limitUsedRatio: ratio.toFixed(4),
    nearLimit: ratio.gte(NEAR_LIMIT_RATIO),
  };
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
    amendments: amendments(sorted, original, header),
    guarantee: guarantee(input, end.value),
    remaining: null,
    historyPart: input.parts.history,
    guaranteesPart: input.parts.guarantees,
  };
}
