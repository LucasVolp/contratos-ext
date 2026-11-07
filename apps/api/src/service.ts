import { assertUasg, inScope, narrowScope, Scope } from "./auth/access";
import { validateFilters } from "@contracts/validation";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "./errors";
import { ComprasClient } from "./compras";
import {
  contractStatus,
  Data,
  date,
  importRange,
  pagination,
  recordTotal,
  validateContract,
  validateRecord,
} from "./domain";
import { Repositories } from "./repositories";
const json = (value: any): any => JSON.parse(JSON.stringify(value));
export function presentContract(value: Data): Data {
  return { ...json(value), status: contractStatus(value) };
}
export function presentRecord(value: Data): Data {
  return { ...json(value), totalValue: recordTotal(value) };
}
export class ApplicationService {
  constructor(
    readonly db: Repositories,
    readonly external: ComprasClient = new ComprasClient(),
  ) {}
  async contracts(query: Data, scope: Scope = null) {
    const fieldErrors = validateFilters(query);
    if (Object.keys(fieldErrors).length)
      throw new BadRequestException({
        message: Object.values(fieldErrors).join(" · "),
        fieldErrors,
      });
    const { page, limit } = pagination(query),
      from = date(query.from, "from"),
      to = date(query.to, "to");
    if (from && to && from > to)
      throw new BadRequestException(
        "Período inválido: início posterior ao fim.",
      );
    if (
      query.status &&
      !["UPCOMING", "ACTIVE", "EXPIRING", "EXPIRED", "UNKNOWN"].includes(
        query.status,
      )
    )
      throw new BadRequestException("Status de contrato inválido.");
    const today = new Date().toISOString().slice(0, 10);
    const boundary = new Date(`${today}T00:00:00Z`);
    boundary.setUTCDate(boundary.getUTCDate() + 30);
    const filter = {
      scope: narrowScope(scope, query.uasgs),
      uasg: query.uasg ? String(query.uasg) : undefined,
      search: query.search ? String(query.search) : undefined,
      from,
      to,
      status: query.status,
      today,
      boundary: boundary.toISOString().slice(0, 10),
    };
    const [rows, stats] = await Promise.all([
      this.db.contracts.list(filter, page, limit),
      this.db.contracts.stats(filter),
    ]);
    return {
      data: rows.map(presentContract),
      total: stats.count,
      page,
      limit,
      stats,
    };
  }
  async contract(id: string, scope: Scope = null) {
    const value = await this.db.contracts.get(id);
    if (!value || !inScope(scope, value.uasg))
      throw new NotFoundException("Contrato não encontrado.");
    return presentContract(value);
  }
  async saveContract(id: string | null, body: Data, scope: Scope = null) {
    const data = validateContract(body);
    assertUasg(scope, data.uasg);
    if (id) {
      await this.contract(id, scope);
      return presentContract(await this.db.contracts.update(id, data));
    }
    return presentContract(await this.db.contracts.create(data));
  }
  async deleteContract(id: string, scope: Scope = null) {
    await this.contract(id, scope);
    await this.db.contracts.remove(id);
    return { deleted: true };
  }
  async importContracts(body: Data, scope: Scope = null) {
    const { uasg, from, to } = importRange(body);
    assertUasg(scope, uasg);
    const fetched = await this.external.contracts(uasg, from, to);
    // Fetch and validate every page before opening a transaction: remote failure cannot leave partial writes.
    const rows = [
      ...new Map(
        fetched.map((row) => [`${row.number}\0${row.uasg}`, row]),
      ).values(),
    ];
    return this.db.transaction(
      async (tx: Repositories) => {
        let created = 0,
          updated = 0;
        for (const data of rows) {
          const existing = await tx.contracts.byIdentity(
            data.number,
            data.uasg,
          );
          if (existing?.source === "MANUAL") {
            throw new ConflictException(
              `O contrato ${data.number} da UASG ${data.uasg} foi cadastrado manualmente. A importação foi cancelada para preservar seus dados. Confira o cadastro antes de importar novamente.`,
            );
          }
          existing ? updated++ : created++;
        }
        // Preflight every identity before writing, so a conflicting manual row
        // cancels the entire batch, even when it appears on a later page.
        for (const data of rows) {
          await tx.contracts.upsert(data);
        }
        return { created, updated, total: rows.length };
      },
      {
        timeout: 60000,
        serializable: true,
      },
    );
  }
  async records(query: Data, scope: Scope = null) {
    const { page, limit } = pagination(query);
    const search = query.search ? String(query.search) : undefined;
    const [rows, stats] = await Promise.all([
      this.db.records.list(
        search,
        page,
        limit,
        narrowScope(scope, query.uasgs),
      ),
      this.db.records.stats(search, narrowScope(scope, query.uasgs)),
    ]);
    return {
      data: rows.map(presentRecord),
      total: stats.count,
      page,
      limit,
      stats,
    };
  }
  async record(id: string, scope: Scope = null) {
    const value = await this.db.records.get(id);
    if (!value || !inScope(scope, value.uasg))
      throw new NotFoundException("Ata não encontrada.");
    return presentRecord(value);
  }
  async saveRecord(id: string | null, body: Data, scope: Scope = null) {
    const { items, ...fields } = validateRecord(body);
    assertUasg(scope, fields.uasg);
    if (id) await this.record(id, scope);
    return presentRecord(await this.db.records.save(id, fields, items));
  }
  async deleteRecord(id: string, scope: Scope = null) {
    await this.record(id, scope);
    await this.db.records.remove(id);
    return { deleted: true };
  }
  async importRecord(body: Data, scope: Scope = null) {
    const { uasg, from, to } = importRange(body);
    assertUasg(scope, uasg);
    if (typeof body.number !== "string" || !body.number.trim())
      throw new BadRequestException("Número da ata é obrigatório.");
    const value = await this.external.record(
      uasg,
      body.number.trim(),
      from,
      to,
    );
    const existing = (await this.db.records.byIdentity(value.number, uasg))[0];
    if (existing) {
      throw new ConflictException(
        `Ata já cadastrada: ${value.number}, UASG ${uasg}. Abra e edite o registro existente; a importação não substitui dados locais.`,
      );
    }
    return this.saveRecord(null, value, scope);
  }
  async exports(id: string, scope: Scope = null) {
    await this.record(id, scope);
    return this.db.exports.list(id);
  }
}
