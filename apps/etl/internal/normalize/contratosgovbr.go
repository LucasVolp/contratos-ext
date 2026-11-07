package normalize

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Mapped collects soft problems found while mapping.
type Mapped struct {
	BadDates int // unparsable dates stored as NULL
}

// Contract is a normalized contract header.
type Contract struct {
	ExternalID                                         int64
	Number                                             string
	ManagingUnitCode                                   string
	OriginUnitCode, PurchaseUnitCode, AgencyCode       *string
	SupplierType, SupplierDocument, SupplierName       *string
	TypeCode, TypeName, Category, ProcessNumber        *string
	Object, Modality, BiddingNumber, LegalBasis        *string
	SignatureDate, PublicationDate, StartDate, EndDate *time.Time
	InitialValue, GlobalValue                          *string
	InstallmentCount                                   *int64
	InstallmentValue, AccumulatedValue                 *string
	Status                                             *string
	SourceData                                         json.RawMessage
}

// Amendment is a contract history term.
type Amendment struct {
	ExternalID, ContractExternalID                     int64
	Number, TypeCode, TypeName                         *string
	Qualifications                                     []string
	Observation                                        *string
	SignatureDate, PublicationDate, StartDate, EndDate *time.Time
	InitialValue, GlobalValue, NewGlobalValue          *string
	InstallmentCount                                   *int64
	InstallmentValue                                   *string
	NewInstallmentCount                                *int64
	NewInstallmentValue                                *string
	NewValueStartDate                                  *time.Time
	ContractStatus                                     *string
	SourceData                                         json.RawMessage
}

// Guarantee is a contract guarantee.
type Guarantee struct {
	ExternalID, ContractExternalID int64
	GuaranteeType, Amount          *string
	DueDate                        *time.Time
	SourceData                     json.RawMessage
}

// Responsible is a contract manager or inspector with a masked document.
type Responsible struct {
	ExternalID, ContractExternalID     int64
	Name                               string
	MaskedDocument, Role, Installation *string
	Ordinance, Status                  *string
	StartDate, EndDate                 *time.Time
	SourceData                         json.RawMessage
}

// Item is a contract item.
type Item struct {
	ExternalID, ContractExternalID                 int64
	ItemType, MaterialType, GroupName, CatalogItem *string
	Description, Quantity, UnitValue, TotalValue   *string
	PurchaseItemNumber                             *string
	StartDate                                      *time.Time
	History                                        json.RawMessage
	SourceData                                     json.RawMessage
}

// Invoice is a contract billing instrument.
type Invoice struct {
	ExternalID, ContractExternalID                    int64
	InvoiceType, BillingInstrument, Number, Series    *string
	IssueDate, DeadlineDate, DueDate, LiquidationDate *time.Time
	Amount, Interest, Fine, Disallowance, NetAmount   *string
	Status                                            *string
	ReferenceMonth, ReferenceYear                     *int64
	SourceData                                        json.RawMessage
}

// Commitment is an empenho linked to a contract.
type Commitment struct {
	ExternalID, ContractExternalID                    int64
	UnitCode, ManagementCode, Number                  string
	IssueDate                                         *time.Time
	Creditor, ResourceSource, WorkProgram             *string
	InternalPlan, ExpenseNature                       *string
	Committed, ToLiquidate, Liquidated, Paid          *string
	RPRegistered, RPToLiquidate, RPLiquidated, RPPaid *string
	SourceData                                        json.RawMessage
}

// File is the metadata of a public contract file.
type File struct {
	ExternalID, ContractExternalID              int64
	FileType, Description, URL, Origin, SeiLink *string
	ProcessNumber                               *string
	SourceData                                  json.RawMessage
}

// fields reads one source row and records the first error.
type fields struct {
	resource string
	data     map[string]any
	mapped   *Mapped
	err      error
}

func (f *fields) fail(format string, args ...any) {
	if f.err == nil {
		f.err = fmt.Errorf("%s: %s", f.resource, fmt.Sprintf(format, args...))
	}
}

func (f *fields) value(path ...string) any {
	var current any = f.data
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}

func (f *fields) text(path ...string) *string {
	switch v := f.value(path...).(type) {
	case string:
		if s := strings.TrimSpace(v); s != "" {
			return &s
		}
	case json.Number:
		s := string(v)
		return &s
	}
	return nil
}

func (f *fields) required(path ...string) string {
	if s := f.text(path...); s != nil {
		return *s
	}
	f.fail("%s is required", strings.Join(path, "."))
	return ""
}

