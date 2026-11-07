-- Raw replica of public sources (Contratos.gov.br first). Written only by the
-- Go replicator (apps/etl, cmd/replicator); the API only reads these tables.
CREATE SCHEMA public_sources;

CREATE TABLE public_sources.source_pacing (
    source text PRIMARY KEY CHECK (btrim(source) <> ''),
    last_request_at timestamptz,
    blocked_until timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    rate_limited_until timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    interval_ms integer NOT NULL CHECK (interval_ms BETWEEN 100 AND 600000),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public_sources.source_pacing (source, interval_ms) VALUES ('CONTRATOS_GOV_BR', 1000);
COMMENT ON TABLE public_sources.source_pacing IS 'Persistent per-source request spacing and cooldown shared by replicator processes using this database. Written by the replicator only.';

CREATE TABLE public_sources.capture_runs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL CHECK (btrim(source) <> ''),
    trigger text NOT NULL CHECK (trigger IN ('MANUAL', 'SCHEDULED', 'REQUESTED')),
    target_type text NOT NULL CHECK (target_type IN ('MANAGEMENT_UNIT', 'CONTRACT')),
    target_code text NOT NULL CHECK (btrim(target_code) <> ''),
    status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
    request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    captured_count integer NOT NULL DEFAULT 0 CHECK (captured_count >= 0),
    unchanged_count integer NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
    not_found_count integer NOT NULL DEFAULT 0 CHECK (not_found_count >= 0),
    failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    error text,
    etl_version text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CHECK ((status = 'RUNNING') = (finished_at IS NULL))
);
CREATE INDEX capture_runs_target_idx ON public_sources.capture_runs (source, target_type, target_code, started_at DESC);
COMMENT ON TABLE public_sources.capture_runs IS 'One row per replicator sync execution. Written by the replicator only.';

CREATE TABLE public_sources.captures (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL CHECK (btrim(source) <> ''),
    resource text NOT NULL CHECK (btrim(resource) <> ''),
    request_key text NOT NULL CHECK (btrim(request_key) <> ''),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    payload jsonb NOT NULL,
    first_captured_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    first_run_id bigint NOT NULL REFERENCES public_sources.capture_runs(id),
    last_run_id bigint NOT NULL REFERENCES public_sources.capture_runs(id),
    UNIQUE (source, request_key, content_hash)
);
CREATE INDEX captures_latest_idx ON public_sources.captures (source, request_key, last_seen_at DESC);
COMMENT ON TABLE public_sources.captures IS 'Distinct canonical JSON contents received per source request. Same content is stored once; last_seen_at moves forward. Written by the replicator only.';

CREATE TABLE public_sources.capture_attempts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES public_sources.capture_runs(id),
    source text NOT NULL CHECK (btrim(source) <> ''),
    resource text NOT NULL CHECK (btrim(resource) <> ''),
    request_key text NOT NULL CHECK (btrim(request_key) <> ''),
    outcome text NOT NULL CHECK (outcome IN ('CAPTURED', 'UNCHANGED', 'NOT_FOUND', 'FAILED')),
    http_status integer,
    capture_id bigint REFERENCES public_sources.captures(id),
    error text,
    attempted_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((capture_id IS NOT NULL) = (outcome IN ('CAPTURED', 'UNCHANGED')))
);
CREATE INDEX capture_attempts_key_idx ON public_sources.capture_attempts (source, request_key, attempted_at DESC);
CREATE INDEX capture_attempts_run_idx ON public_sources.capture_attempts (run_id);
COMMENT ON TABLE public_sources.capture_attempts IS 'One row per source request made by the replicator, including failures and not-found responses. Written by the replicator only.';

CREATE VIEW public_sources.latest_captures AS
SELECT DISTINCT ON (source, request_key) *
FROM public_sources.captures
ORDER BY source, request_key, last_seen_at DESC, id DESC;
COMMENT ON VIEW public_sources.latest_captures IS 'Most recently seen content per source request key.';
