import { formatDecimal, maskDocument } from "@contracts/validation";
export type PurchaseSummary = {
  id: string;
  externalId: string;
  number: string;
  year: number | null;
  uasg: string;
  unitName: string | null;
  object: string | null;
  status: string | null;
  srp: boolean | null;
  pncpId: string | null;
  processNumber: string | null;
  organizationName: string | null;
  organizationDocument: string | null;
  city: string | null;
  state: string | null;
  estimatedValue: string | null;
  awardedValue: string | null;
  publishedAt: string | null;
  openingAt: string | null;
  closingAt: string | null;
  lastSyncedAt: string | null;
  detailsSyncedAt: string | null;
  recordsSyncedAt: string | null;
};
export type PurchaseResult = {
  externalId: string;
  supplierDocument: string | null;
  supplierName: string | null;
  quantity: string | null;
  unitPrice: string | null;
  totalValue: string | null;
  status: string | null;
  cancelled: boolean;
  cancelledAt: string | null;
  resultDate: string | null;
};
export type PurchaseItem = {
  externalId: string;
  number: string;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  estimatedUnitPrice: string | null;
  estimatedTotal: string | null;
  status: string | null;
  results: PurchaseResult[];
};
export type PurchaseDetail = PurchaseSummary & {
  items: PurchaseItem[];
  linkedRecords: PublicRecordSummary[];
};
export type PublicRecordSummary = {
  id: string;
  externalId: string;
  number: string;
  uasg: string;
  unitName: string | null;
  organizationName: string | null;
  purchaseExternalId: string | null;
  purchasePncpId: string | null;
  purchaseNumber: string | null;
  purchaseYear: number | null;
  object: string | null;
  startDate: string | null;
  endDate: string | null;
  totalValue: string | null;
  itemsCount: number | null;
  situation: string | null;
  lastSyncedAt: string | null;
  detailsSyncedAt: string | null;
  linkedPurchaseId: string | null;
};
export type SupplementPart<T> = {
  status: "loaded" | "error" | "not_loaded";
  data: T[];
  lastSyncedAt: string | null;
  error: string | null;
};
export type UnitRow = {
  code: string | null;
  name: string | null;
  type: string | null;
  supplierDocument: string | null;
  quantity: string | null;
  adhesionBalance: string | null;
  commitmentBalance: string | null;
  excluded: boolean;
};
export type CommitmentRow = {
  unit: string | null;
  type: string | null;
  quantity: string | null;
  committed: string | null;
  balance: string | null;
};
export type AdhesionRow = {
  unit: string | null;
  approvedAt: string | null;
  quantity: string | null;
};
export type ItemSupplement = {
  units: SupplementPart<UnitRow>;
  commitments: SupplementPart<CommitmentRow>;
  adhesions: SupplementPart<AdhesionRow>;
};
export type PublicRecordItem = {
  key: string;
  number: string;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  totalValue: string | null;
  brand: string | null;
  model: string | null;
  supplierDocument: string | null;
  supplierName: string | null;
  supplement?: ItemSupplement;
};
export type PublicRecordDetail = PublicRecordSummary & {
  items: PublicRecordItem[];
  suppliers: { document: string; name: string | null }[];
  processNumber: string | null;
  organizationDocument: string | null;
  city: string | null;
  state: string | null;
};
export type CatalogPage<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  stats: {
    count: number;
    srpCount?: number;
    estimatedValue?: string | null;
    awardedValue?: string | null;
    totalValue?: string | null;
  };
};
export const known = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? "Não informado"
    : String(value);
export const quantity = (value: string | null | undefined) =>
  value === null || value === undefined
    ? "Não informado"
    : formatDecimal(value);
export const document = (value: string | null | undefined) =>
  value ? maskDocument(value) : "Não informado";
export const stamp = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("pt-BR") : "Não consultado";
export const purchaseNumber = (number: string | null, year: number | null) =>
  number
    ? `${number}${year && !/\/\s*\d{4}$/.test(number) ? `/${year}` : ""}`
    : "Não informado";
