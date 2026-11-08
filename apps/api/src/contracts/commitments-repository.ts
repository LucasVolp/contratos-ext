import { SqlConnection } from "../database";
import { CONTRACT_SOURCE } from "./repository";

export type FinanceStatus = "CONFIRMED" | "NOT_FOUND" | "PENDING" | "OUT_OF_SCOPE";

// Amounts reported by Contratos.gov.br per commitment, as decimal text.
export interface Amounts {
  committed: string | null;
  liquidated: string | null;
  paid: string | null;
  rpRegistered: string | null;
  rpToLiquidate: string | null;
  rpLiquidated: string | null;
  rpPaid: string | null;
}

export interface CommitmentLinkRow extends Amounts {
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
}

export interface CommitmentContractRow {
  externalId: string;
  number: string;
  supplierName: string | null;
  supplierDocument: string | null;
  uasg: string;
  unitName: string | null;
  registered: boolean;
}

export interface CampusTotalsRow extends Amounts {
  unitCode: string;
  unitName: string;
  count: number;
}

const AMOUNT_COLUMNS: [keyof Amounts, string][] = [
  ["committed", "committed"],
  ["liquidated", "liquidated"],
  ["paid", "paid"],
  ["rpRegistered", "rp_registered"],
  ["rpToLiquidate", "rp_to_liquidate"],
  ["rpLiquidated", "rp_liquidated"],
  ["rpPaid", "rp_paid"],
];

const amounts = AMOUNT_COLUMNS.map(([key, column]) => `l.${column}::text AS "${key}"`).join(", ");

// A sum is unknown when any amount it adds is unknown, as in the finance API.
const sums = AMOUNT_COLUMNS.map(
  ([key, column]) => `CASE WHEN count(*) = count(l.${column}) THEN sum(l.${column})::text END AS "${key}"`,
).join(", ");

// The successful daily finance imports that cover a commitment's unit, through
// its management (MANAGEMENT scope) or its unit code (MANAGEMENT_UNIT scope).
const coverageRuns = `finance.ingestion_runs r ON r.type = 'DAILY_EXPENSES' AND r.status = 'SUCCESS'
  AND ((r.scope_type = 'MANAGEMENT' AND cc.management_code = ANY(r.scope_codes))
    OR (r.scope_type = 'MANAGEMENT_UNIT' AND cc.unit_code = ANY(r.scope_codes)))`;

// Commitments Contratos.gov.br lists for contract $2, each with its finance
// status: CONFIRMED when the Portal da Transparência reference exists (with or
// without an imported header); otherwise OUT_OF_SCOPE when no import covers its
// unit or it predates the first covered day, NOT_FOUND when its issue day was
// imported (or its date is unknown), else PENDING until the next import.
const linked = `coverage AS (
    SELECT cc.external_id, min(r.period_start) AS first_day, max(r.period_end) AS last_day,
      bool_or(cc.issue_date BETWEEN r.period_start AND r.period_end) AS day_imported
    FROM public_sources.contract_commitments cc JOIN ${coverageRuns}
    WHERE cc.source = $1 AND cc.contract_external_id = $2::bigint
    GROUP BY cc.external_id),
  linked AS (
    SELECT cc.*, ref.id AS reference_id, mu.name AS unit_name, cov.last_day,
      CASE WHEN fc.id IS NOT NULL THEN items.committed END AS finance_committed,
      CASE WHEN ref.id IS NOT NULL THEN 'CONFIRMED'
        WHEN cov.external_id IS NULL OR cc.issue_date < cov.first_day THEN 'OUT_OF_SCOPE'
        WHEN cc.issue_date IS NULL OR cov.day_imported THEN 'NOT_FOUND'
        ELSE 'PENDING' END AS finance_status
    FROM public_sources.contract_commitments cc
    LEFT JOIN finance.commitment_references ref ON ref.source = 'TRANSPARENCY_PORTAL' AND ref.document_code = cc.transparency_code
    LEFT JOIN finance.commitments fc ON fc.id = ref.id
    -- Same rule as the finance detail's committedValue: unknown without items or with any unknown item.
    LEFT JOIN LATERAL (SELECT CASE WHEN count(*) > 0 AND count(*) = count(i.current_value) THEN sum(i.current_value) END AS committed
      FROM finance.commitment_items i WHERE i.commitment_id = fc.id) items ON true
    LEFT JOIN finance.management_units mu ON mu.management_code = cc.management_code AND mu.code = cc.unit_code
    LEFT JOIN coverage cov ON cov.external_id = cc.external_id
    WHERE cc.source = $1 AND cc.contract_external_id = $2::bigint)`;

