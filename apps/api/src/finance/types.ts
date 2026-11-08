export type FinanceQuery = Record<string, unknown>;
export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}
export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
export interface CommitmentFilters extends Pagination {
  allowedUnitCodes?: string[];
  managementCode: string;
  managementUnitCode?: string;
  fiscalYear?: number;
  expenseNature?: string;
  favoredCode?: string;
  search?: string;
  from?: string;
  to?: string;
}
export interface UnitFilters extends Pagination {
  allowedUnitCodes?: string[];
  managementCode?: string;
  search?: string;
}
export interface FinanceUnit {
  managementCode: string;
  code: string;
  name: string | null;
  managementName: string | null;
}
export interface CommitmentSummary {
  id: string;
  source: string;
  documentCode: string;
  resumedCode: string | null;
  headerAvailable: boolean;
  fiscalYear: number | null;
  managementCode: string | null;
  managementUnitCode: string | null;
  unitName: string | null;
  emissionDate: string | null;
  favoredCode: string | null;
  favoredName: string | null;
  processNumber: string | null;
  expenseNature: string | null;
  itemCount: number;
  historyCount: number;
  liquidationCount: number;
  paymentCount: number;
  committedValue: string | null;
  liquidatedValue: string | null;
  liquidationPriorYearMovementValue: string | null;
  paidValue: string | null;
  priorYearPaidValue: string | null;
}
export interface CommitmentHeader {
  type: string | null;
  documentTypeCode: string | null;
  documentType: string | null;
  budgetPlanCode: string | null;
  budgetPlanName: string | null;
  observation: string | null;
  originalValue: string | null;
  valueBrl: string | null;
  conversionRate: string | null;
  ingestionRunId: string;
  updatedAt: string;
}
export interface CommitmentDetail extends CommitmentSummary {
  header: CommitmentHeader | null;
}

export interface ExecutionFilters extends Pagination {
  allowedUnitCodes?: string[];
  managementCode: string;
  fiscalYear: number;
  managementUnitCode?: string;
  expenseNature?: string;
  actionCode?: string;
  fromMonth: number;
  toMonth: number;
}
export interface ExecutionAmounts {
  committedValue: string | null;
  liquidatedValue: string | null;
  paidValue: string | null;
  registeredPayablesValue: string | null;
  canceledPayablesValue: string | null;
  priorYearPaidValue: string | null;
}
export interface ExecutionSummary extends ExecutionAmounts {
  sourceRowCount: number;
  observedMonthCount: number;
  firstMonth: string | null;
  lastMonth: string | null;
  lastImportedAt: string | null;
}
export interface ExecutionRow extends ExecutionSummary {
  managementCode: string;
  managementUnitCode: string;
  unitName: string | null;
  expenseNature: string | null;
  economicCategoryCode: string;
  economicCategoryName: string | null;
  expenseGroupCode: string;
  expenseGroupName: string | null;
  applicationModalityCode: string | null;
  applicationModalityName: string | null;
  expenseElementCode: string;
  expenseElementName: string | null;
}
export interface ReportPage<Row, Summary> extends Page<Row> {
  summary: Summary;
}

export interface BudgetFilters extends Pagination {
  subordinateAgencyCode: string;
  fiscalYear: number;
  budgetaryUnitCode?: string;
  actionCode?: string;
  economicCategoryCode?: string;
  expenseGroupCode?: string;
  expenseElementCode?: string;
}
export interface BudgetSummary {
  sourceRowCount: number;
  initialBudget: string | null;
  updatedBudget: string | null;
  committedBudget: string | null;
  executedBudget: string | null;
  lastImportedAt: string | null;
}
export interface BudgetRow extends BudgetSummary {
  fiscalYear: number;
  superiorOrganCode: string;
  superiorOrganName: string | null;
  subordinateAgencyCode: string;
  subordinateAgencyName: string | null;
  budgetaryUnitCode: string;
  budgetaryUnitName: string | null;
  actionCode: string;
  actionName: string | null;
  economicCategoryCode: string;
  economicCategoryName: string | null;
  expenseGroupCode: string;
  expenseGroupName: string | null;
  expenseElementCode: string;
  expenseElementName: string | null;
}

export type ExpenseMetric = "committedValue" | "liquidatedValue" | "paidValue";
export interface SubelementFilters extends ExecutionFilters {
  expenseNature: string;
  metric: ExpenseMetric;
}
export interface SubelementAmounts {
  committedValue: string | null;
  liquidatedValue: string | null;
  paidValue: string | null;
}
export interface SubelementRow extends SubelementAmounts {
  code: string | null;
  name: string | null;
  sourceRowCount: number;
}
export interface SubelementSummary extends SubelementAmounts {
  sourceRowCount: number;
  documentCount: number;
  observedDayCount: number;
  firstDocumentDate: string | null;
  lastDocumentDate: string | null;
  lastImportedAt: string | null;
  coverage: "NOT_VERIFIED";
}
export interface SubelementSlice {
  code: string | null;
  name: string | null;
  value: string | null;
  other: boolean;
}
export interface SubelementReport extends ReportPage<
  SubelementRow,
  SubelementSummary
> {
  chart: SubelementSlice[];
  chartEligible: boolean;
}
