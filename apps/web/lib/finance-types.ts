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
