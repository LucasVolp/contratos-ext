-- Owned by contratos-ext. The Go ETL writes imported data using qualified names.
-- Detailed documents, monthly execution and annual budgets are separate sources.
CREATE SCHEMA finance;

CREATE TABLE finance.management_units (
    management_code text NOT NULL CHECK (management_code ~ '^[0-9]+$'),
    code text NOT NULL CHECK (code ~ '^[0-9]{6}$'),
    name text,
    management_name text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (management_code, code)
);

CREATE TABLE finance.expense_natures (
    code text PRIMARY KEY CHECK (code ~ '^([0-9]{6}|[0-9]{8})$'),
    description text,
    parent_code text REFERENCES finance.expense_natures(code),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((length(code) = 6 AND parent_code IS NULL)
        OR (length(code) = 8 AND parent_code = left(code, 6) AND parent_code IS NOT NULL))
);

CREATE TABLE finance.ingestion_runs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type text NOT NULL CHECK (type IN ('DAILY_EXPENSES', 'MONTHLY_EXECUTION', 'ANNUAL_BUDGET')),
    source text NOT NULL DEFAULT 'TRANSPARENCY_PORTAL' CHECK (btrim(source) <> ''),
    source_file text NOT NULL CHECK (btrim(source_file) <> ''),
    checksum_sha256 text CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
    period_start date NOT NULL,
    period_end date NOT NULL,
    scope_type text NOT NULL CHECK (scope_type IN ('MANAGEMENT', 'MANAGEMENT_UNIT', 'SUBORDINATE_AGENCY')),
    scope_codes text[] NOT NULL CHECK (cardinality(scope_codes) > 0 AND array_position(scope_codes, NULL) IS NULL),
    trigger_type text NOT NULL CHECK (trigger_type IN ('MANUAL', 'SCHEDULED')),
    status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUCCESS', 'FAILURE', 'NO_DATA')),
    etl_version text NOT NULL CHECK (btrim(etl_version) <> ''),
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    processed_records bigint NOT NULL DEFAULT 0 CHECK (processed_records >= 0),
    error text,
    CHECK (period_end >= period_start),
    CHECK ((status = 'IN_PROGRESS' AND finished_at IS NULL)
        OR (status <> 'IN_PROGRESS' AND finished_at >= started_at AND finished_at IS NOT NULL))
);
CREATE INDEX ingestion_runs_period_idx ON finance.ingestion_runs(type, period_start, period_end);
CREATE INDEX ingestion_runs_status_idx ON finance.ingestion_runs(status, started_at);

-- Identity exists independently of the header: payments often arrive first.
CREATE TABLE finance.commitment_references (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL DEFAULT 'TRANSPARENCY_PORTAL' CHECK (btrim(source) <> ''),
    document_code text NOT NULL CHECK (btrim(document_code) <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, document_code)
);

CREATE TABLE finance.commitments (
    id bigint PRIMARY KEY REFERENCES finance.commitment_references(id),
    resumed_code text,
    fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 9999),
    management_code text NOT NULL,
    management_unit_code text NOT NULL,
    emission_date date NOT NULL,
    type text,
    process_number text,
    document_type_code text,
    document_type text,
    favored_code text,
    favored_name text,
    expense_nature_code text REFERENCES finance.expense_natures(code),
    budget_plan_code text,
    budget_plan_name text,
    observation text,
    original_value numeric(24,6),
    value_brl numeric(24,6),
    conversion_rate numeric(24,12),
    source_data jsonb NOT NULL DEFAULT '{}',
    ingestion_run_id bigint NOT NULL REFERENCES finance.ingestion_runs(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (management_code, management_unit_code) REFERENCES finance.management_units(management_code, code)
);
CREATE INDEX commitments_unit_year_idx ON finance.commitments(management_code, management_unit_code, fiscal_year, emission_date);
CREATE INDEX commitments_nature_idx ON finance.commitments(expense_nature_code);
CREATE INDEX commitments_favored_idx ON finance.commitments(favored_code);
CREATE INDEX commitments_ingestion_idx ON finance.commitments(ingestion_run_id);

