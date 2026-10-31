import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
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
import { PrismaClient, Prisma } from "./generated/prisma/client";
const json = (value: any): any => JSON.parse(JSON.stringify(value));
export function presentContract(value: Data): Data {
  return { ...json(value), status: contractStatus(value) };
}
export function presentRecord(value: Data): Data {
  return { ...json(value), totalValue: recordTotal(value) };
}
export class ApplicationService {
  constructor(
    readonly db: PrismaClient,
    readonly external: ComprasClient = new ComprasClient(),
  ) {}
  async contracts(query: Data) {
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
    const clauses: Prisma.ContractWhereInput[] = [];
    if (query.uasg) clauses.push({ uasg: String(query.uasg) });
    if (query.search)
      clauses.push({
        OR: [
          "number",
          "object",
          "supplierName",
          "supplierDocument",
          "unitName",
        ].map((field) => ({
          [field]: { contains: String(query.search), mode: "insensitive" },
        })),
      });
    if (from || to) {
      clauses.push({ startDate: { not: null }, endDate: { not: null } });
      if (from) clauses.push({ endDate: { gte: from } });
      if (to) clauses.push({ startDate: { lte: to } });
    }
    const today = new Date().toISOString().slice(0, 10),
      boundary = new Date(`${today}T00:00:00Z`);
    boundary.setUTCDate(boundary.getUTCDate() + 30);
    const known = { startDate: { not: null }, endDate: { not: null } };
    const statusFilters: Record<string, Prisma.ContractWhereInput> = {
      UNKNOWN: { OR: [{ startDate: null }, { endDate: null }] },
      UPCOMING: { AND: [known, { startDate: { gt: today } }] },
      EXPIRED: { AND: [known, { endDate: { lt: today } }] },
      EXPIRING: {
        AND: [
          known,
          { startDate: { lte: today } },
          { endDate: { gte: today, lte: boundary.toISOString().slice(0, 10) } },
        ],
      },
      ACTIVE: {
        AND: [
          known,
          { startDate: { lte: today } },
          { endDate: { gt: boundary.toISOString().slice(0, 10) } },
        ],
      },
    };
    if (query.status) clauses.push(statusFilters[query.status]);
    const where = { AND: clauses };
    const [rows, stats, expiringCount] = await Promise.all([
      this.db.contract.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
      this.db.contract.aggregate({
        where,
        _count: { _all: true },
        _sum: { globalValue: true },
      }),
      this.db.contract.count({
        where: { AND: [where, statusFilters.EXPIRING] },
      }),
    ]);
    return {
      data: rows.map(presentContract),
      total: stats._count._all,
      page,
      limit,
      stats: {
        count: stats._count._all,
        totalValue: stats._sum.globalValue?.toString() ?? "0",
        expiringCount,
      },
    };
  }
  async contract(id: string) {
    const value = await this.db.contract.findUnique({ where: { id } });
    if (!value) throw new NotFoundException("Contrato não encontrado.");
    return presentContract(value);
  }
  async saveContract(id: string | null, body: Data) {
    const data = validateContract(body) as Prisma.ContractCreateInput;
    if (id) {
      await this.contract(id);
      return presentContract(
        await this.db.contract.update({ where: { id }, data }),
      );
    }
    return presentContract(await this.db.contract.create({ data }));
  }
  async deleteContract(id: string) {
    await this.contract(id);
    await this.db.contract.delete({ where: { id } });
    return { deleted: true };
  }
  async importContracts(body: Data) {
    const { uasg, from, to } = importRange(body);
    const fetched = await this.external.contracts(uasg, from, to);
    // Fetch and validate every page before opening a transaction: remote failure cannot leave partial writes.
    const rows = [
      ...new Map(
        fetched.map((row) => [`${row.number}\0${row.uasg}`, row]),
      ).values(),
    ];
    return this.db.$transaction(
      async (tx: Prisma.TransactionClient) => {
        let created = 0,
          updated = 0;
        for (const data of rows) {
          const where = {
            number_uasg: { number: data.number, uasg: data.uasg },
          };
          const existing = await tx.contract.findUnique({ where });
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
          await tx.contract.upsert({
            where: { number_uasg: { number: data.number, uasg: data.uasg } },
            create: data as Prisma.ContractCreateInput,
            update: data as Prisma.ContractUpdateInput,
          });
        }
        return { created, updated, total: rows.length };
      },
      {
        timeout: 60000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }
  async records(query: Data) {
    const { page, limit } = pagination(query);
    const where: Prisma.PriceRecordWhereInput = {};
    if (query.search)
      where.OR = [
        "number",
        "object",
        "supplierName",
        "organizationName",
        "uasg",
      ].map((field) => ({
        [field]: { contains: String(query.search), mode: "insensitive" },
      }));
    const [rows, count, exportsCount, totals] = await Promise.all([
      this.db.priceRecord.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: { items: { orderBy: { number: "asc" } } },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
      this.db.priceRecord.count({ where }),
      this.db.documentExport.count({ where: { record: where } }),
      this.db.$queryRaw<Array<{ total: string }>>(
        Prisma.sql`SELECT COALESCE(SUM(i.quantity * i."unitPrice"),0)::text AS total FROM "RecordItem" i JOIN "PriceRecord" r ON r.id=i."recordId" WHERE ${query.search ? Prisma.sql`(r.number ILIKE ${"%" + query.search + "%"} OR r.object ILIKE ${"%" + query.search + "%"} OR r."supplierName" ILIKE ${"%" + query.search + "%"} OR r."organizationName" ILIKE ${"%" + query.search + "%"} OR r.uasg ILIKE ${"%" + query.search + "%"})` : Prisma.sql`TRUE`}`,
      ),
    ]);
    return {
      data: rows.map(presentRecord),
      total: count,
      page,
      limit,
      stats: {
        count,
        totalValue: new Decimal(totals[0]?.total ?? "0").toFixed(),
        exportsCount,
      },
    };
  }
  async record(id: string) {
    const value = await this.db.priceRecord.findUnique({
      where: { id },
      include: {
        items: { orderBy: { number: "asc" } },
        exports: {
          select: {
            id: true,
            format: true,
            templateVersion: true,
            createdAt: true,
            itemNumber: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!value) throw new NotFoundException("Ata não encontrada.");
    return presentRecord(value);
  }
  async saveRecord(id: string | null, body: Data) {
    const { items, ...fields } = validateRecord(body);
    const data = fields as Prisma.PriceRecordCreateInput;
    if (id) await this.record(id);
    const value = id
      ? await this.db.priceRecord.update({
          where: { id },
          data: { ...data, items: { deleteMany: {}, create: items } },
          include: { items: { orderBy: { number: "asc" } } },
        })
      : await this.db.priceRecord.create({
          data: { ...data, items: { create: items } },
          include: { items: { orderBy: { number: "asc" } } },
        });
    return presentRecord(value);
  }
  async deleteRecord(id: string) {
    await this.record(id);
    await this.db.priceRecord.delete({ where: { id } });
    return { deleted: true };
  }
  async importRecord(body: Data) {
    const { uasg, from, to } = importRange(body);
    if (typeof body.number !== "string" || !body.number.trim())
      throw new BadRequestException("Número da ata é obrigatório.");
    const value = await this.external.record(
      uasg,
      body.number.trim(),
      from,
      to,
    );
    const existing = await this.db.priceRecord.findUnique({
      where: { number_uasg: { number: value.number, uasg } },
    });
    if (existing) {
      throw new ConflictException(
        `Ata já cadastrada: ${value.number}, UASG ${uasg}. Abra e edite o registro existente; a importação não substitui dados locais.`,
      );
    }
    return this.saveRecord(null, value);
  }
  async exports(id: string) {
    await this.record(id);
    return this.db.documentExport.findMany({
      where: { recordId: id },
      select: {
        id: true,
        format: true,
        templateVersion: true,
        createdAt: true,
        itemNumber: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
