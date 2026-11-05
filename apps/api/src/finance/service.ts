import { NotFoundException } from "../errors";
import { FinanceRepository } from "./repository";
import { FinanceQuery } from "./types";
import { collectionFilters, commitmentFilters, commitmentId, detailFilters, unitFilters } from "./validation";

export type CommitmentCollection = "items" | "history" | "liquidations" | "payments";

export class FinanceService {
  constructor(private readonly repository: FinanceRepository) {}
  units(query: FinanceQuery) { return this.repository.units(unitFilters(query)); }
  commitments(query: FinanceQuery) { return this.repository.commitments(commitmentFilters(query)); }
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
