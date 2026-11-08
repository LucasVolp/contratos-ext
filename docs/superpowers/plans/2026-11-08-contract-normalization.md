# Contract Normalization Implementation Plan (Phase 1, Step 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the raw Contratos.gov.br captures from step 1 into typed tables the API can read: contracts, amendments, guarantees, responsible staff, items, invoices, commitments and file metadata. Each contract also gets a per-part freshness record.

**Architecture:** A new migration adds typed tables to the replicator-owned `public_sources` schema, plus a SQL function `contract_number_key` that normalizes contract numbers. The API will reuse that function in step 2b to match its own `Contract` rows. A new Go package `internal/normalize` parses source values (Brazilian money, dot decimals, mixed date shapes, masked documents) and maps each resource. Its `Normalizer` rebuilds one contract at a time, in a single transaction, from `public_sources.latest_captures`. The replicator CLI gains `normalize`, and `sync` normalizes what it captured.

**Tech Stack:** Go 1.24, `database/sql` + `lib/pq`, PostgreSQL 16, SQL migrations run by `apps/api/src/migrate.ts`.

**Spec:** `docs/superpowers/specs/2026-11-07-institutional-copilot-design.md`, sections 4.1, 4.2, 4.4 and 4.8, plus the roadmap (section 5, Phase 1 step 2). Step 2b (`docs/superpowers/plans/2026-11-08-contract-enrichment-api-web.md`) consumes the tables created here.

## Prerequisite

