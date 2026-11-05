package etl

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
)

type Row map[string]string
type Kind int

const (
	Commitments Kind = iota
	Liquidations
	Payments
	Items
	History
	LiquidationImpacts
	PaymentImpacts
)

type fileSpec struct {
	kind     Kind
	suffix   string
	required []string
}

var dailyFiles = []fileSpec{
	{Commitments, "_Despesas_Empenho.csv", []string{"Código Empenho", "Data Emissão", "Código Gestão", "Código Unidade Gestora", "Valor Original do Empenho", "Valor do Empenho Convertido pra R$", "Valor Utilizado na Conversão"}},
	{Liquidations, "_Despesas_Liquidacao.csv", []string{"Código Liquidação", "Data Emissão", "Código Gestão", "Código Unidade Gestora"}},
	{Payments, "_Despesas_Pagamento.csv", []string{"Código Pagamento", "Data Emissão", "Código Gestão", "Código Unidade Gestora", "Valor Original do Pagamento", "Valor do Pagamento Convertido pra R$", "Valor Utilizado na Conversão"}},
	{Items, "_Despesas_ItemEmpenho.csv", []string{"Código Empenho", "Sequencial", "Quantidade", "Valor Unitário", "Valor Total", "Valor Atual"}},
	{History, "_Despesas_ItemEmpenhoHistorico.csv", []string{"Código Empenho", "Sequencial", "Tipo Operação", "Data Operação", "Quantidade Item", "Valor Unitário Item", "Valor Total Item"}},
	{LiquidationImpacts, "_Despesas_Liquidacao_EmpenhosImpactados.csv", []string{"Código Liquidação", "Código Empenho", "Código Natureza Despesa Completa", "Subitem", "Valor Liquidado (R$)", "Valor Restos a Pagar Inscritos (R$)", "Valor Restos a Pagar Cancelado (R$)", "Valor Restos a Pagar Pagos (R$)"}},
	{PaymentImpacts, "_Despesas_Pagamento_EmpenhosImpactados.csv", []string{"Código Pagamento", "Código Empenho", "Código Natureza Despesa Completa", "Subitem", "Valor Pago (R$)", "Valor Restos a Pagar Inscritos (R$)", "Valor Restos a Pagar Cancelado (R$)", "Valor Restos a Pagar Pagos (R$)"}},
}

type DailyData struct {
	Rows     map[Kind][]Row
	Checksum string
}

type sourceArchive struct {
	file     *os.File
	members  map[string]*zip.File
	checksum string
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(buffer)
}

func openSourceArchive(ctx context.Context, filename string) (_ *sourceArchive, failure error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("open archive: %w", err)
	}
	defer func() {
		if failure != nil {
			file.Close()
		}
	}()
	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}
	hash := sha256.New()
	if _, err = io.Copy(hash, contextReader{ctx, file}); err != nil {
		return nil, err
	}
	archive, err := zip.NewReader(file, stat.Size())
	if err != nil {
		return nil, fmt.Errorf("read ZIP: %w", err)
	}
	files := map[string]*zip.File{}
	for _, member := range archive.File {
		name := path.Base(member.Name)
		if _, exists := files[name]; exists {
			return nil, fmt.Errorf("duplicate ZIP member %q", name)
		}
		files[name] = member
	}
	return &sourceArchive{file: file, members: files, checksum: hex.EncodeToString(hash.Sum(nil))}, nil
}

func ReadDaily(ctx context.Context, opts Options) (*DailyData, error) {
	archive, err := openSourceArchive(ctx, opts.File)
	if err != nil {
		return nil, err
	}
	defer archive.file.Close()
	data := &DailyData{Rows: map[Kind][]Row{}, Checksum: archive.checksum}
	documents := map[Kind]map[string]bool{Commitments: {}, Liquidations: {}, Payments: {}}
	for _, spec := range dailyFiles {
		name := opts.Date.Format("20060102") + spec.suffix
		member := archive.members[name]
		if member == nil {
			return nil, fmt.Errorf("incomplete daily archive: missing %s", name)
		}
		err = readCSV(ctx, member, spec.required, func(row Row) error {
			var selected bool
			switch spec.kind {
			case Commitments, Liquidations, Payments:
				selected = opts.selected(row["Código Gestão"], row["Código Unidade Gestora"])
				if selected {
					code := row[documentColumn(spec.kind)]
					if documents[spec.kind][code] {
						return fmt.Errorf("duplicate document %q", code)
					}
					documents[spec.kind][code] = true
				}
			case Items, History:
				code := row["Código Empenho"]
				unit, management, _, identityErr := documentIdentity(code)
				if identityErr != nil {
					return identityErr
				}
				selected = opts.selected(management, unit)
				if selected && spec.kind == Items && !documents[Commitments][code] {
					return fmt.Errorf("item has no commitment header in this archive: %s", code)
				}
			case LiquidationImpacts:
				selected = documents[Liquidations][row["Código Liquidação"]]
			case PaymentImpacts:
				// Match by payment identity, never by today's commitment list.
				selected = documents[Payments][row["Código Pagamento"]]
			}
			if selected {
				data.Rows[spec.kind] = append(data.Rows[spec.kind], row)
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
	}
	return data, nil
}

func readCSV(ctx context.Context, member *zip.File, required []string, consume func(Row) error) error {
	const maxSize = 1 << 30
	if member.UncompressedSize64 > maxSize {
		return fmt.Errorf("CSV exceeds 1 GiB size limit")
	}
	file, err := member.Open()
	if err != nil {
		return err
	}
	defer file.Close()
	limited := &io.LimitedReader{R: file, N: maxSize + 1}
	buffered := bufio.NewReader(limited)
	prefix, _ := buffered.Peek(4096)
	var decoded io.Reader = buffered
	// The portal uses Windows-1252. UTF-8 fixtures/exports are also accepted.
	probe := bytes.SplitN(prefix, []byte{'\n'}, 2)[0]
	if !utf8.Valid(probe) {
		decoded = charmap.Windows1252.NewDecoder().Reader(buffered)
	}
	reader := csv.NewReader(decoded)
	reader.Comma = ';'
	reader.LazyQuotes = true
	header, err := reader.Read()
	if err != nil {
		return fmt.Errorf("read CSV header: %w", err)
	}
	columns := map[string]bool{}
	for i, name := range header {
		name = strings.TrimSpace(strings.TrimPrefix(name, "\ufeff"))
		if name == "" || columns[name] {
			return fmt.Errorf("empty or duplicate CSV column %q", name)
		}
		header[i], columns[name] = name, true
	}
	for _, name := range required {
		if !columns[name] {
			return fmt.Errorf("missing CSV column %q", name)
		}
	}
	for line := 2; ; line++ {
		if err = ctx.Err(); err != nil {
			return err
		}
		fields, readErr := reader.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return fmt.Errorf("row %d: %w", line, readErr)
		}
		row := Row{}
		for i, name := range header {
			row[name] = strings.TrimSpace(fields[i])
		}
		if err = consume(row); err != nil {
			return fmt.Errorf("row %d: %w", line, err)
		}
	}
	if limited.N == 0 {
		return fmt.Errorf("CSV exceeds 1 GiB size limit")
	}
	return nil
}

func documentColumn(kind Kind) string {
	switch kind {
	case Commitments:
		return "Código Empenho"
	case Liquidations:
		return "Código Liquidação"
	default:
		return "Código Pagamento"
	}
}
