export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
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

export interface FinanceUnit {
  managementCode: string;
  managementName: string | null;
  code: string;
  name: string | null;
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
  managementUnitCode: string | null;
  unitName: string | null;
  expenseNature: string | null;
  economicCategoryCode: string;
  expenseGroupCode: string;
  applicationModalityCode: string | null;
  expenseElementCode: string;
  expenseElementName: string | null;
}
export interface BudgetAmounts {
  initialBudget: string | null;
  updatedBudget: string | null;
  committedBudget: string | null;
  executedBudget: string | null;
}
export interface BudgetSummary extends BudgetAmounts {
  sourceRowCount: number;
  lastImportedAt: string | null;
}
export interface BudgetRow extends BudgetSummary {
  subordinateAgencyCode: string;
  subordinateAgencyName: string | null;
  budgetaryUnitCode: string;
  budgetaryUnitName: string | null;
  actionCode: string;
  actionName: string | null;
  economicCategoryCode: string;
  expenseGroupCode: string;
  expenseGroupName: string | null;
  expenseElementCode: string;
  expenseElementName: string | null;
}
export interface FinancialReport<Row, Summary> extends Page<Row> {
  summary: Summary;
}
export interface ChartEntry {
  id: string;
  name: string;
  caption?: string;
  value: string | null;
  filterValue?: string;
}
export type ExecutionMetric =
  "committedValue" | "liquidatedValue" | "paidValue";
export interface ExecutionNature {
  code: string;
  name: string | null;
  summary: ExecutionSummary;
}
export interface ExecutionNatures {
  natures: ExecutionNature[];
  unclassifiedCount: number;
  unassignedUnitCount: number;
}
export interface BudgetBreakdowns {
  actions: { code: string; name: string | null; summary: BudgetSummary }[];
  groups: { code: string; name: string | null; summary: BudgetSummary }[];
}

export interface SubelementRow {
  code: string | null;
  name: string | null;
  committedValue: string | null;
  liquidatedValue: string | null;
  paidValue: string | null;
  sourceRowCount: number;
}
export interface SubelementReport extends Page<SubelementRow> {
  chartEligible: boolean;
  summary: {
    committedValue: string | null;
    liquidatedValue: string | null;
    paidValue: string | null;
    sourceRowCount: number;
    documentCount: number;
    observedDayCount: number;
    firstDocumentDate: string | null;
    lastDocumentDate: string | null;
    lastImportedAt: string | null;
    coverage: "NOT_VERIFIED";
  };
  chart: {
    code: string | null;
    name: string | null;
    value: string | null;
    other: boolean;
  }[];
}
