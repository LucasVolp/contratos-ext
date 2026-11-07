package etl

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"time"
)

type aggregateSpec struct {
	table        string
	member       string
	periodColumn string
	keys         []string
	dimensions   map[string]string
	names        map[string]string
	amounts      map[string]string
	nullable     map[string]bool
}

func annualSpec(opts Options) aggregateSpec {
	return aggregateSpec{
		table: "annual_budgets", member: opts.Date.Format("2006") + "_OrcamentoDespesa.csv", periodColumn: "EXERCÍCIO",
		keys: []string{"source", "fiscal_year", "superior_organ_code", "subordinate_agency_code", "budgetary_unit_code", "function_code", "subfunction_code", "program_code", "action_code", "economic_category_code", "expense_group_code", "expense_element_code"},
		dimensions: map[string]string{
			"superior_organ_code": "CÓDIGO ÓRGÃO SUPERIOR", "subordinate_agency_code": "CÓDIGO ÓRGÃO SUBORDINADO",
			"budgetary_unit_code": "CÓDIGO UNIDADE ORÇAMENTÁRIA", "function_code": "CÓDIGO FUNÇÃO", "subfunction_code": "CÓDIGO SUBFUNÇÃO",
			"program_code": "CÓDIGO PROGRAMA ORÇAMENTÁRIO", "action_code": "CÓDIGO AÇÃO", "economic_category_code": "CÓDIGO CATEGORIA ECONÔMICA",
			"expense_group_code": "CÓDIGO GRUPO DE DESPESA", "expense_element_code": "CÓDIGO ELEMENTO DE DESPESA",
		},
		names: map[string]string{
			"superior_organ_name": "NOME ÓRGÃO SUPERIOR", "subordinate_agency_name": "NOME ÓRGÃO SUBORDINADO",
			"budgetary_unit_name": "NOME UNIDADE ORÇAMENTÁRIA", "function_name": "NOME FUNÇÃO", "subfunction_name": "NOME SUBFUNÇÃO",
			"program_name": "NOME PROGRAMA ORÇAMENTÁRIO", "action_name": "NOME AÇÃO", "economic_category_name": "NOME CATEGORIA ECONÔMICA",
			"expense_group_name": "NOME GRUPO DE DESPESA", "expense_element_name": "NOME ELEMENTO DE DESPESA",
		},
		amounts: map[string]string{"initial_budget": "ORÇAMENTO INICIAL (R$)", "updated_budget": "ORÇAMENTO ATUALIZADO (R$)", "committed_budget": "ORÇAMENTO EMPENHADO (R$)", "executed_budget": "ORÇAMENTO REALIZADO (R$)"},
	}
}

func monthlySpec(opts Options) aggregateSpec {
	return aggregateSpec{
		table: "monthly_execution", member: opts.Date.Format("200601") + "_Despesas.csv", periodColumn: "Ano e mês do lançamento",
		keys: []string{"source", "reference_month", "management_code", "management_unit_code", "superior_organ_code", "subordinate_agency_code", "action_code", "budget_plan_code", "economic_category_code", "expense_group_code", "expense_element_code", "application_modality_code", "federative_unit", "municipality", "amendment_author_code"},
		dimensions: map[string]string{
			"management_code": "Código Gestão", "management_unit_code": "Código Unidade Gestora",
			"superior_organ_code": "Código Órgão Superior", "subordinate_agency_code": "Código Órgão Subordinado",
			"action_code": "Código Ação", "budget_plan_code": "Código Plano Orçamentário",
			"economic_category_code": "Código Categoria Econômica", "expense_group_code": "Código Grupo de Despesa",
			"expense_element_code": "Código Elemento de Despesa", "application_modality_code": "Código Modalidade da Despesa",
			"federative_unit": "UF", "municipality": "Município", "amendment_author_code": "Código Autor Emenda",
		},
		names: map[string]string{
			"superior_organ_name": "Nome Órgão Superior", "subordinate_agency_name": "Nome Órgão Subordinado",
			"action_name": "Nome Ação", "budget_plan_name": "Plano Orçamentário", "economic_category_name": "Nome Categoria Econômica",
			"expense_group_name": "Nome Grupo de Despesa", "expense_element_name": "Nome Elemento de Despesa",
			"application_modality_name": "Modalidade da Despesa", "amendment_author_name": "Nome Autor Emenda",
		},
		amounts: map[string]string{
			"committed_value_brl": "Valor Empenhado (R$)", "liquidated_value_brl": "Valor Liquidado (R$)", "paid_value_brl": "Valor Pago (R$)",
			"registered_payables_value_brl": "Valor Restos a Pagar Inscritos (R$)", "canceled_payables_value_brl": "Valor Restos a Pagar Cancelado (R$)", "outstanding_value_paid_brl": "Valor Restos a Pagar Pagos (R$)",
		},
		nullable: map[string]bool{"budget_plan_code": true, "application_modality_code": true, "federative_unit": true, "municipality": true, "amendment_author_code": true, "management_unit_code": true, "superior_organ_code": true, "subordinate_agency_code": true},
	}
}

