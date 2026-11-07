-- Typed Contratos.gov.br contract snapshots rebuilt by the Go replicator from
-- public_sources.latest_captures. Written only by the replicator; the API reads.

CREATE FUNCTION public_sources.contract_number_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT NULLIF(regexp_replace(regexp_replace(upper(value), '\s', '', 'g'), '^0+(\d)', '\1'), '')
$$;
COMMENT ON FUNCTION public_sources.contract_number_key(text) IS 'Comparable contract number: upper case, no whitespace, no leading zeros in the first digit run. Shared by the replicator and the API to match app contracts.';

CREATE TABLE public_sources.contracts (
    source text NOT NULL CHECK (btrim(source) <> ''),
    external_id bigint NOT NULL CHECK (external_id > 0),
    number text NOT NULL CHECK (btrim(number) <> ''),
    number_key text GENERATED ALWAYS AS (public_sources.contract_number_key(number)) STORED,
    managing_unit_code text NOT NULL CHECK (btrim(managing_unit_code) <> ''),
    origin_unit_code text,
    purchase_unit_code text,
    agency_code text,
    supplier_type text,
    supplier_document text,
    supplier_name text,
    type_code text,
    type_name text,
    category text,
    process_number text,
    object text,
    modality text,
    bidding_number text,
    legal_basis text,
    signature_date date,
    publication_date date,
    start_date date,
    end_date date,
    initial_value numeric(24,6),
    global_value numeric(24,6),
    installment_count integer,
    installment_value numeric(24,6),
    accumulated_value numeric(24,6),
    status text,
    header_resource text NOT NULL CHECK (header_resource IN ('contract', 'contracts_active_by_unit', 'contracts_inactive_by_unit')),
    captured_at timestamptz NOT NULL,
    normalized_at timestamptz NOT NULL DEFAULT now(),
    source_data jsonb NOT NULL,
    PRIMARY KEY (source, external_id)
);
CREATE INDEX contracts_identity_idx ON public_sources.contracts (managing_unit_code, number_key);
COMMENT ON TABLE public_sources.contracts IS 'Latest normalized header of each Contratos.gov.br contract. managing_unit_code matches the app Contract.uasg. Written by the replicator only.';

CREATE TABLE public_sources.contract_amendments (
    source text NOT NULL,
    external_id bigint NOT NULL,
    contract_external_id bigint NOT NULL,
    number text,
    type_code text,
    type_name text,
    qualifications text[] NOT NULL DEFAULT '{}',
    observation text,
    signature_date date,
    publication_date date,
    start_date date,
    end_date date,
    initial_value numeric(24,6),
    global_value numeric(24,6),
    new_global_value numeric(24,6),
    installment_count integer,
    installment_value numeric(24,6),
    new_installment_count integer,
    new_installment_value numeric(24,6),
    new_value_start_date date,
    contract_status text,
    source_data jsonb NOT NULL,
    PRIMARY KEY (source, external_id),
    FOREIGN KEY (source, contract_external_id) REFERENCES public_sources.contracts (source, external_id) ON DELETE CASCADE
);
CREATE INDEX contract_amendments_contract_idx ON public_sources.contract_amendments (source, contract_external_id);
COMMENT ON TABLE public_sources.contract_amendments IS 'Contract history terms (original contract, amendments, apostilles) from Contratos.gov.br historico. Snapshot per contract.';

CREATE TABLE public_sources.contract_guarantees (
    source text NOT NULL,
    external_id bigint NOT NULL,
    contract_external_id bigint NOT NULL,
    guarantee_type text,
    amount numeric(24,6),
    due_date date,
    source_data jsonb NOT NULL,
    PRIMARY KEY (source, external_id),
    FOREIGN KEY (source, contract_external_id) REFERENCES public_sources.contracts (source, external_id) ON DELETE CASCADE
);
CREATE INDEX contract_guarantees_contract_idx ON public_sources.contract_guarantees (source, contract_external_id);
COMMENT ON TABLE public_sources.contract_guarantees IS 'Contract guarantees from Contratos.gov.br. Snapshot per contract.';

CREATE TABLE public_sources.contract_responsibles (
    source text NOT NULL,
    external_id bigint NOT NULL,
    contract_external_id bigint NOT NULL,
    responsible_name text NOT NULL,
    masked_document text,
    role text,
    installation text,
    ordinance text,
    status text,
    start_date date,
    end_date date,
    source_data jsonb NOT NULL,
    PRIMARY KEY (source, external_id),
    FOREIGN KEY (source, contract_external_id) REFERENCES public_sources.contracts (source, external_id) ON DELETE CASCADE
);
CREATE INDEX contract_responsibles_contract_idx ON public_sources.contract_responsibles (source, contract_external_id);
COMMENT ON TABLE public_sources.contract_responsibles IS 'Contract managers and inspectors from Contratos.gov.br. Documents are stored masked only. Snapshot per contract.';

