import { api, ApiError } from "./api";
import type {
  BudgetBreakdowns,
  BudgetRow,
  BudgetSummary,
  ExecutionBreakdowns,
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

/** Chart values are complete server summaries, never client sums of page rows. */
export async function loadExecutionBreakdowns(
  query: string,
  signal: AbortSignal,
): Promise<ExecutionBreakdowns> {
  const params = new URLSearchParams(query);
  const from = Number(params.get("fromMonth") || 1),
    to = Number(params.get("toMonth") || 12);
  const rows = await allRows<ExecutionRow>(`execution?${query}`, signal);
  const units = [
    ...new Map(
      rows.filter((r) => r.managementUnitCode !== null).map((r) => [
        r.managementUnitCode!,
        { code: r.managementUnitCode!, name: r.unitName },
      ]),
    ).values(),
  ];
  const natures = [
    ...new Map(
      rows
        .filter((r) => r.expenseNature !== null)
        .map((r) => [
          r.expenseNature!,
          { code: r.expenseNature!, name: r.expenseElementName },
        ]),
    ).values(),
  ];
  const tasks = [
    ...Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => ({
      kind: "monthly" as const,
      month: from + i,
    })),
    ...units.map((unit) => ({ kind: "unit" as const, ...unit })),
    ...natures.map((nature) => ({ kind: "nature" as const, ...nature })),
  ];
  const results = await mapConcurrent(
    tasks,
    async (task) => {
      const changes: Record<string, string> = { limit: "1" };
      if (task.kind === "monthly") {
        changes.fromMonth = String(task.month);
        changes.toMonth = String(task.month);
      } else
        changes[task.kind === "unit" ? "managementUnitCode" : "expenseNature"] =
          task.code;
      const report = await financeGet<
        FinancialReport<ExecutionRow, ExecutionSummary>
      >(financePath("execution", query, changes), signal);
      return { ...task, summary: report.summary };
    },
    signal,
  );
  return {
    monthly: results
      .filter((r) => r.kind === "monthly")
      .map((r) => ({ month: r.month, summary: r.summary })),
    units: results
      .filter((r) => r.kind === "unit")
      .map((r) => ({ code: r.code, name: r.name, summary: r.summary })),
    natures: results
      .filter((r) => r.kind === "nature")
      .map((r) => ({ code: r.code, name: r.name, summary: r.summary })),
    unassignedUnitCount: rows.filter((r) => r.managementUnitCode === null).length,
    unclassifiedCount: rows.filter((r) => r.expenseNature === null).length,
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
