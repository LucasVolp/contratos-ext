-- Contracts are read only from the daily replica (public_sources.contracts).
-- The app keeps just its own internal notes per contract, keyed by the source
-- identity so they survive every daily run and outlive a contract that stops
-- appearing in the source. Written by the API only; the replicator never
-- touches this table.
CREATE TABLE "ContractNote" (
    source text NOT NULL,
    "externalId" bigint NOT NULL,
    notes text NOT NULL CHECK (char_length(notes) <= 10000),
    "updatedById" uuid REFERENCES "User"(id) ON DELETE SET NULL,
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, "externalId")
);
COMMENT ON TABLE "ContractNote" IS 'Internal free-text notes on a replicated contract, keyed by (source, external id) of public_sources.contracts. No foreign key on purpose: notes are kept when the replica row is gone.';
COMMENT ON COLUMN "ContractNote".notes IS 'Trimmed free text, up to 10,000 characters; an empty string means the notes were cleared.';
COMMENT ON COLUMN "ContractNote"."updatedById" IS 'User who last saved the notes; NULL when that user was removed.';

-- Manually registered and Dados Abertos imported contracts are discontinued;
-- their rows and indexes go with the table.
DROP TABLE "Contract";

COMMENT ON TABLE public_sources.contracts IS 'Latest normalized header of each Contratos.gov.br contract. managing_unit_code matches "Institution".uasg, the scope of every app read. Written by the replicator only.';
COMMENT ON FUNCTION public_sources.contract_number_key(text) IS 'Comparable contract number: upper case, no whitespace, no leading zeros in the first digit run. Generates public_sources.contracts.number_key, indexed with managing_unit_code (contracts_identity_idx) to find a contract by unit and number.';
