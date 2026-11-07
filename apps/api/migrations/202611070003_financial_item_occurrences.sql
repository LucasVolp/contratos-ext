-- Official files can repeat a sequential for distinct item rows. Preserve every
-- occurrence in a deterministic source order, including identical repetitions.
ALTER TABLE finance.commitment_items
    ADD COLUMN source_ordinal integer NOT NULL DEFAULT 1 CHECK (source_ordinal > 0),
    DROP CONSTRAINT commitment_items_commitment_id_sequential_key,
    ADD CONSTRAINT commitment_items_identity_key
        UNIQUE (commitment_id, sequential, source_ordinal);
