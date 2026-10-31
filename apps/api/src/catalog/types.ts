export type Raw = Record<string, any>;
export type DecimalValue = string | null;
export interface PurchaseResult {
  externalId: string;
  supplierDocument: string;
  supplierName: string;
  quantity: DecimalValue;
  unitPrice: DecimalValue;
  totalValue: DecimalValue;
  status: string;
  cancelled: boolean;
  cancelledAt: string | null;
  resultDate: string | null;
}
export interface PurchaseItem {
  externalId: string;
  number: string;
  description: string;
  unit: string;
  quantity: DecimalValue;
  estimatedUnitPrice: DecimalValue;
  estimatedTotal: DecimalValue;
  status: string;
  results: PurchaseResult[];
}
export interface PublicRecordItem {
  key: string;
  number: string;
  description: string;
  unit: string;
  quantity: DecimalValue;
  unitPrice: DecimalValue;
  totalValue: DecimalValue;
  brand: string;
  model: string;
  supplierDocument: string;
  supplierName: string;
  supplement?: ItemSupplement;
}
export interface UnitRow {
  code: string;
  name: string;
  type: string;
  supplierDocument: string;
  quantity: DecimalValue;
  adhesionBalance: DecimalValue;
  commitmentBalance: DecimalValue;
  excluded: boolean;
}
export interface CommitmentRow {
  unit: string;
  type: string;
  quantity: DecimalValue;
  committed: DecimalValue;
  balance: DecimalValue;
}
export interface AdhesionRow {
  unit: string;
  approvedAt: string | null;
  quantity: DecimalValue;
}
export interface SupplementPart<T> {
  status: "loaded" | "error" | "not_loaded";
  data: T[];
  lastSyncedAt: string | null;
  error: string | null;
}
export interface ItemSupplement {
  units: SupplementPart<UnitRow>;
  commitments: SupplementPart<CommitmentRow>;
  adhesions: SupplementPart<AdhesionRow>;
}
export type SupplementKind = keyof ItemSupplement;
export interface PurchaseSnapshot {
  items: PurchaseItem[];
  rawItems: Raw[];
  rawResults: Raw[];
}
export interface PurchaseResultState {
  itemNumber: string;
  supplierDocument: string;
  cancelled: boolean;
}
export interface RecordSnapshot {
  purchaseResultStates?: PurchaseResultState[];
  purchaseResultsSyncedAt?: string | null;
  items: PublicRecordItem[];
  rawItems: Raw[];
  processNumber: string;
  organizationDocument: string;
  city: string;
  state: string;
  modality: string | null;
  purchaseSrp: boolean | null;
}
