-- Institution-level movements can retain management identity while the Portal
-- leaves both organization hierarchy codes empty. Keep missing codes unknown.
ALTER TABLE finance.monthly_execution
    ALTER COLUMN superior_organ_code DROP NOT NULL,
    ALTER COLUMN subordinate_agency_code DROP NOT NULL;
