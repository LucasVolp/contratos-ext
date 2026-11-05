package etl

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/lib/pq"
)

type Result struct {
	RunID            int64  `json:"runId"`
	Status           string `json:"status"`
	ProcessedRecords int64  `json:"processedRecords"`
	Checksum         string `json:"checksum"`
}

func Run(ctx context.Context, db *sql.DB, opts Options) (result Result, failure error) {
	if err := opts.Validate(); err != nil {
		return result, err
	}
	var installed bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM public._sql_migrations WHERE name = $1)`, RequiredMigration).Scan(&installed); err != nil || !installed {
		return result, fmt.Errorf("required migration %s is not installed; run pnpm db:migrate before importing", RequiredMigration)
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return result, err
	}
	defer conn.Close()
	// One source-wide lock serializes overlapping MANAGEMENT and MANAGEMENT_UNIT scopes.
	// A unit-scoped lock alone would not conflict with its encompassing management scope.
	if _, err = conn.ExecContext(ctx, "SELECT pg_advisory_lock(4100, 14134)"); err != nil {
		return result, err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, unlockErr := conn.ExecContext(cleanup, "SELECT pg_advisory_unlock(4100, 14134)"); unlockErr != nil {
			// A pooled session must never retain a lock after this importer returns.
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
			failure = errors.Join(failure, fmt.Errorf("release import lock: %w", unlockErr))
		}
	}()
	date := opts.Date.Format("2006-01-02")
	err = conn.QueryRowContext(ctx, `INSERT INTO finance.ingestion_runs
        (type, source, source_file, period_start, period_end, scope_type, scope_codes, trigger_type, status, etl_version)
        VALUES ('DAILY_EXPENSES',$1,$2,$3,$3,$4,$5,$6,'IN_PROGRESS',$7) RETURNING id`,
		Source, filepath.Base(opts.File), date, opts.ScopeType, pq.Array(opts.Codes), opts.Trigger, Version).Scan(&result.RunID)
	if err != nil {
		return result, err
	}
	defer func() {
		if failure == nil {
			return
		}
		result.Status = "FAILURE"
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, auditErr := conn.ExecContext(cleanup, `UPDATE finance.ingestion_runs
            SET status = 'FAILURE', error = $2, finished_at = now() WHERE id = $1`, result.RunID, failure.Error()); auditErr != nil {
			failure = errors.Join(failure, fmt.Errorf("record failed import: %w", auditErr))
		}
	}()
	data, err := ReadDaily(ctx, opts)
	if err != nil {
		return result, err
	}
	result.Checksum = data.Checksum
	if _, err = conn.ExecContext(ctx, "UPDATE finance.ingestion_runs SET checksum_sha256 = $2 WHERE id = $1", result.RunID, data.Checksum); err != nil {
		return result, err
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	count, err := writeDaily(ctx, tx, data, result.RunID)
	if err != nil {
		return result, err
	}
	result.Status = "SUCCESS"
	if len(data.Rows) == 0 {
		result.Status = "NO_DATA"
	}
	if _, err = tx.ExecContext(ctx, `UPDATE finance.ingestion_runs SET status = $2, processed_records = $3, finished_at = now() WHERE id = $1`, result.RunID, result.Status, count); err != nil {
		return result, err
	}
	if err = tx.Commit(); err != nil {
		return result, err
	}
	result.ProcessedRecords = count
	return result, nil
}
