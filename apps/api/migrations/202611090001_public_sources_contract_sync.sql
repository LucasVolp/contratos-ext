-- Contract sync support. Child rows are keyed per contract because the source
-- shares some records (for example commitments) across contracts, and daily
-- runs group the capture runs of one automatic cycle. Written by the Go
-- replicator only.

ALTER TABLE public_sources.contract_amendments DROP CONSTRAINT contract_amendments_pkey;
ALTER TABLE public_sources.contract_amendments ADD PRIMARY KEY (source, contract_external_id, external_id);
DROP INDEX public_sources.contract_amendments_contract_idx;
ALTER TABLE public_sources.contract_guarantees DROP CONSTRAINT contract_guarantees_pkey;
ALTER TABLE public_sources.contract_guarantees ADD PRIMARY KEY (source, contract_external_id, external_id);
DROP INDEX public_sources.contract_guarantees_contract_idx;
ALTER TABLE public_sources.contract_responsibles DROP CONSTRAINT contract_responsibles_pkey;
ALTER TABLE public_sources.contract_responsibles ADD PRIMARY KEY (source, contract_external_id, external_id);
DROP INDEX public_sources.contract_responsibles_contract_idx;
ALTER TABLE public_sources.contract_items DROP CONSTRAINT contract_items_pkey;
ALTER TABLE public_sources.contract_items ADD PRIMARY KEY (source, contract_external_id, external_id);
DROP INDEX public_sources.contract_items_contract_idx;
ALTER TABLE public_sources.contract_invoices DROP CONSTRAINT contract_invoices_pkey;
ALTER TABLE public_sources.contract_invoices ADD PRIMARY KEY (source, contract_external_id, external_id);
DROP INDEX public_sources.contract_invoices_contract_idx;
ALTER TABLE public_sources.contract_commitments DROP CONSTRAINT contract_commitments_pkey;
ALTER TABLE public_sources.contract_commitments ADD PRIMARY KEY (source, contract_external_id, external_id);
DROP INDEX public_sources.contract_commitments_contract_idx;
ALTER TABLE public_sources.contract_files DROP CONSTRAINT contract_files_pkey;
ALTER TABLE public_sources.contract_files ADD PRIMARY KEY (source, contract_external_id, external_id);
DROP INDEX public_sources.contract_files_contract_idx;

CREATE TABLE public_sources.daily_runs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL CHECK (btrim(source) <> ''),
    status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED')),
    unit_count integer NOT NULL DEFAULT 0 CHECK (unit_count >= 0),
    failed_unit_count integer NOT NULL DEFAULT 0 CHECK (failed_unit_count >= 0),
    error text,
    etl_version text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CHECK ((status = 'RUNNING') = (finished_at IS NULL))
);
COMMENT ON TABLE public_sources.daily_runs IS 'One row per automatic daily sync cycle over all management units. Written by the replicator only.';
COMMENT ON COLUMN public_sources.daily_runs.status IS 'RUNNING until the cycle ends; COMPLETED when every unit was attempted, CANCELLED when stopped by a signal, FAILED when the cycle could not proceed.';
COMMENT ON COLUMN public_sources.daily_runs.unit_count IS 'Management units attempted in the cycle.';
COMMENT ON COLUMN public_sources.daily_runs.failed_unit_count IS 'Management units whose sync or normalization failed in the cycle.';

ALTER TABLE public_sources.capture_runs ADD COLUMN daily_run_id bigint REFERENCES public_sources.daily_runs (id);
COMMENT ON COLUMN public_sources.capture_runs.daily_run_id IS 'Daily cycle that started this capture run; NULL for manual or requested runs.';
