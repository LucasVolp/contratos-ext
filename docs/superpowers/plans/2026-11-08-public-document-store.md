# Public Document Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve public contract PDFs and their revisions, extract page-citable text, and expose stored evidence through authorized contract screens.

**Architecture:** The Go replicator discovers normalized source references, publishes immutable hash-addressed files and persists metadata in a separate `documents` schema. A post-normalization daily pass handles downloads and extraction; Fastify serves scoped reads from PostgreSQL and a read-only shared volume. Existing source snapshots remain independent of retained evidence.

**Tech Stack:** Existing Go 1.24 ETL, PostgreSQL 16, Fastify 5/TypeScript, Next.js 16/React, shadcn with Base UI; Poppler container tools for PDF inspection/extraction.

**Spec:** `docs/superpowers/specs/2026-11-08-public-document-store-design.md` (approved 2026-11-08).

## Global Constraints

- English technical artifacts; pt-BR product copy. Follow `AGENTS.md`.
- Before any web edit, read `docs/ui-rules.md`, `apps/web/AGENTS.md`, and relevant installed Next.js guides if using Next.js APIs. Complete the §8 checklist.
- No source calls in API requests; no uploads, OCR execution, embeddings, LLMs, risk scores or refresh queue.
- Retained versions and associations survive normalization and source removal. Never cascade-delete evidence with replica rows.
- Authentication and registered managing-UASG scope apply to every metadata, version, binary and page read; out-of-scope resources return 404.
- One download at a time; 7-day recheck; failed references wait 24 hours; restricted/unsupported references retry only after source metadata changes.
- Download limits: 50 MiB, 60 seconds, at most 5 redirects. HTTPS plus explicit public-host allowlist and public resolved addresses only; preserve existing persistent host pacing/cooldown.
- Extraction limits: 120 seconds total per file, 1,000 pages, 20 MiB output. Defaults configurable. Keep physical page numbering from 1.
- Daily document budget: 30 minutes. Never-attempted references first, then oldest eligible; persist progress and report remaining eligible work.
- Metadata PostgreSQL migrations belong to the API. Bytes live on a named volume, ETL read/write and API read-only; backup both together.

## Review Focus

1. A stale cached file listing must not silently resurrect a document absent from a newer successful listing (Task 2).
2. A → B → A is three logical revisions but two immutable blobs; a failed third download preserves B (Tasks 1, 3).
3. A document visible through one UASG must not expose metadata from another contract or bypass the selected contract path (Task 6).
4. A PDF with both image-only and text pages retains page numbering and usable text; blank pages are coverage gaps, not confirmed scans (Task 4).
5. An expired download budget or interrupted process must leave structured sync completed, incomplete bytes unpublished and remaining document work resumable (Tasks 3, 5).

## File Map and Shared Contracts

Create `apps/etl/internal/documents/` with focused `types.go`, `store.go`, `discovery.go`, `storage.go`, `download.go`, `extract.go`, `runner.go` and matching `_test.go` files. Put small synthetic PDFs in `testdata/` (no real personal data). Keep document CLI code in new `apps/etl/cmd/replicator/documents.go`; extend `main.go`, `plan.go`, and tests rather than embedding pipeline logic there.

Create `apps/api/src/document-store/{types,repository,storage,service,controller}.ts`; this avoids confusing public evidence with the existing `src/documents.ts` template exporter. Register this module in `src/app.ts`. Create `apps/api/test/document-store.test.ts` and `apps/api/test/integration/document-store.test.ts`.

Create `apps/web/lib/contract-documents-api.ts` and `apps/web/components/contract-documents/{contract-documents-section,document-versions,document-pages}.tsx`. Mount them through the existing contract source panel. Existing files/source endpoints remain backward compatible.

Use positive bigint ids serialized as strings. The SQL schema stores:

