import { SqlConnection } from "../database";
import { Conditions } from "../repositories/sql";
import { BudgetFilters, BudgetRow, BudgetSummary, ExecutionFilters, ExecutionRow, ExecutionSummary, Pagination, ReportPage } from "./types";

// SQL identifiers come from these repository constants, never HTTP parameters.
const executionAmounts = {
  committedValue: "committed_value_brl",
  liquidatedValue: "liquidated_value_brl",
  paidValue: "paid_value_brl",
  registeredPayablesValue: "registered_payables_value_brl",
  canceledPayablesValue: "canceled_payables_value_brl",
  priorYearPaidValue: "outstanding_value_paid_brl",
};
const budgetAmounts = {
  initialBudget: "initial_budget", updatedBudget: "updated_budget",
  committedBudget: "committed_budget", executedBudget: "executed_budget",
};

function moneySums(fields: Record<string, string>): string {
  return Object.entries(fields).map(([name, column]) =>
    `CASE WHEN count(*) > 0 AND count(*) FILTER (WHERE ${column} IS NULL) = 0 THEN sum(${column})::text END AS "${name}"`
  ).join(",\n");
}

const executionCoverage = `count(*)::int AS "sourceRowCount", count(DISTINCT reference_month)::int AS "observedMonthCount",
  min(reference_month)::text AS "firstMonth", max(reference_month)::text AS "lastMonth", max(updated_at) AS "lastImportedAt"`;

export class FinanceReportsRepository {
  constructor(private readonly db: SqlConnection) {}

  private async report<Row, Summary>(selection: string, where: Conditions, grouping: string, summary: string, order: string, pagination: Pagination): Promise<ReportPage<Row, Summary>> {
    const limit = where.param(pagination.limit), offset = where.param(pagination.offset);
    const [result] = await this.db.query<{ total: string; data: Row[]; summary: Summary }>(`
      WITH filtered AS (SELECT * FROM (${selection}) s WHERE ${where.text}),
      grouped AS (${grouping}), selected AS (SELECT * FROM grouped ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}),
      summary AS (${summary})
      SELECT (SELECT count(*)::text FROM grouped) AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(selected) ORDER BY ${order}) FROM selected), '[]'::jsonb) AS data,
        (SELECT to_jsonb(summary) FROM summary) AS summary`, where.values);
    const total = Number(result.total);
    if (!Number.isSafeInteger(total)) throw new Error("Financial report count exceeds the supported range");
    return { data: result.data, total, page: pagination.page, limit: pagination.limit, summary: result.summary };
  }

