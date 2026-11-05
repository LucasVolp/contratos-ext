package etl

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"golang.org/x/text/encoding/charmap"
)

func TestExactDecimals(t *testing.T) {
	for _, sample := range []struct {
		input string
		want  any
	}{
		{"", nil}, {"1.234,560000", "1234.56"}, {"-0,10", "-0.1"}, {"+000.200", "0.2"},
		{"999999999999999999,123456", "999999999999999999.123456"}, {"0,000001", "0.000001"},
	} {
		got, err := Decimal(sample.input, 24, 6)
		if err != nil || got != sample.want {
			t.Errorf("Decimal(%q) = %v, %v; want %v", sample.input, got, err, sample.want)
		}
	}
	for _, input := range []string{"NaN", "Infinity", "1e3", "1,234.56", "1.23,45", "0.0000001", "1000000000000000000"} {
		if _, err := Decimal(input, 24, 6); err == nil {
			t.Errorf("accepted invalid or lossy decimal %q", input)
		}
	}
	sum, err := addMoney("0.1", "0.2")
	if err != nil || sum != "0.3" {
		t.Fatalf("inexact sum: %v, %v", sum, err)
	}
}

func testOptions(file string) Options {
	date, _ := time.Parse("2006-01-02", "2026-09-30")
	return Options{File: file, Date: date, ScopeType: "MANAGEMENT", Codes: []string{"26421"}, Trigger: "MANUAL"}
}

func documentRow(kind Kind, code string) Row {
	return Row{documentColumn(kind): code, "Código Gestão": "26421", "Código Unidade Gestora": "015814",
		"Data Emissão": "30/09/2026", "Unidade Gestora": "Unidade de Educação", "Gestão": "Instituto",
		"Código Categoria de Despesa": "3", "Código Grupo de Despesa": "3", "Código Modalidade de Aplicação": "90",
		"Código Elemento de Despesa": "30", "Valor Original do Empenho": "100,00", "Extraorçamentário": "Não"}
}

func dailyFixture() map[Kind][]Row {
	current, old := "015814264212026NE000001", "015814264212025NE000002"
	payment, liquidation := "015814264212026OB000001", "015814264212026NS000001"
	history := Row{"Código Empenho": current, "Sequencial": "1", "Tipo Operação": "INCLUSAO", "Data Operação": "30/09/2026", "Valor Total Item": "10,00"}
	return map[Kind][]Row{
		Commitments:  {documentRow(Commitments, current)},
		Payments:     {documentRow(Payments, payment)},
		Liquidations: {documentRow(Liquidations, liquidation)},
		Items: {
			{"Código Empenho": current, "Sequencial": "1", "Descrição": "Serviço de educação", "Valor Atual": "10,123456", "Quantidade": "1,00"},
			{"Código Empenho": current, "Sequencial": "2", "Valor Atual": "20,00"},
		},
		History: {history, history, {"Código Empenho": current, "Sequencial": "1", "Tipo Operação": "INCLUSAO", "Data Operação": "30/09/2026", "Valor Total Item": "5,00"}},
		PaymentImpacts: {
			{"Código Pagamento": payment, "Código Empenho": old, "Código Natureza Despesa Completa": "33903001", "Subitem": "MATERIAL", "Valor Pago (R$)": "0,10"},
			{"Código Pagamento": payment, "Código Empenho": old, "Código Natureza Despesa Completa": "33903001", "Subitem": "MATERIAL", "Valor Pago (R$)": "0,20"},
		},
		LiquidationImpacts: {{"Código Liquidação": liquidation, "Código Empenho": current, "Código Natureza Despesa Completa": "33903001", "Valor Liquidado (R$)": "80,00"}},
	}
}

