import { maskDocument, formatDecimal } from "@contracts/validation";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import Decimal from "decimal.js";
import { Data, readiness } from "./domain";
import { ApplicationService } from "./service";
import { Scope } from "./auth/access";
export const TEMPLATE_VERSION = "arp-ata-14133-standalone-v2";
const brDate = (value: string | null) =>
  value ? value.split("-").reverse().join("/") : " ";
function documentId(value: string) {
  return maskDocument(value);
}
function currency(value: string) {
  return formatDecimal(value, true);
}
export function renderDocx(record: Data): Buffer {
  const supplier = [
    record.supplierName,
    `CNPJ/CPF ${documentId(record.supplierDocument)}`,
    record.supplierRepresentative
      ? `Representante: ${record.supplierRepresentative}`
      : "",
  ]
    .filter(Boolean)
    .join(" — ");
  const model = {
    processoAdministrativo: record.processNumber,
    numeroAta: record.number,
    orgaoNome: record.organizationName,
    orgaoEndereco: [record.organizationStreet, record.organizationNumber]
      .filter(Boolean)
      .join(", "),
    cidade: record.organizationCity,
    UF: record.organizationState,
    CNPJ: documentId(record.organizationDocument),
    representanteCargoNome:
      `${record.authorityRole} ${record.authorityName}`.trim(),
    representanteMatricula: record.authorityRegistration,
    portariaNumero: record.ordinanceNumber,
    portariaData: brDate(record.ordinanceDate),
    portariaDouData: brDate(record.ordinancePublicationDate),
    temPortaria: !!record.ordinanceNumber,
    temDataPortaria: !!record.ordinanceNumber && !!record.ordinanceDate,
    temPublicacaoPortaria:
      !!record.ordinanceNumber && !!record.ordinancePublicationDate,
    temMatricula: !!record.authorityRegistration,
    numeroCompra:
      record.purchaseYear && !/\/\d{4}$/.test(record.purchaseNumber)
        ? `${record.purchaseNumber}/${record.purchaseYear}`
        : record.purchaseNumber,
    anoCompra: record.purchaseYear ?? "",
    objeto: record.object,
    tipoInstrumento:
      record.modality === "PREGAO"
        ? "Edital de licitação"
        : "Aviso de contratação direta",
    fornecedorRazaoSocial: supplier,
    modalidadePregao: record.modality === "PREGAO",
    tipoInstrumentoEdital: record.modality === "PREGAO",
    podeRenovar: record.renewable,
    vigencia:
      record.startDate && record.endDate
        ? `o período de ${brDate(record.startDate)} a ${brDate(record.endDate)}`
        : "o prazo e o termo inicial definidos no instrumento convocatório",
    itens: record.items.map((item: Data) => ({
      numeroItem: item.number,
      descricaoItem: item.description,
      marca: item.brand ?? "",
      modelo: item.model ?? "",
      unidade: item.unit,
      quantidadeMaxima: item.quantity.toString(),
      quantidadeMinima: item.minimumQuantity.toString(),
      valorUnitario: currency(item.unitPrice.toString()),
      prazoGarantia: item.warranty ?? "",
    })),
  };
  try {
    const path =
      process.env.DOCX_TEMPLATE_PATH ||
      join(__dirname, "../templates/arp-ata-14133.docx");
    const doc = new Docxtemplater(new PizZip(readFileSync(path)), {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    doc.render(model);
    return doc
      .getZip()
      .generate({ type: "nodebuffer", compression: "DEFLATE" });
  } catch {
    throw new InternalServerErrorException(
      "Falha ao preencher o modelo Word. Confira a instalação do template.",
    );
  }
}
export async function convertPdf(
  docx: Buffer,
  request: typeof fetch = fetch,
): Promise<Buffer> {
  const base = process.env.GOTENBERG_URL || "http://localhost:3055";
  const form = new FormData();
  form.append(
    "files",
    new Blob([new Uint8Array(docx)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    "ata.docx",
  );
  try {
    const response = await request(
      `${base.replace(/\/$/, "")}/forms/libreoffice/convert`,
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(
          Number(process.env.PDF_TIMEOUT_MS || 60000),
        ),
      },
    );
    if (!response.ok) throw new Error();
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.subarray(0, 5).toString() !== "%PDF-") throw new Error();
    return buffer;
  } catch {
    throw new ServiceUnavailableException(
      "PDF indisponível: o conversor Gotenberg não respondeu. Verifique o serviço ou baixe o Word (.docx).",
    );
  }
}
export class DocumentService {
  constructor(
    private readonly db: any,
    private readonly app: ApplicationService,
    private readonly converter: (docx: Buffer) => Promise<Buffer> = convertPdf,
  ) {}
  async generate(
    id: string,
    format: string,
    itemId: string | undefined,
    scope: Scope,
  ) {
    if (!["docx", "pdf"].includes(format))
      throw new BadRequestException("Formato inválido. Use docx ou pdf.");
    const record = await this.app.record(id, scope);
    const check = readiness(record, itemId);
    if (!check.ready)
      throw new UnprocessableEntityException({
        message: "Preencha os campos obrigatórios antes de exportar.",
        missingFields: check.missingFields,
      });
    const selected = {
      ...record,
      items: itemId
        ? record.items.filter((item: Data) => item.id === itemId)
        : record.items,
    };
    const docx = renderDocx(selected),
      buffer = format === "pdf" ? await this.converter(docx) : docx;
    // Persist only a successful result; snapshots are JSON copies and have no update endpoint.
    // Avoid a local `exports` binding: CommonJS uses it for exported constants.
    const { exports: exportHistory, ...snapshotRecord } = record;
    await this.db.documentExport.create({
      data: {
        recordId: id,
        format,
        templateVersion: TEMPLATE_VERSION,
        itemNumber: itemId ? selected.items[0].number : null,
        snapshot: JSON.parse(
          JSON.stringify({
            record: snapshotRecord,
            itemId: itemId ?? null,
            format,
            templateVersion: TEMPLATE_VERSION,
          }),
        ),
      },
    });
    return {
      buffer,
      filename: `ata-${record.number.replace(/[^a-zA-Z0-9-]/g, "-")}.${format}`,
      contentType:
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
}