CREATE TABLE public_sources.contract_items (
    source text NOT NULL,
    external_id bigint NOT NULL,
    contract_external_id bigint NOT NULL,
    item_type text,
    material_type text,
    group_name text,
    catalog_item text,
    description text,
    quantity numeric(24,6),
    unit_value numeric(24,6),
    total_value numeric(24,6),
    purchase_item_number text,
    start_date date,
    history jsonb NOT NULL DEFAULT '[]',
    source_data jsonb NOT NULL,
    PRIMARY KEY (source, external_id),
    FOREIGN KEY (source, contract_external_id) REFERENCES public_sources.contracts (source, external_id) ON DELETE CASCADE
);
CREATE INDEX contract_items_contract_idx ON public_sources.contract_items (source, contract_external_id);
COMMENT ON TABLE public_sources.contract_items IS 'Contract items from Contratos.gov.br. Snapshot per contract.';

CREATE TABLE public_sources.contract_invoices (
    source text NOT NULL,
    external_id bigint NOT NULL,
    contract_external_id bigint NOT NULL,
    invoice_type text,
    billing_instrument text,
    number text,
    series text,
    issue_date date,
    deadline_date date,
    due_date date,
    liquidation_date date,
    amount numeric(24,6),
    interest numeric(24,6),
    fine numeric(24,6),
    disallowance numeric(24,6),
    net_amount numeric(24,6),
    status text,
    reference_month integer,
    reference_year integer,
    source_data jsonb NOT NULL,
    PRIMARY KEY (source, external_id),
    FOREIGN KEY (source, contract_external_id) REFERENCES public_sources.contracts (source, external_id) ON DELETE CASCADE
);
CREATE INDEX contract_invoices_contract_idx ON public_sources.contract_invoices (source, contract_external_id);
COMMENT ON TABLE public_sources.contract_invoices IS 'Contract invoices (billing instruments) from Contratos.gov.br. Snapshot per contract.';

CREATE TABLE public_sources.contract_commitments (
    source text NOT NULL,
    external_id bigint NOT NULL,
    contract_external_id bigint NOT NULL,
    unit_code text NOT NULL,
    management_code text NOT NULL,
    number text NOT NULL,
    transparency_code text GENERATED ALWAYS AS (unit_code || management_code || number) STORED,
    issue_date date,
    creditor text,
    resource_source text,
    work_program text,
    internal_plan text,
    expense_nature text,
    committed numeric(24,6),
    to_liquidate numeric(24,6),
    liquidated numeric(24,6),
    paid numeric(24,6),
    rp_registered numeric(24,6),
    rp_to_liquidate numeric(24,6),
    rp_liquidated numeric(24,6),
    rp_paid numeric(24,6),
    source_data jsonb NOT NULL,
    PRIMARY KEY (source, external_id),
    FOREIGN KEY (source, contract_external_id) REFERENCES public_sources.contracts (source, external_id) ON DELETE CASCADE
);
CREATE INDEX contract_commitments_contract_idx ON public_sources.contract_commitments (source, contract_external_id);
CREATE INDEX contract_commitments_transparency_idx ON public_sources.contract_commitments (transparency_code);
COMMENT ON TABLE public_sources.contract_commitments IS 'Commitments (empenhos) linked to each contract by Contratos.gov.br. transparency_code matches finance.commitment_references.document_code. Snapshot per contract.';

CREATE TABLE public_sources.contract_files (
    source text NOT NULL,
    external_id bigint NOT NULL,
    contract_external_id bigint NOT NULL,
    file_type text,
    description text,
    url text,
    origin text,
    sei_link text,
    process_number text,
    source_data jsonb NOT NULL,
    PRIMARY KEY (source, external_id),
    FOREIGN KEY (source, contract_external_id) REFERENCES public_sources.contracts (source, external_id) ON DELETE CASCADE
);
CREATE INDEX contract_files_contract_idx ON public_sources.contract_files (source, contract_external_id);
COMMENT ON TABLE public_sources.contract_files IS 'Metadata of public files attached to each contract. Files themselves are not downloaded yet. Snapshot per contract.';

CREATE TABLE public_sources.contract_parts (
    source text NOT NULL,
    contract_external_id bigint NOT NULL,
    part text NOT NULL CHECK (part IN ('header', 'history', 'commitments', 'guarantees', 'responsibles', 'items', 'invoices', 'files')),
    status text NOT NULL CHECK (status IN ('AVAILABLE', 'NOT_FOUND', 'FAILED', 'MISSING')),
    captured_at timestamptz,
    last_attempt_at timestamptz,
    last_error text,
    row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    PRIMARY KEY (source, contract_external_id, part),
    FOREIGN KEY (source, contract_external_id) REFERENCES public_sources.contracts (source, external_id) ON DELETE CASCADE
);
COMMENT ON TABLE public_sources.contract_parts IS 'Freshness of each part of a normalized contract: AVAILABLE, NOT_FOUND (source has none), FAILED (last attempt failed; rows come from the previous good capture) or MISSING (never captured).';
