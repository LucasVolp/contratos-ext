# Institutional Copilot — Design

Date: 2026-11-07
Status: draft for approval

## 1. Intent

Contracts Ext today is a consultation layer: it shows contracts, public
purchases, price records, commitments (empenhos), liquidations, payments,
monthly execution and the institutional budget (LOA). The goal is to move from
"showing data" to **helping public administration staff do their work**:
answering questions, explaining situations, stating facts, raising reasonable
assumptions and drafting documents across four areas — Contracts, Procurement
(Licitações), Documents and Commitments/Payments.

The chosen shape is an **institutional copilot**: a chat side panel, in the
spirit of Shopify Sidekick, that understands the screen the user is on. It
waits for questions (it is not a push-notification system), but it may offer a
relevant topic when the current screen has a rule-based alert.

Example interactions (illustrative, user-facing text stays in Portuguese):

- On a contract: "Resume esse contrato", "Quanto já foi empenhado e pago?",
  "Quanto falta para o limite de acréscimos?", "Rascunha um aditivo de prazo
  de 12 meses".
- On a filtered commitment list: "Por que esses estão sem liquidação?",
  "Quais deveriam ser anulados antes do fim do exercício?"
- On monthly execution: "Qual unidade está mais atrasada?", "Compara com o ano
  passado."

### Why the work starts with data, not with the model

The recon of the current codebase showed that the copilot would be unable to
answer the most valuable questions today:

1. `Contract` (public schema) and `finance.commitments` are unrelated. "How
   much was committed/paid on this contract?" has no answer.
2. `Contract` is shallow: number, object, supplier, UASG, dates, initial and
   global value. No amendments, guarantees, responsible staff, items, invoices
   or files. The 25% amendment limit, guarantee expiry and "who is the fiscal"
   cannot be computed.
3. There are no stored documents for a model to read. The user asked for a
   public document store that can later feed retrieval (RAG).

Therefore this design is phased. **Phase 1 (data foundation) is specified in
enough detail to plan from.** Later phases are recorded as direction and will
each get their own design before implementation.

## 2. Product principles (apply to every phase)

- **Two layers.** Deterministic rules and SQL produce facts, numbers and
  alerts (deadlines, amendment percentages, idle commitments). The model works
  on top: it interprets, normalizes free text, reads documents, drafts and
  converses. The model never originates a number.
- **Every statement is traceable.** Copilot answers cite the record or
  document they come from, as a link to the corresponding screen or source.
- **The copilot suggests; a person decides.** Nothing is signed, sent or
  written to an official system. Actions are limited to navigating, applying
  filters and producing drafts, each confirmed by the user (Sidekick-style
  preview/confirm).
- **Drafts go through templates.** Document drafting reuses the existing
  docxtemplater + Gotenberg pipeline: the model fills fields, the template
  renders the document. The model does not write whole legal documents freely.
- **Auditability over cleverness.** In a context subject to audit bodies
  (CGU/TCU), a reproducible, explainable alert ("23.8% because amendments A + B")
  is worth more than a smarter but unverifiable one.

## 3. Goals, non-goals, anti-goals

### Goals

- Phase 1: every contract in the app can show its amendments, guarantees,
  responsible staff, items, invoices, files and the commitments linked to it,
  with committed / liquidated / paid / restos a pagar totals.
- Phase 1: derived facts are computed deterministically and shown on the
  contract detail screen (current end date, current global value, cumulative
  additions and suppressions, guarantee vs. contract end).
- Phase 1: public documents attached to contracts are captured, versioned,
  linked to their entities and have their text extracted per page.
- Later: a screen-aware chat that answers using the app's own read APIs and
  cites sources; then template-based drafting; then document reading and
  rule-based alerts.

### Non-goals (for now)

