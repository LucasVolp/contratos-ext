package normalize

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T, name string) json.RawMessage {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func day(d *time.Time) string {
	if d == nil {
		return "<nil>"
	}
	return d.Format(time.DateOnly)
}

func TestMapListingContract(t *testing.T) {
	var m Mapped
	c, err := MapListingContract(fixture(t, "listing_item.json"), &m)
	if err != nil {
		t.Fatal(err)
	}
	if c.ExternalID != 13847 || c.Number != "00004/2017" || c.ManagingUnitCode != "158148" || text(c.OriginUnitCode) != "158148" ||
		text(c.PurchaseUnitCode) != "158147" || text(c.InitialValue) != "545854.00" || text(c.GlobalValue) != "682318.13" ||
		c.InstallmentCount == nil || *c.InstallmentCount != 12 || day(c.StartDate) != "2017-02-01" ||
		text(c.SupplierDocument) != "08273364000157" || text(c.Status) != "Ativo" || text(c.LegalBasis) != "<nil>" {
		t.Fatalf("contract = %+v", c)
	}
	if !strings.Contains(string(c.SourceData), `"numero"`) {
		t.Fatal("source data missing")
	}
}

func TestMapIDContract(t *testing.T) {
	var m Mapped
	c, err := MapIDContract(fixture(t, "id_contract.json"), &m)
	if err != nil {
		t.Fatal(err)
	}
	if c.ExternalID != 1057026 || c.ManagingUnitCode != "158148" || text(c.OriginUnitCode) != "158533" ||
		text(c.SupplierDocument) != "59339070000111" || text(c.TypeName) != "Empenho" || text(c.GlobalValue) != "6100.00" ||
		text(c.LegalBasis) != "LEI 14.133/2021 - Artigo: 74 - Inciso: IV" {
		t.Fatalf("contract = %+v", c)
	}
	two := json.RawMessage(`[` + strings.Trim(string(fixture(t, "id_contract.json")), "[]\n ") + `,` + strings.Trim(string(fixture(t, "id_contract.json")), "[]\n ") + `]`)
	if _, err := MapIDContract(two, &m); err == nil {
		t.Fatal("two-element /id payload accepted")
	}
	if _, err := MapIDContract(json.RawMessage(`{"id":1}`), &m); err == nil {
		t.Fatal("bare object accepted")
	}
}

func TestMapAmendments(t *testing.T) {
	var m Mapped
	rows, err := MapAmendments(fixture(t, "historico.json"), &m)
	if err != nil || len(rows) != 2 {
		t.Fatalf("rows = %d, err = %v", len(rows), err)
	}
	if !slices.Equal(rows[0].Qualifications, []string{"INFORMATIVO", "ACRÉSCIMO / SUPRESSÃO", "VIGÊNCIA"}) {
		t.Fatalf("qualifications = %v", rows[0].Qualifications)
	}
	if rows[1].Qualifications == nil || len(rows[1].Qualifications) != 0 {
		t.Fatalf("null qualifications = %#v", rows[1].Qualifications)
	}
	a := rows[0]
	if a.ContractExternalID != 13847 || text(a.TypeName) != "Termo Aditivo" || day(a.EndDate) != "2020-01-31" ||
		text(a.GlobalValue) != "545854.50" || text(a.NewGlobalValue) != "0.00" || a.InstallmentCount == nil || *a.InstallmentCount != 9 {
		t.Fatalf("amendment = %+v", a)
	}
}

func TestMapItemsKeepsDotQuantity(t *testing.T) {
	var m Mapped
	rows, err := MapItems(fixture(t, "itens.json"), &m)
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows = %d, err = %v", len(rows), err)
	}
	i := rows[0]
	if text(i.Quantity) != "750.625" || text(i.TotalValue) != "6755.63" || text(i.UnitValue) != "1.00" ||
		day(i.StartDate) != "2021-04-19" || !strings.Contains(string(i.History), "48728") || text(i.PurchaseItemNumber) != "00003" {
		t.Fatalf("item = %+v", i)
	}
}

