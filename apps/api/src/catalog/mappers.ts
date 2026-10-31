import Decimal from "decimal.js";
import { normalizeDocument, isDate } from "@contracts/validation";
import { BadGatewayException } from "@nestjs/common";
import {
  Raw,
  PurchaseItem,
  PurchaseResult,
  PurchaseResultState,
  PublicRecordItem,
  UnitRow,
  CommitmentRow,
  AdhesionRow,
} from "./types";
export const string = (value: unknown): string =>
  value == null ? "" : String(value);
// Only item numbers are numeric identities; opaque purchase IDs remain unchanged.
export const itemNumberIdentity = (value: unknown): string => {
  const number = string(value);
  return /^\d+$/.test(number) ? number.replace(/^0+(?=\d)/, "") : number;
};
export const nullable = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);
export const day = (value: unknown): string | null => {
  const result = nullable(value)?.slice(0, 10);
  return result && isDate(result) ? result : null;
};
export function numeric(value: unknown): string | null {
  if (value == null || value === "") return null;
  try {
    const n = new Decimal(String(value));
    return n.isFinite() && n.gte(0) ? n.toFixed() : null;
  } catch {
    return null;
  }
}
export const integer = (value: unknown): number | null =>
  value == null || value === ""
    ? null
    : Number.isSafeInteger(Number(value))
      ? Number(value)
      : null;
export function mapPurchase(r: Raw) {
  return {
    externalId: string(r.idCompra),
    pncpId: nullable(r.numeroControlePNCP ?? r.numeroControlePNCPCompra),
    number: string(r.numeroCompra),
    year: integer(r.anoCompraPncp),
    uasg: string(r.unidadeOrgaoCodigoUnidade),
    unitName: string(r.unidadeOrgaoNomeUnidade),
    object: string(r.objetoCompra),
    status: string(r.situacaoCompraNomePncp),
    srp: typeof r.srp === "boolean" ? r.srp : null,
    processNumber: string(r.processo),
    organizationName: string(r.orgaoEntidadeRazaoSocial),
    organizationDocument: normalizeDocument(r.orgaoEntidadeCnpj ?? ""),
    city: string(r.unidadeOrgaoMunicipioNome),
    state: string(r.unidadeOrgaoUfSigla),
    estimatedValue: numeric(r.valorTotalEstimado),
    awardedValue: numeric(r.valorTotalHomologado),
    publishedAt: day(r.dataPublicacaoPncp),
    openingAt: day(r.dataAberturaPropostaPncp),
    closingAt: day(r.dataEncerramentoPropostaPncp),
  };
}
const resultCancelled = (r: Raw): boolean =>
  !!r.dataCancelamentoPncp ||
  r.cancelado === true ||
  /cancelad/i.test(string(r.situacaoCompraItemResultadoNome));

export function mapPurchaseResultStates(
  items: Raw[],
  results: Raw[],
): PurchaseResultState[] {
  const states = new Map<string, PurchaseResultState>();
  for (const item of items) {
    const id = string(item.idCompraItem);
    const itemNumber = string(item.numeroItemPncp);
    if (!id || !itemNumber) continue;
    for (const result of results) {
      if (string(result.idCompraItem) !== id) continue;
      const supplierDocument = normalizeDocument(result.niFornecedor ?? "");
      if (!supplierDocument) continue;
      const key = JSON.stringify([itemNumberIdentity(itemNumber), supplierDocument]);
      const previous = states.get(key);
      states.set(key, {
        itemNumber,
        supplierDocument,
        cancelled: (previous?.cancelled ?? true) && resultCancelled(result),
      });
    }
  }
  return [...states.values()];
}