- `documents.blobs`: `hash` (64 lowercase hex, PK), `storage_key` (unique), `byte_size`, `mime_type`, `created_at`.
- `documents.documents`: bigint id, `(source, source_document_id)` unique, type/description/URL/SEI/origin/process metadata, `metadata_hash`, discovery timestamps.
- `documents.document_versions`: bigint id, document id, monotonically increasing `revision`, blob hash, metadata/URL snapshot, `captured_at`, `verified_at`; unique `(document_id, revision)` only, never unique `(document_id, blob_hash)`.
- `documents.contract_documents`: document id plus contract source/external id, first/last seen, `currently_listed`, last reconciled successful listing timestamp; no FK to disposable replica rows.
- `documents.document_attempts`: document id, metadata hash, attempt time, outcome, HTTP status, bounded diagnostic error; outcomes `STORED`, `UNCHANGED`, `FAILED`, `RESTRICTED`, `UNSUPPORTED`, `NOT_DOWNLOADABLE`.
- `documents.extractions`: bigint id, blob hash, extractor version, method, start/finish, status, page count, bounded error; reruns append attempts rather than overwrite good output.
- `documents.pages`: extraction id, physical page number, text, status (`EXTRACTED`, `NEEDS_OCR`), unique `(extraction_id, page_number)`.
- `documents.runs`: start/finish, status, optional daily run id, processing counters and bounded error. A document failure changes document counters, never structured sync outcomes.

Go shared types in `types.go`: `Target{Unit string; ContractID int64}`, `Policy` containing all configurable limits above, `Blob{Hash, Key string; Size int64}`, `Reference{DocumentID int64; Source, SourceDocumentID, URL, SeiLink, MetadataHash string}`, `Downloaded{Blob Blob; HTTPStatus int; FinalURL string}`, `Page{Number int; Text, Status string}`, `Extraction{Method, ToolVersion, Status string; PageCount int; Pages []Page; Error string}`, `Summary{RunID int64; Stored, Unchanged, Failed, Restricted, Unsupported, NotDownloadable, Remaining int; BudgetExhausted bool}`.

## Task 1: Durable schema and immutable local storage

**Files:** create `apps/api/migrations/202611090003_public_document_store.sql`; create Go `types.go`, `storage.go`, `store.go` and tests; add `DocumentsMigration` to `internal/testdb/testdb.go`.

**Interfaces:** `LocalStorage.Put(ctx context.Context, body io.Reader, maxBytes int64) (Blob, error)` publishes by hash; `Path(hash string) (string, error)` accepts only valid hashes. `Store{DB *sql.DB}` provides `RecordVersion(ctx context.Context, ref Reference, download Downloaded, at time.Time) (revision int, changed bool, err error)` and `RecordAttempt(ctx context.Context, ref Reference, outcome string, httpStatus int, message string, at time.Time) error`.

- [ ] **1. Write failing storage and database tests.** `TestPutDeduplicates` asserts equal bytes return equal hashes and one physical file. `TestPutLimitAndCancellation` asserts no published file on oversize/cancellation and no temporary leaks. `TestVersionReappearance` records A/A/B/A and asserts revisions `[1,1,2,3]`, version count 3, blob count 2. `TestConcurrentVersion` asserts two writers of the same bytes create one revision. Delete the corresponding replica contract/file rows and assert evidence counts unchanged.
- [ ] **2. Run RED.** In `apps/etl`: `go test ./internal/documents -run 'TestPut|TestVersion|TestConcurrent' -count=1`. Expect missing implementation or failed assertions; database tests require `ETL_TEST_DATABASE_URL` pointing at a disposable test server.
- [ ] **3. Implement migration, storage and writes.** Apply schema/checks/indexes above, references within the document schema, no evidence FKs to source snapshots. Stream to same-filesystem temp files, hash and enforce byte limit, publish atomically; refuse symlinks/untrusted keys. Serialize revision writes using a transaction-level document lock and compare only the latest revision hash. Publish bytes before committing versions; an orphan blob is acceptable after crash.
- [ ] **4. Verify GREEN.** Run the same tests with PostgreSQL enabled, plus migration-twice verification using the existing migration runner; require passes, not skips. Verify invalid hashes and traversal cannot produce paths.
- [ ] **5. Commit:** `feat(documents): add durable evidence schema and immutable storage`.

## Task 2: Discovery and retained contract associations

**Files:** create Go `discovery.go`, `discovery_test.go`; extend `store.go`, `store_test.go`.

**Interfaces:** `Store.Discover(ctx context.Context, target Target, at time.Time) error` reconciles local normalized file references; `Store.Due(ctx context.Context, target Target, policy Policy, at time.Time) ([]Reference, error)` returns ordered eligible references. Discovery uses the successful listing snapshot timestamp, not the current clock, to prevent stale replay.