  execution(filters: ExecutionFilters): Promise<ReportPage<ExecutionRow, ExecutionSummary>> {
    const where = new Conditions();
    where.add(`s.source = 'TRANSPARENCY_PORTAL'`);
    where.add(`s.management_code = ${where.param(filters.managementCode)}`);
    const start = `${filters.fiscalYear}-${String(filters.fromMonth).padStart(2, "0")}-01`;
    const end = filters.toMonth === 12 ? `${filters.fiscalYear + 1}-01-01` : `${filters.fiscalYear}-${String(filters.toMonth + 1).padStart(2, "0")}-01`;
    where.add(`s.reference_month >= ${where.param(start)}::date AND s.reference_month < ${where.param(end)}::date`);
    if (filters.managementUnitCode) where.add(`s.management_unit_code = ${where.param(filters.managementUnitCode)}`);
    if (filters.expenseNature) where.add(`s.expense_nature = ${where.param(filters.expenseNature)}`);
    if (filters.actionCode) where.add(`s.action_code = ${where.param(filters.actionCode)}`);
    const selection = `SELECT m.*, u.name AS unit_name,
      CASE WHEN economic_category_code ~ '^[0-9]$' AND expense_group_code ~ '^[0-9]$'
        AND application_modality_code ~ '^[0-9]{2}$' AND expense_element_code ~ '^[0-9]{2}$'
        THEN economic_category_code || expense_group_code || application_modality_code || expense_element_code END AS expense_nature
      FROM finance.monthly_execution m LEFT JOIN finance.management_units u
        ON (u.management_code, u.code) = (m.management_code, m.management_unit_code)`;
    const sums = moneySums(executionAmounts);
    const grouping = `SELECT management_code AS "managementCode", management_unit_code AS "managementUnitCode", min(unit_name) AS "unitName",
      expense_nature AS "expenseNature", economic_category_code AS "economicCategoryCode", min(economic_category_name) AS "economicCategoryName",
      expense_group_code AS "expenseGroupCode", min(expense_group_name) AS "expenseGroupName",
      application_modality_code AS "applicationModalityCode", min(application_modality_name) AS "applicationModalityName",
      expense_element_code AS "expenseElementCode", min(expense_element_name) AS "expenseElementName",
      ${executionCoverage}, ${sums} FROM filtered
      GROUP BY management_code, management_unit_code, expense_nature, economic_category_code, expense_group_code, application_modality_code, expense_element_code`;
    return this.report(selection, where, grouping, `SELECT ${executionCoverage}, ${sums} FROM filtered`,
      `"managementCode" ASC, "managementUnitCode" ASC, "economicCategoryCode" ASC, "expenseGroupCode" ASC, "applicationModalityCode" ASC NULLS LAST, "expenseElementCode" ASC`, filters);
  }

  budgets(filters: BudgetFilters): Promise<ReportPage<BudgetRow, BudgetSummary>> {
    const where = new Conditions();
    where.add(`s.source = 'TRANSPARENCY_PORTAL'`);
    where.add(`s.subordinate_agency_code = ${where.param(filters.subordinateAgencyCode)}`);
    where.add(`s.fiscal_year = ${where.param(filters.fiscalYear)}`);
    // Each optional field maps to a fixed repository column, not an input identifier.
    for (const [field, column] of [
      ["budgetaryUnitCode", "budgetary_unit_code"], ["actionCode", "action_code"],
      ["economicCategoryCode", "economic_category_code"], ["expenseGroupCode", "expense_group_code"],
      ["expenseElementCode", "expense_element_code"],
    ] as const) {
      if (filters[field]) where.add(`s.${column} = ${where.param(filters[field])}`);
    }
    const sums = moneySums(budgetAmounts);
    const coverage = `count(*)::int AS "sourceRowCount", max(updated_at) AS "lastImportedAt"`;
    const grouping = `SELECT fiscal_year AS "fiscalYear", superior_organ_code AS "superiorOrganCode", min(superior_organ_name) AS "superiorOrganName",
      subordinate_agency_code AS "subordinateAgencyCode", min(subordinate_agency_name) AS "subordinateAgencyName",
      budgetary_unit_code AS "budgetaryUnitCode", min(budgetary_unit_name) AS "budgetaryUnitName",
      action_code AS "actionCode", min(action_name) AS "actionName", economic_category_code AS "economicCategoryCode", min(economic_category_name) AS "economicCategoryName",
      expense_group_code AS "expenseGroupCode", min(expense_group_name) AS "expenseGroupName",
      expense_element_code AS "expenseElementCode", min(expense_element_name) AS "expenseElementName",
      ${coverage}, ${sums} FROM filtered
      GROUP BY fiscal_year, superior_organ_code, subordinate_agency_code, budgetary_unit_code, action_code, economic_category_code, expense_group_code, expense_element_code`;
    return this.report(`SELECT * FROM finance.annual_budgets`, where, grouping, `SELECT ${coverage}, ${sums} FROM filtered`,
      `"superiorOrganCode" ASC, "subordinateAgencyCode" ASC, "budgetaryUnitCode" ASC, "actionCode" ASC, "economicCategoryCode" ASC, "expenseGroupCode" ASC, "expenseElementCode" ASC`, filters);
  }
}
