import { SqlConnection } from "../database";
import { Conditions } from "../repositories/sql";
import {
  CommitmentDetail,
  CommitmentFilters,
  CommitmentSummary,
  FinanceUnit,
  Page,
  Pagination,
  UnitFilters,
} from "./types";

const fullPortalCode = `r.source = 'TRANSPARENCY_PORTAL' AND r.document_code ~ '^[0-9]{15}[A-Z]{2}[0-9]+$'`;
const scopedReferences = `SELECT r.id, r.source, r.document_code,
  c.id IS NOT NULL AS header_available, c.resumed_code, c.emission_date,
  COALESCE(c.management_code, CASE WHEN ${fullPortalCode} THEN substring(r.document_code FROM 7 FOR 5) END) AS management_code,
  COALESCE(c.management_unit_code, CASE WHEN ${fullPortalCode} THEN substring(r.document_code FROM 1 FOR 6) END) AS management_unit_code,
  COALESCE(c.fiscal_year, CASE WHEN ${fullPortalCode} THEN substring(r.document_code FROM 12 FOR 4)::int END) AS fiscal_year,
  c.favored_code, c.favored_name, c.process_number, c.expense_nature_code,
  c.type, c.document_type_code, c.document_type, c.budget_plan_code, c.budget_plan_name,
  c.observation, c.original_value, c.value_brl, c.conversion_rate, c.ingestion_run_id, c.updated_at
  FROM finance.commitment_references r LEFT JOIN finance.commitments c ON c.id = r.id`;

// Each child dataset is aggregated independently, preventing a many-to-many join
// from multiplying current items, liquidations, payments or history operations.
const summaryJoins = `
  LEFT JOIN finance.management_units u ON (u.management_code, u.code) = (b.management_code, b.management_unit_code)
  CROSS JOIN LATERAL (SELECT count(*)::int AS count,
    CASE WHEN count(*) > 0 AND count(*) FILTER (WHERE current_value IS NULL) = 0 THEN sum(current_value)::text END AS committed
    FROM finance.commitment_items WHERE commitment_id = b.id) items
  CROSS JOIN LATERAL (SELECT count(*)::int AS count FROM finance.commitment_item_history WHERE commitment_id = b.id) history
  CROSS JOIN LATERAL (SELECT count(DISTINCT liquidation_id)::int AS count,
    CASE WHEN count(*) FILTER (WHERE liquidated_value_brl IS NULL) = 0 THEN COALESCE(sum(liquidated_value_brl), 0)::text END AS liquidated,
    CASE WHEN count(*) FILTER (WHERE outstanding_value_liquidated_brl IS NULL) = 0 THEN COALESCE(sum(outstanding_value_liquidated_brl), 0)::text END AS prior_year_liquidated
    FROM finance.liquidation_commitments WHERE commitment_id = b.id) liquidations
  CROSS JOIN LATERAL (SELECT count(DISTINCT payment_id)::int AS count,
    CASE WHEN count(*) FILTER (WHERE paid_value_brl IS NULL) = 0 THEN COALESCE(sum(paid_value_brl), 0)::text END AS paid,
    CASE WHEN count(*) FILTER (WHERE outstanding_value_paid_brl IS NULL) = 0 THEN COALESCE(sum(outstanding_value_paid_brl), 0)::text END AS prior_year_paid
    FROM finance.payment_commitments WHERE commitment_id = b.id) payments`;

const summaryProjection = `b.id::text AS id, b.source, b.document_code AS "documentCode",
  b.resumed_code AS "resumedCode", b.header_available AS "headerAvailable",
  b.fiscal_year AS "fiscalYear", b.management_code AS "managementCode", b.management_unit_code AS "managementUnitCode",
  u.name AS "unitName", b.emission_date::text AS "emissionDate", b.favored_code AS "favoredCode",
  b.favored_name AS "favoredName", b.process_number AS "processNumber", b.expense_nature_code AS "expenseNature",
  items.count AS "itemCount", history.count AS "historyCount", liquidations.count AS "liquidationCount", payments.count AS "paymentCount",
  items.committed AS "committedValue", liquidations.liquidated AS "liquidatedValue",
  liquidations.prior_year_liquidated AS "liquidationPriorYearMovementValue", payments.paid AS "paidValue", payments.prior_year_paid AS "priorYearPaidValue"`;

const commitmentOrder = `"fiscalYear" DESC NULLS LAST, "emissionDate" DESC NULLS LAST, "_sortId" DESC`;

function pageResult<T>(
  row: { total: string; data: T[] },
  pagination: Pagination,
): Page<T> {
  const total = Number(row.total);
  if (!Number.isSafeInteger(total))
    throw new Error("Financial result count exceeds the supported range");
  return {
    data: row.data,
    total,
    page: pagination.page,
    limit: pagination.limit,
  };
}

export class FinanceRepository {
  constructor(private readonly db: SqlConnection) {}

