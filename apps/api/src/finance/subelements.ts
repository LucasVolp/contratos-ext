import type { SqlConnection } from "../database";
import { Conditions } from "../repositories/sql";
import type { SubelementFilters, SubelementReport } from "./types";

const stages = ["committedValue", "liquidatedValue", "paidValue"] as const;
function sums() {
  return stages
    .map(
      (stage) => `CASE WHEN count(*) FILTER (WHERE stage = '${stage}') > 0
    AND count(*) FILTER (WHERE stage = '${stage}' AND amount IS NULL) = 0
    THEN (sum(amount) FILTER (WHERE stage = '${stage}'))::text END AS "${stage}"`,
    )
    .join(",");
}
// Current items and each movement allocation contribute once, without cross-source joins.
const sourceRows = `
  SELECT r.source, c.management_code, c.management_unit_code, c.fiscal_year, c.emission_date,
    i.expense_nature_code AS nature, i.subitem_code AS subitem, i.subitem_description AS name,
    'committedValue'::text AS stage, i.current_value AS amount, i.updated_at, 'commitment:' || c.id AS document
  FROM finance.commitment_items i JOIN finance.commitments c ON c.id = i.commitment_id
    JOIN finance.commitment_references r ON r.id = c.id
  UNION ALL
  SELECT l.source, l.management_code, l.management_unit_code, l.fiscal_year, l.emission_date,
    a.expense_nature_code, a.subitem_code, a.subitem_description, 'liquidatedValue', a.liquidated_value_brl, a.updated_at, 'liquidation:' || l.id
  FROM finance.liquidation_commitments a JOIN finance.liquidations l ON l.id = a.liquidation_id
  UNION ALL
  SELECT p.source, p.management_code, p.management_unit_code, p.fiscal_year, p.emission_date,
    a.expense_nature_code, a.subitem_code, a.subitem_description, 'paidValue', a.paid_value_brl, a.updated_at, 'payment:' || p.id
  FROM finance.payment_commitments a JOIN finance.payments p ON p.id = a.payment_id
  WHERE p.extra_budgetary IS DISTINCT FROM TRUE`;

export class FinanceSubelementsRepository {
  constructor(private readonly db: SqlConnection) {}
  async report(filters: SubelementFilters): Promise<SubelementReport> {
    const where = new Conditions();
    where.add(`source = 'TRANSPARENCY_PORTAL'`);
    where.add(`management_code = ${where.param(filters.managementCode)}`);
    where.add(`fiscal_year = ${where.param(filters.fiscalYear)}`);
    where.add(`left(nature, 6) = ${where.param(filters.expenseNature)}`);
    const start = `${filters.fiscalYear}-${String(filters.fromMonth).padStart(2, "0")}-01`;
    const end =
      filters.toMonth === 12
        ? `${filters.fiscalYear + 1}-01-01`
        : `${filters.fiscalYear}-${String(filters.toMonth + 1).padStart(2, "0")}-01`;
    where.add(
      `emission_date >= ${where.param(start)}::date AND emission_date < ${where.param(end)}::date`,
    );
    if (filters.managementUnitCode)
      where.add(
        `management_unit_code = ${where.param(filters.managementUnitCode)}`,
      );
    if (filters.allowedUnitCodes)
      where.add(
        `management_unit_code = ANY(${where.param(filters.allowedUnitCodes)}::text[])`,
      );
    // Column selection is a closed server enum, never an interpolated HTTP identifier.
    const metric = {
      committedValue: '"committedValue"',
      liquidatedValue: '"liquidatedValue"',
      paidValue: '"paidValue"',
    }[filters.metric];
    const stage = where.param(filters.metric);
    const limit = where.param(filters.limit),
      offset = where.param(filters.offset);
    const [result] = await this.db.query<{
      total: string;
      data: SubelementReport["data"];
      summary: SubelementReport["summary"];
      chart: SubelementReport["chart"];
      chartEligible: boolean;
    }>(
      `
      WITH raw AS (${sourceRows}), filtered AS (
        SELECT *, CASE
          WHEN nature ~ '^[0-9]{8}$' AND (subitem IS NULL OR subitem = '' OR right(nature,2) = subitem) THEN nature
          WHEN nature ~ '^[0-9]{6}$' AND subitem ~ '^[0-9]{2}$' THEN nature || subitem
        END AS code FROM raw WHERE ${where.text}
      ), grouped AS (
        SELECT code, min(name) AS name, ${sums()}, count(*)::int AS "sourceRowCount"
        FROM filtered GROUP BY code
      ), selected AS (SELECT * FROM grouped ORDER BY ${metric}::numeric DESC NULLS LAST, code ASC NULLS LAST LIMIT ${limit} OFFSET ${offset}),
      top AS (SELECT * FROM grouped WHERE code IS NOT NULL AND ${metric} IS NOT NULL ORDER BY ${metric}::numeric DESC, code ASC LIMIT 5),
      other AS (SELECT NULL::text AS code, 'Demais registros'::text AS name,
        CASE WHEN count(*) FILTER (WHERE amount IS NULL) = 0 THEN sum(amount)::text END AS value, true AS other
        FROM filtered WHERE stage = ${stage} AND (code IS NULL OR code NOT IN (SELECT code FROM top)) HAVING count(*) > 0),
      chart AS (SELECT code, name, ${metric} AS value, false AS other FROM top UNION ALL SELECT * FROM other),
      summary AS (SELECT ${sums()}, count(*)::int AS "sourceRowCount", count(DISTINCT document)::int AS "documentCount",
        count(DISTINCT emission_date)::int AS "observedDayCount", min(emission_date)::text AS "firstDocumentDate",
        max(emission_date)::text AS "lastDocumentDate", max(updated_at) AS "lastImportedAt", 'NOT_VERIFIED'::text AS coverage FROM filtered)
      SELECT (SELECT COALESCE(bool_and(${metric} IS NOT NULL AND ${metric}::numeric >= 0), false) FROM grouped) AS "chartEligible",
        (SELECT count(*)::text FROM grouped) AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(selected) ORDER BY ${metric}::numeric DESC NULLS LAST, code ASC NULLS LAST) FROM selected),'[]'::jsonb) AS data,
        (SELECT to_jsonb(summary) FROM summary) AS summary,
        COALESCE((SELECT jsonb_agg(to_jsonb(chart) ORDER BY other ASC, value::numeric DESC NULLS LAST, code ASC) FROM chart),'[]'::jsonb) AS chart`,
      where.values,
    );
    const total = Number(result.total);
    if (!Number.isSafeInteger(total))
      throw new Error(
        "Subelement classification count exceeds the supported range",
      );
    return { ...result, total, page: filters.page, limit: filters.limit };
  }
}