// Read-only links between replicated contracts and imported finance
// commitments, derived at read time so they follow both sides' updates.
export class ContractCommitmentRepository {
  constructor(private readonly db: SqlConnection) {}

  links(externalId: string) {
    return this.db.query<CommitmentLinkRow & Record<string, unknown>>(
      `WITH ${linked}
       SELECT l.transparency_code AS "transparencyCode", l.number, l.unit_code AS "unitCode", l.unit_name AS "unitName",
         l.issue_date::text AS "issueDate", l.creditor, l.expense_nature AS "expenseNature", ${amounts},
         l.finance_status AS "financeStatus", l.reference_id::text AS "financeCommitmentId",
         l.finance_committed::text AS "financeCommitted",
         CASE WHEN l.finance_status = 'PENDING' THEN l.last_day::text END AS "lastImportedOn"
       FROM linked l ORDER BY l.unit_code, l.issue_date DESC NULLS LAST, l.number`,
      [CONTRACT_SOURCE, externalId],
    );
  }

  campuses(externalId: string) {
    return this.db.query<CampusTotalsRow & Record<string, unknown>>(
      `WITH ${linked}
       SELECT l.unit_code AS "unitCode", COALESCE(max(l.unit_name), l.unit_code) AS "unitName", count(*)::int AS count, ${sums}
       FROM linked l GROUP BY l.unit_code ORDER BY "unitName", l.unit_code`,
      [CONTRACT_SOURCE, externalId],
    );
  }

  // Contracts whose Contratos.gov.br commitments include finance reference $2.
  contractsOf(commitmentId: string) {
    return this.db.query<CommitmentContractRow & Record<string, unknown>>(
      `SELECT DISTINCT c.external_id::text AS "externalId", c.number, c.supplier_name AS "supplierName",
         c.supplier_document AS "supplierDocument", c.managing_unit_code AS uasg, COALESCE(i.name, mu.name) AS "unitName",
         i.uasg IS NOT NULL AS registered
       FROM finance.commitment_references ref
       JOIN public_sources.contract_commitments cc ON cc.source = $1 AND cc.transparency_code = ref.document_code
       JOIN public_sources.contracts c ON c.source = cc.source AND c.external_id = cc.contract_external_id
       LEFT JOIN "Institution" i ON i.uasg = c.managing_unit_code
       LEFT JOIN LATERAL (SELECT u.name FROM finance.management_units u WHERE u.code = c.managing_unit_code
         ORDER BY u.management_code LIMIT 1) mu ON true
       WHERE ref.id = $2::bigint
       ORDER BY c.number, "externalId"`,
      [CONTRACT_SOURCE, commitmentId],
    );
  }

  async totals(externalId: string) {
    const [row] = await this.db.query<Amounts & { count: number; remaining: string | null }>(
      `WITH ${linked}, totals AS (SELECT count(*)::int AS count, ${sums} FROM linked l)
       SELECT t.*, (c.global_value - t.committed::numeric)::text AS remaining
       FROM totals t JOIN public_sources.contracts c ON c.source = $1 AND c.external_id = $2::bigint`,
      [CONTRACT_SOURCE, externalId],
    );
    return row;
  }
}