CREATE TABLE finance.commitment_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    commitment_id bigint NOT NULL REFERENCES finance.commitments(id),
    sequential integer NOT NULL CHECK (sequential > 0),
    expense_nature_code text REFERENCES finance.expense_natures(code),
    subitem_code text,
    subitem_description text,
    description text,
    quantity numeric(24,6),
    unit_price numeric(24,6),
    current_value numeric(24,6),
    current_price numeric(24,6),
    total_value numeric(24,6),
    source_data jsonb NOT NULL DEFAULT '{}',
    ingestion_run_id bigint NOT NULL REFERENCES finance.ingestion_runs(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (commitment_id, sequential)
);
CREATE INDEX commitment_items_nature_idx ON finance.commitment_items(expense_nature_code, commitment_id);
CREATE INDEX commitment_items_ingestion_idx ON finance.commitment_items(ingestion_run_id);

CREATE TABLE finance.commitment_item_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    commitment_id bigint NOT NULL REFERENCES finance.commitment_references(id),
    item_sequential integer NOT NULL CHECK (item_sequential > 0),
    source_key text NOT NULL CHECK (btrim(source_key) <> ''),
    operation_type text NOT NULL CHECK (btrim(operation_type) <> ''),
    operation_date date NOT NULL,
    quantity numeric(24,6),
    unit_price numeric(24,6),
    total_value numeric(24,6),
    source_data jsonb NOT NULL DEFAULT '{}',
    ingestion_run_id bigint NOT NULL REFERENCES finance.ingestion_runs(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (commitment_id, source_key)
);
CREATE INDEX commitment_history_item_idx ON finance.commitment_item_history(commitment_id, item_sequential, operation_date);
CREATE INDEX commitment_history_ingestion_idx ON finance.commitment_item_history(ingestion_run_id);

CREATE TABLE finance.liquidations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL DEFAULT 'TRANSPARENCY_PORTAL' CHECK (btrim(source) <> ''),
    document_code text NOT NULL CHECK (btrim(document_code) <> ''),
    resumed_code text,
    fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 9999),
    management_code text NOT NULL,
    management_unit_code text NOT NULL,
    emission_date date NOT NULL,
    document_type_code text,
    document_type text,
    favored_code text,
    favored_name text,
    expense_nature_code text REFERENCES finance.expense_natures(code),
    budget_plan_code text,
    budget_plan_name text,
    observation text,
    source_data jsonb NOT NULL DEFAULT '{}',
    ingestion_run_id bigint NOT NULL REFERENCES finance.ingestion_runs(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, document_code),
    FOREIGN KEY (management_code, management_unit_code) REFERENCES finance.management_units(management_code, code)
);
CREATE INDEX liquidations_unit_year_idx ON finance.liquidations(management_code, management_unit_code, fiscal_year, emission_date);
CREATE INDEX liquidations_nature_idx ON finance.liquidations(expense_nature_code);
CREATE INDEX liquidations_ingestion_idx ON finance.liquidations(ingestion_run_id);

CREATE TABLE finance.liquidation_commitments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    liquidation_id bigint NOT NULL REFERENCES finance.liquidations(id),
    commitment_id bigint NOT NULL REFERENCES finance.commitment_references(id),
    expense_nature_code text REFERENCES finance.expense_natures(code),
    subitem_code text,
    subitem_description text,
    liquidated_value_brl numeric(24,6),
    registered_payables_value_brl numeric(24,6),
    canceled_payables_value_brl numeric(24,6),
    outstanding_value_liquidated_brl numeric(24,6),
    source_data jsonb NOT NULL DEFAULT '{}',
    ingestion_run_id bigint NOT NULL REFERENCES finance.ingestion_runs(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (liquidation_id, commitment_id, expense_nature_code, subitem_code)
);
CREATE INDEX liquidation_commitments_commitment_idx ON finance.liquidation_commitments(commitment_id, expense_nature_code);
CREATE INDEX liquidation_commitments_nature_idx ON finance.liquidation_commitments(expense_nature_code);
CREATE INDEX liquidation_commitments_ingestion_idx ON finance.liquidation_commitments(ingestion_run_id);

