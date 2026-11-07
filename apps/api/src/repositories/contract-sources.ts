import { SqlConnection } from "../database";
import { Page, Pagination } from "../finance/types";

export type SourcePart = "history" | "guarantees" | "responsibles" | "items" | "invoices" | "files";
export const SOURCE_PARTS: readonly SourcePart[] = ["history", "guarantees", "responsibles", "items", "invoices", "files"];

export interface SourceContract {
  externalId: string;
  number: string;
  managingUnitCode: string;
  originUnitCode: string | null;
  typeName: string | null;
  category: string | null;
  processNumber: string | null;
  object: string | null;
  modality: string | null;
  status: string | null;
  supplierName: string | null;
  supplierDocument: string | null;
  signatureDate: string | null;
  startDate: string | null;
  endDate: string | null;
  initialValue: string | null;
  globalValue: string | null;
  accumulatedValue: string | null;
  installmentCount: number | null;
  capturedAt: Date;
  normalizedAt: Date;
}

export interface SourcePartState {
  part: string;
  status: "AVAILABLE" | "NOT_FOUND" | "FAILED" | "MISSING";
  capturedAt: Date | null;
  lastAttemptAt: Date | null;
  rowCount: number;
}

const SOURCE = "CONTRATOS_GOV_BR";

const contractProjection = `external_id::text AS "externalId", number, managing_unit_code AS "managingUnitCode",
  origin_unit_code AS "originUnitCode", type_name AS "typeName", category, process_number AS "processNumber", object, modality,
  status, supplier_name AS "supplierName", supplier_document AS "supplierDocument",
  signature_date::text AS "signatureDate", start_date::text AS "startDate", end_date::text AS "endDate",
  initial_value::text AS "initialValue", global_value::text AS "globalValue", accumulated_value::text AS "accumulatedValue",
  installment_count AS "installmentCount", captured_at AS "capturedAt", normalized_at AS "normalizedAt"`;

// Each part maps to its table, a camelCase projection (decimals and dates as
// text so jsonb never turns them into numbers) and its display order.
const partQueries: Record<SourcePart, { table: string; projection: string; order: string }> = {
  history: {
    table: "contract_amendments",
    projection: `external_id::text AS "externalId", number, type_name AS "typeName", qualifications, observation,
      signature_date::text AS "signatureDate", publication_date::text AS "publicationDate", start_date::text AS "startDate",
      end_date::text AS "endDate", initial_value::text AS "initialValue", global_value::text AS "globalValue",
      new_global_value::text AS "newGlobalValue", contract_status AS "contractStatus"`,
    order: `"signatureDate" NULLS LAST, external_id`,
  },
  guarantees: {
    table: "contract_guarantees",
    projection: `external_id::text AS "externalId", guarantee_type AS "guaranteeType", amount::text AS amount, due_date::text AS "dueDate"`,
    order: "external_id",
  },
  responsibles: {
    table: "contract_responsibles",
    projection: `external_id::text AS "externalId", responsible_name AS name, masked_document AS "maskedDocument", role, ordinance, status,
      start_date::text AS "startDate", end_date::text AS "endDate"`,
    order: "external_id",
  },
  items: {
    table: "contract_items",
    projection: `external_id::text AS "externalId", purchase_item_number AS "purchaseItemNumber", item_type AS "itemType",
      catalog_item AS "catalogItem", description, quantity::text AS quantity, unit_value::text AS "unitValue",
      total_value::text AS "totalValue", start_date::text AS "startDate"`,
    order: "external_id",
  },
  invoices: {
    table: "contract_invoices",
    projection: `external_id::text AS "externalId", number, series, invoice_type AS "invoiceType", billing_instrument AS "billingInstrument",
      issue_date::text AS "issueDate", due_date::text AS "dueDate", amount::text AS amount, net_amount::text AS "netAmount",
      disallowance::text AS disallowance, liquidation_date::text AS "liquidationDate", status,
      reference_month AS "referenceMonth", reference_year AS "referenceYear"`,
    order: `"issueDate" DESC NULLS LAST, external_id`,
  },
  files: {
    table: "contract_files",
    projection: `external_id::text AS "externalId", file_type AS "fileType", description, url, sei_link AS "seiLink", origin`,
    order: "external_id",
  },
};

export class ContractSourceRepository {
  constructor(private readonly db: SqlConnection) {}

  matches(number: string, uasg: string) {
    return this.db.query<SourceContract & Record<string, unknown>>(
      `SELECT ${contractProjection} FROM public_sources.contracts
       WHERE source = $1 AND managing_unit_code = $3 AND number_key = public_sources.contract_number_key($2)
       ORDER BY external_id`,
      [SOURCE, number, uasg],
    );
  }

  parts(externalId: string) {
    return this.db.query<SourcePartState & Record<string, unknown>>(
      `SELECT part, status, captured_at AS "capturedAt", last_attempt_at AS "lastAttemptAt", row_count AS "rowCount"
       FROM public_sources.contract_parts WHERE source = $1 AND contract_external_id = $2::bigint
       ORDER BY array_position(ARRAY['header','history','items','invoices','guarantees','responsibles','files','commitments'], part)`,
      [SOURCE, externalId],
    );
  }

  async page(externalId: string, part: SourcePart, pagination: Pagination): Promise<Page<Record<string, unknown>>> {
    const query = partQueries[part];
    const [row] = await this.db.query<{ total: string; data: Record<string, unknown>[] }>(
      `WITH filtered AS (SELECT external_id, ${query.projection} FROM public_sources.${query.table}
         WHERE source = $1 AND contract_external_id = $2::bigint),
       selected AS (SELECT * FROM filtered ORDER BY ${query.order} LIMIT $3 OFFSET $4)
       SELECT (SELECT count(*)::text FROM filtered) AS total,
         COALESCE((SELECT jsonb_agg(to_jsonb(selected) - 'external_id' ORDER BY ${query.order}) FROM selected), '[]'::jsonb) AS data`,
      [SOURCE, externalId, pagination.limit, pagination.offset],
    );
    return { data: row.data, total: Number(row.total), page: pagination.page, limit: pagination.limit };
  }

  importable(uasg: string) {
    return this.db.query<SourceContract & Record<string, unknown>>(
      `SELECT ${contractProjection} FROM public_sources.contracts WHERE source = $1 AND managing_unit_code = $2 ORDER BY external_id`,
      [SOURCE, uasg],
    );
  }
}
