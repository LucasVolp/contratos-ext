package etl

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// Names and columns come exclusively from the mappings in this package.
// Input values always use PostgreSQL parameters.
func upsert(ctx context.Context, tx *sql.Tx, table string, values record, keys ...string) (int64, error) {
	columns, placeholders, updates, args := []string{}, []string{}, []string{}, []any{}
	for _, value := range values {
		columns = append(columns, value.name)
		args = append(args, value.value)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
		key := false
		for _, name := range keys {
			key = key || name == value.name
		}
		if !key {
			updates = append(updates, value.name+" = EXCLUDED."+value.name)
		}
	}
	updates = append(updates, "updated_at = now()")
	query := "INSERT INTO finance." + table + " (" + strings.Join(columns, ",") + ") VALUES (" + strings.Join(placeholders, ",") + ") " +
		"ON CONFLICT (" + strings.Join(keys, ",") + ") DO UPDATE SET " + strings.Join(updates, ",") + " RETURNING id"
	var id int64
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&id); err != nil {
		return 0, fmt.Errorf("write %s: %w", table, err)
	}
	return id, nil
}

func ensureReference(ctx context.Context, tx *sql.Tx, code string) (int64, error) {
	if _, _, _, err := documentIdentity(code); err != nil {
		return 0, err
	}
	var id int64
	err := tx.QueryRowContext(ctx, `INSERT INTO finance.commitment_references (source, document_code)
        VALUES ($1, $2) ON CONFLICT (source, document_code) DO UPDATE
        SET document_code = EXCLUDED.document_code RETURNING id`, Source, code).Scan(&id)
	return id, err
}

func ensureNature(ctx context.Context, tx *sql.Tx, code string, row Row) error {
	if code == "" {
		return nil
	}
	parent := code[:6]
	_, err := tx.ExecContext(ctx, `INSERT INTO finance.expense_natures (code, description) VALUES ($1, $2)
        ON CONFLICT (code) DO UPDATE SET description = COALESCE(EXCLUDED.description, finance.expense_natures.description), updated_at = now()`, parent, text(row["Elemento de Despesa"]))
	if err != nil {
		return err
	}
	if len(code) == 8 {
		_, err = tx.ExecContext(ctx, `INSERT INTO finance.expense_natures (code, parent_code, description) VALUES ($1, $2, $3)
            ON CONFLICT (code) DO UPDATE SET description = COALESCE(EXCLUDED.description, finance.expense_natures.description), updated_at = now()`, code, parent, text(row["SubElemento de Despesa"]))
	}
	return err
}

