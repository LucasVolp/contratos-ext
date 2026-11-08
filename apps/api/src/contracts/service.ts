import { validateFilters } from "@contracts/validation";
import { inScope, narrowScope, Scope, Viewer } from "../auth/access";
import { contractStatus, Data, date, pagination } from "../domain";
import { BadRequestException, NotFoundException } from "../errors";
import { known, pagination as partPagination } from "../finance/validation";
import {
  ContractDetailRow,
  ContractRepository,
  ContractRow,
  SOURCE_PARTS,
  SourcePart,
} from "./repository";

const STATUSES = ["UPCOMING", "ACTIVE", "EXPIRING", "EXPIRED", "UNKNOWN"];
const NOTES_LIMIT = 10000;
const MAX_BIGINT = 9223372036854775807n;

const notFound = () => new NotFoundException("Contrato não encontrado.");

// A CPF supplier is a natural person (LGPD): only digits 4 to 9 are shown, as
// the source itself masks responsibles. CNPJs and other identifiers stay as is.
export function maskSupplierDocument(value: string | null) {
  return value && /^\d{11}$/.test(value) ? `***.${value.slice(3, 6)}.${value.slice(6, 9)}-**` : value;
}

function presentSummary(row: ContractRow) {
  return {
    externalId: row.externalId,
    number: row.number,
    object: row.object,
    supplierName: row.supplierName,
    supplierDocument: maskSupplierDocument(row.supplierDocument),
    uasg: row.uasg,
    unitName: row.unitName,
    startDate: row.startDate,
    endDate: row.endDate,
    globalValue: row.globalValue,
    status: contractStatus(row),
  };
}

function presentDetail(row: ContractDetailRow) {
  return {
    ...presentSummary(row),
    originUnitCode: row.originUnitCode,
    typeName: row.typeName,
    category: row.category,
    processNumber: row.processNumber,
    modality: row.modality,
    sourceStatus: row.sourceStatus,
    signatureDate: row.signatureDate,
    initialValue: row.initialValue,
    accumulatedValue: row.accumulatedValue,
    installmentCount: row.installmentCount,
    capturedAt: row.capturedAt,
    normalizedAt: row.normalizedAt,
  };
}

// Contracts come only from the Contratos.gov.br daily replica; the API never
// calls the source. Internal notes are the only data the app writes.
export class ContractService {
  constructor(private readonly contracts: ContractRepository) {}

  async list(query: Data, scope: Scope) {
    const fieldErrors = validateFilters(query);
    if (Object.keys(fieldErrors).length)
      throw new BadRequestException({ message: Object.values(fieldErrors).join(" · "), fieldErrors });
    const { page, limit } = pagination(query),
      from = date(query.from, "from"),
      to = date(query.to, "to");
    if (from && to && from > to) throw new BadRequestException("Período inválido: início posterior ao fim.");
    if (query.status && !STATUSES.includes(query.status)) throw new BadRequestException("Status de contrato inválido.");
    const today = new Date().toISOString().slice(0, 10);
    const boundary = new Date(`${today}T00:00:00Z`);
    boundary.setUTCDate(boundary.getUTCDate() + 30);
    const visible = narrowScope(scope, query.uasgs);
    const filter = {
      scope: visible,
      uasg: query.uasg ? String(query.uasg) : undefined,
      search: query.search ? String(query.search) : undefined,
      from,
      to,
      status: query.status,
      today,
      boundary: boundary.toISOString().slice(0, 10),
    };
    const [rows, stats, sync] = await Promise.all([
      this.contracts.list(filter, page, limit),
      this.contracts.stats(filter),
      this.contracts.sync(visible),
    ]);
    return { data: rows.map(presentSummary), total: stats.count, page, limit, stats, sync };
  }

  async detail(externalId: string, scope: Scope) {
    const contract = await this.find(externalId, scope);
    const [parts, notes] = await Promise.all([this.contracts.parts(externalId), this.contracts.notes(externalId)]);
    return { contract: presentDetail(contract), parts, notes: notes ?? { text: "", updatedAt: null, updatedBy: null } };
  }

  async part(externalId: string, part: string, query: Data, scope: Scope) {
    if (!validId(externalId)) throw notFound();
    if (!SOURCE_PARTS.includes(part as SourcePart)) throw new BadRequestException("Parte inválida.");
    known(query, ["page", "limit"]);
    const page = partPagination(query);
    await this.find(externalId, scope);
    return this.contracts.page(externalId, part as SourcePart, page);
  }

  async saveNotes(externalId: string, body: Data, viewer: Viewer, scope: Scope) {
    await this.find(externalId, scope);
    if (typeof body?.notes !== "string")
      throw new BadRequestException({
        message: "Informe as observações internas em texto.",
        fieldErrors: { notes: "Informe as observações internas em texto." },
      });
    const notes = body.notes.trim();
    // Count code points, as the database constraint does.
    if ([...notes].length > NOTES_LIMIT) {
      const message = "As observações internas podem ter no máximo 10.000 caracteres.";
      throw new BadRequestException({ message, fieldErrors: { notes: message } });
    }
    return this.contracts.saveNotes(externalId, notes, viewer.id);
  }

  // Unknown, malformed, unregistered and out-of-scope contracts all answer the
  // same 404, so the response never reveals that a contract exists.
  async find(externalId: string, scope: Scope) {
    if (!validId(externalId)) throw notFound();
    const contract = await this.contracts.get(externalId);
    if (!contract || !inScope(scope, contract.uasg)) throw notFound();
    return contract;
  }
}

function validId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_BIGINT;
}
