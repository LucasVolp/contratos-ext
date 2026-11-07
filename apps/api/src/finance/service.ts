import { inScope, Scope } from "../auth/access";
import { NotFoundException } from "../errors";
import { FinanceRepository } from "./repository";
import { FinanceReportsRepository } from "./reports";
import { FinanceQuery } from "./types";
import {
  budgetFilters,
  collectionFilters,
  commitmentFilters,
  commitmentId,
  detailFilters,
  executionFilters,
  unitFilters,
} from "./validation";

export type CommitmentCollection =
  | "items"
  | "history"
  | "liquidations"
  | "payments";

export class FinanceService {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly reports: FinanceReportsRepository,
  ) {}
  units(query: FinanceQuery, scope: Scope = null) {
    return this.repository.units({
      ...unitFilters(query),
      allowedUnitCodes: scope ?? undefined,
    });
  }
  commitments(query: FinanceQuery, scope: Scope = null) {
    return this.repository.commitments({
      ...commitmentFilters(query),
      allowedUnitCodes: scope ?? undefined,
    });
  }
  async execution(query: FinanceQuery, scope: Scope = null) {
    const filters = {
      ...executionFilters(query),
      allowedUnitCodes: scope ?? undefined,
    };
    const result = await this.reports.execution(filters);
    return {
      ...result,
      context: {
        dataset: "MONTHLY_EXECUTION",
        source: "TRANSPARENCY_PORTAL",
        managementCode: filters.managementCode,
        fiscalYear: filters.fiscalYear,
        fromMonth: filters.fromMonth,
        toMonth: filters.toMonth,
      },
    };
  }
  async budgets(query: FinanceQuery) {
    const filters = budgetFilters(query);
    const result = await this.reports.budgets(filters);
    return {
      ...result,
      context: {
        dataset: "ANNUAL_BUDGET",
        source: "TRANSPARENCY_PORTAL",
        subordinateAgencyCode: filters.subordinateAgencyCode,
        fiscalYear: filters.fiscalYear,
      },
    };
  }
  async commitment(value: string, query: FinanceQuery, scope: Scope = null) {
    const id = commitmentId(value);
    detailFilters(query);
    const result = await this.repository.commitment(id);
    if (
      !result ||
      (scope !== null &&
        (!result.managementUnitCode ||
          !inScope(scope, result.managementUnitCode)))
    )
      throw new NotFoundException("Empenho não encontrado.");
    return result;
  }
  async collection(
    kind: CommitmentCollection,
    value: string,
    query: FinanceQuery,
    scope: Scope = null,
  ) {
    const id = commitmentId(value);
    const filters = collectionFilters(query, kind === "history");
    if (scope !== null) await this.commitment(id, {}, scope);
    else if (!(await this.repository.exists(id)))
      throw new NotFoundException("Empenho não encontrado.");
    return this.repository[kind](id, filters);
  }
}
