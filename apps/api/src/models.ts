// Database rows. NUMERIC stays a string to preserve decimal precision.
export interface PriceRecord {
  id: string;
  number: string;
  processNumber: string;
  purchaseNumber: string;
  purchaseYear: number | null;
  modality: string;
  object: string;
  startDate: string | null;
  endDate: string | null;
  renewable: boolean;
  uasg: string;
  organizationName: string;
  organizationDocument: string;
  organizationStreet: string;
  organizationNumber: string;
  organizationCity: string;
  organizationState: string;
  authorityName: string;
  authorityRole: string;
  authorityRegistration: string;
  ordinanceNumber: string;
  ordinanceDate: string | null;
  ordinancePublicationDate: string | null;
  supplierName: string;
  supplierDocument: string;
  supplierRepresentative: string;
  createdAt: Date;
  updatedAt: Date;
  sourcePublicRecordId: string | null;
  sourceSupplierDocument: string | null;
}
export interface RecordItem {
  id: string;
  recordId: string;
  number: number;
  description: string;
  brand: string;
  model: string;
  unit: string;
  quantity: string;
  minimumQuantity: string;
  unitPrice: string;
  warranty: string;
}
export interface DocumentExport {
  id: string;
  recordId: string;
  format: string;
  templateVersion: string;
  itemNumber: number | null;
  snapshot: unknown;
  createdAt: Date;
}
export interface PublicPurchase {
  id: string;
  externalId: string;
  pncpId: string | null;
  number: string;
  year: number | null;
  uasg: string;
  unitName: string;
  object: string;
  status: string;
  srp: boolean | null;
  processNumber: string;
  organizationName: string;
  organizationDocument: string;
  city: string;
  state: string;
  estimatedValue: string | null;
  awardedValue: string | null;
  publishedAt: string | null;
  openingAt: string | null;
  closingAt: string | null;
  summary: unknown;
  snapshot: unknown;
  lastSyncedAt: Date;
  detailsSyncedAt: Date | null;
  recordsSyncedAt: Date | null;
}
export interface PublicRecord {
  id: string;
  externalId: string;
  number: string;
  uasg: string;
  unitName: string;
  organizationName: string;
  purchaseExternalId: string | null;
  purchasePncpId: string | null;
  purchaseNumber: string;
  purchaseYear: number | null;
  object: string;
  startDate: string | null;
  endDate: string | null;
  totalValue: string | null;
  itemsCount: number | null;
  situation: string;
  summary: unknown;
  snapshot: unknown;
  lastSyncedAt: Date;
  detailsSyncedAt: Date | null;
}
export interface CatalogSupplement {
  id: string;
  publicRecordId: string;
  itemNumber: string;
  kind: string;
  status: string;
  data: unknown;
  lastSyncedAt: Date | null;
  error: string | null;
}