func (f *fields) money(key string) *string {
	v, err := Money(f.value(key))
	if err != nil {
		f.fail("%s: %v", key, err)
	}
	return v
}

func (f *fields) decimal(key string) *string {
	v, err := Decimal(f.value(key))
	if err != nil {
		f.fail("%s: %v", key, err)
	}
	return v
}

func (f *fields) integer(key string) *int64 {
	v, err := Integer(f.value(key))
	if err != nil {
		f.fail("%s: %v", key, err)
	}
	return v
}

func (f *fields) date(key string) *time.Time {
	v, ok := Date(f.value(key))
	if !ok {
		f.mapped.BadDates++
	}
	return v
}

func (f *fields) id(key string) int64 {
	v, err := Integer(f.value(key))
	if err != nil || v == nil || *v <= 0 {
		f.fail("%s must be a positive integer", key)
		return 0
	}
	return *v
}

func (f *fields) digits(path ...string) *string {
	if s := f.text(path...); s != nil {
		d := Digits(*s)
		if d != "" {
			return &d
		}
	}
	return nil
}

func decodeObject(raw json.RawMessage) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var data map[string]any
	if err := decoder.Decode(&data); err != nil || data == nil {
		return nil, fmt.Errorf("expected a JSON object")
	}
	return data, nil
}

