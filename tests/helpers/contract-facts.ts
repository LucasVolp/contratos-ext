// Derived facts as GET /api/contracts/:externalId returns them for a contract
// whose history and guarantees were never captured. Specs that are not about
// the situation summary use it so the detail mock matches the API shape.
export const uncapturedFacts = {
  endDate: { value: null, source: null, daysLeft: null, divergence: null },
  term: { status: 'NOT_COMPUTABLE', startDate: null, months: null, capMonths: null, law: 'UNKNOWN', lawSource: 'NONE' },
  amendments: {
    status: 'NOT_COMPUTABLE', base: null, additions: null, suppressions: null, additionsPct: null, suppressionsPct: null,
    limitPct: '25', margin: null, limitUsedRatio: null, nearLimit: false, terms: [],
  },
  guarantee: { status: 'NOT_CONSULTED', dueDate: null, daysBeforeEnd: null, count: 0 },
  remaining: null,
  historyPart: 'MISSING',
  guaranteesPart: 'MISSING',
};
