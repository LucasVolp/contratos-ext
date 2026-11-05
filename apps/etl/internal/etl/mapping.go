package etl

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type field struct {
	name  string
	value any
}
type record []field

func text(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func sourceJSON(value any) string { data, _ := json.Marshal(value); return string(data) }

func sourceDate(value string) (string, error) {
	for _, layout := range []string{"02/01/2006", "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.Format("2006-01-02"), nil
		}
	}
	return "", fmt.Errorf("invalid source date %q", value)
}

func positiveInteger(value string) (int, error) {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("invalid positive integer %q", value)
	}
	return parsed, nil
}

var digits = regexp.MustCompile(`^[0-9]+$`)

func natureFromRow(row Row) (string, error) {
	code := row["Código Natureza Despesa Completa"]
	// The real files use MU for multiple classifications and -1 for unknown.
	// Keep the source marker in source_data, not in the expense-nature dimension.
	if code == "MU" || code == "-1" {
		return "", nil
	}
	if code != "" {
		if !digits.MatchString(code) || (len(code) != 6 && len(code) != 8) {
			return "", fmt.Errorf("invalid expense nature %q", code)
		}
		return code, nil
	}
	var parts []string
	for i, column := range []string{"Código Categoria de Despesa", "Código Grupo de Despesa", "Código Modalidade de Aplicação", "Código Elemento de Despesa"} {
		part := row[column]
		if part == "" || part == "MU" || part == "-1" {
			return "", nil
		}
		width := 1
		if i >= 2 {
			width = 2
		}
		if !digits.MatchString(part) || len(part) > width {
			return "", fmt.Errorf("invalid classification %s=%q", column, part)
		}
		parts = append(parts, strings.Repeat("0", width-len(part))+part)
	}
	code = strings.Join(parts, "")
	if sub := row["Código SubElemento de Despesa"]; sub != "" {
		if !digits.MatchString(sub) || len(sub) > 2 {
			return "", fmt.Errorf("invalid subelement %q", sub)
		}
		code += strings.Repeat("0", 2-len(sub)) + sub
	}
	return code, nil
}

func moneyFields(row Row, columns map[string]string, scale int) (record, error) {
	result := record{}
	// Explicit output order keeps generated SQL and diagnostics deterministic.
	for _, column := range sortedKeys(columns) {
		value, err := Decimal(row[columns[column]], 24, scale)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", columns[column], err)
		}
		result = append(result, field{column, value})
	}
	return result, nil
}

func mapDocument(kind Kind, row Row, runID int64) (record, string, error) {
	code := row[documentColumn(kind)]
	unit, management, year, err := documentIdentity(code)
	if err != nil {
		return nil, "", err
	}
	if unit != row["Código Unidade Gestora"] || management != row["Código Gestão"] {
		return nil, "", fmt.Errorf("document scope disagrees with header: %s", code)
	}
	date, err := sourceDate(row["Data Emissão"])
	if err != nil {
		return nil, "", err
	}
	nature, err := natureFromRow(row)
	if err != nil {
		return nil, "", err
	}
	result := record{
		{"resumed_code", text(row[documentColumn(kind)+" Resumido"])},
		{"fiscal_year", year}, {"management_code", management}, {"management_unit_code", unit},
		{"emission_date", date}, {"document_type_code", text(row["Código Tipo Documento"])},
		{"document_type", text(row["Tipo Documento"])}, {"favored_code", text(row["Código Favorecido"])},
		{"favored_name", text(row["Favorecido"])}, {"expense_nature_code", text(nature)},
		{"budget_plan_code", text(row["Código Plano Orçamentário"])},
		{"budget_plan_name", text(row["Plano Orçamentário"])}, {"observation", text(row["Observação"])},
		{"source_data", sourceJSON(row)}, {"ingestion_run_id", runID},
	}
	if kind == Commitments {
		result = append(result, field{"type", text(row["Tipo Empenho"])})
	}
	if kind == Commitments || kind == Payments {
		result = append(result, field{"process_number", text(row["Processo"])})
		noun := "Empenho"
		if kind == Payments {
			noun = "Pagamento"
		}
		amounts, err := moneyFields(row, map[string]string{
			"original_value": "Valor Original do " + noun,
			"value_brl":      "Valor do " + noun + " Convertido pra R$",
		}, 6)
		if err != nil {
			return nil, "", err
		}
		conversion, err := moneyFields(row, map[string]string{"conversion_rate": "Valor Utilizado na Conversão"}, 12)
		if err != nil {
			return nil, "", err
		}
		result = append(append(result, amounts...), conversion...)
	}
	if kind == Payments {
		var value any
		switch strings.ToLower(row["Extraorçamentário"]) {
		case "":
			value = nil
		case "sim", "true", "1":
			value = true
		case "não", "nao", "false", "0":
			value = false
		default:
			return nil, "", fmt.Errorf("invalid extra-budgetary flag %q", row["Extraorçamentário"])
		}
		result = append(result, field{"extra_budgetary", value})
	}
	return result, nature, nil
}

