import { api, ApiError } from "./api";
import type {
  BudgetBreakdowns,
  BudgetRow,
  BudgetSummary,
  ExecutionNatures,
  ExecutionRow,
  ExecutionSummary,
  FinanceUnit,
  FinancialReport,
  Page,
} from "./finance-types";
const financialLabels: Record<string, string> = {
  managementCode: "órgão / gestão",
  subordinateAgencyCode: "órgão subordinado",
  managementUnitCode: "unidade gestora",
  budgetaryUnitCode: "unidade orçamentária",
  fiscalYear: "exercício",
  expenseNature: "natureza de despesa",
  actionCode: "ação orçamentária",
  fromMonth: "mês inicial",
  toMonth: "mês final",
  expenseGroupCode: "grupo de despesa",
  expenseElementCode: "elemento de despesa",
  economicCategoryCode: "categoria econômica",
  favoredCode: "código do favorecido",
  commitmentId: "identificador do empenho",
};
export async function financeGet<T>(
  path: string,
  signal: AbortSignal,
): Promise<T> {
  try {
    return await api<T>(`/finance/${path}`, { signal });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const humanize = (text: string) =>
      Object.entries(financialLabels).reduce(
        (message, [key, label]) => message.replaceAll(key, label),
        text,
      );
    throw new ApiError(
      humanize(error.message),
      Object.fromEntries(
        Object.entries(error.fieldErrors).map(([key, value]) => [
          key,
          humanize(value),
        ]),
      ),
      error.status,
    );
  }
}
export function financePath(
  endpoint: string,
  query: string,
  changes: Record<string, string | undefined> = {},
) {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  return `${endpoint}?${params}`;
}
async function mapConcurrent<T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
  signal: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (index < items.length) {
        signal.throwIfAborted();
        const current = index++;
        results[current] = await work(items[current]);
      }
    }),
  );
  return results;
}
async function allRows<Row>(path: string, signal: AbortSignal): Promise<Row[]> {
  const [endpoint, query = ""] = path.split("?");
  const first = await financeGet<Page<Row>>(
    financePath(endpoint, query, { page: "1", limit: "100" }),
    signal,
  );
  const pages = await mapConcurrent(
    Array.from(
      { length: Math.max(0, Math.ceil(first.total / first.limit) - 1) },
      (_, i) => i + 2,
    ),
    (page) =>
      financeGet<Page<Row>>(
        financePath(endpoint, query, { page: String(page), limit: "100" }),
        signal,
      ),
    signal,
  );
  return [first, ...pages].flatMap((page) => page.data);
}
export function loadFinanceUnits(_key: string, signal: AbortSignal) {
  return allRows<FinanceUnit>("units", signal);
}
export function loadBudgetRows(query: string, signal: AbortSignal) {
  return allRows<BudgetRow>(`budgets?${query}`, signal);
}

/** Each element uses a complete SQL summary; page rows only discover classifications. */
export async function loadExecutionNatures(
  query: string,
  signal: AbortSignal,
): Promise<ExecutionNatures> {
  const rows = await allRows<ExecutionRow>(`execution?${query}`, signal);
  const natures = [
    ...new Map(
      rows
        .filter((row) => row.expenseNature !== null)
        .map((row) => [
          row.expenseNature!,
          { code: row.expenseNature!, name: row.expenseElementName },
        ]),
    ).values(),
  ];
  const results = await mapConcurrent(
    natures,
    async (nature) => {
      const report = await financeGet<
        FinancialReport<ExecutionRow, ExecutionSummary>
      >(
        financePath("execution", query, {
          expenseNature: nature.code,
          page: "1",
          limit: "1",
        }),
        signal,
      );
      return { ...nature, summary: report.summary };
    },
    signal,
  );
  return {
    natures: results,
    unclassifiedCount: rows.filter((row) => row.expenseNature === null).length,
    unassignedUnitCount: rows.filter((row) => row.managementUnitCode === null)
      .length,
  };
}
export async function loadBudgetBreakdowns(
  query: string,
  signal: AbortSignal,
): Promise<BudgetBreakdowns> {
  const rows = await loadBudgetRows(query, signal);
  const actions = [
    ...new Map(
      rows.map((r) => [
        r.actionCode,
        { code: r.actionCode, name: r.actionName },
      ]),
    ).values(),
  ];
  const groups = [
    ...new Map(
      rows.map((r) => [
        r.expenseGroupCode,
        { code: r.expenseGroupCode, name: r.expenseGroupName },
      ]),
    ).values(),
  ];
  const results = await mapConcurrent(
    [
      ...actions.map((a) => ({ ...a, kind: "action" as const })),
      ...groups.map((g) => ({ ...g, kind: "group" as const })),
    ],
    async (task) => {
      const report = await financeGet<
        FinancialReport<BudgetRow, BudgetSummary>
      >(
        financePath("budgets", query, {
          limit: "1",
          [task.kind === "action" ? "actionCode" : "expenseGroupCode"]:
            task.code,
        }),
        signal,
      );
      return { ...task, summary: report.summary };
    },
    signal,
  );
  return {
    actions: results.filter((r) => r.kind === "action"),
    groups: results.filter((r) => r.kind === "group"),
  };
}
