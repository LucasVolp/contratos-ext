# Public document store — initial design

Date: 2026-11-08
Status: approved by the user on 2026-11-08.
Roadmap: Phase 1, step 5 of `2026-11-07-institutional-copilot-design.md`.

## Intent and user decisions

The user wants documents to support an institution-wide understanding of health
and priorities, beyond answering questions about individual contracts. This step
prepares the evidence foundation: preserved source documents, their provenance,
and text that can later be cited by document version and page.

The user agreed to prepare an initial repository and approved this design.
Implementation defaults below originated with the designer and were accepted
as part of the scope; they are not independently requested product features.

Institutional health assessments, priority rankings and legal interpretation
are later work. A document being absent, inaccessible or unreadable is a coverage
limitation, not evidence that an institutional obligation is missing.

## Current state

- The Go replicator captures the Contratos.gov.br file listing. Normalization
  writes `public_sources.contract_files` with source identifiers, description,
  type, URL, SEI link and raw metadata.
- Normalization deletes and recreates the file snapshot for each contract.
  Persistent document history must not depend on those rows surviving.
- Contract reads enforce registered managing UASGs and the user's existing scope.
- The daily replicator and API currently have no shared document volume.
- No binary capture or per-page extraction pipeline exists yet.

## Initial scope

- Automatically discover public documents listed for replicated contracts of
  registered institutions, including inactive contracts already present locally.
- Download public PDF files, retain immutable bytes, deduplicate content and
  preserve successive versions with their capture provenance.
- Extract text per physical PDF page; identify pages needing OCR.
- Let authorized users list documents and versions, open/download a stored PDF,
  inspect extracted pages and follow the original link from a contract.
- Expose scoped read APIs suitable for future institutional analysis.
- Record processing failures and coverage gaps separately from contract facts.

Out of scope: uploads, OCR execution, embeddings, model calls, classification of
clauses, institutional scores, prioritization dashboards, full-text search UI,
PNCP capture, ingestion of app-generated exports, and step 6's refresh queue.
Non-PDF references retain metadata and an explicit unsupported status.

## Evidence model

Create a separate `documents` schema through API-owned migrations. The Go ETL
owns ingestion; the API only reads and serves the repository.

- `blobs`: content-addressed SHA-256, relative storage key, byte size, detected
  MIME type and creation time. One immutable physical file per hash.
- `documents`: stable logical identity `(source, source_document_id)` using the
  file's upstream external id; current source metadata and discovery times.
  A changed upstream id is a distinct document, even with identical bytes.
- `document_versions`: a new revision when the observed content changes from
  the latest successful version; blob reference, source URL and metadata
  snapshot, capture time and last successful verification time. Observing
  A → B → A creates three revisions referencing two blobs. An unchanged fetch
  updates verification history without adding a revision.
- `contract_documents`: explicit contract source/id associations, first/last
  seen timestamps and whether currently listed. Derive institution scope through
  the registered contract's managing UASG, rather than duplicating institution
  assignments. Do not infer an amendment association from a description.
- `document_attempts`: discovery/download outcomes, timestamps, HTTP status and
  bounded error detail. Failed attempts do not replace the last stored version.
- `extractions` and `pages`: extraction runs per blob and extractor version,
  method, status and error, with one text/status row per page. A failed rerun
  preserves earlier successful output. Text is derived, never original evidence.

Document associations and versions are independent of the disposable
`contract_files` snapshot. A successfully fetched listing that omits a previously
seen file marks it no longer listed; failed or missing listings do not. Neither
case deletes bytes or versions. Repository records remain preserved if contracts
are removed from the replica, but are inaccessible until a current authorized
contract association permits access. A retained association remains sufficient
when the file is no longer listed: the contract must still exist and be
authorized, but `currently_listed` does not control read access. No cascade may
erase evidence history.

Source metadata describes the source's claim, not a verified legal
classification. No criticality, obligation or risk labels are invented here.

## Capture and scheduling

After structured capture and normalization for all registered UASGs complete,
the daily cycle runs a separate document pass. Document errors have their own
summary and never roll back or change structured contract availability.

Provide a one-shot `replicator documents` command over locally normalized file
references, optionally limited to a contract or UASG, so existing replicas can be
backfilled without refetching structured source data. Support re-extraction of
stored PDFs without downloading them again. These commands do not implement a
user-request queue or accept arbitrary user-supplied URLs.

Designer defaults: one download at a time; reuse persistent source-host pacing
and cooldown; a 7-day binary recheck window; retry transient failures on the next
eligible daily pass; 24-hour retry delay for failed references; no automatic
retry for restricted or unsupported files until source metadata changes.
Process never-attempted references before routine rechecks, oldest eligible first,
with a 30-minute document-pass budget so large backlogs resume across cycles.
Expose the remaining eligible count. CLI may override the pass budget.