  async units(filters: UnitFilters): Promise<Page<FinanceUnit>> {
    const where = new Conditions();
    if (filters.allowedUnitCodes)
      where.add(`u.code=ANY(${where.param(filters.allowedUnitCodes)}::text[])`);
    if (filters.managementCode)
      where.add(`u.management_code = ${where.param(filters.managementCode)}`);
    where.search(filters.search, ["u.code", "u.name", "u.management_name"]);
    return this.collectionPage<FinanceUnit>(
      `SELECT u.management_code AS "managementCode", u.code, u.name,
      u.management_name AS "managementName" FROM finance.management_units u WHERE ${where.text}`,
      where,
      `"managementCode" ASC, code ASC`,
      filters,
      false,
    );
  }

  async commitments(
    filters: CommitmentFilters,
  ): Promise<Page<CommitmentSummary>> {
    const where = new Conditions();
    if (filters.allowedUnitCodes)
      where.add(
        `b.management_unit_code=ANY(${where.param(filters.allowedUnitCodes)}::text[])`,
      );
    where.add(`b.management_code = ${where.param(filters.managementCode)}`);
    if (filters.managementUnitCode)
      where.add(
        `b.management_unit_code = ${where.param(filters.managementUnitCode)}`,
      );
    if (filters.fiscalYear)
      where.add(`b.fiscal_year = ${where.param(filters.fiscalYear)}`);
    if (filters.favoredCode)
      where.add(`b.favored_code = ${where.param(filters.favoredCode)}`);
    if (filters.from)
      where.add(`b.emission_date >= ${where.param(filters.from)}::date`);
    if (filters.to)
      where.add(`b.emission_date <= ${where.param(filters.to)}::date`);
    where.search(filters.search, [
      "b.document_code",
      "b.resumed_code",
      "b.favored_name",
      "b.process_number",
    ]);
    if (filters.expenseNature) {
      const pattern = where.param(
        filters.expenseNature + (filters.expenseNature.length === 6 ? "%" : ""),
      );
      where.add(`(b.expense_nature_code LIKE ${pattern}
        OR EXISTS (SELECT 1 FROM finance.commitment_items i WHERE i.commitment_id = b.id AND i.expense_nature_code LIKE ${pattern})
        OR EXISTS (SELECT 1 FROM finance.liquidation_commitments l WHERE l.commitment_id = b.id AND l.expense_nature_code LIKE ${pattern})
        OR EXISTS (SELECT 1 FROM finance.payment_commitments p WHERE p.commitment_id = b.id AND p.expense_nature_code LIKE ${pattern}))`);
    }
    const limit = where.param(filters.limit),
      offset = where.param(filters.offset);
    const [row] = await this.db.query<{
      total: string;
      data: CommitmentSummary[];
    }>(
      `
      WITH scoped AS (${scopedReferences}), filtered AS (SELECT * FROM scoped b WHERE ${where.text}),
      selected AS (SELECT * FROM filtered ORDER BY fiscal_year DESC NULLS LAST, emission_date DESC NULLS LAST, id DESC LIMIT ${limit} OFFSET ${offset}),
      projected AS (SELECT ${summaryProjection}, b.id AS "_sortId" FROM selected b ${summaryJoins})
      SELECT (SELECT count(*)::text FROM filtered) AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(projected) - '_sortId' ORDER BY ${commitmentOrder}) FROM projected), '[]'::jsonb) AS data`,
      where.values,
    );
    return pageResult(row, filters);
  }

  async commitment(id: string): Promise<CommitmentDetail | null> {
    const [row] = await this.db.query<CommitmentDetail>(
      `WITH scoped AS (${scopedReferences})
      SELECT ${summaryProjection}, CASE WHEN b.header_available THEN jsonb_build_object(
        'type', b.type, 'documentTypeCode', b.document_type_code, 'documentType', b.document_type,
        'budgetPlanCode', b.budget_plan_code, 'budgetPlanName', b.budget_plan_name, 'observation', b.observation,
        'originalValue', b.original_value::text, 'valueBrl', b.value_brl::text, 'conversionRate', b.conversion_rate::text,
        'ingestionRunId', b.ingestion_run_id::text, 'updatedAt', b.updated_at) END AS header
      FROM scoped b ${summaryJoins} WHERE b.id = $1::bigint`,
      [id],
    );
    return row ?? null;
  }