CREATE TABLE finance.payments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL DEFAULT 'TRANSPARENCY_PORTAL' CHECK (btrim(source) <> ''),
    document_code text NOT NULL CHECK (btrim(document_code) <> ''),
    resumed_code text,
    fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 9999),
    management_code text NOT NULL,
    management_unit_code text NOT NULL,
    emission_date date NOT NULL,
    document_type_code text,
    document_type text,
    favored_code text,
    favored_name text,
    expense_nature_code text REFERENCES finance.expense_natures(code),
    budget_plan_code text,
    budget_plan_name text,
    observation text,
    process_number text,
    extra_budgetary boolean,
    original_value numeric(24,6),
    value_brl numeric(24,6),
    conversion_rate numeric(24,12),
    source_data jsonb NOT NULL DEFAULT '{}',
    ingestion_run_id bigint NOT NULL REFERENCES finance.ingestion_runs(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, document_code),
    FOREIGN KEY (management_code, management_unit_code) REFERENCES finance.management_units(management_code, code)
);
CREATE INDEX payments_unit_year_idx ON finance.payments(management_code, management_unit_code, fiscal_year, emission_date);
CREATE INDEX payments_nature_idx ON finance.payments(expense_nature_code);
CREATE INDEX payments_favored_idx ON finance.payments(favored_code);
CREATE INDEX payments_ingestion_idx ON finance.payments(ingestion_run_id);

CREATE TABLE finance.payment_commitments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id bigint NOT NULL REFERENCES finance.payments(id),
    commitment_id bigint NOT NULL REFERENCES finance.commitment_references(id),
    expense_nature_code text REFERENCES finance.expense_natures(code),
    subitem_code text,
    subitem_description text,
    paid_value_brl numeric(24,6),
    registered_payables_value_brl numeric(24,6),
    canceled_payables_value_brl numeric(24,6),
    outstanding_value_paid_brl numeric(24,6),
    source_data jsonb NOT NULL DEFAULT '{}',
    ingestion_run_id bigint NOT NULL REFERENCES finance.ingestion_runs(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (payment_id, commitment_id, expense_nature_code, subitem_code)
);
CREATE INDEX payment_commitments_commitment_idx ON finance.payment_commitments(commitment_id, expense_nature_code);
CREATE INDEX payment_commitments_nature_idx ON finance.payment_commitments(expense_nature_code);
CREATE INDEX payment_commitments_ingestion_idx ON finance.payment_commitments(ingestion_run_id);

-- Annual institutional budget has no campus management unit or application modality.
-- Preserve its actual classification instead of manufacturing a six-digit nature.
CREATE TABLE finance.annual_budgets (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL DEFAULT 'TRANSPARENCY_PORTAL' CHECK (btrim(source) <> ''),
    fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 9999),
    superior_organ_code text NOT NULL,
    superior_organ_name text,
    subordinate_agency_code text NOT NULL,
    subordinate_agency_name text,
    budgetary_unit_code text NOT NULL,
    budgetary_unit_name text,
    function_code text NOT NULL,
    function_name text,
    subfunction_code text NOT NULL,
    subfunction_name text,
    program_code text NOT NULL,
    program_name text,
    action_code text NOT NULL,
    action_name text,
    economic_category_code text NOT NULL,
    economic_category_name text,
    expense_group_code text NOT NULL,
    expense_group_name text,
    expense_element_code text NOT NULL,
    expense_element_name text,
    initial_budget numeric(24,6),
    updated_budget numeric(24,6),
    committed_budget numeric(24,6),
    executed_budget numeric(24,6),
    source_data jsonb NOT NULL DEFAULT '{}',
    ingestion_run_id bigint NOT NULL REFERENCES finance.ingestion_runs(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, fiscal_year, superior_organ_code, subordinate_agency_code,
        budgetary_unit_code, function_code, subfunction_code, program_code,
        action_code, economic_category_code, expense_group_code, expense_element_code)
);
CREATE INDEX annual_budgets_query_idx ON finance.annual_budgets(subordinate_agency_code, fiscal_year, action_code);
CREATE INDEX annual_budgets_ingestion_idx ON finance.annual_budgets(ingestion_run_id);

