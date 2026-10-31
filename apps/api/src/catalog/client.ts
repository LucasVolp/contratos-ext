import { ComprasClient } from "../compras";
import { Raw } from "./types";
import { day } from "./mappers";
export const PATHS = {
  purchases: "/modulo-contratacoes/1_consultarContratacoes_PNCP_14133",
  purchase: "/modulo-contratacoes/1.1_consultarContratacoes_PNCP_14133_Id",
  items: "/modulo-contratacoes/2.1_consultarItensContratacoes_PNCP_14133_Id",
  results:
    "/modulo-contratacoes/3.1_consultarResultadoItensContratacoes_PNCP_14133_Id",
  records: "/modulo-arp/1_consultarARP",
  record: "/modulo-arp/1.1_consultarARP_Id",
  recordItems: "/modulo-arp/2.1_consultarARPItem_Id",
  units: "/modulo-arp/3_consultarUnidadesItem",
  commitments: "/modulo-arp/4_consultarEmpenhosSaldoItem",
  adhesions: "/modulo-arp/5_consultarAdesoesItem",
};
export class CatalogClient {
  constructor(
    private readonly transport: Pick<
      ComprasClient,
      "pages"
    > = new ComprasClient(),
  ) {}
  async windows(
    from: string,
    to: string,
    load: (start: string, end: string) => Promise<Raw[]>,
  ) {
    const rows: Raw[] = [];
    let start = from;
    while (start <= to) {
      const last = new Date(`${start}T00:00:00Z`);
      last.setUTCDate(last.getUTCDate() + 364);
      const end =
        last.toISOString().slice(0, 10) < to
          ? last.toISOString().slice(0, 10)
          : to;
      rows.push(...(await load(start, end)));
      const next = new Date(`${end}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      start = next.toISOString().slice(0, 10);
    }
    return rows;
  }
  purchases(uasg: string, from: string, to: string) {
    return this.windows(from, to, async (start, end) => {
      // The source interprets the final date as midnight, so query the next day.
      const upper = new Date(`${end}T00:00:00Z`);
      upper.setUTCDate(upper.getUTCDate() + 1);
      const rows = await this.transport.pages(PATHS.purchases, {
        unidadeOrgaoCodigoUnidade: uasg,
        codigoModalidade: 5,
        dataPublicacaoPncpInicial: start,
        dataPublicacaoPncpFinal: upper.toISOString().slice(0, 10),
        contratacaoExcluida: false,
      });
      return rows.filter((row) => {
        const published = day(row.dataPublicacaoPncp);
        return published !== null && published >= start && published <= end;
      });
    });
  }

  records(uasg: string, from: string, to: string) {
    return this.windows(from, to, (start, end) =>
      this.transport.pages(PATHS.records, {
        codigoUnidadeGerenciadora: uasg,
        dataVigenciaInicialMin: start,
        dataVigenciaInicialMax: end,
      }),
    );
  }
  async purchase(externalId: string) {
    const params = { tipo: "idCompra", codigo: externalId };
    const [headers, items, results] = await Promise.all([
      this.transport.pages(PATHS.purchase, params),
      this.transport.pages(PATHS.items, params),
      this.transport.pages(PATHS.results, params),
    ]);
    return { headers, items, results };
  }
  async record(externalId: string) {
    const params = { numeroControlePncpAta: externalId };
    const [headers, items] = await Promise.all([
      this.transport.pages(PATHS.record, params),
      this.transport.pages(PATHS.recordItems, params),
    ]);
    return { headers, items };
  }
  units(number: string, uasg: string, item: string) {
    return this.transport.pages(PATHS.units, {
      numeroAta: number,
      unidadeGerenciadora: uasg,
      numeroItem: item,
    });
  }
  commitments(number: string, uasg: string) {
    return this.transport.pages(PATHS.commitments, {
      numeroAta: number,
      unidadeGerenciadora: uasg,
    });
  }
  adhesions(number: string, uasg: string, item: string) {
    return this.transport.pages(PATHS.adhesions, {
      numeroAta: number,
      unidadeGerenciadora: uasg,
      numeroItem: item,
    });
  }
}
