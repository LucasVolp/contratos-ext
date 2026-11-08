import { api, currency, date } from "@/lib/api";

export type FinanceStatus = "CONFIRMED" | "NOT_FOUND" | "PENDING" | "OUT_OF_SCOPE";

/** Amounts reported by Contratos.gov.br, as decimal strings; null is unknown. */
export type Amounts = {
  committed: string | null;
  liquidated: string | null;
  paid: string | null;
  rpRegistered: string | null;
  rpToLiquidate: string | null;
  rpLiquidated: string | null;
  rpPaid: string | null;
};

export type CommitmentLink = Amounts & {
  transparencyCode: string;
  number: string;
  unitCode: string;
  unitName: string | null;
  issueDate: string | null;
  creditor: string | null;
  expenseNature: string | null;
  financeStatus: FinanceStatus;
  financeCommitmentId: string | null;
  financeCommitted: string | null;
  lastImportedOn: string | null;
  linkable: boolean;
};

export type CampusTotals = Amounts & { unitCode: string; unitName: string; count: number };

export type ContractCommitments = {
  commitments: CommitmentLink[];
  campuses: CampusTotals[];
  totals: Amounts & { count: number };
  balance: { globalValue: string | null; remaining: string | null };
};

/** A contract that lists a finance commitment; no externalId when the viewer cannot open it. */
export type CommitmentContract = {
  externalId: string | null;
  number: string;
  supplierName: string | null;
  supplierDocument: string | null;
  uasg: string;
  unitName: string | null;
};

export const getContractCommitments = (externalId: string, signal?: AbortSignal) =>
  api<ContractCommitments>(`/contracts/${externalId}/commitments`, { signal });

export const getCommitmentContracts = (commitmentId: string, signal?: AbortSignal) =>
  api<{ contracts: CommitmentContract[] }>(`/contracts/by-commitment/${encodeURIComponent(commitmentId)}`, { signal });

/** Plain-language finance situation of a commitment listed by Contratos.gov.br. */
export function financeStatusLabel(link: Pick<CommitmentLink, "financeStatus" | "lastImportedOn">): string {
  switch (link.financeStatus) {
    case "CONFIRMED":
      return "Na execução financeira";
    case "NOT_FOUND":
      return "Não encontrado nos dados importados";
    case "PENDING":
      return `Aguardando importação — última importação em ${date(link.lastImportedOn)}`;
    default:
      return "Fora do escopo da importação financeira";
  }
}

/** Committed amount, with the finance figure beside it when the two sources disagree. */
export function committedWithFinance(link: Pick<CommitmentLink, "committed" | "financeCommitted">): string {
  const reported = currency(link.committed);
  return link.financeCommitted !== null && link.financeCommitted !== link.committed
    ? `${reported} · Execução financeira: ${currency(link.financeCommitted)}`
    : reported;
}
