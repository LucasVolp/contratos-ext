import { Scope } from "../auth/access";
import { SqlConnection } from "../database";
import { Page, Pagination } from "../finance/types";
import { Conditions } from "../repositories/sql";
import { FactInput } from "./facts";

export const CONTRACT_SOURCE = "CONTRATOS_GOV_BR";

export type SourcePart = "history" | "guarantees" | "responsibles" | "items" | "invoices" | "files";
export const SOURCE_PARTS: readonly SourcePart[] = ["history", "guarantees", "responsibles", "items", "invoices", "files"];

export interface ContractFilters {
  scope: Scope;
  uasg?: string;
  search?: string;
  from: string | null;
  to: string | null;
  status?: string;
  guaranteeBeforeEnd?: boolean;
  today: string;
  boundary: string;
}

// Decimals and dates come as text so precision and calendar days survive JSON.
export interface ContractRow {
  externalId: string;
  number: string;
  object: string | null;
  supplierName: string | null;
  supplierDocument: string | null;
  uasg: string;
  unitName: string;
  startDate: string | null;
  endDate: string | null;
  globalValue: string | null;
}

export interface ContractDetailRow extends ContractRow {
  originUnitCode: string | null;
  typeName: string | null;
  category: string | null;
  processNumber: string | null;
  modality: string | null;
  sourceStatus: string | null;
  signatureDate: string | null;
  initialValue: string | null;
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

export interface ContractNotes {
  text: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface ContractStats {
  count: number;
  totalValue: string;
  expiringCount: number;
  vigency: {
    active: number;
    expiring: number;
    ended: number;
    upcoming: number;
    unknown: number;
    activeValue: string | null;
  };
}

export interface SyncState {
  lastCompletedAt: Date | null;
  running: boolean;
  staleUnits: { uasg: string; name: string; lastGoodAt: Date | null }[];
}

// Every contract read joins the registered institutions: only contracts whose
// managing UASG is registered are visible, even to unrestricted viewers.
const registered = `public_sources.contracts c JOIN "Institution" i ON i.uasg = c.managing_unit_code`;

const summaryProjection = `c.external_id::text AS "externalId", c.number, c.object, c.supplier_name AS "supplierName",
  c.supplier_document AS "supplierDocument", c.managing_unit_code AS uasg, i.name AS "unitName",
  c.start_date::text AS "startDate", c.end_date::text AS "endDate", c.global_value::text AS "globalValue"`;

const detailProjection = `${summaryProjection}, c.origin_unit_code AS "originUnitCode", c.type_name AS "typeName", c.category,
  c.process_number AS "processNumber", c.modality, c.status AS "sourceStatus", c.signature_date::text AS "signatureDate",
  c.initial_value::text AS "initialValue", c.accumulated_value::text AS "accumulatedValue",
  c.installment_count AS "installmentCount", c.captured_at AS "capturedAt", c.normalized_at AS "normalizedAt"`;

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

// The latest guarantee due date is before the contract end (same rule as the
// guarantee fact in facts.ts); false without guarantees, due dates or end date.
const guaranteeBeforeEndSql = `COALESCE((SELECT max(g.due_date) FROM public_sources.contract_guarantees g
  WHERE g.source = c.source AND g.contract_external_id = c.external_id) < c.end_date, false)`;

// Vigência status conditions share the date boundaries of contractStatus in
// domain.ts: unknown without both dates, expiring within EXPIRING_WINDOW_DAYS
// (90) days, inclusive end.
function statusSql(status: string | undefined, today: string, boundary: string, c: Conditions): string {
  const known = "c.start_date IS NOT NULL AND c.end_date IS NOT NULL";
  switch (status) {
    case "UNKNOWN":
      return "(c.start_date IS NULL OR c.end_date IS NULL)";
    case "UPCOMING":
      return `(${known} AND c.start_date > ${c.param(today)}::date)`;
    case "EXPIRED":
      return `(${known} AND c.end_date < ${c.param(today)}::date)`;
    case "EXPIRING":
      return `(${known} AND c.start_date <= ${c.param(today)}::date AND c.end_date >= ${c.param(today)}::date AND c.end_date <= ${c.param(boundary)}::date)`;
    case "ACTIVE":
      return `(${known} AND c.start_date <= ${c.param(today)}::date AND c.end_date > ${c.param(boundary)}::date)`;
    default:
      return "TRUE";
  }
}

function conditions(f: ContractFilters) {
  const c = new Conditions();
  c.add(`c.source = ${c.param(CONTRACT_SOURCE)}`);
  if (f.scope) c.add(`c.managing_unit_code = ANY(${c.param(f.scope)}::text[])`);
  if (f.uasg) c.add(`c.managing_unit_code = ${c.param(f.uasg)}`);
  // A CPF is only ever shown masked, so it is not searchable either.
  c.search(f.search, [
    "c.number",
    "c.object",
    "c.supplier_name",
    "CASE WHEN char_length(c.supplier_document) <> 11 THEN c.supplier_document END",
    "i.name",
  ]);
  if (f.from || f.to) c.add("c.start_date IS NOT NULL AND c.end_date IS NOT NULL");
  if (f.from) c.add(`c.end_date >= ${c.param(f.from)}::date`);
  if (f.to) c.add(`c.start_date <= ${c.param(f.to)}::date`);
  c.add(statusSql(f.status, f.today, f.boundary, c));
  if (f.guaranteeBeforeEnd) c.add(guaranteeBeforeEndSql);
  return c;
}

export class ContractRepository {
  constructor(private readonly db: SqlConnection) {}

