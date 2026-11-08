# Public sources data model

The `public_sources` schema is the receiving area of the Go replicator
(`apps/etl/cmd/replicator`). It keeps what public sources returned, exactly as
returned (canonical JSON), plus an audit of every request. Screens never read it
directly; the API reads the normalized contract replica (`contracts`, its child
tables and `contract_parts`) to serve the contract screens.

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
| `source_pacing` | One row per source: last request time, `blocked_until`, `rate_limited_until` and `penalty_interval_ms` (interval earned by blocks; 0 = none). Each run applies its own minimum on top and never stores it. Shared by every replicator process using this database. Seeded with `CONTRATOS_GOV_BR`. |
| `capture_runs` | One row per sync: `source`, `trigger` (`MANUAL`, `SCHEDULED`, `REQUESTED` reserved for screen-initiated syncs), `target_type` (`MANAGEMENT_UNIT`, `CONTRACT`), `target_code`, `status` (`RUNNING`, `SUCCEEDED`, `PARTIAL`, `FAILED`), counters, `error`, `etl_version`, start/finish times. `finished_at` is set exactly when the status is not `RUNNING`. |
| `captures` | One row per distinct content received for a request key: `resource` (stable name such as `contract_commitments`), `request_key` (path plus sorted query), `content_hash` (SHA-256 of the canonical JSON), `payload` (jsonb), `first_captured_at`, `last_seen_at`, first and last run. Unique on `(source, request_key, content_hash)`. |
| `capture_attempts` | One row per request: `outcome`, `http_status`, `error`, `attempted_at` and `capture_id` when there was content. |
| `latest_captures` (view) | The most recently seen content per `(source, request_key)`. |

## Typed contract tables

Migration `202611080001_public_sources_contracts` adds typed snapshots rebuilt by
`replicator normalize` (and by `sync` unless `-normalize=false`) from
`latest_captures`. Nothing is fetched during normalization.

| Object | Purpose |
|---|---|
| `contracts` | One header per Contratos.gov.br contract, keyed by `(source, external_id)`. `managing_unit_code` matches the registered institution UASG (`"Institution".uasg`), which scopes every API read; `number_key` is `contract_number_key(number)`. `header_resource` says whether the header came from `/id` (`contract`, preferred) or from a UG listing. |
| `contract_amendments`, `contract_guarantees`, `contract_responsibles`, `contract_items`, `contract_invoices`, `contract_commitments`, `contract_files` | Child snapshots per contract: each normalization deletes and re-inserts the contract's rows from the latest capture of that part. Rows are filed under the contract whose URL they were captured from. |
| `contract_parts` | Freshness per contract part (`header`, `history`, `commitments`, `guarantees`, `responsibles`, `items`, `invoices`, `files`): `AVAILABLE`, `NOT_FOUND` (source has none), `FAILED` (last attempt failed; rows still come from the previous good capture, `captured_at` shows when) or `MISSING` (never captured). |
| `contract_number_key(text)` | Upper case, no whitespace, no leading zeros in the first digit run (`00004/2017` → `4/2017`). Generates `contracts.number_key`, indexed with `managing_unit_code` (`contracts_identity_idx`); no API query uses it today. |

Value parsing: money in Brazilian format (`54.793,53`), item quantities with a dot
decimal (`750.625`), dates as `YYYY-MM-DD`, timestamps or `{"date": …}` objects
(unparsable dates become NULL and are counted as `badDates`). A full CPF in a
responsible's `usuario` is masked as `***.DDD.DDD-**` before storage; the source
already sends it masked. `contract_commitments.transparency_code` equals
`finance.commitment_references.document_code` for the same empenho.

## Daily sync

Migration `202611090001_public_sources_contract_sync` keys the contract children
per contract (their primary keys start with `contract_external_id`, so two
contracts never overwrite each other's rows) and adds the daily cycle audit.

| Object | Purpose |
|---|---|
| `daily_runs` | One row per `replicator daily` cycle over all registered UGs: `source`, `status` (`RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`), `unit_count`, `failed_unit_count`, `error`, `etl_version`, `started_at`, `finished_at`. `finished_at` is set exactly when the status is not `RUNNING`. `COMPLETED` means every UG was attempted, even if some failed. Written by the replicator only. |
| `capture_runs.daily_run_id` | The daily cycle that started the run (trigger `SCHEDULED`); `NULL` for manual or requested runs. |

A process starting `replicator daily` runs a cycle only when no `COMPLETED` row
finished in the last 24 hours. A per-source advisory lock
(`hashtext('public_sources.daily:' || source)`) prevents overlapping cycles.

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

Contratos.gov.br: minimum 1 s between requests (per run, `-interval`), penalty
interval doubled on each new block up to 30 s, 5m01s cooldown after HTTP 429 or a
WAF header, longer `Retry-After` honored up to 1 hour. The penalty is dropped one
hour after the cooldown ends without a new block. The gate only coordinates processes using this database;
other clients on the same public IP are not paced by it.

## Growth

`captures` grows only when source content changes. `capture_attempts` grows on
every request (a full UG sync makes roughly two plus seven per contract). A
retention rule for old attempts is expected later.