func writeFixture(t *testing.T, rows map[Kind][]Row, windows bool, omit Kind, dates ...string) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "daily.zip")
	output, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(output)
	date := "20260930"
	if len(dates) > 0 {
		date = dates[0]
	}
	for _, spec := range dailyFiles {
		if spec.kind == omit {
			continue
		}
		keys := map[string]bool{}
		for _, name := range spec.required {
			keys[name] = true
		}
		for _, row := range rows[spec.kind] {
			for key := range row {
				keys[key] = true
			}
		}
		header := sortedKeys(keys)
		buffer := &bytes.Buffer{}
		csvWriter := csv.NewWriter(buffer)
		csvWriter.Comma = ';'
		if err := csvWriter.Write(header); err != nil {
			t.Fatal(err)
		}
		for _, row := range rows[spec.kind] {
			fields := make([]string, len(header))
			for i, key := range header {
				fields[i] = row[key]
			}
			if err := csvWriter.Write(fields); err != nil {
				t.Fatal(err)
			}
		}
		csvWriter.Flush()
		if err := csvWriter.Error(); err != nil {
			t.Fatal(err)
		}
		data := buffer.Bytes()
		if windows {
			data, err = charmap.Windows1252.NewEncoder().Bytes(data)
			if err != nil {
				t.Fatal(err)
			}
		}
		member, err := archive.Create(date + spec.suffix)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = member.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err = archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err = output.Close(); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestArchiveMatchesPaymentIdentityAndDecodesSource(t *testing.T) {
	for _, windows := range []bool{false, true} {
		file := writeFixture(t, dailyFixture(), windows, Kind(-1))
		data, err := ReadDaily(context.Background(), testOptions(file))
		if err != nil {
			t.Fatal(err)
		}
		if len(data.Rows[PaymentImpacts]) != 2 {
			t.Fatal("lost links to a prior-year commitment")
		}
		if data.Rows[Items][0]["Descrição"] != "Serviço de educação" {
			t.Fatal("incorrect source encoding")
		}
		if len(data.Checksum) != 64 {
			t.Fatal("missing archive checksum")
		}
		options := testOptions(file)
		options.ScopeType, options.Codes = "MANAGEMENT_UNIT", []string{"999999"}
		empty, err := ReadDaily(context.Background(), options)
		if err != nil || len(empty.Rows) != 0 {
			t.Fatalf("scope leaked: %v, %v", empty.Rows, err)
		}
	}
}

func TestArchiveCompletenessAndCancellation(t *testing.T) {
	file := writeFixture(t, dailyFixture(), false, Items)
	if _, err := ReadDaily(context.Background(), testOptions(file)); err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("accepted incomplete archive: %v", err)
	}
	file = writeFixture(t, dailyFixture(), false, Kind(-1))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ReadDaily(ctx, testOptions(file)); !errors.Is(err, context.Canceled) {
		t.Fatalf("ignored cancellation: %v", err)
	}
}

func TestSourceIdentityAndHistoryMultiplicity(t *testing.T) {
	if _, _, _, err := documentIdentity("2025NE000001"); err == nil {
		t.Fatal("short code accepted as global identity")
	}
	opts := testOptions("daily.zip")
	opts.Codes = []string{""}
	if err := opts.Validate(); err == nil {
		t.Fatal("implicit all-institution scope accepted")
	}
	row := dailyFixture()[History][0]
	first, err := mapHistory(row, 1, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	second, err := mapHistory(row, 1, 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	key := func(values record) any {
		for _, field := range values {
			if field.name == "source_key" {
				return field.value
			}
		}
		return nil
	}
	if key(first) == key(second) {
		t.Fatal("identical source occurrences collapsed")
	}
	replay, _ := mapHistory(row, 1, 999, 1)
	if key(first) != key(replay) {
		t.Fatal("history identity depends on import attempt")
	}
	if !reflect.DeepEqual(NormalizeCodes("26421, 26421,26415"), []string{"26415", "26421"}) {
		t.Fatal("scope normalization failed")
	}
}

func TestImpactAggregationAndMissingAmounts(t *testing.T) {
	groups, err := groupImpacts(PaymentImpacts, dailyFixture()[PaymentImpacts])
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 || groups[0].subitem != "01" {
		t.Fatal("incorrect source grouping")
	}
	values := map[string]any{}
	for _, value := range groups[0].amounts {
		values[value.name] = value.value
	}
	if values["paid_value_brl"] != "0.3" || values["registered_payables_value_brl"] != nil {
		t.Fatalf("incorrect aggregate: %v", values)
	}
}

func TestSourceClassificationMarkers(t *testing.T) {
	for _, marker := range []string{"MU", "-1"} {
		row := documentRow(Payments, "015814264212026DF800239")
		row["Código Elemento de Despesa"] = marker
		nature, err := natureFromRow(row)
		if err != nil || nature != "" {
			t.Fatalf("source marker became a nature: %q %v", nature, err)
		}
	}
}
