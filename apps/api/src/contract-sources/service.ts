import { Scope } from "../auth/access";
import { BadRequestException, NotFoundException } from "../errors";
import { known, pagination } from "../finance/validation";
import { Repositories } from "../repositories";
import { SOURCE_PARTS, SourceContract, SourcePart, SourcePartState } from "../repositories/contract-sources";
import { ApplicationService } from "../service";

type Data = Record<string, unknown>;

export interface SourceSummary {
  resolution: "RESOLVED" | "NOT_FOUND" | "AMBIGUOUS";
  candidateCount: number;
  source: SourceContract | null;
  parts: SourcePartState[];
}

// Reads the Contratos.gov.br replica for an app contract. The match is computed
// on every read (managing UASG plus normalized number); nothing is stored on the
// Contract row and the source is never called.
export class ContractSourceService {
  constructor(
    private readonly repositories: Repositories,
    private readonly contracts: ApplicationService,
  ) {}

  async summary(id: string, scope: Scope): Promise<SourceSummary> {
    const contract = await this.contracts.contract(id, scope);
    const matches = await this.repositories.contractSources.matches(String(contract.number), String(contract.uasg));
    if (matches.length !== 1)
      return { resolution: matches.length ? "AMBIGUOUS" : "NOT_FOUND", candidateCount: matches.length, source: null, parts: [] };
    const parts = await this.repositories.contractSources.parts(matches[0].externalId);
    return { resolution: "RESOLVED", candidateCount: 1, source: matches[0], parts };
  }

  async part(id: string, part: string, query: Data, scope: Scope) {
    if (!SOURCE_PARTS.includes(part as SourcePart)) throw new BadRequestException("Parte inválida.");
    known(query, ["page", "limit"]);
    const page = pagination(query);
    const summary = await this.summary(id, scope);
    if (!summary.source) throw new NotFoundException("Dados do Contratos.gov.br não encontrados para este contrato.");
    return this.repositories.contractSources.page(summary.source.externalId, part as SourcePart, page);
  }
}