func writeDaily(ctx context.Context, tx *sql.Tx, data *DailyData, runID int64) (int64, error) {
	parents := map[Kind]map[string]int64{Commitments: {}, Liquidations: {}, Payments: {}}
	skipped := map[Kind]map[string]bool{Commitments: {}, Liquidations: {}, Payments: {}}
	var count int64
	for _, kind := range []Kind{Commitments, Liquidations, Payments} {
		table := map[Kind]string{Commitments: "commitments", Liquidations: "liquidations", Payments: "payments"}[kind]
		for _, row := range data.Rows[kind] {
			code := row[documentColumn(kind)]
			values, nature, err := mapDocument(kind, row, runID)
			if err != nil {
				return 0, fmt.Errorf("%s %s: %w", table, code, err)
			}
			previousID, newer, err := newerHeader(ctx, tx, kind, code, runID)
			if err != nil {
				return 0, err
			}
			if newer {
				parents[kind][code], skipped[kind][code] = previousID, true
				continue
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO finance.management_units (management_code, code, name, management_name)
                VALUES ($1,$2,$3,$4) ON CONFLICT (management_code, code) DO UPDATE
                SET name = COALESCE(EXCLUDED.name, finance.management_units.name),
                management_name = COALESCE(EXCLUDED.management_name, finance.management_units.management_name), updated_at = now()`,
				row["Código Gestão"], row["Código Unidade Gestora"], text(row["Unidade Gestora"]), text(row["Gestão"]))
			if err != nil {
				return 0, err
			}
			if err = ensureNature(ctx, tx, nature, row); err != nil {
				return 0, err
			}
			var id int64
			if kind == Commitments {
				id, err = ensureReference(ctx, tx, code)
				if err != nil {
					return 0, err
				}
				values = append(values, field{"id", id})
				id, err = upsert(ctx, tx, table, values, "id")
			} else {
				values = append(values, field{"source", Source}, field{"document_code", code})
				id, err = upsert(ctx, tx, table, values, "source", "document_code")
			}
			if err != nil {
				return 0, err
			}
			parents[kind][code] = id
			count++
		}
	}

	// Item snapshots may exist before their header. Preserve newer snapshots even
	// when an older archive is needed to fill in a missing header.
	preserveItems := map[string]bool{}
	itemCodes := map[string]bool{}
	for code := range parents[Commitments] {
		itemCodes[code] = true
	}
	for _, row := range data.Rows[Items] {
		itemCodes[row["Código Empenho"]] = true
	}
	for _, code := range sortedKeys(itemCodes) {
		var newer bool
		err := tx.QueryRowContext(ctx, `SELECT EXISTS (
   SELECT 1 FROM finance.commitment_items i
   JOIN finance.commitment_references r ON r.id = i.commitment_id
   JOIN finance.ingestion_runs previous ON previous.id = i.ingestion_run_id
   JOIN finance.ingestion_runs incoming ON incoming.id = $3
   WHERE r.source = $1 AND r.document_code = $2 AND previous.period_start > incoming.period_start
  )`, Source, code, runID).Scan(&newer)
		if err != nil {
			return 0, err
		}
		_, newerDocument, err := newerHeader(ctx, tx, Commitments, code, runID)
		if err != nil {
			return 0, err
		}
		preserveItems[code] = newer || newerDocument || skipped[Commitments][code]
	}
	seenItems := map[string]int{}
	type itemIdentity struct {
		commitmentID int64
		sequential   any
	}
	representedItems := map[string]itemIdentity{}
	// Sequential values can repeat in the official source. Stable source ordering
	// assigns each occurrence its own slot without collapsing distinct records.
	itemRows := append([]Row(nil), data.Rows[Items]...)
	sort.SliceStable(itemRows, func(i, j int) bool { return sourceJSON(itemRows[i]) < sourceJSON(itemRows[j]) })
	for _, row := range itemRows {
		if preserveItems[row["Código Empenho"]] {
			continue
		}
		id, err := ensureReference(ctx, tx, row["Código Empenho"])
		if err != nil {
			return 0, err
		}
		values, nature, err := mapItem(row, id, runID)
		if err != nil {
			return 0, err
		}
		key := ""
		// mapItem includes a typed sequential field; avoid source '01' vs '1' duplicates.
		for _, value := range values {
			if value.name == "sequential" {
				key = fmt.Sprintf("%d/%v", id, value.value)
				representedItems[key] = itemIdentity{id, value.value}
			}
		}
		seenItems[key]++
		values = append(values, field{"source_ordinal", seenItems[key]})
		if err = ensureNature(ctx, tx, nature, row); err != nil {
			return 0, err
		}
		if _, err = upsert(ctx, tx, "commitment_items", values, "commitment_id", "sequential", "source_ordinal"); err != nil {
			return 0, err
		}
		count++
	}
	// Refresh variants only for represented sequentials; unseen siblings need a header snapshot.
	for _, key := range sortedKeys(representedItems) {
		identity := representedItems[key]
		if _, err := tx.ExecContext(ctx, "DELETE FROM finance.commitment_items WHERE commitment_id = $1 AND sequential = $2 AND ingestion_run_id <> $3", identity.commitmentID, identity.sequential, runID); err != nil {
			return 0, err
		}
	}
	// Only headers present in this complete archive can replace their current item set.
	for _, code := range sortedKeys(parents[Commitments]) {
		if preserveItems[code] {
			continue
		}
		_, err := tx.ExecContext(ctx, "DELETE FROM finance.commitment_items WHERE commitment_id = $1 AND ingestion_run_id <> $2", parents[Commitments][code], runID)
		if err != nil {
			return 0, err
		}
	}
	occurrences := map[string]int{}
	for _, row := range data.Rows[History] {
		id, err := ensureReference(ctx, tx, row["Código Empenho"])
		if err != nil {
			return 0, err
		}
		canonical := sourceJSON(row)
		occurrences[canonical]++
		values, err := mapHistory(row, id, runID, occurrences[canonical])
		if err != nil {
			return 0, err
		}
		if _, err = upsert(ctx, tx, "commitment_item_history", values, "commitment_id", "source_key"); err != nil {
			return 0, err
		}
		count++
	}
	for _, kind := range []Kind{LiquidationImpacts, PaymentImpacts} {
		parentKind, table, parentIDColumn := Payments, "payment_commitments", "payment_id"
		if kind == LiquidationImpacts {
			parentKind, table, parentIDColumn = Liquidations, "liquidation_commitments", "liquidation_id"
		}
		groups, err := groupImpacts(kind, data.Rows[kind])
		if err != nil {
			return 0, err
		}
		for _, group := range groups {
			if skipped[parentKind][group.parent] {
				continue
			}
			ref, err := ensureReference(ctx, tx, group.commitment)
			if err != nil {
				return 0, err
			}
			if err = ensureNature(ctx, tx, group.nature, Row{}); err != nil {
				return 0, err
			}
			values := append(group.amounts,
				field{parentIDColumn, parents[parentKind][group.parent]}, field{"commitment_id", ref},
				field{"expense_nature_code", text(group.nature)}, field{"subitem_code", group.subitem},
				field{"subitem_description", text(group.description)}, field{"source_data", sourceJSON(group.rows)},
				field{"ingestion_run_id", runID})
			if _, err = upsert(ctx, tx, table, values, parentIDColumn, "commitment_id", "expense_nature_code", "subitem_code"); err != nil {
				return 0, err
			}
			count++
		}
		for _, code := range sortedKeys(parents[parentKind]) {
			if skipped[parentKind][code] {
				continue
			}
			_, err = tx.ExecContext(ctx, "DELETE FROM finance."+table+" WHERE "+parentIDColumn+" = $1 AND ingestion_run_id <> $2", parents[parentKind][code], runID)
			if err != nil {
				return 0, err
			}
		}
	}
	return count, nil
}

func newerHeader(ctx context.Context, tx *sql.Tx, kind Kind, code string, runID int64) (int64, bool, error) {
	table := map[Kind]string{Commitments: "commitments", Liquidations: "liquidations", Payments: "payments"}[kind]
	from := "finance." + table + " d"
	condition := "d.source = $1 AND d.document_code = $2"
	if kind == Commitments {
		from += " JOIN finance.commitment_references r ON r.id = d.id"
		condition = "r.source = $1 AND r.document_code = $2"
	}
	var id int64
	var newer bool
	err := tx.QueryRowContext(ctx, "SELECT d.id, previous.period_start > incoming.period_start FROM "+from+
		" JOIN finance.ingestion_runs previous ON previous.id = d.ingestion_run_id"+
		" JOIN finance.ingestion_runs incoming ON incoming.id = $3 WHERE "+condition, Source, code, runID).Scan(&id, &newer)
	if err == sql.ErrNoRows {
		return 0, false, nil
	}
	return id, newer, err
}
