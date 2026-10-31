import { BadRequestException } from "@nestjs/common";
import { isUASG, isUF, normalizeDocument } from "@contracts/validation";
import { ComprasClient } from "../compras";
import { PrismaClient } from "../generated/prisma/client";
import { Data } from "../domain";
const UNITS = "/modulo-uasg/1_consultarUasg";
const ORGANS = "/modulo-uasg/2_consultarOrgao";
const fold = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();
type Unit = { uasg: string; name: string; city: string; uf: string };
/**
 * Finds UASGs in the public Compras.gov registry so the general manager can register whole bodies
 * (e.g. every IFSP campus). The source has no name search: names are matched here within one UF.
 */
export class PublicUnits {
  constructor(
    private readonly db: PrismaClient,
    private readonly transport: Pick<ComprasClient, "pages"> = new ComprasClient(),
  ) {}
  async search(query: Data) {
    const term = String(query?.q ?? "").trim(),
      uf = String(query?.uf ?? "").trim().toUpperCase();
    const document = normalizeDocument(term);
    let rows: Data[];
    if (isUASG(term)) {
      // The registry answers 404 to any query without the status filter.
      const [unit] = await this.transport.pages(UNITS, {
        codigoUasg: term,
        statusUasg: true,
      });
      rows = unit?.cnpjCpfOrgao
        ? await this.organUnits(unit.cnpjCpfOrgao)
        : unit
          ? [unit]
          : [];
    } else if (/^[0-9A-Z]{14}$/.test(document) && /\d/.test(document)) {
      rows = await this.organUnits(document);
    } else {
      const errors: Record<string, string> = {};
      if (fold(term).length < 3)
        errors.q = "Informe uma UASG, o CNPJ do órgão ou ao menos 3 letras do nome.";
      if (!isUF(uf)) errors.uf = "Escolha a UF para buscar pelo nome.";
      if (Object.keys(errors).length)
        throw new BadRequestException({
          message: Object.values(errors).join(" · "),
          fieldErrors: errors,
        });
      const words = fold(term).split(" ");
      const all = await this.transport.pages(UNITS, {
        siglaUf: uf,
        statusUasg: true,
      });
      // Show every unit of each matching body, not only the matching names.
      const organs = new Set(
        all
          .filter((row) => {
            const name = fold(row.nomeUasg);
            return words.every((word) => name.includes(word));
          })
          .map((row) => row.cnpjCpfOrgao || `uasg:${row.codigoUasg}`),
      );
      rows = all.filter((row) =>
        organs.has(row.cnpjCpfOrgao || `uasg:${row.codigoUasg}`),
      );
    }
    const groups = new Map<string, Unit[]>();
    for (const row of rows) {
      if (row.statusUasg === false || !isUASG(String(row.codigoUasg))) continue;
      const key = String(row.cnpjCpfOrgao || `uasg:${row.codigoUasg}`);
      const units = groups.get(key) ?? [];
      units.push({
        uasg: String(row.codigoUasg),
        name: String(row.nomeUasg ?? "").trim(),
        city: String(row.nomeMunicipioIbge ?? ""),
        uf: String(row.siglaUf ?? ""),
      });
      groups.set(key, units);
    }
    const limited = [...groups.entries()].slice(0, 10);
    const registered = await this.db.institution.findMany({
      where: {
        uasg: { in: limited.flatMap(([, units]) => units.map((u) => u.uasg)) },
      },
      select: { uasg: true, organization: true },
    });
    const known = new Map(registered.map((r) => [r.uasg, r.organization]));
    return {
      truncated: groups.size > limited.length,
      organs: await Promise.all(
        limited.map(async ([key, units]) => ({
          document: key.startsWith("uasg:") ? null : key,
          name: key.startsWith("uasg:") ? null : await this.organName(key),
          units: units
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
            .map((unit) => ({
              ...unit,
              registered: known.has(unit.uasg),
              organization: known.get(unit.uasg) ?? null,
            })),
        })),
      ),
    };
  }
  private organUnits(document: string) {
    return this.transport.pages(UNITS, {
      cnpjCpfOrgao: document,
      statusUasg: true,
    });
  }
  private async organName(document: string) {
    try {
      const [organ] = await this.transport.pages(ORGANS, {
        cnpjCpfOrgao: document,
        statusOrgao: true,
      });
      return organ?.nomeOrgao ? String(organ.nomeOrgao) : null;
    } catch {
      // The organ name is only a label; the units are still usable without it.
      return null;
    }
  }
}
