-- Official daily archives can contain items without repeating their commitment header.
ALTER TABLE finance.commitment_items
    DROP CONSTRAINT commitment_items_commitment_id_fkey,
    ADD CONSTRAINT commitment_items_commitment_id_fkey
        FOREIGN KEY (commitment_id) REFERENCES finance.commitment_references(id);

-- The source uses -9 (not applicable) for some institution-level payable movements.
-- Preserve their management identity and raw source marker without inventing a unit.
ALTER TABLE finance.monthly_execution
    ALTER COLUMN management_unit_code DROP NOT NULL;