func TestMapCommitments(t *testing.T) {
	var m Mapped
	rows, err := MapCommitments(fixture(t, "empenhos.json"), &m)
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows = %d, err = %v", len(rows), err)
	}
	c := rows[0]
	if c.UnitCode != "158345" || c.ManagementCode != "26421" || c.Number != "2022NE000066" ||
		text(c.Committed) != "54793.53" || text(c.RPRegistered) != "660.24" || day(c.IssueDate) != "2022-04-07" {
		t.Fatalf("commitment = %+v", c)
	}
}

func TestMapInvoicesFilesGuarantees(t *testing.T) {
	var m Mapped
	invoices, err := MapInvoices(fixture(t, "faturas.json"), &m)
	if err != nil || len(invoices) != 1 || text(invoices[0].NetAmount) != "6100.00" || day(invoices[0].DueDate) != "2026-11-18" ||
		text(invoices[0].Status) != "Pendente" || invoices[0].ReferenceMonth != nil {
		t.Fatalf("invoices = %+v, err = %v", invoices, err)
	}
	files, err := MapFiles(fixture(t, "arquivos.json"), &m)
	if err != nil || len(files) != 1 || !strings.HasSuffix(text(files[0].URL), ".pdf") || text(files[0].Origin) != "SEI" {
		t.Fatalf("files = %+v, err = %v", files, err)
	}
	guarantees, err := MapGuarantees(fixture(t, "garantias.json"), &m)
	if err != nil || len(guarantees) != 1 || text(guarantees[0].Amount) != "27292.70" || day(guarantees[0].DueDate) != "2023-04-30" {
		t.Fatalf("guarantees = %+v, err = %v", guarantees, err)
	}
}

func TestMapResponsiblesMasksCPF(t *testing.T) {
	var m Mapped
	rows, err := MapResponsibles(fixture(t, "responsaveis.json"), &m)
	if err != nil || len(rows) != 2 {
		t.Fatalf("rows = %d, err = %v", len(rows), err)
	}
	if text(rows[0].MaskedDocument) != "***.123.456-**" || rows[0].Name != "RODRIGO EXEMPLO" {
		t.Fatalf("masked row = %+v", rows[0])
	}
	if text(rows[1].MaskedDocument) != "***.456.789-**" || rows[1].Name != "MARIA EXEMPLO" || text(rows[1].Role) != "Fiscal Técnico" {
		t.Fatalf("unmasked row = %+v", rows[1])
	}
	if strings.Contains(string(rows[1].SourceData), "123.456.789-01") {
		t.Fatalf("source data kept a full CPF: %s", rows[1].SourceData)
	}
	if name, doc := SplitResponsible("JOSE SEM DOCUMENTO"); name != "JOSE SEM DOCUMENTO" || doc != nil {
		t.Fatalf("no separator = %q, %v", name, doc)
	}
	if _, doc := SplitResponsible("12345678901 - ANA"); text(doc) != "***.456.789-**" {
		t.Fatalf("bare digits = %v", text(doc))
	}
}

func TestMappersCountBadDates(t *testing.T) {
	var m Mapped
	rows, err := MapGuarantees(json.RawMessage(`[{"id":1,"contrato_id":5,"tipo":"Caução","valor":"10,00","vencimento":"0000-00-00"}]`), &m)
	if err != nil || len(rows) != 1 || rows[0].DueDate != nil || m.BadDates != 1 {
		t.Fatalf("rows = %+v, bad = %d, err = %v", rows, m.BadDates, err)
	}
}

func TestMappersRejectBadRows(t *testing.T) {
	var m Mapped
	if _, err := MapInvoices(json.RawMessage(`[{"id":1,"contrato_id":5,"valor":"abc"}]`), &m); err == nil || !strings.Contains(err.Error(), "contract_invoices") {
		t.Fatalf("bad money error = %v", err)
	}
	if _, err := MapItems(json.RawMessage(`[{"contrato_id":5}]`), &m); err == nil || !strings.Contains(err.Error(), "contract_items") {
		t.Fatalf("missing id error = %v", err)
	}
	if _, err := MapCommitments(json.RawMessage(`[{"id":1,"contrato_id":5,"gestao":"26421","numero":"2022NE1"}]`), &m); err == nil {
		t.Fatal("commitment without unit accepted")
	}
	if rows, err := MapFiles(json.RawMessage(`[]`), &m); err != nil || len(rows) != 0 {
		t.Fatalf("empty payload = %v, %v", rows, err)
	}
}