Branch `feat/contract-normalization` is stacked on `feat/replicator-foundation` (PR #2). Execute in the worktree `.claude/worktrees/contract-normalization`. If PR #2 merges first, rebase onto `main`.

## Global Constraints

- English for every technical artifact (`AGENTS.md`). Source field names stay as the source spells them, and appear only inside mapping code and `source_data`.
- The Go program never creates schema objects. The migration lives in `apps/api/migrations/` and is owned by the API runner.
- Only the replicator writes `public_sources`. Typed rows are rebuilt from `public_sources.latest_captures` and never fetched from the network by the normalizer.
- Money is never parsed through floating point. Values are stored as `numeric(24,6)`.
- Do not modify the finance ETL (`internal/etl`, `cmd/etl`).
- Commits use conventional style and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Source facts this plan relies on (observed on 2026-11-07/08)

- **Two shapes for one contract.**
  - UG listing items (`/api/contrato/ug/{ug}`, `/inativo/ug/{ug}`) are nested:
    - managing UG at `contratante.orgao.unidade_gestora.codigo`;
    - origin UG at `contratante.orgao_origem.unidade_gestora_origem.codigo`;
    - agency at `contratante.orgao.codigo`;
    - supplier at `fornecedor.{tipo,cnpj_cpf_idgener,nome}`;
    - purchasing unit at `unidade_compra`.
  - `/api/contrato/id/{id}` returns a **one-element array** of a flat object:
    - managing UG at `unidade_codigo`;
    - origin UG at `unidade_origem_codigo`;
    - agency at `orgao_codigo`;
    - supplier document at `fonecedor_cnpj_cpf_idgener` (the source misspells it), supplier name at `fornecedor_nome`, supplier type at `fornecedor_tipo`;
    - legal basis at `fundamento_legal`.
  - Common fields in both shapes: `id, numero, tipo, codigo_tipo, categoria, processo, objeto, modalidade, licitacao_numero, data_assinatura, data_publicacao, vigencia_inicio, vigencia_fim, valor_inicial, valor_global, num_parcelas, valor_parcela, valor_acumulado, situacao, unidade_compra`. The listing has `amparo_legal`.
- **Managing UG = the app's `Contract.uasg`.** The current Dados Abertos import stores the UASG it queried (`codigoUnidadeGestora`), which is the managing UG. In the sample, contract 1057026 has managing UG 158148 and origin UG 158533. This **corrects spec 4.2**, which said origin UG.
- **Number formats.**
  - Money is Brazilian (`"54.793,53"`, `"0,00"`).
  - Item `quantidade` uses a dot decimal (`"750.625"`, `"600.5"`).
  - `num_parcelas` is a JSON number.
- **Date formats.** Dates are `"YYYY-MM-DD"`, `null`, `""`, or an object `{"date":"2021-04-19 15:39:57.000000","timezone_type":3,"timezone":"America/Sao_Paulo"}` (`itens.data_inicio_item`).
- **`responsaveis.usuario`** arrives already masked by the source: `"***.123.456-** - FULL NAME"`.
- **`historico`** includes the original contract row (`tipo` "Contrato" or "Empenho"). `qualificacao_termo` is `null` or an array of `{codigo, descricao}`.
- **`empenhos`** carry `unidade_gestora`, `gestao` and `numero` (`YYYYNE######`). Their concatenation is the Portal da Transparência `document_code` (spec 4.3; the link itself is step 3).

### Designer's calls fixed by this plan

- Typed tables live in `public_sources`. Every table is keyed by `(source, external_id)` using the source's own ids, and child rows reference the contract with `ON DELETE CASCADE`.
- Children are **snapshots**: each normalization of a contract deletes and re-inserts its child rows from the latest captures.
  - When a part's latest attempt failed, the previous good capture still feeds the rows, and the part is marked `FAILED`.
  - When a part has no capture at all, it is `MISSING` and has no rows.
- Header precedence: the latest `contract` capture (`/id`), when one exists; otherwise the newest UG listing capture containing that id.
- A full CPF found in `responsaveis.usuario` (11 digits, defensive) is masked to `***.DDD.DDD-**` before storage. Supplier documents are stored as digits, matching `Contract.supplierDocument`.
- Unparsable dates become NULL and are counted, not fatal. Unparsable money fails the contract's normalization (status `FAILED`, error kept) without stopping the others.

## Review Focus

1. **The latest attempt for a part failed, but an older capture exists.** The rows still reflect the older capture, `contract_parts.status = 'FAILED'`, and `captured_at` is the old `last_seen_at`. The screen must not go empty. Test in Task 4.
2. **Mixed value formats** (`"12.345.678.901.234,56"`, `"0,00"`, `""`, `null`, quantity `"750.625"`) are stored exactly, with no float rounding. Test in Task 1.
3. **Date shapes** (`{"date":…}` object, `"0000-00-00"`, `""`) give a date or NULL and never crash the run. Test in Task 1.
4. **A responsible's `usuario` carrying an unmasked CPF** is stored masked in `contract_responsibles`. Test in Task 2.
5. **A contract known only from a UG listing** (no `/id` capture) normalizes from the listing shape. An id with no header anywhere is skipped and counted. Test in Task 4.

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/api/migrations/202611080001_public_sources_contracts.sql` | Typed contract tables, `contract_parts`, `contract_number_key()` |
| `apps/etl/internal/testdb/testdb.go` | Add `const ContractsMigration` |
| `apps/etl/internal/normalize/values.go` | `Money`, `Decimal`, `Date`, `Digits`, `SplitResponsible` |
| `apps/etl/internal/normalize/contratosgovbr.go` | Row types and mappers for every Contratos.gov.br resource |
| `apps/etl/internal/normalize/store.go` | `Normalizer.Contract`, `Normalizer.Unit`, part status |
| `apps/etl/cmd/replicator/*` | `normalize` command; `sync -normalize` |
| `docs/public-sources-data-model.md`, `apps/etl/README.md`, spec | Documentation and the spec correction |

---

### Task 1: Migration and value parsers

**Files:**
- Create: `apps/api/migrations/202611080001_public_sources_contracts.sql`, `apps/etl/internal/normalize/values.go`
- Modify: `apps/etl/internal/testdb/testdb.go`; `apps/api/test/integration/finance.test.ts` (migration count 7 → 8)
- Test: `apps/etl/internal/normalize/values_test.go`, `apps/etl/internal/normalize/schema_test.go`

**Interfaces:**
- Produces (SQL, all in schema `public_sources`):
  - `contract_number_key(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE`:
    1. `upper`;
    2. remove all whitespace;
    3. strip leading zeros of the first digit run when it starts the string (`'00004/2017'` → `'4/2017'`, `'0000/2020'` → `'0/2020'`);
    4. return NULL for NULL or blank input.
  - `contracts`:
    - key: `source text`, `external_id bigint`, PK `(source, external_id)`;
    - number: `number text NOT NULL`, `number_key text GENERATED ALWAYS AS (public_sources.contract_number_key(number)) STORED`;
    - units: `managing_unit_code text NOT NULL`, `origin_unit_code text`, `purchase_unit_code text`, `agency_code text`;
    - supplier: `supplier_type text`, `supplier_document text`, `supplier_name text`;
    - classification: `type_code text`, `type_name text`, `category text`, `process_number text`, `object text`, `modality text`, `bidding_number text`, `legal_basis text`;
    - dates: `signature_date date`, `publication_date date`, `start_date date`, `end_date date`;
    - values: `initial_value numeric(24,6)`, `global_value numeric(24,6)`, `installment_count integer`, `installment_value numeric(24,6)`, `accumulated_value numeric(24,6)`;
    - `status text`;
    - provenance: `header_resource text NOT NULL CHECK IN ('contract','contracts_active_by_unit','contracts_inactive_by_unit')`, `captured_at timestamptz NOT NULL`, `normalized_at timestamptz NOT NULL DEFAULT now()`, `source_data jsonb NOT NULL`.
    - Index `(managing_unit_code, number_key)`.
  - Child tables. All have `source text`, `external_id bigint`, `contract_external_id bigint NOT NULL`, `source_data jsonb NOT NULL`, PK `(source, external_id)`, FK `(source, contract_external_id)` → `contracts ON DELETE CASCADE`, and an index on `(source, contract_external_id)`:
    - `contract_amendments`:
      - identification: `number text`, `type_code text`, `type_name text`, `qualifications text[] NOT NULL DEFAULT '{}'`, `observation text`;
      - dates: `signature_date date`, `publication_date date`, `start_date date`, `end_date date`;
      - values: `initial_value`, `global_value`, `new_global_value`, `installment_value`, `new_installment_value` (all `numeric(24,6)`), `installment_count integer`, `new_installment_count integer`;
      - `new_value_start_date date`, `contract_status text`.
    - `contract_guarantees`: `guarantee_type text`, `amount numeric(24,6)`, `due_date date`.
    - `contract_responsibles`: `responsible_name text NOT NULL`, `masked_document text`, `role text`, `installation text`, `ordinance text`, `status text`, `start_date date`, `end_date date`.
    - `contract_items`:
      - `item_type text`, `material_type text`, `group_name text`, `catalog_item text`, `description text`;
      - `quantity numeric(24,6)`, `unit_value numeric(24,6)`, `total_value numeric(24,6)`;
      - `purchase_item_number text`, `start_date date`, `history jsonb NOT NULL DEFAULT '[]'`.
    - `contract_invoices`:
      - `invoice_type text`, `billing_instrument text`, `number text`, `series text`;
      - dates: `issue_date date`, `deadline_date date`, `due_date date`, `liquidation_date date`;
      - values: `amount`, `interest`, `fine`, `disallowance`, `net_amount` (all `numeric(24,6)`);
      - `status text`, `reference_month integer`, `reference_year integer`.
    - `contract_commitments`:
      - identification: `unit_code text NOT NULL`, `management_code text NOT NULL`, `number text NOT NULL`, `transparency_code text GENERATED ALWAYS AS (unit_code || management_code || number) STORED`;
      - `issue_date date`, `creditor text`, `resource_source text`, `work_program text`, `internal_plan text`, `expense_nature text`;
      - values: `committed`, `to_liquidate`, `liquidated`, `paid`, `rp_registered`, `rp_to_liquidate`, `rp_liquidated`, `rp_paid` (all `numeric(24,6)`).
      - Index on `transparency_code`.
    - `contract_files`: `file_type text`, `description text`, `url text`, `origin text`, `sei_link text`, `process_number text`.
  - `contract_parts`:
    - `source text`, `contract_external_id bigint`;
    - `part text CHECK IN ('header','history','commitments','guarantees','responsibles','items','invoices','files')`;
    - `status text NOT NULL CHECK IN ('AVAILABLE','NOT_FOUND','FAILED','MISSING')`;
    - `captured_at timestamptz`, `last_attempt_at timestamptz`, `last_error text`, `row_count integer NOT NULL DEFAULT 0`;
    - PK `(source, contract_external_id, part)`, FK to `contracts ON DELETE CASCADE`.
  - Each table gets a `COMMENT ON`.
- Produces (Go):
  - `testdb.ContractsMigration = "202611080001_public_sources_contracts"`. Tests apply `testdb.Migration, testdb.ContractsMigration`.
  - `normalize.Money(v any) (*string, error)`: Brazilian format → plain decimal text. Accepts:
    - a string with `.` thousands and `,` decimal;
    - a string with no separators;
    - a `json.Number`.
    - `nil` and `""` → `nil, nil`.
    - Anything else → error.
  - `normalize.Decimal(v any) (*string, error)`: dot-decimal string or `json.Number` → text. `nil` and `""` → nil.
  - `normalize.Date(v any) (*time.Time, bool)`: returns `(nil, true)` for null/blank and `(nil, false)` for unparsable. Accepts:
    - `"YYYY-MM-DD"`;
    - `"YYYY-MM-DD HH:MM:SS[.ffffff]"`;
    - an object with string `date`.
  - `normalize.Digits(s string) string`.
  - `normalize.Integer(v any) (*int64, error)`: accepts a `json.Number` or a digit string. `nil` and `""` → nil.

- [ ] **Step 1: Write the failing tests**
  - `values_test.go` — `TestMoney`, table-driven:
    - `"54.793,53"` → `"54793.53"`;
    - `"0,00"` → `"0.00"`;
    - `"12.345.678.901.234,56"` → `"12345678901234.56"`;
    - `"1000"` → `"1000"`;
    - `json.Number("6100.5")` → `"6100.5"`;
    - `""` → nil;
    - `nil` → nil;
    - `"abc"` and `"1,2,3"` → error.
  - `TestDecimal`: `"750.625"` → `"750.625"`; `"600.5"` → `"600.5"`; `""` → nil; `"7,5"` → error.
  - `TestDate`:
    - `"2026-11-04"` → 2026-11-04;
    - `"2021-04-19 15:39:57.000000"` → 2021-04-19;
    - `map[string]any{"date":"2021-04-19 15:39:57.000000","timezone_type":json.Number("3")}` → 2021-04-19;
    - `""` and `nil` → `(nil,true)`;
    - `"0000-00-00"` and `"31/12/2020"` → `(nil,false)`.
  - `TestDigitsAndInteger`: `Digits("59.339.070/0001-11") == "59339070000111"`; `Integer(json.Number("12"))` → 12; `Integer("x")` → error.
  - `schema_test.go` — `TestContractNumberKey`, using `testdb.Isolated(t, testdb.Migration, testdb.ContractsMigration)` and selecting `public_sources.contract_number_key($1)`:
    - `'00004/2017'` → `'4/2017'`;
    - `' 4/2017 '` → `'4/2017'`;
    - `'2026ne000234'` → `'2026NE000234'`;
    - `'0000/2020'` → `'0/2020'`;
    - `''` → NULL.
  - `TestContractPartsRejectUnknownPart`: inserting a part `'payments'` fails.

- [ ] **Step 2: Run them to verify they fail**, with `cd apps/etl && ETL_TEST_DATABASE_URL=… go test ./internal/normalize -count=1`. Expected: FAIL (package missing).

- [ ] **Step 3: Write the migration, `values.go` and the `testdb` constant.** Update the migration-count assertion in `apps/api/test/integration/finance.test.ts` from 7 to 8.

- [ ] **Step 4: Run the tests again**, plus `pnpm --filter @contracts/api test:integration`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(sources): add typed contract tables and value parsers`.

---

### Task 2: Resource mappers

**Files:**
- Create: `apps/etl/internal/normalize/contratosgovbr.go`
- Test: `apps/etl/internal/normalize/contratosgovbr_test.go`, `apps/etl/internal/normalize/testdata/*.json`

**Interfaces:**
- Consumes: Task 1 parsers.
- Produces:
  - Row types with exported fields mirroring the Task 1 columns (`*string` for nullable text and decimals, `*time.Time` for dates, `*int64` for integers, `SourceData json.RawMessage`): `Contract`, `Amendment`, `Guarantee`, `Responsible`, `Item`, `Invoice`, `Commitment`, `File`. Each has `ExternalID int64`.
  - `type Mapped struct { BadDates int }`. Mappers add to `BadDates` for every unparsable date.
  - `func MapListingContract(item json.RawMessage, m *Mapped) (Contract, error)`
  - `func MapIDContract(payload json.RawMessage, m *Mapped) (Contract, error)`. The payload is the one-element array; zero or several elements → error.
  - `func MapAmendments(payload json.RawMessage, m *Mapped) ([]Amendment, error)`. `Qualifications` holds the `descricao` values, in order; `null` → empty.
  - `func MapGuarantees(…) ([]Guarantee, error)`, `MapResponsibles(…) ([]Responsible, error)`, `MapItems(…) ([]Item, error)`, `MapInvoices(…) ([]Invoice, error)`, `MapCommitments(…) ([]Commitment, error)`, `MapFiles(…) ([]File, error)`. All take `(payload json.RawMessage, m *Mapped)`.
  - `func SplitResponsible(usuario string) (name string, maskedDocument *string)`:
    - splits on the first `" - "`;
    - a left part matching a fully digit CPF (`\d{3}\.?\d{3}\.?\d{3}-?\d{2}`) is re-masked to `***.DDD.DDD-**` (keeping the middle six digits);
    - an already masked left part is kept;
    - with no separator, the whole string is the name and the document is nil.
  - Every mapper rejects a row whose `id` is missing or not a positive integer, with an error naming the resource.

- [ ] **Step 1: Save fixtures** under `testdata/`, trimmed from the real responses captured on 2026-11-07/08:
  - `listing_item.json` (contract 13847);
  - `id_contract.json` (contract 1057026, one-element array);
  - `historico.json` (one "Termo Aditivo" with `qualificacao_termo` `[{"codigo":5,"descricao":"INFORMATIVO"},{"codigo":1,"descricao":"ACRÉSCIMO / SUPRESSÃO"}]`, plus one "Contrato" row with `null`);
  - `itens.json` (`quantidade "750.625"`, `valortotal "6.755,63"`, `data_inicio_item` object);
  - `faturas.json`; `empenhos.json` (`158345`/`26421`/`2022NE000066`); `garantias.json`; `arquivos.json`;
  - `responsaveis.json` (`"***.123.456-** - RODRIGO EXEMPLO"` plus a synthetic `"123.456.789-01 - MARIA EXEMPLO"`).

  Replace real personal names in fixtures with `EXEMPLO` names.

- [ ] **Step 2: Write the failing tests:**
  - `TestMapListingContract`: `ExternalID 13847`, `Number "00004/2017"`, `ManagingUnitCode "158148"`, `InitialValue "545854.00"`, `GlobalValue "682318.13"`, `InstallmentCount 12`, `StartDate 2017-02-01`, `SupplierDocument "03506307000157"` (or the fixture's digits), `Status "Ativo"`.
  - `TestMapIDContract`:
    - `ExternalID 1057026`, `ManagingUnitCode "158148"`, `OriginUnitCode "158533"`, `SupplierDocument "59339070000111"` (read from `fonecedor_cnpj_cpf_idgener`), `TypeName "Empenho"`;
    - a two-element array → error.
  - `TestMapAmendments`: the qualifications are exactly `["INFORMATIVO","ACRÉSCIMO / SUPRESSÃO"]` and the "Contrato" row has an empty slice.
  - `TestMapItemsKeepsDotQuantity`: `Quantity "750.625"`, `TotalValue "6755.63"`, `StartDate 2021-04-19`, `History` non-empty.
  - `TestMapCommitments`: `UnitCode "158345"`, `ManagementCode "26421"`, `Number "2022NE000066"`, `Committed "54793.53"`, `RPRegistered "660.24"`.
  - `TestMapResponsiblesMasksCPF` (Review Focus 4): the masked fixture keeps `"***.123.456-**"`; the synthetic one becomes `"***.456.789-**"` with name `"MARIA EXEMPLO"`, and the resulting struct's `SourceData` does not contain `"123.456.789-01"`.
  - `TestMappersCountBadDates`: a guarantee with `vencimento "0000-00-00"` → `DueDate nil` and `m.BadDates == 1`.
  - `TestMappersRejectBadMoney`: an invoice with `valor "abc"` → error mentioning `contract_invoices`.

  For `SourceData`, the mapper stores the row's raw JSON. For responsibles only, the `usuario` field inside `SourceData` is replaced by the masked form.

- [ ] **Step 3: Run them to verify they fail**, with `go test ./internal/normalize -run 'TestMap' -count=1`. Expected: FAIL.

- [ ] **Step 4: Implement `contratosgovbr.go`.** Decode with `json.Decoder.UseNumber()`.

- [ ] **Step 5: Run the tests.** Expected: PASS.

- [ ] **Step 6: Commit.** Message: `feat(sources): map Contratos.gov.br resources to typed rows`.

---

### Task 3: Normalizer store

**Files:**
- Create: `apps/etl/internal/normalize/store.go`
- Test: `apps/etl/internal/normalize/store_test.go`

**Interfaces:**
- Consumes: Task 2 mappers; the step 1 tables `captures`, `capture_attempts` and the `latest_captures` view (resource names from `contratosgovbr.ContractResources`).
- Produces:
  - `type Normalizer struct { DB *sql.DB; Source string }`
  - `type ContractResult struct { ExternalID int64; Status string; BadDates int; Error string }`. `Status` is one of `NORMALIZED`, `SKIPPED_NO_HEADER`, `FAILED`.
  - `type Summary struct { Normalized, Skipped, Failed, BadDates int }`. JSON tags `normalized, skipped, failed, badDates`.
  - `func (n *Normalizer) Contract(ctx context.Context, externalID int64) (ContractResult, error)`. It returns an error only for database failures; mapping problems become `Status FAILED` with `Error` set. Steps:
    1. Inside one transaction, take `pg_advisory_xact_lock(hashtext('public_sources.contract:' || $source || ':' || $id))`.
    2. Resolve the header by the precedence in the Designer's calls. With no header: `SKIPPED_NO_HEADER`, and nothing is written.
    3. Upsert `contracts`, with `captured_at` = the header capture's `last_seen_at`.
    4. For each part (`history`, `commitments`, `guarantees`, `responsibles`, `items`, `invoices`, `files`, mapped to resources `contract_history`, … `contract_files`), read the latest capture and the latest attempt for `/api/contrato/{id}/{segment}`:
       - **rows:** from the latest capture if any, else none;
       - **status:**
         - `MISSING` when there is no attempt and no capture;
         - `NOT_FOUND` when the latest attempt is `NOT_FOUND`;
         - `FAILED` when the latest attempt is `FAILED`;
         - `AVAILABLE` otherwise;
       - **times:** `captured_at` = the latest capture's `last_seen_at`; `last_attempt_at` and `last_error` come from the latest attempt.
    5. Delete then insert that part's child rows.
    6. Upsert the `contract_parts` row with `row_count`.
    7. Write a `header` part with `AVAILABLE` and the header's `captured_at`.
    8. On a mapping error, roll back that contract's transaction and return `FAILED`. Previous rows stay intact.
  - `func (n *Normalizer) Unit(ctx context.Context, unit string) (Summary, error)`. Ids come from the union of ids in the latest `contracts_active_by_unit` and `contracts_inactive_by_unit` captures for that UG (deduplicated). It calls `Contract` for each and sums the results.
  - `func (n *Normalizer) All(ctx context.Context) (Summary, error)`: every id appearing in any latest listing or `contract` capture of the source.

- [ ] **Step 1: Write the failing tests.** Use `testdb.Isolated(t, testdb.Migration, testdb.ContractsMigration)`. Seed captures through `capture.Store` (`StartRun` / `Record` with canonicalized Task 2 fixtures), so the test exercises the real step 1 contract.
  - `TestNormalizeContractFromIDCapture`: seed `contract` plus all 7 parts → `NORMALIZED`. Check:
    - `contracts.number_key = '2026NE000234'`;
    - there are 8 `contract_parts` rows, all `AVAILABLE`;
    - `contract_items.quantity = 750.625`;
    - `contract_commitments.transparency_code = '158345264212022NE000066'`.
  - `TestNormalizeContractFromListingOnly` (Review Focus 5, first half): seed only an active listing containing 13847 → `NORMALIZED` with `header_resource = 'contracts_active_by_unit'`, and the 7 parts are `MISSING`.
  - `TestNormalizeSkipsWithoutHeader` (Review Focus 5, second half): id 999 with no captures → `SKIPPED_NO_HEADER`, and `contracts` is empty.
  - `TestNormalizeKeepsLastGoodCaptureOnFailure` (Review Focus 1): seed a guarantees capture with 1 row, normalize, then record a `FAILED` attempt for the same key and normalize again. The guarantee row still exists, `contract_parts.status = 'FAILED'`, `last_error` is set, and `captured_at` is unchanged.
  - `TestNormalizeIsSnapshot`: re-seed items with 1 row instead of 3 → after normalizing, exactly 1 `contract_items` row.
  - `TestNormalizeMappingErrorRollsBack`: an invoice capture with `valor "abc"` → `FAILED`. The rows written by a previous successful normalization are unchanged.
  - `TestNormalizeUnitDeduplicates`: active and inactive listings both contain 13847 → `Summary.Normalized == 1`.

- [ ] **Step 2: Run them to verify they fail**, with `ETL_TEST_DATABASE_URL=… go test ./internal/normalize -run TestNormalize -count=1`. Expected: FAIL.

- [ ] **Step 3: Implement `store.go`.**

- [ ] **Step 4: Run the package tests with race detection**, with `go test -race ./internal/normalize -count=1`. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(sources): normalize captured contracts into typed snapshots`.

---

### Task 4: CLI `normalize`, `sync -normalize`, docs

**Files:**
- Modify: `apps/etl/cmd/replicator/main.go`, `apps/etl/cmd/replicator/plan.go`, `apps/etl/cmd/replicator/main_test.go`
- Modify: `apps/etl/README.md`, `docs/public-sources-data-model.md`, `docs/superpowers/specs/2026-11-07-institutional-copilot-design.md` (section 4.2 identity correction)

**Interfaces:**
- Consumes: `normalize.Normalizer` (Task 3).
- Produces:
  - `replicator normalize -source CONTRATOS_GOV_BR (-unit <UG> | -contract <id> | -all)`. Exactly one target is required. It prints one JSON line `{"normalized":…,"skipped":…,"failed":…,"badDates":…}` and exits 1 when `failed > 0`.
  - `replicator sync … [-normalize=true]` (default true). After a run that is not `FAILED`, it normalizes the run's target (unit → `Normalizer.Unit`, contract → `Normalizer.Contract`). The sync JSON line gains `"normalization": {…Summary}`. A normalization failure does not change the capture run's status, but makes the exit code 1.
  - `requiredMigrations` becomes both migration names. The missing-migration message names the first one missing.
  - `type normalizePlan struct { source, unit string; contractID int64; all bool }` and `func parseNormalize(args []string) (normalizePlan, error)`.

- [ ] **Step 1: Write the failing tests** in `main_test.go`:
  - `TestParseNormalizeValidation`: accepts `-unit 158148`, `-contract 13847`, `-all`; rejects no target, two targets, `-unit 1581`, `-source PNCP`.
  - `TestExecuteSyncNormalizes`: a server like the one in `TestExecuteSyncsContract`, but answering `/api/contrato/id/13847` with a one-element array (the real `/id` shape; the step 1 test answers a bare object, which the normalizer must reject). Assert stdout contains `"normalization":{"normalized":1` and that `public_sources.contracts` has 1 row.
  - `TestExecuteNormalizeWithoutSyncSkips`: `normalize -contract 999` on an empty migrated DB gives exit 0 and `"skipped":1`.
  - `TestExecuteRequiresContractsMigration`: a DB with only the step 1 migration gives exit 1 and a message naming `202611080001_public_sources_contracts`.

- [ ] **Step 2: Run them to verify they fail**, with `ETL_TEST_DATABASE_URL=… go test ./cmd/replicator -count=1`. Expected: FAIL.

- [ ] **Step 3: Implement the CLI changes.**

- [ ] **Step 4: Update the docs:**
  - **Data model doc:** the new tables, part statuses, header precedence and `contract_number_key`.
  - **ETL README:** the `normalize` command and `-normalize`.
  - **Spec 4.2:** replace "origin UG (`unidade_gestora_origem`)" with "managing UG (`contratante.orgao.unidade_gestora` / `unidade_codigo`), which is what the current import stores as `Contract.uasg`". Add the evidence (contract 1057026: managing 158148, origin 158533). Also record that resolution is computed at read time (managing UG plus `contract_number_key`, step 2b), so no Contratos.gov.br id is stored on `Contract`. `Contract.externalId` already holds the PNCP control number.

- [ ] **Step 5: Full verification:**
  - Run `cd apps/etl && go vet ./... && ETL_TEST_DATABASE_URL=… go test -race ./... -count=1`. Expected: PASS.
  - Run `pnpm test` and `pnpm --filter @contracts/api test:integration`. Expected: PASS.
  - Manual smoke test in a throwaway database (create, apply both migrations, run, drop; never the dev database): `go run ./cmd/replicator sync -source CONTRATOS_GOV_BR -contract 1057026`. Expected: `"status":"SUCCEEDED"` and `"normalization":{"normalized":1,…}`, and `public_sources.contract_invoices` has 1 row with `net_amount = 6100.00`.

- [ ] **Step 6: Commit.** Message: `feat(sources): add normalize command and normalize after sync`.
