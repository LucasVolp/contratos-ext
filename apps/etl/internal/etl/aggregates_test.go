package etl

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/text/encoding/charmap"
)

func aggregateOptions(dataset string) Options {
	value, scope := "2026-09-01", "MANAGEMENT"
	if dataset == AnnualBudget {
		value, scope = "2026-01-01", "SUBORDINATE_AGENCY"
	}
	date, _ := time.Parse("2006-01-02", value)
	return Options{Dataset: dataset, Date: date, File: "aggregate.zip", ScopeType: scope, Codes: []string{"26421"}, Trigger: "MANUAL"}
}

func monthlyRow() Row {
	return Row{"Ano e mês do lançamento": "2026/09", "Código Gestão": "26421", "Código Unidade Gestora": "015814",
		"Nome Unidade Gestora": "Unidade de Educação", "Nome Gestão": "Instituto",
		"Código Órgão Superior": "26000", "Código Órgão Subordinado": "26421", "Código Ação": "20RL",
		"Código Categoria Econômica": "3", "Código Grupo de Despesa": "3", "Código Elemento de Despesa": "30",
		"Valor Empenhado (R$)": "0,10", "Valor Pago (R$)": "0,10"}
}

func annualRow() Row {
	return Row{"EXERCÍCIO": "2026", "CÓDIGO ÓRGÃO SUPERIOR": "26000", "CÓDIGO ÓRGÃO SUBORDINADO": "26421",
		"CÓDIGO UNIDADE ORÇAMENTÁRIA": "26421", "CÓDIGO FUNÇÃO": "12", "CÓDIGO SUBFUNÇÃO": "363",
		"CÓDIGO PROGRAMA ORÇAMENTÁRIO": "5012", "CÓDIGO AÇÃO": "20RL", "CÓDIGO CATEGORIA ECONÔMICA": "3",
		"CÓDIGO GRUPO DE DESPESA": "3", "CÓDIGO ELEMENTO DE DESPESA": "30",
		"ORÇAMENTO INICIAL (R$)": "0,10", "ORÇAMENTO ATUALIZADO (R$)": "0,20", "ORÇAMENTO EMPENHADO (R$)": "0,10"}
}

func cloneRow(row Row, changes Row) Row {
	copy := Row{}
	for k, v := range row {
		copy[k] = v
	}
	for k, v := range changes {
		copy[k] = v
	}
	return copy
}