- [ ] **1. Write failing tests.** `TestDiscoverRetainsHistory` normalizes the same file twice and asserts stable logical identity. `TestDiscoverEmptyListing` asserts a newer successful empty listing sets `currently_listed=false`. `TestDiscoverFailedListing` asserts failed/missing parts and a stale cached replay cannot remove or resurrect associations. `TestDuePolicy` asserts 7-day success expiry, 24-hour failure delay, no restricted/unsupported retries until metadata changes, never-attempted first and stable ordering. Include inactive contracts and files of unregistered UASGs; only registered contracts enter discovery.
- [ ] **2. Run RED:** `go test ./internal/documents -run 'TestDiscover|TestDue' -count=1`.
- [ ] **3. Implement discovery and selection.** Derive refs from `public_sources.contract_files` joined to registered contracts; upsert documents by upstream id and retain per-contract associations. Reconcile removal only for newer successfully normalized file-list observations, including empty `NOT_FOUND` listings. Leave failed/missing parts untouched. Retry identity includes source metadata hash; use direct URL before SEI. Do not infer amendment links. Persist pending references with nullable URLs; no URL results in `NOT_DOWNLOADABLE` rather than a disappearing record.
- [ ] **4. Verify GREEN:** rerun task tests and `go test ./internal/normalize ./internal/documents -count=1` with database tests enabled.
- [ ] **5. Commit:** `feat(documents): discover source files without losing retained history`.

## Task 3: Bounded PDF download with shared pacing

**Files:** create Go `download.go`, `download_test.go`; extend `storage.go` tests. Reuse `internal/pacing` directly; do not repurpose the JSON capture fetcher as a binary buffer.

**Interfaces:** `Downloader.Fetch(ctx context.Context, ref Reference) (Downloaded, error)`; typed `DownloadError{Outcome string; HTTPStatus int; Message string}`. Inject clock, resolver/dialer and host-to-`pacing.Gate` lookup for deterministic tests. Production always validates actual destinations; test transports are never exposed as CLI bypass flags.

- [ ] **1. Write failing tests.** `TestFetchPublicPDF` asserts MIME/signature inspection, streamed storage and gate reservation. `TestFetchLimits` asserts 50 MiB max, 60-second request timeout and 5-redirect ceiling. `TestFetchRedirectAndDNS` rejects private/loopback/link-local/IPv6-local destinations, DNS rebinding and unapproved redirect hosts. `TestFetchOutcomes` distinguishes HTTP 401/403, 429/WAF, 500, unsupported content and HTML/SEI viewer pages. `TestFailedReplacement` proves a valid earlier copy survives a truncated/oversize replacement. A signature-valid corrupt/encrypted PDF is stored for later extraction failure.
- [ ] **2. Run RED:** `go test ./internal/documents -run 'TestFetch|TestFailedReplacement' -count=1`.
- [ ] **3. Implement downloader.** Default host `contratos.comprasnet.gov.br`, HTTPS only; operator may add public hosts. Validate all resolved addresses and pin validated IPs in the dialer while preserving TLS hostname checks. Revalidate each redirect, reserve its host's gate, preserve persistent source-host cooldown and Retry-After semantics. Existing source host shares the Contratos.gov.br pacing row; additional approved hosts get distinct persistent rows using the existing table shape. Limit body bytes regardless of Content-Length. Treat authenticated/restricted files as restricted without bypassing them; preserve last successful versions on every failure.
- [ ] **4. Verify GREEN:** run downloader tests and `go test ./internal/pacing ./internal/capture ./internal/documents -count=1`; no external service calls in these tests.
- [ ] **5. Commit:** `feat(documents): capture public PDFs with bounded paced downloads`.

## Task 4: Page-preserving PDF extraction

**Files:** create Go `extract.go`, `extract_test.go`, `testdata/`; extend store persistence tests; modify `apps/etl/Dockerfile`.

**Interfaces:** `PDFExtractor.Extract(ctx context.Context, path string) (Extraction, error)`; `Store.RecordExtraction(ctx context.Context, hash string, result Extraction, at time.Time) error`. Use `pdfinfo` and `pdftotext`, invoked with argument arrays and bounded stdout/stderr; no shell evaluation.

