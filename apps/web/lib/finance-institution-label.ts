// Verified on 2026-11-08 against MEC publications; see docs/finance-pages.md.
// Use financial management codes, never an inferred match to a catalog UASG.
const MANAGEMENT_ACRONYMS: Readonly<Record<string, string>> = {
  "26350": "UFGD",
  "26415": "IFMS",
  "26421": "IFRO",
};

export function financeInstitutionLabel(code: string, name: string | null) {
  return MANAGEMENT_ACRONYMS[code] || name || code;
}