func writeAggregateFixture(t *testing.T, opts Options, rows []Row, omit string) string {
	t.Helper()
	spec := specification(opts)
	keys := map[string]bool{spec.periodColumn: true}
	for _, header := range spec.dimensions {
		keys[header] = true
	}
	for _, header := range spec.amounts {
		keys[header] = true
	}
	for _, row := range rows {
		for header := range row {
			keys[header] = true
		}
	}
	delete(keys, omit)
	headers := sortedKeys(keys)
	buffer := &bytes.Buffer{}
	writer := csv.NewWriter(buffer)
	writer.Comma = ';'
	if err := writer.Write(headers); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		values := make([]string, len(headers))
		for i, header := range headers {
			values[i] = row[header]
		}
		if err := writer.Write(values); err != nil {
			t.Fatal(err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		t.Fatal(err)
	}
	encoded, err := charmap.Windows1252.NewEncoder().Bytes(buffer.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(t.TempDir(), "aggregate.zip")
	file, err := os.Create(filename)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	member, err := archive.Create(spec.member)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := member.Write(encoded); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return filename
}

func TestAggregateOptionsAndPeriodBoundaries(t *testing.T) {
	for _, sample := range []struct{ dataset, end string }{{MonthlyExecution, "2026-09-30"}, {AnnualBudget, "2026-12-31"}} {
		options := aggregateOptions(sample.dataset)
		if err := options.Validate(); err != nil {
			t.Fatal(err)
		}
		_, end := options.period()
		if end.Format("2006-01-02") != sample.end {
			t.Fatal("wrong audit period")
		}
		options.ScopeType = "MANAGEMENT_UNIT"
		options.Codes = []string{"015814"}
		if sample.dataset == AnnualBudget && options.Validate() == nil {
			t.Fatal("annual budget accepted a campus scope")
		}
	}
	options := aggregateOptions(MonthlyExecution)
	options.Date = options.Date.AddDate(0, 0, 1)
	if options.Validate() == nil {
		t.Fatal("monthly period accepted a non-first day")
	}
	options = aggregateOptions(AnnualBudget)
	options.Date = options.Date.AddDate(0, 1, 0)
	if options.Validate() == nil {
		t.Fatal("annual period accepted February")
	}
}

func TestAnnualGroupingPreservesActualBudgetClassification(t *testing.T) {
	opts := aggregateOptions(AnnualBudget)
	row := annualRow()
	rows := []Row{row, cloneRow(row, Row{"ORÇAMENTO INICIAL (R$)": "0,20", "sourceExtra": "a separate source detail"}),
		cloneRow(row, Row{"CÓDIGO CATEGORIA ECONÔMICA": "4"})}
	opts.File = writeAggregateFixture(t, opts, rows, "")
	data, err := ReadAggregate(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	groups, err := groupAggregates(opts, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 2 {
		t.Fatal("different economic categories collapsed")
	}
	for _, group := range groups {
		if valueOf(group.values, "economic_category_code") == "3" {
			if valueOf(group.values, "initial_budget") != "0.3" || len(group.rows) != 2 {
				t.Fatal("annual rows were not summed exactly")
			}
			if valueOf(group.values, "executed_budget") != nil {
				t.Fatal("unknown annual amount became zero")
			}
		}
		if valueOf(group.values, "action_code") != "20RL" {
			t.Fatal("lost alphanumeric action")
		}
		if valueOf(group.values, "management_unit_code") != nil || valueOf(group.values, "expense_nature_code") != nil {
			t.Fatal("manufactured a campus or nature absent from the annual source")
		}
	}
}

func TestMonthlyNullableDimensionsAndScope(t *testing.T) {
	opts := aggregateOptions(MonthlyExecution)
	row := monthlyRow()
	rows := []Row{row, cloneRow(row, Row{"Valor Empenhado (R$)": "0,20", "Código Autor Emenda": "-1"}),
		cloneRow(row, Row{"Código Modalidade da Despesa": "90"}),
		cloneRow(row, Row{"Código Categoria Econômica": "4"}),
		cloneRow(row, Row{"Código Unidade Gestora": "158148"})}
	opts.ScopeType, opts.Codes = "MANAGEMENT_UNIT", []string{"015814"}
	opts.File = writeAggregateFixture(t, opts, rows, "")
	data, err := ReadAggregate(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	groups, err := groupAggregates(opts, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Rows) != 4 || len(groups) != 3 {
		t.Fatal("scope or nullable classification grouping failed")
	}
	found := false
	for _, group := range groups {
		if len(group.rows) == 2 {
			found = valueOf(group.values, "committed_value_brl") == "0.3" && valueOf(group.values, "amendment_author_code") == nil
		}
	}
	if !found {
		t.Fatal("missing classifications were not normalized before grouping")
	}
}

func TestAggregateArchiveRejectsMissingColumnsAndWrongPeriods(t *testing.T) {
	for _, dataset := range []string{AnnualBudget, MonthlyExecution} {
		opts := aggregateOptions(dataset)
		row, omit, period := annualRow(), "ORÇAMENTO INICIAL (R$)", "EXERCÍCIO"
		if dataset == MonthlyExecution {
			row, omit, period = monthlyRow(), "Valor Empenhado (R$)", "Ano e mês do lançamento"
		}
		opts.File = writeAggregateFixture(t, opts, []Row{row}, omit)
		if _, err := ReadAggregate(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "missing CSV column") {
			t.Fatalf("accepted incomplete columns: %v", err)
		}
		row[period] = "2025"
		opts.File = writeAggregateFixture(t, opts, []Row{row}, "")
		if _, err := ReadAggregate(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "source period") {
			t.Fatalf("accepted wrong source period: %v", err)
		}
	}
}
