import { assertUasg, inScope, narrowScope, Scope } from "./auth/access";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "./errors";
import { ComprasClient } from "./compras";
import {
  Data,
  importRange,
  pagination,
  recordTotal,
  validateRecord,
} from "./domain";
import { Repositories } from "./repositories";
const json = (value: any): any => JSON.parse(JSON.stringify(value));
export function presentRecord(value: Data): Data {
  return { ...json(value), totalValue: recordTotal(value) };
}
export class ApplicationService {
  constructor(
    readonly db: Repositories,
    readonly external: ComprasClient = new ComprasClient(),
  ) {}
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