  list(f: ContractFilters, page: number, limit: number) {
    const c = conditions(f);
    return this.db.query<ContractRow & { guaranteeBeforeEnd: boolean } & Record<string, unknown>>(
      `SELECT ${summaryProjection}, ${guaranteeBeforeEndSql} AS "guaranteeBeforeEnd" FROM ${registered} WHERE ${c.text}
       ORDER BY c.end_date DESC NULLS LAST, c.external_id LIMIT ${c.param(limit)} OFFSET ${c.param((page - 1) * limit)}`,
      c.values,
    );
  }

  async stats(f: ContractFilters) {
    const c = conditions(f),
      where = c.text,
      active = statusSql("ACTIVE", f.today, f.boundary, c),
      expiring = statusSql("EXPIRING", f.today, f.boundary, c),
      ended = statusSql("EXPIRED", f.today, f.boundary, c),
      upcoming = statusSql("UPCOMING", f.today, f.boundary, c),
      unknown = statusSql("UNKNOWN", f.today, f.boundary, c);
    const [row] = await this.db.query<ContractStats & Record<string, unknown>>(
      `SELECT count(*)::int AS count, COALESCE(sum(c.global_value), 0)::text AS "totalValue",
         count(*) FILTER (WHERE ${expiring})::int AS "expiringCount",
         jsonb_build_object('active', count(*) FILTER (WHERE ${active}), 'expiring', count(*) FILTER (WHERE ${expiring}),
           'ended', count(*) FILTER (WHERE ${ended}), 'upcoming', count(*) FILTER (WHERE ${upcoming}),
           'unknown', count(*) FILTER (WHERE ${unknown}),
           'activeValue', (sum(c.global_value) FILTER (WHERE ${active} OR ${expiring}))::text) AS vigency
       FROM ${registered} WHERE ${where}`,
      c.values,
    );
    return row;
  }

  // Freshness of the daily replica for the in-scope registered UASGs. A unit is
  // stale when its last good active listing is older than the start of the last
  // completed daily run; before any completed run nothing is reported stale.
  async sync(scope: Scope): Promise<SyncState> {
    const [run] = await this.db.query<{ startedAt: Date | null; finishedAt: Date | null; running: boolean }>(
      `WITH last AS (SELECT started_at, finished_at FROM public_sources.daily_runs
         WHERE source = $1 AND status = 'COMPLETED' ORDER BY finished_at DESC, id DESC LIMIT 1)
       SELECT (SELECT started_at FROM last) AS "startedAt", (SELECT finished_at FROM last) AS "finishedAt",
         EXISTS (SELECT 1 FROM public_sources.daily_runs WHERE source = $1 AND status = 'RUNNING') AS running`,
      [CONTRACT_SOURCE],
    );
    if (!run.startedAt) return { lastCompletedAt: null, running: run.running, staleUnits: [] };
    const staleUnits = await this.db.query<SyncState["staleUnits"][number] & Record<string, unknown>>(
      `SELECT uasg, name, "lastGoodAt" FROM (
         SELECT i.uasg, i.name, (SELECT max(a.attempted_at) FROM public_sources.capture_attempts a
           WHERE a.source = $1 AND a.request_key = '/api/contrato/ug/' || i.uasg AND a.outcome IN ('CAPTURED', 'UNCHANGED')) AS "lastGoodAt"
         FROM "Institution" i ${scope ? "WHERE i.uasg = ANY($3::text[])" : ""}
       ) units
       WHERE "lastGoodAt" IS NULL OR "lastGoodAt" < $2
       ORDER BY name, uasg`,
      scope ? [CONTRACT_SOURCE, run.startedAt, scope] : [CONTRACT_SOURCE, run.startedAt],
    );
    return { lastCompletedAt: run.finishedAt, running: run.running, staleUnits };
  }