// each decodes a JSON array payload and maps every element.
func each[T any](resource string, payload json.RawMessage, m *Mapped, build func(*fields, json.RawMessage) T) ([]T, error) {
	var raws []json.RawMessage
	if err := json.Unmarshal(payload, &raws); err != nil {
		return nil, fmt.Errorf("%s: expected a JSON array: %w", resource, err)
	}
	rows := make([]T, 0, len(raws))
	for i, raw := range raws {
		data, err := decodeObject(raw)
		if err != nil {
			return nil, fmt.Errorf("%s row %d: %w", resource, i, err)
		}
		f := &fields{resource: resource, data: data, mapped: m}
		row := build(f, raw)
		if f.err != nil {
			return nil, fmt.Errorf("row %d: %w", i, f.err)
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func contractCommon(f *fields, c *Contract, raw json.RawMessage) {
	c.ExternalID = f.id("id")
	c.Number = f.required("numero")
	c.TypeCode, c.TypeName, c.Category = f.text("codigo_tipo"), f.text("tipo"), f.text("categoria")
	c.ProcessNumber, c.Object = f.text("processo"), f.text("objeto")
	c.Modality, c.BiddingNumber = f.text("modalidade"), f.text("licitacao_numero")
	c.SignatureDate, c.PublicationDate = f.date("data_assinatura"), f.date("data_publicacao")
	c.StartDate, c.EndDate = f.date("vigencia_inicio"), f.date("vigencia_fim")
	c.InitialValue, c.GlobalValue = f.money("valor_inicial"), f.money("valor_global")
	c.InstallmentCount = f.integer("num_parcelas")
	c.InstallmentValue, c.AccumulatedValue = f.money("valor_parcela"), f.money("valor_acumulado")
	c.Status = f.text("situacao")
	c.PurchaseUnitCode = f.text("unidade_compra")
	c.SourceData = raw
}

// MapListingContract maps one item of a UG contract listing (nested shape).
func MapListingContract(item json.RawMessage, m *Mapped) (Contract, error) {
	data, err := decodeObject(item)
	if err != nil {
		return Contract{}, fmt.Errorf("contract listing item: %w", err)
	}
	f := &fields{resource: "contracts", data: data, mapped: m}
	var c Contract
	contractCommon(f, &c, item)
	c.ManagingUnitCode = f.required("contratante", "orgao", "unidade_gestora", "codigo")
	c.OriginUnitCode = f.text("contratante", "orgao_origem", "unidade_gestora_origem", "codigo")
	c.AgencyCode = f.text("contratante", "orgao", "codigo")
	c.SupplierType, c.SupplierName = f.text("fornecedor", "tipo"), f.text("fornecedor", "nome")
	c.SupplierDocument = f.digits("fornecedor", "cnpj_cpf_idgener")
	c.LegalBasis = f.text("amparo_legal")
	return c, f.err
}

// MapIDContract maps the /api/contrato/id/{id} payload: a one-element array of
// a flat object (the source spells the supplier document key
// "fonecedor_cnpj_cpf_idgener").
func MapIDContract(payload json.RawMessage, m *Mapped) (Contract, error) {
	var raws []json.RawMessage
	if err := json.Unmarshal(payload, &raws); err != nil || len(raws) != 1 {
		return Contract{}, fmt.Errorf("contracts: /id payload must be a one-element array")
	}
	data, err := decodeObject(raws[0])
	if err != nil {
		return Contract{}, fmt.Errorf("contracts: %w", err)
	}
	f := &fields{resource: "contracts", data: data, mapped: m}
	var c Contract
	contractCommon(f, &c, raws[0])
	c.ManagingUnitCode = f.required("unidade_codigo")
	c.OriginUnitCode, c.AgencyCode = f.text("unidade_origem_codigo"), f.text("orgao_codigo")
	c.SupplierType, c.SupplierName = f.text("fornecedor_tipo"), f.text("fornecedor_nome")
	c.SupplierDocument = f.digits("fonecedor_cnpj_cpf_idgener")
	c.LegalBasis = f.text("fundamento_legal")
	return c, f.err
}

// MapAmendments maps a historico payload.
func MapAmendments(payload json.RawMessage, m *Mapped) ([]Amendment, error) {
	return each("contract_amendments", payload, m, func(f *fields, raw json.RawMessage) Amendment {
		qualifications := []string{}
		if list, ok := f.value("qualificacao_termo").([]any); ok {
			for _, entry := range list {
				if object, ok := entry.(map[string]any); ok {
					if description, ok := object["descricao"].(string); ok {
						qualifications = append(qualifications, description)
					}
				}
			}
		}
		return Amendment{
			ExternalID: f.id("id"), ContractExternalID: f.id("contrato_id"),
			Number: f.text("numero"), TypeCode: f.text("codigo_tipo"), TypeName: f.text("tipo"),
			Qualifications: qualifications, Observation: f.text("observacao"),
			SignatureDate: f.date("data_assinatura"), PublicationDate: f.date("data_publicacao"),
			StartDate: f.date("vigencia_inicio"), EndDate: f.date("vigencia_fim"),
			InitialValue: f.money("valor_inicial"), GlobalValue: f.money("valor_global"), NewGlobalValue: f.money("novo_valor_global"),
			InstallmentCount: f.integer("num_parcelas"), InstallmentValue: f.money("valor_parcela"),
			NewInstallmentCount: f.integer("novo_num_parcelas"), NewInstallmentValue: f.money("novo_valor_parcela"),
			NewValueStartDate: f.date("data_inicio_novo_valor"), ContractStatus: f.text("situacao_contrato"),
			SourceData: raw,
		}
	})
}

// MapGuarantees maps a garantias payload.
func MapGuarantees(payload json.RawMessage, m *Mapped) ([]Guarantee, error) {
	return each("contract_guarantees", payload, m, func(f *fields, raw json.RawMessage) Guarantee {
		return Guarantee{ExternalID: f.id("id"), ContractExternalID: f.id("contrato_id"),
			GuaranteeType: f.text("tipo"), Amount: f.money("valor"), DueDate: f.date("vencimento"), SourceData: raw}
	})
}

var (
	fullCPF      = regexp.MustCompile(`^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$`)
	embeddedCPF  = regexp.MustCompile(`\d{3}\.?\d{3}\.?\d{3}-?\d{2}`)
	maskedPrefix = regexp.MustCompile(`^\*{3}\.\d{3}\.\d{3}-\*{2}$`)
)

func maskCPF(cpf string) string {
	d := Digits(cpf)
	return "***." + d[3:6] + "." + d[6:9] + "-**"
}

// SplitResponsible splits "document - NAME". A full CPF is re-masked as
// ***.DDD.DDD-**; an already masked document is kept; without a separator the
// whole value is the name.
func SplitResponsible(usuario string) (string, *string) {
	left, right, found := strings.Cut(usuario, " - ")
	if !found {
		return strings.TrimSpace(embeddedCPF.ReplaceAllStringFunc(usuario, maskCPF)), nil
	}
	left, right = strings.TrimSpace(left), strings.TrimSpace(right)
	switch {
	case fullCPF.MatchString(left):
		masked := maskCPF(left)
		return right, &masked
	case maskedPrefix.MatchString(left):
		return right, &left
	}
	return strings.TrimSpace(embeddedCPF.ReplaceAllStringFunc(usuario, maskCPF)), nil
}

// MapResponsibles maps a responsaveis payload; source_data keeps only the
// masked form of "usuario".
func MapResponsibles(payload json.RawMessage, m *Mapped) ([]Responsible, error) {
	return each("contract_responsibles", payload, m, func(f *fields, _ json.RawMessage) Responsible {
		usuario := ""
		if s := f.text("usuario"); s != nil {
			usuario = *s
		}
		name, document := SplitResponsible(usuario)
		if name == "" {
			f.fail("usuario is required")
		}
		safe := map[string]any{}
		for key, value := range f.data {
			safe[key] = value
		}
		if document != nil {
			safe["usuario"] = *document + " - " + name
		} else {
			safe["usuario"] = name
		}
		source, _ := json.Marshal(safe)
		return Responsible{ExternalID: f.id("id"), ContractExternalID: f.id("contrato_id"), Name: name,
			MaskedDocument: document, Role: f.text("funcao_id"), Installation: f.text("instalacao_id"),
			Ordinance: f.text("portaria"), Status: f.text("situacao"),
			StartDate: f.date("data_inicio"), EndDate: f.date("data_fim"), SourceData: source}
	})
}

// MapItems maps an itens payload; quantities use a dot decimal.
func MapItems(payload json.RawMessage, m *Mapped) ([]Item, error) {
	return each("contract_items", payload, m, func(f *fields, raw json.RawMessage) Item {
		history := json.RawMessage(`[]`)
		if list, ok := f.value("historico_item").([]any); ok {
			history, _ = json.Marshal(list)
		}
		return Item{ExternalID: f.id("id"), ContractExternalID: f.id("contrato_id"),
			ItemType: f.text("tipo_id"), MaterialType: f.text("tipo_material"), GroupName: f.text("grupo_id"),
			CatalogItem: f.text("catmatseritem_id"), Description: f.text("descricao_complementar"),
			Quantity: f.decimal("quantidade"), UnitValue: f.money("valorunitario"), TotalValue: f.money("valortotal"),
			PurchaseItemNumber: f.text("numero_item_compra"), StartDate: f.date("data_inicio_item"),
			History: history, SourceData: raw}
	})
}

// MapInvoices maps a faturas payload.
func MapInvoices(payload json.RawMessage, m *Mapped) ([]Invoice, error) {
	return each("contract_invoices", payload, m, func(f *fields, raw json.RawMessage) Invoice {
		return Invoice{ExternalID: f.id("id"), ContractExternalID: f.id("contrato_id"),
			InvoiceType: f.text("tipolistafatura_id"), BillingInstrument: f.text("tipo_instrumento_cobranca"),
			Number: f.text("numero"), Series: f.text("numero_serie"),
			IssueDate: f.date("emissao"), DeadlineDate: f.date("prazo"), DueDate: f.date("vencimento"),
			LiquidationDate: f.date("data_liquidacao"),
			Amount:          f.money("valor"), Interest: f.money("juros"), Fine: f.money("multa"),
			Disallowance: f.money("glosa"), NetAmount: f.money("valorliquido"), Status: f.text("situacao"),
			ReferenceMonth: f.integer("mesref"), ReferenceYear: f.integer("anoref"), SourceData: raw}
	})
}

// MapCommitments maps an empenhos payload. The contract id comes from the
// caller because commitment rows do not carry it.
func MapCommitments(payload json.RawMessage, m *Mapped) ([]Commitment, error) {
	return each("contract_commitments", payload, m, func(f *fields, raw json.RawMessage) Commitment {
		return Commitment{ExternalID: f.id("id"),
			UnitCode: f.required("unidade_gestora"), ManagementCode: f.required("gestao"), Number: f.required("numero"),
			IssueDate: f.date("data_emissao"), Creditor: f.text("credor"), ResourceSource: f.text("fonte_recurso"),
			WorkProgram: f.text("programa_trabalho"), InternalPlan: f.text("planointerno"), ExpenseNature: f.text("naturezadespesa"),
			Committed: f.money("empenhado"), ToLiquidate: f.money("aliquidar"), Liquidated: f.money("liquidado"), Paid: f.money("pago"),
			RPRegistered: f.money("rpinscrito"), RPToLiquidate: f.money("rpaliquidar"),
			RPLiquidated: f.money("rpliquidado"), RPPaid: f.money("rppago"), SourceData: raw}
	})
}

// MapFiles maps an arquivos payload (metadata only).
func MapFiles(payload json.RawMessage, m *Mapped) ([]File, error) {
	return each("contract_files", payload, m, func(f *fields, raw json.RawMessage) File {
		return File{ExternalID: f.id("id"), ContractExternalID: f.id("contrato_id"),
			FileType: f.text("tipo"), Description: f.text("descricao"), URL: f.text("path_arquivo"),
			Origin: f.text("origem"), SeiLink: f.text("link_sei"), ProcessNumber: f.text("processo"), SourceData: raw}
	})
}