- [ ] **1. Write failing tests.** `TestExtractPhysicalPages` uses a 3-page fixture with text/image-only/text and asserts physical page numbers `[1,2,3]`, middle `NEEDS_OCR`, other text preserved, aggregate `PARTIAL`. All empty pages give `NEEDS_OCR`; all nonempty give `EXTRACTED`. `TestExtractionLimits` exercises 120-second total deadline, >1,000 pages, >20 MiB output and subprocess termination. `TestExtractionFailureRetention` keeps the PDF and earlier successful extraction after corrupt/encrypted input or failed rerun. `TestToolVersion` records the actual Poppler version. Include consecutive/trailing blank pages without splitting off an extra phantom page.
- [ ] **2. Run RED:** `go test ./internal/documents -run 'TestExtract|TestToolVersion' -count=1`. Tool integration tests must run with Poppler installed; distinguish explicit prerequisites from silent skips.
- [ ] **3. Implement extraction and persistence.** Inspect page count, enforce a shared per-file deadline, preserve page boundaries using actual page count and explicit page extraction. Retain method/tool version and append extraction attempts. Select latest completed useful extraction for reads; latest failed attempt remains visible independently. Add Poppler to the runtime container with a reproducible resolved version pinned during implementation and documented runtime dependency rationale. Keep the non-root ETL user.
- [ ] **4. Verify GREEN:** run extraction tests locally or in the ETL image and `go test ./internal/documents -count=1` with database enabled; validate image tools report versions. No production documents in fixtures.
- [ ] **5. Commit:** `feat(documents): retain page text and extraction coverage`.

## Task 5: Resumable command, daily document pass and shared volume

**Files:** create Go `runner.go`, `runner_test.go`, `cmd/replicator/documents.go`; modify `cmd/replicator/{main,plan,main_test}.go`, `internal/daily/{cycle,cycle_test}.go`, `compose.yaml`, `package.json`, `.env.example`, `.gitignore` and ETL README. Confirm exact existing env example path before editing.

**Interfaces:** `Runner.Run(ctx context.Context, target Target) (Summary, error)` discovers and processes due refs serially; `Runner.Reextract(ctx context.Context, target Target) (Summary, error)` uses stored bytes only. Add optional `Documents func(context.Context) (documents.Summary, error)` to `daily.Cycle` and `Documents *documents.Summary` to `CycleResult`. Name CLI parser `parseDocuments(args []string) (documentsPlan, error)`.

- [ ] **1. Write failing tests.** `TestRunnerBudgetResume` stops the pass at 30 minutes, reports remaining and resumes oldest work. `TestRunnerCancellation` records interrupted attempts and leaves no partial published file. `TestConcurrentRunners` uses document advisory coordination through download/version persistence, not only the commit, to avoid duplicate work. `TestDailyDocumentsAfterAllUnits` asserts the document phase runs after structured units, document failures do not change structured outcomes, and the next daily cycle still runs. `TestReextractOffline` uses a downloader that fails if invoked. CLI tests reject arbitrary URLs, invalid targets, nonpositive limits and unsupported source.
- [ ] **2. Run RED:** `go test ./internal/documents ./internal/daily ./cmd/replicator -count=1`.
- [ ] **3. Implement runner, CLI and operational configuration.** Command `replicator documents -source CONTRATOS_GOV_BR [-unit <UG> | -contract <id>] [-reextract] [-budget 30m]`; omitted target means all registered contracts. Existing `sync`/`normalize` semantics stay intact. Register document migration checks for document/daily commands without making unrelated normalize commands require PDF tools. Add `pnpm sources:documents` using the existing wrapper. Persist document runs/counters. Lock acquisition must not exhaust DB connections needed by pacing; reserve a dedicated connection and size pools explicitly. Budget expiry records partial completion, not all-items-failed; SIGTERM respects parent cancellation and records cancellation.
- [ ] **4. Wire runtime storage.** `DOCUMENT_STORAGE_ROOT=/var/lib/contracts/documents`, local fallback configured through env, `DOCUMENT_ALLOWED_HOSTS` for additional hosts; add `document_data` named volume read/write to ETL, read-only to API. Initialize its directory for UID 10001 while keeping files readable by API runtime user. Verify default `compose.override.yaml` merges retain document mounts. Document every configurable timeout/size/page/recheck/retry/budget limit above; ignore local runtime bytes in git.
- [ ] **5. Verify GREEN:** task tests with database enabled; `docker compose config` and `docker compose -f compose.yaml config`; container smoke writes a fixture as ETL UID and reads it through API UID. Confirm a read-only API mount rejects writes. Document backup/restore of both volume and DB.
- [ ] **6. Commit:** `feat(documents): run resumable daily and command-line ingestion`.