Prefer the direct file URL; use the SEI link only when no direct URL is supplied.
No browser login or scraping of SEI viewers: a viewer page is recorded as not
directly downloadable. This source adapter initially permits HTTPS downloads
from the Contratos.gov.br host and explicit operator-configured public hosts.
Validate redirects and resolved addresses too; reject private/local targets.
Restricted source metadata and HTTP 401/403 are recorded without bypass attempts.

Designer defaults: 50 MiB download limit, 60-second request timeout, PDF signature
validation, bounded redirects. A valid PDF signature permits storage; parser
failures affect extraction only, preserving corrupt or encrypted evidence for
download. Responses without a PDF signature are not stored as PDF versions.
Stream to a temporary file while
hashing, then atomically publish by hash before committing the version. Unique
constraints and per-document coordination make concurrent CLI/daily runs
idempotent. A crash may leave an unreferenced blob, never a committed version
pointing at a partially written file. Automatic deletion is out of scope.

## Storage and extraction

Use a small storage interface, initially backed by a named Docker volume. The
replicator mounts it read/write; the API mounts it read-only. Configure the root
for non-container commands as well. Storage keys are generated from hashes;
source filenames and URLs never become filesystem paths.

Designer choice: use Poppler command-line tools in the replicator container for
PDF inspection and text extraction. Preserve original bytes and page numbering
(1-based physical PDF pages, not printed page labels). Pin the deployed extractor
through the container build and record the actual tool version.

Inspect and extract with a 120-second process deadline, a 1,000-page ceiling and
a 20 MiB extracted-text ceiling per file. Limits are configurable. Exceeding a
limit records extraction failure while retaining the PDF.

Classify pages as `EXTRACTED` or `NEEDS_OCR` when no usable text is returned;
this is a processing hint, not proof of a scanned page. Mixed PDFs retain all
available text and page-specific gaps. Record document extraction status as
`EXTRACTED`, `PARTIAL`, `NEEDS_OCR` or `FAILED`. Encrypted, corrupt or unsupported
PDFs remain downloadable with an explicit extraction outcome.

## Read access and product behavior

Contract document reads expose stable document/version ids, source metadata,
original link, capture and verification dates, version history, download outcome,
page count and extraction coverage. Page reads identify the precise version,
page number, method and extractor version. Copies and extracted text require
authentication and the same registered-contract/UASG scope as contract detail;
out-of-scope ids return not found, including blob-deduplicated documents.

Use contract-scoped listing and download/page endpoints, checking authorization
on every request. Never expose raw storage keys, arbitrary-path reads, public
volume serving or unscoped hash lookups. For shared documents, access requires
at least one authorized associated contract. Render extracted text as plain text.
Serve PDFs with a safe MIME type and content-disposition filename.

The contract's existing source-file data remains available before binary capture.
Portuguese product copy distinguishes a stored copy, capture pending, last
download failed, unsupported format, restricted access and text needing OCR.
Always keep the date of the last successful copy visible when rechecking fails.
Retained documents no longer listed by the source are identified explicitly.
No institutional conclusions are presented in this step.

Any web implementation must first read `docs/ui-rules.md` and satisfy its §8
checklist, using existing domain/shadcn components, semantic tokens, keyboard
access and 360px layouts. Detailed layout stays with the builder.

## Verification and completion criteria

- Same bytes deduplicate; unchanged observations add no revision; A → B → A
  preserves three observations as revisions and only two physical blobs.
- Normalization reruns and source removal do not delete stored evidence.
- Failed listings do not mark associations removed; failed downloads preserve
  last successful copies, timestamps and text.
- Restart/concurrent-run tests verify idempotency and incomplete-file handling.
- Tests cover multipage/mixed PDFs, malformed/encrypted inputs, extraction
  failures, size/time limits and re-extraction without network access.
- Scoped API tests cover listing, versions, download and page text, including
  shared blobs across institutions and removed contract associations.
- Download tests cover redirects, blocked hosts/addresses, restricted responses,
  non-PDF HTML and upstream pacing/cooldown.
- Backfill and daily ingestion produce visible processing summaries and retain
  useful structured data even when every document fails.
- Compose smoke verification demonstrates the ETL writes files the API can read;
  document the need to back up both database and named volume together.
- End-to-end verification checks stored copy access, origin/date, version history,
  text gaps and source failures; run the UI checklist for changed screens.

## Left to the builder

Exact columns/indexes and endpoint/component decomposition; storage interface
signatures; detailed error codes; test fixtures; bounded extraction subprocess
implementation and container resource controls. Preserve the access model and
observable outcomes above.

## Future institutional analysis

Future analysis can combine contract facts and financial execution with versioned,
page-citable document evidence across authorized units. Institution-wide coverage
must accompany any assessment: missing or unreadable documents cannot silently
be treated as healthy contracts. A later design must establish prioritization
criteria with the user, rather than embedding guessed criteria in ingestion.