export function mapPurchaseItems(items: Raw[], results: Raw[]): PurchaseItem[] {
  const rawItems = [...items];
  const known = new Set(
    items.map((i) => string(i.idCompraItem)).filter(Boolean),
  );
  // Keep result-only items visible when upstream has results but omitted the item endpoint row.
  for (const result of results) {
    const id = string(result.idCompraItem);
    if (id && !known.has(id)) {
      known.add(id);
      rawItems.push({
        idCompraItem: id,
        numeroItemPncp: result.numeroItemPncp,
      });
    }
  }
  return rawItems.map((item, index) => {
    const id = string(item.idCompraItem);
    const own = results.filter(
      (result) => id && string(result.idCompraItem) === id,
    );
    const mapped: PurchaseResult[] = own.map((r, i) => ({
      externalId: `${id}:${string(r.sequencialResultado) || i}:${i}`,
      supplierDocument: normalizeDocument(r.niFornecedor ?? ""),
      supplierName: string(r.nomeRazaoSocialFornecedor ?? r.nomeFornecedor),
      quantity: numeric(r.quantidadeHomologada),
      unitPrice: numeric(r.valorUnitarioHomologado),
      totalValue: numeric(r.valorTotalHomologado),
      status: string(r.situacaoCompraItemResultadoNome),
      cancelled: resultCancelled(r),
      cancelledAt: nullable(r.dataCancelamentoPncp),
      resultDate: day(r.dataResultadoPncp),
    }));
    return {
      externalId: id || `missing:${index}`,
      number: string(item.numeroItemCompra ?? item.numeroItemPncp),
      description: string(item.descricaodetalhada ?? item.descricaoResumida),
      unit: string(item.unidadeMedida),
      quantity: numeric(item.quantidade),
      estimatedUnitPrice: numeric(item.valorUnitarioEstimado),
      estimatedTotal: numeric(item.valorTotal),
      status: string(item.situacaoCompraItemNome),
      results: mapped,
    };
  });
}
export function mapPublicRecord(r: Raw) {
  return {
    externalId: string(r.numeroControlePncpAta),
    number: string(r.numeroAtaRegistroPreco),
    uasg: string(r.codigoUnidadeGerenciadora),
    unitName: string(r.nomeUnidadeGerenciadora),
    organizationName: string(r.nomeOrgao),
    purchaseExternalId: nullable(r.idCompra),
    purchasePncpId: nullable(r.numeroControlePncpCompra),
    purchaseNumber: string(r.numeroCompra),
    purchaseYear: integer(r.anoCompra),
    object: string(r.objeto),
    startDate: day(r.dataVigenciaInicial),
    endDate: day(r.dataVigenciaFinal),
    totalValue: numeric(r.valorTotal),
    itemsCount: integer(r.quantidadeItens),
    situation: string(r.statusAta),
  };
}
export function linkedToPurchase(record: Raw, purchase: Raw): boolean {
  if (record.purchaseExternalId && purchase.externalId)
    return record.purchaseExternalId === purchase.externalId;
  return !!(
    record.purchasePncpId &&
    purchase.pncpId &&
    record.purchasePncpId === purchase.pncpId
  );
}

export function mapRecordItems(
  items: Raw[],
  purchaseItems: Raw[] = [],
): PublicRecordItem[] {
  return items.map((i) => {
    // ARP uses the PNCP item number; the purchase item can have a different internal number.
    const matches = purchaseItems.filter(
      (p) =>
        itemNumberIdentity(p.numeroItemPncp ?? p.numeroItemCompra) ===
          itemNumberIdentity(i.numeroItem) &&
        (!i.idCompra ||
          !p.idCompra ||
          string(p.idCompra) === string(i.idCompra)),
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    return {
      key: string(i.numeroItem),
      number: string(i.numeroItem),
      description: string(i.descricaoItem),
      unit: string(
        i.unidadeFornecimento ?? i.unidadeMedida ?? match?.unidadeMedida,
      ),
      quantity: numeric(
        i.quantidadeHomologadaVencedor ?? i.quantidadeHomologadaItem,
      ),
      unitPrice: numeric(i.valorUnitario),
      totalValue: numeric(i.valorTotal),
      brand: string(i.marca),
      model: string(i.modelo),
      supplierDocument: normalizeDocument(i.niFornecedor ?? ""),
      supplierName: string(i.nomeRazaoSocialFornecedor),
    };
  });
}
export function mapUnits(rows: Raw[]): UnitRow[] {
  return rows.map((r) => ({
    code: string(r.codigoUnidade),
    name: string(r.nomeUnidade),
    type: string(r.tipoUnidade),
    supplierDocument: normalizeDocument(r.fornecedor ?? ""),
    quantity: numeric(r.quantidadeRegistrada),
    adhesionBalance: numeric(r.saldoAdesoes),
    commitmentBalance: numeric(r.saldoRemanejamentoEmpenho),
    excluded: !!r.dataHoraExclusao,
  }));
}
export function mapCommitments(rows: Raw[], item: string): CommitmentRow[] {
  return rows
    .filter((r) => itemNumberIdentity(r.numeroItem) === itemNumberIdentity(item))
    .map((r) => ({
      unit: string(r.unidade),
      type: string(r.tipo),
      quantity: numeric(r.quantidadeRegistrada),
      committed: numeric(r.quantidadeEmpenhada),
      balance: numeric(r.saldoEmpenho),
    }));
}
export function mapAdhesions(rows: Raw[]): AdhesionRow[] {
  return rows.map((r) => ({
    unit: string(r.unidadeNaoParticipante),
    approvedAt: nullable(r.dataAprovacaoAnalise),
    quantity: numeric(r.quantidadeAprovadaAdesao),
  }));
}
export function requireIdentity(value: string, kind: string) {
  if (!value)
    throw new BadGatewayException(
      `A API pública retornou ${kind} sem identificador oficial. Nenhum dado foi importado.`,
    );
}