## Task 6: Scoped evidence read API

**Files:** create `apps/api/src/document-store/{types,repository,storage,service,controller}.ts`, unit and integration tests; modify `apps/api/src/app.ts`, `docs/api-contract.md`.

**Interfaces:** `DocumentStoreRepository` provides contract-scoped paginated listing, version history and exact version/page lookups. `DocumentStoreService` consumes `Pick<ContractService, "find">` for existing contract authorization and a local read-only storage adapter. Methods `list(contractExternalId, query, scope)`, `versions(contractExternalId, documentId, query, scope)`, `file(contractExternalId, documentId, versionId, scope)`, `pages(contractExternalId, documentId, versionId, query, scope)` use existing `Data`, `Scope` and pagination types. `createApplication` accepts an optional `documentStorageRoot` test configuration.

- [ ] **1. Write failing API tests.** Authorized contract lists pending/stored/unlisted documents with last attempt and last valid version separately. Every nested resource must belong to its selected document and path contract. Assert 404 for another UASG, unregistered/deleted contract, foreign document/version/page and invalid/overflow ids; 401 without authentication. Deduplicate the same bytes in two UASGs and verify no metadata/association leakage. Retained unlisted documents remain readable through an authorized existing contract. Missing physical bytes return explicit 503 without erasing metadata; no arbitrary paths or hashes accepted.
- [ ] **2. Run RED:** `pnpm --filter @contracts/api exec tsx --test test/document-store.test.ts test/integration/document-store.test.ts`. Integration tests follow `test/helpers/test-database.ts` and must run against an isolated database.
- [ ] **3. Implement endpoints:** `GET /api/contracts/:externalId/documents`, `.../documents/:documentId/versions`, `.../documents/:documentId/versions/:versionId/file`, `.../documents/:documentId/versions/:versionId/pages`. Use parameter names compatible with the global UUID guard (`documentId` and `versionId`, never generic bigint `id`). Authorize the contract, then validate associations in the repository query before touching storage. Keep existing source/files endpoint.
- [ ] **4. Implement responses.** Paginated lists default 20/max 100; identifiers as strings; metadata/URLs, listed state, last download attempt, latest valid version and extraction coverage. Page records include version id, physical page number, extraction id/method/tool version; no raw hashes, storage keys or diagnostic source errors. Stream PDF bytes with `application/pdf`, safe filename, private/no-store, nosniff; plain-text extraction only. Preserve HTML-like extracted content as text. Validate stored paths from hash-derived keys, reject symlink escape. Do not instantiate extractor or network clients in the API.
- [ ] **5. Verify GREEN:** `pnpm --filter @contracts/api test`, `pnpm --filter @contracts/api test:integration`, `pnpm --filter @contracts/api lint`. Record tests actually executed versus skipped.
- [ ] **6. Commit:** `feat(api): serve contract document versions and page evidence within scope`.

## Task 7: Contract document consultation

**Files:** create web API helper and three components from File Map; modify `components/contract-source/contract-source-panel.tsx`, `lib/contract-source-api.ts` only if needed, and `app/globals.css` for justified semantic layout rules; create `tests/e2e/contract-documents.spec.ts`, `tests/helpers/contract-documents.ts`. Preserve existing source tests.

**Interfaces:** `ContractDocumentsSection({externalId, state}: {externalId: string; state: SourcePartState})`; helpers `getContractDocuments`, `getDocumentVersions`, `getDocumentPages` take contract/document/version ids, URL pagination and AbortSignal; `documentFileUrl` constructs the scoped file URL. Types mirror Task 6 response contracts. `DocumentVersions` and `DocumentPages` receive narrow typed props, keeping stateful leaves small.

