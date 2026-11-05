-- Shared by all Go ETL processes using this database, regardless of dataset/scope.
CREATE TABLE finance.download_state (
    source text PRIMARY KEY CHECK (btrim(source) <> ''),
    last_request_at timestamptz,
    blocked_until timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    rate_limited_until timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    interval_seconds integer NOT NULL DEFAULT 20 CHECK (interval_seconds BETWEEN 20 AND 120),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO finance.download_state (source) VALUES ('TRANSPARENCY_PORTAL');
COMMENT ON TABLE finance.download_state IS 'Persistent request spacing and cooldown shared across ETL processes. Does not coordinate other databases or clients using the same public IP.';
