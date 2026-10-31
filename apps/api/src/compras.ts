import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Data, date, decimal, validateRecord } from "./domain";
const str = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);
const money = (value: unknown) => decimal(str(value ?? "0"), "valor importado");
const day = (value: unknown) =>
  value ? date(str(value).slice(0, 10), "vigência importada") : null;
export class ComprasClient {
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly base = process.env.COMPRAS_API_BASE_URL ||
      "https://dadosabertos.compras.gov.br",
  ) {}
  async pages(path: string, params: Data): Promise<Data[]> {
    const result: Data[] = [];
    let page = 1,
      totalPages = 1;
    do {
      const url = new URL(path, this.base);
      for (const [key, value] of Object.entries({
        ...params,
        pagina: page,
        tamanhoPagina: 500,
      }))
        if (value !== undefined && value !== null)
          url.searchParams.set(key, String(value));
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await this.request(url, {
            signal: AbortSignal.timeout(
              Number(process.env.COMPRAS_TIMEOUT_MS || 30000),
            ),
          });
        } catch {
          if (attempt === 2)
            throw new ServiceUnavailableException(
              "Compras.gov indisponível ou demorou demais. Tente novamente.",
            );
          continue;
        }
        if (![429, 502, 503, 504].includes(response.status) || attempt === 2)
          break;
      }
      if (response?.status === 404 && page === 1) return [];
      if (!response?.ok)
        throw new BadGatewayException(
          `Falha na consulta Compras.gov (HTTP ${response?.status ?? "desconhecido"}). Nenhum dado foi importado.`,
        );
      let body: any;
      try {
        body = await response.json();
      } catch {
        throw new BadGatewayException(
          "Compras.gov retornou JSON inválido. Nenhum dado foi importado.",
        );
      }
      const rows = Array.isArray(body) ? body : body.resultado;
      if (!Array.isArray(rows))
        throw new BadGatewayException(
          "Formato inesperado da resposta Compras.gov. Nenhum dado foi importado.",
        );
      result.push(...rows);
      totalPages = Array.isArray(body)
        ? 1
        : Number(
            body.totalPaginas ?? Number(body.paginasRestantes || 0) + page,
          );
      if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > 10000)
        throw new BadGatewayException("Paginação inválida da API Compras.gov.");
      page++;
    } while (page <= totalPages);
    return result;
  }
  async contracts(uasg: string, from: string, to: string) {
    const units = await this.pages("/modulo-uasg/1_consultarUasg", {
      codigoUasg: uasg,
      statusUasg: true,
    });
    const unit = units.find((u) => str(u.codigoUasg) === uasg);
    if (!unit?.codigoOrgao)
      throw new NotFoundException(
        "UASG ativa não localizada no Compras.gov. Confira o código informado.",
      );
    return (
      await this.pages("/modulo-contratos/1_consultarContratos", {
        codigoOrgao: unit.codigoOrgao,
        codigoUnidadeGestora: uasg,
        dataVigenciaInicialMin: from,
        dataVigenciaInicialMax: to,
      })
    )
      .filter((r) => !r.contratoExcluido)
      .map((r) => mapImportedContract(r, uasg));
  }
  async record(uasg: string, number: string, from: string, to: string) {
    const atas = await this.pages("/modulo-arp/1_consultarARP", {
      codigoUnidadeGerenciadora: uasg,
      numeroAtaRegistroPreco: number,
      dataVigenciaInicialMin: from,
      dataVigenciaInicialMax: to,
    });
    const matches = atas.filter(
      (a) => str(a.numeroAtaRegistroPreco) === number && !a.ataExcluido,
    );
    if (!matches.length)
      throw new NotFoundException(
        "Ata não localizada na UASG e período informados.",
      );
    if (matches.length > 1)
      throw new UnprocessableEntityException(
        "Mais de uma ata encontrada com esse número. Restrinja o período da busca.",
      );
    const ata = matches[0];
    const items = ata.numeroControlePncpAta
      ? await this.pages("/modulo-arp/2.1_consultarARPItem_Id", {
          numeroControlePncpAta: ata.numeroControlePncpAta,
        })
      : await this.pages("/modulo-arp/2_consultarARPItem", {
          codigoUnidadeGerenciadora: uasg,
          dataVigenciaInicialMin: from,
          dataVigenciaInicialMax: to,
        });
    const own = items.filter(
      (i) =>
        !i.itemExcluido &&
        (ata.numeroControlePncpAta
          ? i.numeroControlePncpAta === ata.numeroControlePncpAta
          : str(i.numeroAtaRegistroPreco) === number),
    );
    return mapImportedRecord(ata, own, uasg);
  }
}
export function mapImportedContract(row: Data, uasg: string): Data {
  return {
    number: str(row.numeroContrato),
    object: str(row.objeto),
    supplierName: str(row.nomeRazaoSocialFornecedor),
    supplierDocument: str(row.niFornecedor),
    uasg,
    unitName: str(row.nomeUnidadeGestora),
    startDate: day(row.dataVigenciaInicial),
    endDate: day(row.dataVigenciaFinal),
    initialValue: money(row.valorInicial ?? row.valorGlobal),
    globalValue: money(row.valorGlobal),
    source: "COMPRAS_GOV",
    externalId: str(row.numeroControlePncpContrato) || null,
    lastSyncedAt: new Date(),
  };
}
export function mapImportedRecord(
  ata: Data,
  items: Data[],
  uasg: string,
): Data {
  const suppliers = new Set(
    items
      .map(
        (i) =>
          str(i.niFornecedor).replace(/\D/g, "") ||
          str(i.nomeRazaoSocialFornecedor).trim().toLowerCase(),
      )
      .filter(Boolean),
  );
  if (suppliers.size > 1)
    throw new UnprocessableEntityException(
      "Esta ata possui vários fornecedores. Importe uma ata de fornecedor único para gerar documento consistente.",
    );
  const supplier =
    items.find((i) => i.niFornecedor || i.nomeRazaoSocialFornecedor) ?? {};
  const modalityName = str(ata.nomeModalidadeCompra)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const modalityCode =
    ata.codigoModalidadeCompra == null
      ? null
      : Number(ata.codigoModalidadeCompra);
  let modality: "PREGAO" | "DISPENSA";
  if (modalityName.includes("dispensa")) modality = "DISPENSA";
  else if (modalityName.includes("pregao")) modality = "PREGAO";
  else if (modalityName) {
    throw new UnprocessableEntityException(
      `A modalidade ${ata.nomeModalidadeCompra} não é suportada pelo modelo de ata. Use uma ata de pregão ou dispensa.`,
    );
  } else if (modalityCode === 6) modality = "DISPENSA";
  else if (modalityCode === 5 || modalityCode === null) modality = "PREGAO";
  else {
    throw new UnprocessableEntityException(
      `Código de modalidade ${ata.codigoModalidadeCompra} não suportado. Confira a modalidade na origem antes de importar.`,
    );
  }
  return validateRecord({
    number: str(ata.numeroAtaRegistroPreco),
    object: str(ata.objeto) || "Objeto não informado",
    uasg,
    purchaseNumber: str(ata.numeroCompra),
    purchaseYear: ata.anoCompra ? Number(ata.anoCompra) : null,
    modality,
    startDate: day(ata.dataVigenciaInicial),
    endDate: day(ata.dataVigenciaFinal),
    organizationName: str(ata.nomeOrgao ?? ata.nomeUnidadeGerenciadora),
    supplierName: str(supplier.nomeRazaoSocialFornecedor),
    supplierDocument: str(supplier.niFornecedor),
    items: items.map((i) => ({
      number: Number(i.numeroItem),
      description: str(i.descricaoItem),
      brand: str(i.marca),
      model: str(i.modelo),
      unit: str(i.unidadeFornecimento ?? i.unidadeMedida),
      quantity: money(
        i.quantidadeHomologadaVencedor ?? i.quantidadeHomologadaItem,
      ),
      minimumQuantity: "0",
      unitPrice: money(i.valorUnitario),
      warranty: "",
    })),
  });
}
