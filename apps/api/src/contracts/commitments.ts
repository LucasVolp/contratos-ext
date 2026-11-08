import { inScope, Scope } from "../auth/access";
import { FinanceService } from "../finance/service";
import { Amounts, CampusTotalsRow, CommitmentLinkRow, ContractCommitmentRepository } from "./commitments-repository";

export interface CommitmentContract {
  externalId: string | null; // null when the viewer cannot open the contract
  number: string;
  supplierName: string | null;
  supplierDocument: string | null;
  uasg: string;
  unitName: string | null;
}
import { ContractService, maskSupplierDocument } from "./service";

export interface ContractCommitments {
  commitments: (CommitmentLinkRow & { linkable: boolean })[];
  campuses: CampusTotalsRow[];
  totals: Amounts & { count: number };
  balance: { globalValue: string | null; remaining: string | null };
}

// Commitments of a contract as Contratos.gov.br lists them, matched to the
// imported finance data. Whoever sees the contract sees all its commitments;
// a commitment links to its finance detail only inside the viewer's scope.
export class ContractCommitmentService {
  constructor(
    private readonly contracts: ContractService,
    private readonly repository: ContractCommitmentRepository,
    private readonly finance: FinanceService,
  ) {}

  async forContract(externalId: string, scope: Scope): Promise<ContractCommitments> {
    const contract = await this.contracts.find(externalId, scope);
    const [links, campuses, { remaining, ...totals }] = await Promise.all([
      this.repository.links(externalId),
      this.repository.campuses(externalId),
      this.repository.totals(externalId),
    ]);
    return {
      commitments: links.map((link) => ({
        ...link,
        linkable: link.financeCommitmentId !== null && inScope(scope, link.unitCode),
      })),
      campuses,
      totals,
      balance: { globalValue: contract.globalValue, remaining },
    };
  }

  // Contracts that list a finance commitment the viewer can see. Contracts the
  // viewer cannot open are still named (public Contratos.gov.br facts), unlinked.
  async forCommitment(commitmentId: string, scope: Scope): Promise<{ contracts: CommitmentContract[] }> {
    const commitment = await this.finance.commitment(commitmentId, {}, scope);
    const rows = await this.repository.contractsOf(commitment.id);
    return {
      contracts: rows.map(({ registered, ...row }) => ({
        ...row,
        externalId: registered && inScope(scope, row.uasg) ? row.externalId : null,
        supplierDocument: maskSupplierDocument(row.supplierDocument),
      })),
    };
  }
}
