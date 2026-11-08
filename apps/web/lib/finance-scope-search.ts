// Deterministic interpretation of free text into finance panel filters.
// Only recognizes units present in the directory, fiscal years and periods;
// anything else is reported back instead of being guessed.

export interface ScopeSearchUnit {
  code: string;
  name: string | null;
}

export interface ScopeSearchResult {
  changes: Record<string, string>;
  labels: string[];
  unmatched: string[];
  candidates: ScopeSearchUnit[];
}

interface Token {
  raw: string;
  norm: string;
}

// [label, normalized full name, abbreviation]
const MONTHS = [
  ["janeiro", "janeiro", "jan"],
  ["fevereiro", "fevereiro", "fev"],
  ["março", "marco", "mar"],
  ["abril", "abril", "abr"],
  ["maio", "maio", "mai"],
  ["junho", "junho", "jun"],
  ["julho", "julho", "jul"],
  ["agosto", "agosto", "ago"],
  ["setembro", "setembro", "set"],
  ["outubro", "outubro", "out"],
  ["novembro", "novembro", "nov"],
  ["dezembro", "dezembro", "dez"],
];
const ORDINALS: Record<string, number> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  primeiro: 1,
  segundo: 2,
  terceiro: 3,
  quarto: 4,
};
const PERIOD_LABELS: Record<string, string> = {
  "1-12": "Ano inteiro",
  "1-6": "1º semestre",
  "7-12": "2º semestre",
  "1-3": "1º trimestre",
  "4-6": "2º trimestre",
  "7-9": "3º trimestre",
  "10-12": "4º trimestre",
};
const CONNECTORS = new Set([
  "a",
  "as",
  "o",
  "os",
  "e",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "no",
  "na",
  "para",
]);
const GENERIC_WORDS = new Set([
  "unidade",
  "exercicio",
  "periodo",
  "ano",
  "mes",
]);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ºª°]/g, "")
    .replace(/^(\d)o$/, "$1");
}

function tokenize(text: string): Token[] {
  return text
    .split(/[\s,;]+|(?<=\p{L})-(?=\p{L})/u)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: normalize(raw) }));
}

function monthOf(norm: string) {
  const index = MONTHS.findIndex(
    ([, full, short]) => norm === full || norm === short,
  );
  return index < 0 ? null : index + 1;
}

export function scopeSearchPeriodLabel(from: number, to: number) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to > 12 ||
    from > to
  )
    return "Período inválido";
  const known = PERIOD_LABELS[`${from}-${to}`];
  if (known) return known;
  const first = MONTHS[from - 1][0];
  const capitalized = first[0].toUpperCase() + first.slice(1);
  return from === to ? capitalized : `${capitalized} a ${MONTHS[to - 1][0]}`;
}

function nameTokens(unit: ScopeSearchUnit) {
  return tokenize(unit.name || "").map((token) => token.norm);
}

export function scopeSearchUnitLabel(unit: ScopeSearchUnit) {
  return unit.name || `Unidade ${unit.code}`;
}

function matchUnit(tokens: Token[], units: ScopeSearchUnit[]) {
  const byCode = tokens.find((token) =>
    units.some((u) => u.code === token.norm),
  );
  if (byCode) {
    return {
      unit: units.find((u) => u.code === byCode.norm) || null,
      candidates: [],
      unmatched: tokens
        .filter((t) => t !== byCode && !isSoft(t))
        .map((t) => t.raw),
    };
  }
  const names = units.map(nameTokens);
  const hard = tokens.filter((token) => !isSoft(token));
  const known = hard.filter((token) =>
    names.some((name) => name.some((part) => part.startsWith(token.norm))),
  );
  const unmatched = hard
    .filter((token) => !known.includes(token))
    .map((t) => t.raw);
  if (known.length === 0) return { unit: null, candidates: [], unmatched };
  const scored = units
    .map((unit, index) => {
      const name = names[index];
      return {
        unit,
        hard: known.filter((t) => name.some((part) => part.startsWith(t.norm)))
          .length,
        soft: tokens.filter((t) => isSoft(t) && name.includes(t.norm)).length,
        exact: tokens.map((t) => t.norm).join(" ") === name.join(" "),
      };
    })
    .filter((item) => item.hard === known.length);
  if (scored.length === 0) {
    return {
      unit: null,
      candidates: [],
      unmatched: hard.map((token) => token.raw),
    };
  }
  const best = (items: typeof scored, key: "hard" | "soft") => {
    const top = Math.max(...items.map((item) => item[key]));
    return items.filter((item) => item[key] === top);
  };
  let pool = best(best(scored, "hard"), "soft");
  if (pool.length > 1 && pool.some((item) => item.exact)) {
    pool = pool.filter((item) => item.exact);
  }
  return pool.length === 1
    ? { unit: pool[0].unit, candidates: [], unmatched }
    : { unit: null, candidates: pool.map((item) => item.unit), unmatched };
}