func specification(opts Options) aggregateSpec {
	if opts.dataset() == AnnualBudget {
		return annualSpec(opts)
	}
	return monthlySpec(opts)
}

type AggregateData struct {
	Rows     []Row
	Checksum string
}

func ReadAggregate(ctx context.Context, opts Options) (*AggregateData, error) {
	archive, err := openSourceArchive(ctx, opts.File)
	if err != nil {
		return nil, err
	}
	defer archive.file.Close()
	spec := specification(opts)
	member := archive.members[spec.member]
	if member == nil {
		return nil, fmt.Errorf("incomplete %s archive: missing %s", opts.dataset(), spec.member)
	}
	required := []string{spec.periodColumn}
	for _, name := range sortedKeys(spec.dimensions) {
		required = append(required, spec.dimensions[name])
	}
	for _, name := range sortedKeys(spec.amounts) {
		required = append(required, spec.amounts[name])
	}
	data := &AggregateData{Checksum: archive.checksum}
	err = readCSV(ctx, member, required, func(row Row) error {
		if err := matchAggregatePeriod(opts, spec, row); err != nil {
			return err
		}
		selected := opts.selected(row["Código Gestão"], row["Código Unidade Gestora"])
		if opts.dataset() == AnnualBudget {
			selected = opts.selected(row["CÓDIGO ÓRGÃO SUBORDINADO"], "")
		}
		if selected {
			data.Rows = append(data.Rows, row)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", spec.member, err)
	}
	return data, nil
}

func matchAggregatePeriod(opts Options, spec aggregateSpec, row Row) error {
	value := row[spec.periodColumn]
	if opts.dataset() == AnnualBudget {
		if value == opts.Date.Format("2006") {
			return nil
		}
	} else {
		for _, layout := range []string{"2006/01", "2006-01", "200601"} {
			parsed, err := time.Parse(layout, value)
			if err == nil && parsed.Equal(opts.Date) {
				return nil
			}
		}
	}
	return fmt.Errorf("source period %q disagrees with requested %s", value, opts.Date.Format("2006-01-02"))
}

type aggregateGroup struct {
	values record
	rows   []Row
}

func valueOf(values record, name string) any {
	for _, value := range values {
		if value.name == name {
			return value.value
		}
	}
	return nil
}

func mapAggregate(opts Options, spec aggregateSpec, row Row) (record, error) {
	values := record{{"source", Source}}
	if opts.dataset() == AnnualBudget {
		values = append(values, field{"fiscal_year", opts.Date.Year()})
	} else {
		values = append(values, field{"reference_month", opts.Date.Format("2006-01-02")})
		if len(row["Código Gestão"]) != 5 || !digits.MatchString(row["Código Gestão"]) || (row["Código Unidade Gestora"] != "-9" && (len(row["Código Unidade Gestora"]) != 6 || !digits.MatchString(row["Código Unidade Gestora"]))) {
			return nil, fmt.Errorf("invalid monthly management/unit identity")
		}
	}
	for _, name := range sortedKeys(spec.dimensions) {
		raw := row[spec.dimensions[name]]
		if raw == "" && !spec.nullable[name] {
			return nil, fmt.Errorf("missing classification column %s", spec.dimensions[name])
		}
		if name == "management_unit_code" && raw == "-9" {
			raw = ""
		}
		if spec.nullable[name] && raw == "-1" {
			raw = ""
		}
		values = append(values, field{name, text(raw)})
	}
	for _, name := range sortedKeys(spec.names) {
		values = append(values, field{name, text(row[spec.names[name]])})
	}
	amounts, err := moneyFields(row, spec.amounts, 6)
	return append(values, amounts...), err
}

func groupAggregates(opts Options, data *AggregateData) ([]aggregateGroup, error) {
	spec := specification(opts)
	grouped := map[string]*aggregateGroup{}
	for _, row := range data.Rows {
		values, err := mapAggregate(opts, spec, row)
		if err != nil {
			return nil, err
		}
		keyValues := make([]any, len(spec.keys))
		for i, name := range spec.keys {
			keyValues[i] = valueOf(values, name)
		}
		key := sourceJSON(keyValues)
		group := grouped[key]
		if group == nil {
			grouped[key] = &aggregateGroup{values: values, rows: []Row{row}}
			continue
		}
		for i, value := range group.values {
			if _, amount := spec.amounts[value.name]; amount {
				group.values[i].value, err = addMoney(value.value, valueOf(values, value.name))
				if err != nil {
					return nil, fmt.Errorf("aggregate %s: %w", value.name, err)
				}
			}
		}
		group.rows = append(group.rows, row)
	}
	groups := make([]aggregateGroup, 0, len(grouped))
	for _, key := range sortedKeys(grouped) {
		group := grouped[key]
		sort.Slice(group.rows, func(i, j int) bool { return sourceJSON(group.rows[i]) < sourceJSON(group.rows[j]) })
		groups = append(groups, *group)
	}
	return groups, nil
}

func writeAggregates(ctx context.Context, tx *sql.Tx, opts Options, data *AggregateData, runID int64) (int64, error) {
	groups, err := groupAggregates(opts, data)
	if err != nil {
		return 0, err
	}
	spec := specification(opts)
	scopes := map[string][]any{}
	for _, group := range groups {
		if opts.dataset() == AnnualBudget {
			agency := valueOf(group.values, "subordinate_agency_code")
			scopes[agency.(string)] = []any{agency}
		} else {
			management, unit := valueOf(group.values, "management_code"), valueOf(group.values, "management_unit_code")
			scopes[sourceJSON([]any{management, unit})] = []any{management, unit}
			if unit != nil {
				row := group.rows[0]
				_, err := tx.ExecContext(ctx, `INSERT INTO finance.management_units (management_code, code, name, management_name)
                VALUES ($1,$2,$3,$4) ON CONFLICT (management_code, code) DO UPDATE
                SET name = COALESCE(EXCLUDED.name, finance.management_units.name),
                management_name = COALESCE(EXCLUDED.management_name, finance.management_units.management_name), updated_at = now()`,
					management, unit, text(row["Nome Unidade Gestora"]), text(row["Nome Gestão"]))
				if err != nil {
					return 0, err
				}
			}
		}
		values := append(group.values, field{"source_data", sourceJSON(group.rows)}, field{"ingestion_run_id", runID})
		if _, err := upsert(ctx, tx, spec.table, values, spec.keys...); err != nil {
			return 0, err
		}
	}
	// Refresh only represented scopes after a complete, valid extraction. An absent
	// agency/unit is not permission to erase its last successful snapshot.
	for _, key := range sortedKeys(scopes) {
		var query string
		args := []any{Source, opts.Date.Format("2006-01-02"), runID}
		if opts.dataset() == AnnualBudget {
			query = `DELETE FROM finance.annual_budgets WHERE source = $1 AND fiscal_year = extract(year FROM $2::date)::int AND ingestion_run_id <> $3 AND subordinate_agency_code = $4`
		} else {
			query = `DELETE FROM finance.monthly_execution WHERE source = $1 AND reference_month = $2::date AND ingestion_run_id <> $3 AND management_code = $4 AND management_unit_code IS NOT DISTINCT FROM $5`
		}
		args = append(args, scopes[key]...)
		if _, err := tx.ExecContext(ctx, query, args...); err != nil {
			return 0, err
		}
	}
	return int64(len(groups)), nil
}