func mapItem(row Row, commitmentID, runID int64) (record, string, error) {
	sequential, err := positiveInteger(row["Sequencial"])
	if err != nil {
		return nil, "", err
	}
	nature, err := natureFromRow(row)
	if err != nil {
		return nil, "", err
	}
	result, err := moneyFields(row, map[string]string{
		"quantity": "Quantidade", "unit_price": "Valor Unitário", "total_value": "Valor Total", "current_value": "Valor Atual",
	}, 6)
	if err != nil {
		return nil, "", err
	}
	result = append(result, field{"commitment_id", commitmentID}, field{"sequential", sequential},
		field{"expense_nature_code", text(nature)}, field{"subitem_code", text(row["Código SubElemento de Despesa"])},
		field{"subitem_description", text(row["SubElemento de Despesa"])}, field{"description", text(row["Descrição"])},
		field{"source_data", sourceJSON(row)}, field{"ingestion_run_id", runID})
	return result, nature, nil
}

func mapHistory(row Row, commitmentID, runID int64, occurrence int) (record, error) {
	sequential, err := positiveInteger(row["Sequencial"])
	if err != nil {
		return nil, err
	}
	date, err := sourceDate(row["Data Operação"])
	if err != nil {
		return nil, err
	}
	if row["Tipo Operação"] == "" {
		return nil, fmt.Errorf("missing operation type")
	}
	result, err := moneyFields(row, map[string]string{"quantity": "Quantidade Item", "unit_price": "Valor Unitário Item", "total_value": "Valor Total Item"}, 6)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(sourceJSON(row)))
	key := hex.EncodeToString(hash[:]) + ":" + strconv.Itoa(occurrence)
	return append(result, field{"commitment_id", commitmentID}, field{"item_sequential", sequential},
		field{"source_key", key}, field{"operation_type", row["Tipo Operação"]}, field{"operation_date", date},
		field{"source_data", sourceJSON(row)}, field{"ingestion_run_id", runID}), nil
}

type impactGroup struct {
	parent      string
	commitment  string
	nature      string
	subitem     any
	description string
	amounts     record
	rows        []Row
}

func groupImpacts(kind Kind, rows []Row) ([]impactGroup, error) {
	groups := map[string]*impactGroup{}
	parentColumn, amountColumn, targetColumn := "Código Pagamento", "Valor Pago (R$)", "paid_value_brl"
	outstandingColumn := "outstanding_value_paid_brl"
	if kind == LiquidationImpacts {
		parentColumn, amountColumn, targetColumn = "Código Liquidação", "Valor Liquidado (R$)", "liquidated_value_brl"
		// Preserve the reference mapping; the raw CSV calls this RP Pagos even for liquidations.
		outstandingColumn = "outstanding_value_liquidated_brl"
	}
	for _, row := range rows {
		if _, _, _, err := documentIdentity(row["Código Empenho"]); err != nil {
			return nil, err
		}
		nature, err := natureFromRow(row)
		if err != nil {
			return nil, err
		}
		var subitem any
		if len(nature) == 8 {
			subitem = nature[6:]
		}
		// Subitem is a description in the portal CSV, not a code.
		key := sourceJSON([]any{row[parentColumn], row["Código Empenho"], text(nature), subitem})
		amounts, err := moneyFields(row, map[string]string{targetColumn: amountColumn,
			"registered_payables_value_brl": "Valor Restos a Pagar Inscritos (R$)",
			"canceled_payables_value_brl":   "Valor Restos a Pagar Cancelado (R$)",
			outstandingColumn:               "Valor Restos a Pagar Pagos (R$)"}, 6)
		if err != nil {
			return nil, err
		}
		group := groups[key]
		if group == nil {
			groups[key] = &impactGroup{row[parentColumn], row["Código Empenho"], nature, subitem, row["Subitem"], amounts, []Row{row}}
			continue
		}
		for i := range amounts {
			group.amounts[i].value, err = addMoney(group.amounts[i].value, amounts[i].value)
			if err != nil {
				return nil, err
			}
		}
		group.rows = append(group.rows, row)
	}
	result := make([]impactGroup, 0, len(groups))
	for _, key := range sortedKeys(groups) {
		result = append(result, *groups[key])
	}
	return result, nil
}