- Push notifications, e-mail or messaging integrations.
- Writing to Contratos.gov.br, SIAFI, PNCP or any official system.
- Building authentication (it arrives with PR #1, see section 6) and
  per-user personalization.
- Process instruction features noted in the repo (solicitação de empenho, ETP,
  document repository with checklists) — expected future direction, out of
  scope here.

### Anti-goals (would make this a failure even if it works)

- A copilot that states a number or legal conclusion it cannot trace to a
  record or document.
- Heuristic matches silently presented as official links.
- A chat that is generic ("I'm an AI assistant…") instead of grounded in the
  screen and the institution's data.

## 4. Phase 1 — Data foundation (detailed)

### 4.1 Source: Contratos.gov.br public API

Verified on 2026-11-07 against `https://contratos.comprasnet.gov.br/docs/api-docs.json`
and live calls for UG 158148 (IFRO):

- Per-contract endpoints under `/api/contrato/...` are **public (no auth)**.
  Bulk "changed in period" endpoints under `/api/v1/...` require a bearer
  token and are out of scope.
- `GET /api/contrato/ug/{ug}` lists active contracts of a UG (206 for 158148);
  `GET /api/contrato/inativo/ug/{ug}` lists inactive ones.
  `GET /api/contrato/ugorigem/{uasg}/numeroano/{numero}` looks up one contract
  by UASG and number. `GET /api/contrato/id/{id}` fetches one by id.
- Each contract exposes links to: `historico`, `empenhos`, `cronograma`,
  `garantias`, `itens`, `prepostos`, `responsaveis`, `despesas_acessorias`,
  `faturas`, `ocorrencias`, `terceirizados`, `arquivos`.

Relevant fields observed:

| Sub-resource | Fields |
|---|---|
| empenhos | `unidade_gestora`, `gestao`, `numero` (e.g. `2022NE000066`), `data_emissao`, `credor`, `fonte_recurso`, `planointerno`, `naturezadespesa`, `empenhado`, `aliquidar`, `liquidado`, `pago`, `rpinscrito`, `rpaliquidar`, `rpliquidado`, `rppago` |
| historico | `numero`, `tipo` (e.g. "Termo Aditivo"), `qualificacao_termo` (e.g. "ACRÉSCIMO / SUPRESSÃO"), `observacao`, `data_assinatura`, `vigencia_inicio`, `vigencia_fim`, `valor_inicial`, `valor_global`, `novo_valor_global`, `retroativo_*`, `situacao_contrato` |
| garantias | `tipo`, `valor`, `vencimento` |
| responsaveis | `usuario`, `funcao_id`, `portaria`, `situacao`, `data_inicio`, `data_fim` |
| arquivos | `tipo`, `descricao`, `path_arquivo`, `link_sei`, `origem` |

Observations that affect implementation:

- Monetary values arrive as Brazilian-formatted strings (`"54.793,53"`). Parse
  without floating-point loss, consistent with the existing decimal handling.
- **A commitment's UG may differ from the contract's UG.** In the sample, a
  contract of UG 158148 had commitments issued by UG 158345 (a campus).
- Completeness depends on how the institution uses Contratos.gov.br. In the
  sample, `arquivos` and `responsaveis` were empty while `empenhos` (96) and
  `historico` (8) were populated. The UI must distinguish "source returned
  nothing" from "not yet fetched" from "fetch failed", as the catalog already
  does.

PNCP (`https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/...`)
also exposes `termos`, `empenhos` and `arquivos` for Law 14.133 contracts. It
is a secondary source for contracts that carry a PNCP control number; using it
in Phase 1 is left to the builder.

### 4.2 Linking app contracts to Contratos.gov.br

Existing `Contract` rows come from manual entry or from the Compras.gov.br
open-data import (`/modulo-contratos/1_consultarContratos`), keyed by UASG and
number. Phase 1 resolves each contract to its Contratos.gov.br id:

1. Look up by UASG + contract number (`ugorigem/{uasg}/numeroano/{numero}`), or
   match against the UG listing by number + supplier CNPJ.
2. Store the external id and the resolution outcome (resolved / not found /
   ambiguous). Ambiguous or not-found contracts stay usable; they simply lack
   enrichment and the screen says why.
3. It should also be possible to import contracts directly from the
   Contratos.gov.br UG listing, deduplicating against existing rows with the
   same identity, following the existing rule that manual entries are
   preserved and conflicts are explicit.

Identity rules (designer's call):

- The Contratos.gov.br contract id is the external key once resolved. Lookup
  and deduplication use the **origin UG** (`unidade_gestora_origem`) plus
  contract number, which is what the existing `(number, uasg)` identity
  corresponds to. `unidade_compra` (the purchasing unit, e.g. 158147 vs. UG
  158148) is stored but not used for identity.
- A UG-wide import (~200 contracts) **skips and reports conflicting rows
  individually** instead of cancelling the whole batch, as the current
  `importContracts` does for small imports.
- Enrichment **never overwrites the contract's own columns** (`endDate`,
  `globalValue`, supplier), manual or imported. Updated values (current end
  date, current global value) live in the derived facts, shown next to the
  registered values when they differ.

### 4.3 Linking contracts to commitments (empenhos)

**Primary, deterministic path.** The Portal da Transparência commitment code
already stored in `finance.commitment_references.document_code` has the shape
`UG(6) + gestão(5) + year(4) + "NE" + sequence(6)`. Contratos.gov.br returns
`unidade_gestora`, `gestao` and `numero` (`YYYYNE######`) for each commitment
of a contract. Concatenating them yields the same code:

```
158345 + 26421 + 2022NE000066  →  158345264212022NE000066
```

Each link is stored with its origin. Outcomes per commitment listed by
Contratos.gov.br:

- **confirmed** — code found in `finance.commitments`;
- **pending import** — the commitment exists in Contratos.gov.br but the
  finance ETL has not imported that day/period yet. The link is kept and
  resolves automatically when the commitment arrives. The amounts reported by
  Contratos.gov.br (`empenhado`, `liquidado`, `pago`, RP fields) are still
  shown, labeled with that source.
- **outside import scope** — the commitment's UG is not among the units the
  finance ETL imports, so it will never arrive. Shown separately from "pending
  import" so nobody waits for it.

**Fallback, suggested path (lower priority within Phase 1).** For contracts
without a Contratos.gov.br id, or commitments not listed there, candidate links
may be proposed from `finance.commitments` using: same favored CNPJ
(`favored_code`) as the contract supplier, matching `process_number`, and the
contract number appearing in `observation`. Candidates are shown as
suggestions and become links only after a person confirms them. They are never
mixed visually with confirmed links. A model may later help rank candidates;
Phase 1 does not require one.

### 4.4 Enrichment and derived facts

Store, per resolved contract: amendments/history, guarantees, responsible
staff, items, invoices, file metadata (description, type, link; files
themselves go to the document store, section 4.7), and the commitment list
with source amounts. Prepostos,
ocorrências, terceirizados, cronograma and despesas acessórias are optional for
Phase 1 (builder's call; store raw payloads if cheap).

Derived facts, computed deterministically and shown on the contract detail
screen:

- **Current end date** and **current global value**, after amendments.
- **Cumulative additions and cumulative suppressions as a percentage of the
  initial value, computed separately** (additions and suppressions are not
  netted against each other, per TCU understanding), compared with the legal
  limit (25%, or 50% for building/equipment renovation; Law 8.666 art. 65 for
  older contracts, Law 14.133 art. 125 for new ones). Decided with the user:
  the percentage is **always shown, labeled as an estimate, with its method
  next to it**:
  - which terms were counted and which were excluded (price adjustments —
    reajuste/repactuação — apostilamentos and pure term extensions are
    excluded);
  - for terms qualified as "ACRÉSCIMO / SUPRESSÃO", the direction inferred
    from the change in global value;
  - the base used (initial value as registered in the source);
  - the law and limit assumed (law inferred from signature date and legal
    basis when present; 25% assumed unless a renovation flag exists, which
    the source does not provide today).
  Only when no amendment data exists at all is the fact "not computable".
- **Guarantee vs. contract end:** guarantee expiring before the current end
  date.
- **Financial totals per contract:** committed, liquidated, paid, restos a
  pagar, by fiscal year of the commitment. Source rule (designer's call):
  contract-level totals use the amounts Contratos.gov.br reports per
  commitment, because they include restos a pagar (`rp*`), which the finance
  API does not calculate (`docs/finance-api-contract.md`). For confirmed
  links, the commitment row links to the finance detail (items, history,
  liquidations, payments). When the two sources disagree on a commitment's
  committed amount, both values are shown with source labels; no
  reconciliation logic in Phase 1.
- **Remaining contract value:** current global value minus total committed.

Each derived fact keeps the list of records it was computed from, so the
screen (and later the copilot) can explain it.

### 4.5 Refresh behavior

The API **never calls external sources** for this data; it reads the replica
written by the public sources replicator (4.8).

- Opening a contract shows the replica immediately, with the time of the last
  successful sync per part (contract, amendments, commitments, files, …).
- The existing "force refresh" buttons in the interface are kept, but instead
  of calling the source they **request** a priority sync (contract or UG) that
  the replicator picks up. The screen shows the request as queued / running /
  done / failed and reloads when done.
- Failures keep the last replica and identify which parts are stale or
  unavailable, as the catalog already does.
- Routine freshness comes from scheduled syncs (scheduling is external, as in
  the finance ETL).

### 4.6 Screens

- **Contract detail** gains sections for: summary of derived facts, amendments
  timeline, linked commitments (with confirmed / pending / suggested states and
  totals), guarantees, responsible staff, items, invoices, files.
- **Commitment detail** (`/financeiro/empenhos/[id]`) shows the linked
  contract, when any.
- **Contract list** may show current end date and amendment percentage as
  columns or filters (builder's call).
- **Files section** on contract detail lists stored documents with source,
  type, capture date and a link to open the stored copy and the original.

### 4.7 Public document store

Requested by the user: a way to keep public documents locally, to serve as
context for a future retrieval-augmented copilot (RAG). Phase 1 stores and
extracts; it does not index for retrieval yet.

**What gets stored.** Public files referenced by the sources already in use:

- Contratos.gov.br contract files (`arquivos.path_arquivo`). Verified on
  2026-11-07: links point to
  `https://contratos.comprasnet.gov.br/storage/contrato/...pdf` and download
  without authentication (sample: 2-page PDF, `application/pdf`, ~58 KB).
  `link_sei` entries point to SEI and may not be directly downloadable; store
  the link, attempt the download, and record the outcome.
- PNCP contract and amendment files (`/contratos/.../arquivos`,
  `/termos/{seq}/arquivos`) when the contract has a PNCP control number
  (already stored in `Contract.externalId` by the current import). Optional in
  Phase 1, consistent with 4.1; the storage design must accept a second source.
- Room for PNCP purchase files (edital, termo de referência, ETP) linked to
  public purchases already in the catalog. Optional in Phase 1.
- Documents generated by the app itself (DOCX/PDF of price records) are
  already kept in `DocumentExport`; linking them into the store is optional.

**What is kept per document.**

- The original bytes, immutable once captured, with a content hash (SHA-256)
  used for deduplication. Re-fetching an unchanged file creates no new copy; a
  changed file at the same source link creates a new version, keeping the old
  one.
- Metadata: source system, source URL, source identifiers, document type and
  description as given by the source, MIME type, size, page count, capture
  time, download outcome (stored / failed / not downloadable / restricted).
- Links to the domain entities it belongs to (contract, amendment, public
  purchase, price record). One document may relate to several entities.
- **Extracted text**, per page, with extraction method and status. PDFs with a
  text layer are extracted directly. Scanned PDFs without a text layer are
  marked `needs_ocr`; OCR itself is out of Phase 1 scope (builder may add it
  if cheap). Keeping page boundaries matters: later answers must cite
  "document X, page N".

**When files are fetched (designer's call).** Downloads ride on contract
enrichment: when the replicator syncs a contract (scheduled, UG-wide or on
request), its file list is fetched, new links are downloaded and already-stored links are
re-downloaded only if the stored copy is older than a staleness window
(builder's value). No scheduler or queue in Phase 1; downloads share the
request pacing of 4.5 and run after the structured data, so a slow file never
delays the contract screen.

**Storage.** Binary files live outside PostgreSQL, behind a small storage
interface, with a local filesystem directory on a Docker volume as the
default implementation (preserved by `docker compose down`, like
`postgres_data`). An S3-compatible backend can be added later without schema
changes. Metadata, entity links and extracted text live in PostgreSQL.

**RAG readiness (not built in Phase 1).** The schema must not preclude adding
chunk and embedding tables later (e.g. pgvector in the same PostgreSQL). Phase
1 may add PostgreSQL full-text search over extracted text, which is useful on
its own and as the lexical half of a future hybrid retrieval.

**Owner.** File capture, versioning and text extraction are done by the
replicator (4.8); the API only serves stored files and metadata.

**Scope guard.** Only public documents from public sources. No internal or
restricted documents, no user uploads in Phase 1. Files flagged as restricted
by the source are not downloaded.

### 4.8 Public sources replicator (Go ETL)

Decided by the user: public sources (PNCP in particular) are unstable, so a
software layer in front of them extracts the data and replicates it to the
consumer (our API). **The Go ETL (`apps/etl`) is that layer.** It already does
this for Portal da Transparência: persistent request pacing shared across
processes, 5m01s cooldown on HTTP 429 or WAF responses, raw source fields kept
in `source_data`, external scheduling, and a CLI.

Shape (designer's call within the user's decision):

- **One connector per source.** Phase 1: Contratos.gov.br (contracts, their
  sub-resources and files). Optional in Phase 1: PNCP contracts, terms and
  files. Existing finance import stays as is. Moving the current direct calls
  the API makes to Compras.gov.br Dados Abertos (purchases, price records,
  supplements) behind the replicator is a follow-up, not Phase 1.
- **Pacing per source host**, reusing the existing persistent pacing/cooldown
  mechanism, each host with its own state row and limits.
- **Two stages:**
  1. **Capture** — fetch with retries and cooldowns; store each response raw,
     with request identity (source, endpoint, parameters), capture time,
     HTTP outcome and content hash. An unchanged response (same hash) records
     a "seen at" time instead of a duplicate. Files follow the same rule
     (4.7).
  2. **Normalize** — turn captured payloads into the typed tables the API
     reads (contracts, amendments, guarantees, responsible staff, items,
     invoices, contract commitments, file metadata, extracted text), then
     compute links (4.3). Normalization can be re-run from stored raw
     payloads without hitting the source, so mapping fixes do not require a
     re-download.
- **Replication target:** the same PostgreSQL, in tables the replicator owns
  (like `finance`), with migrations still owned by the API's migration
  history (current rule in `docs/finance-data-model.md`). The API only reads
  them. No queue or HTTP between the two.
- **On-demand sync requests:** a request table written by the API (target:
  contract or UG; status; timestamps; error) and consumed by the replicator.
  This implies the replicator gains a long-running worker mode that polls
  the table, alongside the existing one-shot CLI commands. Scheduled syncs
  remain external (cron/compose).
- **CLI commands** at least: sync one contract, sync a UG (active and
  inactive contracts), re-normalize from raw, and run the worker.
- **Observability:** each run recorded (like `finance.ingestion_runs`), with
  counts per stage and per-part failures, so the screen can say what is stale
  and why.

## 5. Roadmap

Approved by the user on 2026-11-07. Data first; every step ends with something
visible so it can be validated along the way. Each phase goes through design →
plan → implementation; only Phase 1 is designed in detail here.

**Prerequisite:** resolve the PR #1 merge (user).

### Phase 1 — Data

| # | Step | Delivers | Depends on |
|---|---|---|---|
| 1 | Replicator foundation | Multi-source ETL: connector per source, pacing/cooldown per host, raw capture with hash, run records. `sync` command for one UG on Contratos.gov.br. No screens yet. | — |
| 2 | Complete contracts | Normalized amendments, guarantees, responsible staff, items, invoices; app contract ↔ Contratos.gov.br resolution; UG import with per-row conflicts; contract screen shows it all. | 1 |
| 3 | Contract ↔ commitment | Contract commitments linked to finance data by Transparência code; confirmed / pending import / outside import scope; committed, liquidated, paid, restos a pagar totals; commitment screen shows its contract. | 2 |
| 4 | Derived facts | Current end date and value, estimated addition/suppression % with method, guarantee vs. end date, remaining value; summary on contract screen; list filters. | 2, 3 |
| 5 | Document store | PDF capture, hash versioning, volume storage, per-page text extraction, `needs_ocr` marking; Files section on contract. | 2 |
| 6 | Refresh now | Sync request table, ETL worker mode, screen buttons, scheduling in compose. | 2 |
| 7 | Complements (optional) | PNCP as second source of terms and files; suggested links for commitments without a contract, with human confirmation. | 3, 5 |

Steps 5 and 6 can run in parallel with 3 and 4. Follow-up after Phase 1:
move the current purchase/price-record catalog calls behind the replicator.

### Later phases (direction only)

Each gets its own design before implementation.

- **Phase 2 — Copilot v1 (read-only Q&A).** Side panel on contract, commitment
  and execution screens. Each screen publishes a context object (entity type,
  id, active filters). The model answers via tool calls over the app's existing
  read APIs plus the Phase 1 derived facts, and cites sources as links.
  Allowed actions: navigate, apply filters. No writes.
- **Phase 3 — Template-based drafting.** Contract amendment (prazo/valor),
  extension justification, technical notes: the copilot gathers data, proposes
  field values, the user reviews, the existing template pipeline renders
  DOCX/PDF.
- **Phase 4 — Document reading and alerts.** Read contract and amendment PDFs
  (from Contratos.gov.br/PNCP file links) to extract clauses missing from
  structured data (adjustment index, penalties, obligations). Rule-based alerts
  (contracts ending without coverage, idle commitments, amendment limit, split
  purchases, sanctioned suppliers) surface contextually in the panel.
- **Beyond:** item description normalization for cross-unit price comparison
  and joint-purchase suggestions; process instruction (solicitação de empenho,
  ETP).

## 6. Constraints

- Stack: Next.js 16 / React 19 / Tailwind 4 web; Fastify 5 API with SQL via
  `pg` (no ORM); PostgreSQL 16; Go ETL for finance imports; Gotenberg for PDF.
- **Authentication and UASG scoping (decided with the user).** `main` is
  mid-merge with `origin/main` (PR #1, `feat/authentication`: login, sessions,
  roles `GESTOR_GERAL`, `DIRETOR`, `ADMINISTRATIVO`, `USUARIO`, per-user UASG
  scope in `apps/api/src/auth/access.ts`, several institutions per
  deployment). Phase 1 is planned on top of the merged result; resolving the
  merge is a prerequisite owned by the user. Rules:
  - new contract endpoints apply the existing UASG scope using the contract's
    origin UG;
  - whoever can see a contract sees all its commitments, including those
    issued by other UGs (e.g. a campus), because they belong to the contract;
  - UG-wide sync requests are restricted to management roles; single-contract
    sync requests are allowed to anyone who can see the contract.
- Technical artifacts (schemas, identifiers, comments, tests, docs) in English;
  user-facing copy in Portuguese (`AGENTS.md`).
- External sources are public APIs with rate limits and WAFs; send a
  browser-like `User-Agent` and `Accept: application/json` where required.

## 7. Calls made by the designer (not decided by the user)

- Phase 1 is the data foundation; the copilot follows. The user agreed to
  "start there", but the exact phase boundaries are the designer's.
- Contratos.gov.br is the primary enrichment source; PNCP is secondary.
- The fallback heuristic link is suggestion-only and lower priority.
- The document store (requested by the user) keeps files on a filesystem
  volume behind a storage interface, with metadata and per-page extracted text
  in PostgreSQL. Retrieval indexing (chunks, embeddings) and OCR are deferred.
- Only public documents; no user uploads in Phase 1.
- Contract identity, conflict handling and no-overwrite rules (4.2).
- "Outside import scope" commitment state (4.3).
- Financial totals source rule (4.4).
- PNCP documents optional; downloads ride on contract refresh (4.7).
- The API never calls sources for this data; refresh buttons enqueue sync
  requests consumed by a replicator worker mode (4.5, 4.8).
- Moving existing Compras.gov.br Dados Abertos calls behind the replicator is
  a follow-up, not Phase 1 (4.8).

## 8. Left to the builder

- Table design and naming for the new data (new tables should follow
  `AGENTS.md`; the existing `public` tables use quoted PascalCase while
  `finance` uses snake_case).
- Whether to store raw source payloads alongside normalized columns.
- Cache window and pacing values.