function isSoft(token: Token) {
  return CONNECTORS.has(token.norm) || GENERIC_WORDS.has(token.norm);
}

export function interpretScopeSearch(
  text: string,
  units: ScopeSearchUnit[],
  {
    unitKey = "managementUnitCode",
    periods = true,
  }: { unitKey?: string; periods?: boolean } = {},
): ScopeSearchResult {
  const tokens = tokenize(text);
  const rest: Token[] = [];
  const unmatched: string[] = [];
  const months: number[] = [];
  let year: string | null = null;
  let range: [number, number] | null = null;
  let until = false;
  let allUnits = false;
  const period = (consumed: Token[], value: [number, number] | null) => {
    if (periods) range = value;
    else unmatched.push(consumed.map((t) => t.raw).join(" "));
  };
  for (let i = 0; i < tokens.length; i++) {
    const { norm } = tokens[i];
    const next = tokens[i + 1]?.norm;
    const dated = norm.match(/^(\d{1,2})\/((?:19|20)\d{2})$/);
    if (/^(19|20)\d{2}$/.test(norm)) {
      year = norm;
    } else if (dated && Number(dated[1]) >= 1 && Number(dated[1]) <= 12) {
      year = dated[2];
      period([tokens[i]], [Number(dated[1]), Number(dated[1])]);
    } else if (
      norm in ORDINALS &&
      /^(semestre|sem|trimestre|tri)$/.test(next || "")
    ) {
      const n = ORDINALS[norm];
      const size = next!.startsWith("sem") ? 6 : 3;
      if (n <= 12 / size)
        period(tokens.slice(i, i + 2), [(n - 1) * size + 1, n * size]);
      else unmatched.push(`${tokens[i].raw} ${tokens[i + 1].raw}`);
      i++;
    } else if (norm === "ano" && /^(inteiro|todo|completo)$/.test(next || "")) {
      period(tokens.slice(i, i + 2), [1, 12]);
      i++;
    } else if (norm === "todas" || norm === "todos") {
      let j = i + 1;
      if (tokens[j] && CONNECTORS.has(tokens[j].norm)) j++;
      if (tokens[j]?.norm === "unidades") {
        allUnits = true;
        i = j;
      } else rest.push(tokens[i]);
    } else if (norm === "ate" && next && monthOf(next)) {
      until = true;
    } else if (monthOf(norm)) {
      if (periods) months.push(monthOf(norm)!);
      else period([tokens[i]], null);
    } else {
      rest.push(tokens[i]);
    }
  }
  if (months.length > 0) {
    const last = Math.max(...months);
    range = [until ? 1 : Math.min(...months), last];
  }
  const changes: Record<string, string> = {};
  const labels: string[] = [];
  const unitMatch = matchUnit(rest, units);
  unmatched.push(...unitMatch.unmatched);
  if (unitMatch.unit) {
    changes[unitKey] = unitMatch.unit.code;
    labels.push(scopeSearchUnitLabel(unitMatch.unit));
  } else if (allUnits && unitMatch.candidates.length === 0) {
    changes[unitKey] = "";
    labels.push("Todas as unidades");
  }
  if (year) {
    changes.fiscalYear = year;
    labels.push(`Exercício ${year}`);
  }
  const chosen = range as [number, number] | null;
  if (chosen) {
    changes.fromMonth = String(chosen[0]);
    changes.toMonth = String(chosen[1]);
    labels.push(scopeSearchPeriodLabel(chosen[0], chosen[1]));
  }
  return { changes, labels, unmatched, candidates: unitMatch.candidates };
}