  async exists(id: string) {
    const [row] = await this.db.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM finance.commitment_references WHERE id = $1::bigint) AS exists",
      [id],
    );
    return row.exists;
  }

  private async collectionPage<T>(
    selection: string,
    where: Conditions,
    order: string,
    pagination: Pagination,
    stripSortId = true,
  ): Promise<Page<T>> {
    const limit = where.param(pagination.limit),
      offset = where.param(pagination.offset);
    const [row] = await this.db.query<{ total: string; data: T[] }>(
      `WITH filtered AS (${selection}),
      selected AS (SELECT * FROM filtered ORDER BY ${order} LIMIT ${limit} OFFSET ${offset})
      SELECT (SELECT count(*)::text FROM filtered) AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(selected)${stripSortId ? " - '_sortId'" : ""} ORDER BY ${order}) FROM selected), '[]'::jsonb) AS data`,
      where.values,
    );
    return pageResult(row, pagination);
  }

  async items(id: string, pagination: Pagination) {
    const where = new Conditions();
    where.add(`i.commitment_id = ${where.param(id)}::bigint`);
    return this.collectionPage(
      `SELECT i.id::text AS id, i.sequential, i.expense_nature_code AS "expenseNature",
      i.subitem_code AS "subitemCode", i.subitem_description AS "subitemDescription", i.description,
      i.quantity::text AS quantity, i.unit_price::text AS "unitPrice", i.current_value::text AS "currentValue",
      i.current_price::text AS "currentPrice", i.total_value::text AS "totalValue", i.ingestion_run_id::text AS "ingestionRunId", i.updated_at AS "updatedAt", i.id AS "_sortId"
      FROM finance.commitment_items i WHERE ${where.text}`,
      where,
      `sequential ASC, "_sortId" ASC`,
      pagination,
    );
  }

  async history(
    id: string,
    pagination: Pagination & { itemSequential?: number },
  ) {
    const where = new Conditions();
    where.add(`h.commitment_id = ${where.param(id)}::bigint`);
    if (pagination.itemSequential !== undefined)
      where.add(
        `h.item_sequential = ${where.param(pagination.itemSequential)}`,
      );
    return this.collectionPage(
      `SELECT h.id::text AS id, h.item_sequential AS "itemSequential", h.source_key AS "sourceKey",
      h.operation_type AS "operationType", h.operation_date::text AS "operationDate", h.quantity::text AS quantity,
      h.unit_price::text AS "unitPrice", h.total_value::text AS "totalValue", h.ingestion_run_id::text AS "ingestionRunId",
      h.updated_at AS "updatedAt", h.id AS "_sortId" FROM finance.commitment_item_history h WHERE ${where.text}`,
      where,
      `"operationDate" ASC, "itemSequential" ASC, "_sortId" ASC`,
      pagination,
    );
  }

  async liquidations(id: string, pagination: Pagination) {
    const where = new Conditions();
    where.add(`a.commitment_id = ${where.param(id)}::bigint`);
    return this.collectionPage(
      `SELECT a.id::text AS "allocationId", l.id::text AS "documentId", l.source,
      l.document_code AS "documentCode", l.resumed_code AS "resumedCode", l.fiscal_year AS "fiscalYear", l.emission_date::text AS "emissionDate",
      l.management_code AS "managementCode", l.management_unit_code AS "managementUnitCode", l.favored_code AS "favoredCode", l.favored_name AS "favoredName",
      a.expense_nature_code AS "expenseNature", a.subitem_code AS "subitemCode", a.subitem_description AS "subitemDescription",
      a.liquidated_value_brl::text AS "liquidatedValue", a.outstanding_value_liquidated_brl::text AS "priorYearMovementValue",
      a.registered_payables_value_brl::text AS "registeredPayablesValue", a.canceled_payables_value_brl::text AS "canceledPayablesValue",
      a.ingestion_run_id::text AS "ingestionRunId", a.updated_at AS "updatedAt", a.id AS "_sortId"
      FROM finance.liquidation_commitments a JOIN finance.liquidations l ON l.id = a.liquidation_id WHERE ${where.text}`,
      where,
      `"emissionDate" DESC, "_sortId" DESC`,
      pagination,
    );
  }

  async payments(id: string, pagination: Pagination) {
    const where = new Conditions();
    where.add(`a.commitment_id = ${where.param(id)}::bigint`);
    return this.collectionPage(
      `SELECT a.id::text AS "allocationId", p.id::text AS "documentId", p.source,
      p.document_code AS "documentCode", p.resumed_code AS "resumedCode", p.fiscal_year AS "fiscalYear", p.emission_date::text AS "emissionDate",
      p.management_code AS "managementCode", p.management_unit_code AS "managementUnitCode", p.favored_code AS "favoredCode", p.favored_name AS "favoredName",
      p.process_number AS "processNumber", p.extra_budgetary AS "extraBudgetary",
      a.expense_nature_code AS "expenseNature", a.subitem_code AS "subitemCode", a.subitem_description AS "subitemDescription",
      a.paid_value_brl::text AS "paidValue", a.outstanding_value_paid_brl::text AS "priorYearPaidValue",
      a.registered_payables_value_brl::text AS "registeredPayablesValue", a.canceled_payables_value_brl::text AS "canceledPayablesValue",
      a.ingestion_run_id::text AS "ingestionRunId", a.updated_at AS "updatedAt", a.id AS "_sortId"
      FROM finance.payment_commitments a JOIN finance.payments p ON p.id = a.payment_id WHERE ${where.text}`,
      where,
      `"emissionDate" DESC, "_sortId" DESC`,
      pagination,
    );
  }
}
