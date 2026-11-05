import { NotFoundException } from "../errors";
import { FinanceRepository } from "./repository";
import { FinanceReportsRepository } from "./reports";
import { FinanceQuery } from "./types";
import { budgetFilters, collectionFilters, commitmentFilters, commitmentId, detailFilters, executionFilters, unitFilters } from "./validation";

export type CommitmentCollection = "items" | "history" | "liquidations" | "payments";

export class FinanceService {
  constructor(private readonly repository: FinanceRepository, private readonly reports: FinanceReportsRepository) {}
  units(query: FinanceQuery) { return this.repository.units(unitFilters(query)); }
  commitments(query: FinanceQuery) { return this.repository.commitments(commitmentFilters(query)); }
  async execution(query: FinanceQuery) {
    const filters = executionFilters(query);
    const result = await this.reports.execution(filters);
    return { ...result, context: { dataset: "MONTHLY_EXECUTION", source: "TRANSPARENCY_PORTAL", managementCode: filters.managementCode,
      fiscalYear: filters.fiscalYear, fromMonth: filters.fromMonth, toMonth: filters.toMonth } };
  }
  async budgets(query: FinanceQuery) {
    const filters = budgetFilters(query);
    const result = await this.reports.budgets(filters);
    return { ...result, context: { dataset: "ANNUAL_BUDGET", source: "TRANSPARENCY_PORTAL",
      subordinateAgencyCode: filters.subordinateAgencyCode, fiscalYear: filters.fiscalYear } };
  }
  async commitment(value: string, query: FinanceQuery) {
    const id = commitmentId(value);
    detailFilters(query);
    const result = await this.repository.commitment(id);
    if (!result) throw new NotFoundException("Empenho não encontrado.");
    return result;
  }
  async collection(kind: CommitmentCollection, value: string, query: FinanceQuery) {
    const id = commitmentId(value);
    const filters = collectionFilters(query, kind === "history");
    if (!(await this.repository.exists(id))) throw new NotFoundException("Empenho não encontrado.");
    return this.repository[kind](id, filters);
  }
}