CREATE TABLE finance.monthly_execution (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL DEFAULT 'TRANSPARENCY_PORTAL' CHECK (btrim(source) <> ''),
    reference_month date NOT NULL CHECK (extract(day FROM reference_month) = 1),
    management_code text NOT NULL,
    management_unit_code text NOT NULL,
    superior_organ_code text NOT NULL,
    superior_organ_name text,
    subordinate_agency_code text NOT NULL,
    subordinate_agency_name text,
    action_code text NOT NULL,
    action_name text,
    budget_plan_code text,
    budget_plan_name text,
    economic_category_code text NOT NULL,
    economic_category_name text,
    expense_group_code text NOT NULL,
    expense_group_name text,
    expense_element_code text NOT NULL,
    expense_element_name text,
    application_modality_code text,
    application_modality_name text,
    federative_unit text,
    municipality text,
    amendment_author_code text,
    amendment_author_name text,
    committed_value_brl numeric(24,6),
    liquidated_value_brl numeric(24,6),
    paid_value_brl numeric(24,6),
    registered_payables_value_brl numeric(24,6),
    canceled_payables_value_brl numeric(24,6),
    outstanding_value_paid_brl numeric(24,6),
    source_data jsonb NOT NULL DEFAULT '{}',
    ingestion_run_id bigint NOT NULL REFERENCES finance.ingestion_runs(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (management_code, management_unit_code) REFERENCES finance.management_units(management_code, code),
    UNIQUE NULLS NOT DISTINCT (source, reference_month, management_code, management_unit_code,
        superior_organ_code, subordinate_agency_code, action_code, budget_plan_code,
        economic_category_code, expense_group_code, expense_element_code,
        application_modality_code, federative_unit, municipality, amendment_author_code)
);
CREATE INDEX monthly_execution_query_idx ON finance.monthly_execution(management_code, management_unit_code, reference_month);
CREATE INDEX monthly_execution_ingestion_idx ON finance.monthly_execution(ingestion_run_id);

-- Application-owned data. Never overwritten by the ETL or presented as official LOA.
CREATE TABLE finance.budget_distributions (
    id uuid PRIMARY KEY,
    fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 1900 AND 9999),
    management_code text NOT NULL,
    management_unit_code text NOT NULL,
    expense_nature_code text NOT NULL REFERENCES finance.expense_natures(code),
    type text NOT NULL CHECK (type IN ('ESTIMATE', 'RELEASE')),
    amount numeric(24,6) NOT NULL,
    observation text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (management_code, management_unit_code) REFERENCES finance.management_units(management_code, code),
    UNIQUE (fiscal_year, management_code, management_unit_code, expense_nature_code, type)
);
CREATE INDEX budget_distributions_nature_idx ON finance.budget_distributions(expense_nature_code);

COMMENT ON SCHEMA finance IS 'Financial execution imported by the Go ETL and internal planning maintained by the API.';
COMMENT ON TABLE finance.commitment_references IS 'Full source identity; links can arrive before the commitment header.';
COMMENT ON TABLE finance.annual_budgets IS 'Institutional annual budget. Budgetary units do not identify management units or campuses.';
COMMENT ON TABLE finance.monthly_execution IS 'Independent aggregate source; never add to daily document totals.';
COMMENT ON TABLE finance.budget_distributions IS 'Internal application planning; not written by the ETL.';