- [ ] **1. Write failing browser tests.** List a stored PDF with source/date and open/download its scoped copy, choose an old version and inspect page text, then follow original source link. Display pending/failed/restricted/unsupported states, useful empty states and last valid copy after a failed recheck. A mixed PDF identifies unreadable page 2 without claiming an obligation is absent. API failure offers retry and keeps prior content. Switching contract/version while a request is pending never displays the stale response. Add 390px and 360px overflow/action visibility tests and light/dark/system coverage.
- [ ] **2. Run RED:** `pnpm test:e2e tests/e2e/contract-documents.spec.ts` against an isolated running stack with explicit `E2E_BASE_URL`; expect missing UI behavior.
- [ ] **3. Implement consultation.** Replace only the generic `files` renderer with the document section; other source parts stay intact. Read local source file metadata even before discovery has run, without duplicate rows once discovered. A failed file-list refresh retains prior document evidence and labels freshness independently. Reuse `Loading`, `ErrorState`, `Empty`, `Pager`, existing tables and shadcn disclosures. `DocumentPages` renders plain text with a visible physical page reference; no `dangerouslySetInnerHTML`. Use source dates, exact version capture date and extraction gaps. Product labels include “Cópia armazenada”, “Captura pendente”, “Última tentativa de download falhou”, “Formato não suportado”, “Acesso restrito” and “Texto desta página ainda não disponível”. No risk scores or technical OCR jargon.
- [ ] **4. Implement request/pagination behavior.** API helper owns fetch; AbortController cancels stale requests. Preserve selected document/version/page in URL query parameters, clear stale page/selection when changing contract, paginate in SQL. All essential actions remain visible on small screens. Introduce no new web runtime dependency.
- [ ] **5. Verify GREEN:** `pnpm --filter @contracts/web lint`, `pnpm --filter @contracts/web build`, `pnpm test:e2e tests/e2e/contract-documents.spec.ts tests/e2e/contracts.spec.ts tests/e2e/appearance.spec.ts`. Complete `docs/ui-rules.md` §8 manually for keyboard/focus, all states, 360/1440px and themes; record evidence in commit body.
- [ ] **6. Commit:** `feat(web): consult stored contract documents and page references`.

## Task 8: Complete ingestion-to-consultation verification and roadmap documentation

**Files:** extend document ETL/API/browser integration tests as needed; modify `README.md`, `apps/etl/README.md`, `docs/api-contract.md`, and roadmap step 5 in `docs/superpowers/specs/2026-11-07-institutional-copilot-design.md`.

**Interfaces:** consume all earlier task interfaces without introducing new feature scope. Record run commands and verification results in this plan's execution notes.

- [ ] **1. Add/run a failing cross-process acceptance test** if not already covered: a local test source fixture is captured by the Go document command, stored in the shared directory and read by the authenticated API/browser with the same version/page identifiers. API-only seeded success does not prove the ingestion flow. Use test-only injectable source/dialer seams; never loosen production URL validation for fixtures.
- [ ] **2. Exercise A/A/B/A and source removal end-to-end.** Assert three revisions, two blobs, old version still opens, removed listing retains evidence; run normalization again and repeat reads. Confirm source downtime and extraction failure preserve last good data. Denied-user requests must fail through the running HTTP stack.
- [ ] **3. Run required checks once at completion.** `pnpm test`, `pnpm lint`, `pnpm build`, API integration suite, `go test -race ./... -count=1` in ETL with isolated PostgreSQL and Poppler available, and relevant browser specs from Task 7. Capture exit codes and report environmental blocks honestly; tests skipped for missing dependencies are not passes.
- [ ] **4. Document operation and limitations.** Include initial backfill, single-contract/UG command, offline re-extraction, named-volume backup/restore, storage growth/no automatic deletion, unsupported downloads and scan/text limitations. Mark step 5 complete only after acceptance checks; keep step 6 queue and later institutional analysis pending.
- [ ] **5. Commit:** `docs: describe public document ingestion and verified consultation flow`.

## Execution Notes

- The user approved the design on 2026-11-08. No product implementation has started in this plan commit.
- Existing uncommitted ETL mapping/tests and programmer briefing changes belong to the user; preserve them. Execute in an isolated branch/worktree and never stage unrelated files.
- This is one vertical feature with sequential interfaces. The intended implementation branch is `feat/public-document-store`; use worktree isolation at execution time.
- Plan self-review: durable schema/storage → Task 1; metadata discovery/provenance → Task 2; capture/failures/pacing → Task 3; page text/versioned extraction → Task 4; daily/CLI/configuration → Task 5; authorization/read APIs → Task 6; consultation/states/accessibility → Task 7; full-flow verification/backups/roadmap → Task 8. Review Focus items are assigned to the tests named above.