  async get(externalId: string) {
    const [row] = await this.db.query<ContractDetailRow & Record<string, unknown>>(
      `SELECT ${detailProjection} FROM ${registered} WHERE c.source = $1 AND c.external_id = $2::bigint`,
      [CONTRACT_SOURCE, externalId],
    );
    return row ?? null;
  }

  parts(externalId: string) {
    return this.db.query<SourcePartState & Record<string, unknown>>(
      `SELECT part, status, captured_at AS "capturedAt", last_attempt_at AS "lastAttemptAt", row_count AS "rowCount"
       FROM public_sources.contract_parts WHERE source = $1 AND contract_external_id = $2::bigint
       ORDER BY array_position(ARRAY['header','history','items','invoices','guarantees','responsibles','files','commitments'], part)`,
      [CONTRACT_SOURCE, externalId],
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
      [CONTRACT_SOURCE, externalId, pagination.limit, pagination.offset],
    );
    return { data: row.data, total: Number(row.total), page: pagination.page, limit: pagination.limit };
  }

  // Replica rows the derived facts are computed from (facts.ts); part statuses
  // come from parts(). Dates and decimals stay text.
  async factInput(externalId: string): Promise<Omit<FactInput, "parts">> {
    const args = [CONTRACT_SOURCE, externalId];
    const [[header], history, guarantees] = await Promise.all([
      this.db.query<FactInput["header"] & Record<string, unknown>>(
        `SELECT type_name AS "typeName", category, legal_basis AS "legalBasis", signature_date::text AS "signatureDate",
           start_date::text AS "startDate", end_date::text AS "endDate", initial_value::text AS "initialValue"
         FROM public_sources.contracts WHERE source = $1 AND external_id = $2::bigint`,
        args,
      ),
      this.db.query<FactInput["history"][number] & Record<string, unknown>>(
        `SELECT external_id::text AS "externalId", number, type_name AS "typeName", qualifications, observation,
           signature_date::text AS "signatureDate", start_date::text AS "startDate", end_date::text AS "endDate",
           global_value::text AS "globalValue"
         FROM public_sources.contract_amendments WHERE source = $1 AND contract_external_id = $2::bigint`,
        args,
      ),
      this.db.query<FactInput["guarantees"][number] & Record<string, unknown>>(
        `SELECT external_id::text AS "externalId", due_date::text AS "dueDate"
         FROM public_sources.contract_guarantees WHERE source = $1 AND contract_external_id = $2::bigint`,
        args,
      ),
    ]);
    return { header, history, guarantees };
  }

  async notes(externalId: string) {
    const [row] = await this.db.query<ContractNotes & Record<string, unknown>>(
      `SELECT n.notes AS text, n."updatedAt", u.name AS "updatedBy"
       FROM "ContractNote" n LEFT JOIN "User" u ON u.id = n."updatedById"
       WHERE n.source = $1 AND n."externalId" = $2::bigint`,
      [CONTRACT_SOURCE, externalId],
    );
    return row ?? null;
  }

  async saveNotes(externalId: string, notes: string, userId: string) {
    const [row] = await this.db.query<ContractNotes & Record<string, unknown>>(
      `WITH saved AS (
         INSERT INTO "ContractNote" (source, "externalId", notes, "updatedById", "updatedAt")
         VALUES ($1, $2::bigint, $3, $4::uuid, now())
         ON CONFLICT (source, "externalId") DO UPDATE
           SET notes = EXCLUDED.notes, "updatedById" = EXCLUDED."updatedById", "updatedAt" = EXCLUDED."updatedAt"
         RETURNING notes, "updatedById", "updatedAt")
       SELECT saved.notes AS text, saved."updatedAt", u.name AS "updatedBy"
       FROM saved LEFT JOIN "User" u ON u.id = saved."updatedById"`,
      [CONTRACT_SOURCE, externalId, notes, userId],
    );
    return row;
  }
}
