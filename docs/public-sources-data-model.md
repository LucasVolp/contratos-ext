# Public sources data model

The `public_sources` schema is the receiving area of the Go replicator
(`apps/etl/cmd/replicator`). It keeps what public sources returned, exactly as
returned (canonical JSON), plus an audit of every request. Screens do not read it
directly; later steps normalize it into typed tables.

Design: [Institutional copilot](superpowers/specs/2026-11-07-institutional-copilot-design.md),
sections 4.1 and 4.8.

## Ownership

- Created by API migration `202611070001_public_sources_foundation`, applied with
  `pnpm db:migrate`. The replicator never creates schema objects and refuses to
  run when the migration is missing.
- Written only by the replicator. The API reads.
- Recommended grants for a dedicated replicator role: `USAGE` on schema
  `public_sources`; `SELECT, INSERT, UPDATE` on its tables; no DDL and no
  `DELETE`.

## Tables

| Object | Purpose |
|---|---|
| `source_pacing` | One row per source: last request time, `blocked_until`, `rate_limited_until`, current `interval_ms`. Shared by every replicator process using this database. Seeded with `CONTRATOS_GOV_BR` at 1000 ms. |
| `capture_runs` | One row per sync: `source`, `trigger` (`MANUAL`, `SCHEDULED`, `REQUESTED` reserved for screen-initiated syncs), `target_type` (`MANAGEMENT_UNIT`, `CONTRACT`), `target_code`, `status` (`RUNNING`, `SUCCEEDED`, `PARTIAL`, `FAILED`), counters, `error`, `etl_version`, start/finish times. `finished_at` is set exactly when the status is not `RUNNING`. |
| `captures` | One row per distinct content received for a request key: `resource` (stable name such as `contract_commitments`), `request_key` (path plus sorted query), `content_hash` (SHA-256 of the canonical JSON), `payload` (jsonb), `first_captured_at`, `last_seen_at`, first and last run. Unique on `(source, request_key, content_hash)`. |
| `capture_attempts` | One row per request: `outcome`, `http_status`, `error`, `attempted_at` and `capture_id` when there was content. |
| `latest_captures` (view) | The most recently seen content per `(source, request_key)`. |

## Outcomes

| Outcome | Meaning | Capture row |
|---|---|---|
| `CAPTURED` | Content differs from the latest capture of the key (new, or back to an older version). | Inserted, or an older identical row's `last_seen_at` moves forward. |
| `UNCHANGED` | Content equals the latest capture of the key. | `last_seen_at` moves forward; nothing is duplicated. |
| `NOT_FOUND` | The source answered 404. | None. Not a failure. |
| `FAILED` | Network error, HTTP error, block, non-JSON or oversized body. | None. The previous capture stays the latest. |

Run status: `SUCCEEDED` when no request failed; `PARTIAL` when some failed and
others succeeded; `FAILED` when the active listing (UG sync) or the contract
itself (contract sync) failed, when nothing succeeded, or when the run was
cancelled (`error = 'cancelled'`).

## Contratos.gov.br resources

| Resource | Path |
|---|---|
| `contracts_active_by_unit` | `/api/contrato/ug/{ug}` |
| `contracts_inactive_by_unit` | `/api/contrato/inativo/ug/{ug}` |
| `contract` | `/api/contrato/id/{id}` |
| `contract_history` | `/api/contrato/{id}/historico` |
| `contract_commitments` | `/api/contrato/{id}/empenhos` |
| `contract_guarantees` | `/api/contrato/{id}/garantias` |
| `contract_responsibles` | `/api/contrato/{id}/responsaveis` |
| `contract_items` | `/api/contrato/{id}/itens` |
| `contract_invoices` | `/api/contrato/{id}/faturas` |
| `contract_files` | `/api/contrato/{id}/arquivos` (listing only; files are downloaded in a later step) |

## Pacing

Contratos.gov.br: minimum 1 s between requests, interval doubled on each new
block up to 30 s, 5m01s cooldown after HTTP 429 or a WAF header, longer
`Retry-After` honored. The gate only coordinates processes using this database;
other clients on the same public IP are not paced by it.

## Growth

`captures` grows only when source content changes. `capture_attempts` grows on
every request (a full UG sync makes roughly two plus seven per contract). A
retention rule for old attempts is expected later.
