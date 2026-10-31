import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../src/app";
import { ServiceUnavailableException } from "@nestjs/common";
import { CatalogClient } from "../../src/catalog/client";
import { Database } from "../../src/database";

test("catalog HTTP snapshots, cross-year links, supplements and supplier drafts preserve local data", async () => {
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const db = app.get(Database);
  const marker = `CAT-${Date.now()}`;
  const req = async (path: string, method = "GET", body?: unknown) =>
    fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await req(path, method, body);
    const json = await response.json();
    assert.ok(
      response.ok,
      `${method} ${path} ${response.status}: ${JSON.stringify(json)}`,
    );
    return json;
  };
  let failAdhesions = false,
    failDetail = false,
    reactivateCancelled = false;
  const supplierA = "11222333000181",
    supplierB = "52998224725",
    supplierC = "11144477735";
  const header = {
    idCompra: marker,
    numeroControlePNCP: `PNCP-${marker}`,
    numeroCompra: "90001",
    anoCompraPncp: 2025,
    unidadeOrgaoCodigoUnidade: "999999",
    objetoCompra: "Aquisição pública",
    srp: true,
    processo: "Processo público",
    orgaoEntidadeRazaoSocial: "Órgão de teste",
    orgaoEntidadeCnpj: supplierA,
    unidadeOrgaoMunicipioNome: "Brasília",
    unidadeOrgaoUfSigla: "DF",
    modalidadeNome: "Pregão - Eletrônico",
    codigoModalidade: 5,
    dataPublicacaoPncp: "2025-12-30",
    valorTotalEstimado: "0.1",
    valorTotalHomologado: "0.2",
  };
  const rawItems = [
    {
      idCompra: marker,
      idCompraItem: `${marker}-item`,
      numeroItemCompra: 7,
      numeroItemPncp: 1,
      descricaoResumida: "Material",
      unidadeMedida: "UN",
      quantidade: "0.1",
    },
  ];
  const ata = {
    numeroControlePncpAta: `ATA-${marker}`,
    numeroAtaRegistroPreco: marker,
    codigoUnidadeGerenciadora: "999999",
    nomeUnidadeGerenciadora: "Unidade",
    nomeOrgao: "Órgão",
    idCompra: marker,
    numeroControlePncpCompra: header.numeroControlePNCP,
    numeroCompra: "90001",
    anoCompra: "2025",
    objeto: "Material público",
    codigoModalidadeCompra: "05",
    nomeModalidadeCompra: "Pregão",
    dataVigenciaInicial: "2026-01-01",
    dataVigenciaFinal: "2027-01-01",
    quantidadeItens: 3,
    valorTotal: "0.04",
  };
  const ataItems = [supplierA, supplierB, supplierC].map((supplier, index) => ({
    numeroControlePncpAta: ata.numeroControlePncpAta,
    idCompra: marker,
    numeroItem: "00001",
    descricaoItem: "Material",
    niFornecedor: supplier,
    nomeRazaoSocialFornecedor: `Fornecedor ${index + 1}`,
    quantidadeHomologadaVencedor: "0.1",
    valorUnitario: "0.2",
    valorTotal: "0.02",
  }));
  try {
    // This assertion was RED before the catalog controllers were registered.
    assert.equal((await req("/purchases?uasg=999999")).status, 200);
    const client = app.get(CatalogClient);
    Object.assign(client, {
      purchases: async () => [header],
      purchase: async () => {
        if (failDetail)
          throw new ServiceUnavailableException("Fonte pública indisponível");
        return {
          headers: [header],
          items: rawItems,
          results: [
            {
              idCompra: marker,
              idCompraItem: rawItems[0].idCompraItem,
              sequencialResultado: 1,
              niFornecedor: supplierA,
              quantidadeHomologada: "0.1",
              valorUnitarioHomologado: "0.2",
            },
            {
              idCompra: marker,
              idCompraItem: rawItems[0].idCompraItem,
              sequencialResultado: 2,
              niFornecedor: supplierB,
            },
            {
              idCompra: marker,
              idCompraItem: rawItems[0].idCompraItem,
              sequencialResultado: 3,
              niFornecedor: supplierC,
              dataCancelamentoPncp: "2026-01-01T10:00:00",
            },
            ...(reactivateCancelled
              ? [
                  {
                    idCompra: marker,
                    idCompraItem: rawItems[0].idCompraItem,
                    sequencialResultado: 4,
                    niFornecedor: supplierC,
                    cancelado: false,
                  },
                ]
              : []),
          ],
        };
      },
      records: async (_uasg: string, from: string, to: string) => {
        assert.equal(from, "2025-01-01");
        assert.equal(to, "2026-12-31");
        return [
          ata,
          {
            ...ata,
            numeroControlePncpAta: null,
            numeroAtaRegistroPreco: "INCOMPLETE",
          },
          {
            ...ata,
            numeroControlePncpAta: `OTHER-${marker}`,
            idCompra: "foreign",
            numeroControlePncpCompra: header.numeroControlePNCP,
          },
        ];
      },
      record: async () => ({ headers: [ata], items: ataItems }),
      units: async (_number: string, _uasg: string, item: string) => {
        assert.equal(item, "00001");
        return [
          {
            codigoUnidade: "999999",
            nomeUnidade: "Participante",
            fornecedor: supplierA,
            quantidadeRegistrada: "0.1",
          },
        ];
      },
      commitments: async () => [
        { numeroItem: "2", quantidadeRegistrada: "999" },
        {
          numeroItem: "1",
          unidade: "999999",
          quantidadeRegistrada: "0.1",
          quantidadeEmpenhada: "0.05",
          saldoEmpenho: "0.05",
        },
      ],
      adhesions: async () => {
        if (failAdhesions) throw new Error("offline");
        return [
          {
            unidadeNaoParticipante: "888888",
            quantidadeAprovadaAdesao: "0.02",
          },
        ];
      },
    });
    assert.deepEqual(
      await call("/purchases/sync", "POST", {
        uasg: "999999",
        from: "2025-01-01",
        to: "2025-12-31",
      }),
      { created: 1, updated: 0, total: 1 },
    );
    const list = await call(`/purchases?search=${marker}`);
    assert.equal(list.total, 0); // Search uses public number/object, not opaque technical identity.
    const saved = await db.publicPurchase.findUniqueOrThrow({
        where: { externalId: marker },
      }),
      id = saved.id;
    let purchase = await call(`/purchases/${id}/refresh`, "POST");
    assert.equal(purchase.items[0].results.length, 3);
    assert.equal(purchase.items[0].results[2].cancelled, true);
    await call("/purchases/sync", "POST", {
      uasg: "999999",
      from: "2025-01-01",
      to: "2025-12-31",
    });
    purchase = await call(`/purchases/${id}`);
    assert.equal(purchase.items[0].results.length, 3);
    failDetail = true;
    assert.ok((await req(`/purchases/${id}/refresh`, "POST")).status >= 500);
    assert.equal((await call(`/purchases/${id}`)).items[0].results.length, 3);
    failDetail = false;
    const linked = await call(`/purchases/${id}/records/refresh`, "POST", {});
    assert.equal(linked.total, 1);
    assert.deepEqual(linked.recordsLookup, {
      incompleteRecords: [{ number: "INCOMPLETE" }],
    });
    const refreshedPurchase = await call(`/purchases/${id}/refresh`, "POST");
    assert.deepEqual(refreshedPurchase.recordsLookup, linked.recordsLookup);
    const readPurchase = await call(`/purchases/${id}`);
    assert.equal(readPurchase.items[0].results.length, 3);
    assert.deepEqual(readPurchase.recordsLookup, linked.recordsLookup);
    assert.equal(
      await db.publicRecord.count({ where: { externalId: `OTHER-${marker}` } }),
      0,
    );
    const recordId = linked.records[0].id;
    let record = await call(`/public-records/${recordId}/refresh`, "POST");
    assert.equal(record.items.length, 3);
    assert.equal(record.items[0].unit, "UN");
    assert.equal(record.processNumber, "Processo público");
    assert.equal(record.suppliers.length, 3);
    assert.equal(record.linkedPurchaseId, id);
    let aux = await call(
      `/public-records/${recordId}/items/00001/refresh`,
      "POST",
    );
    assert.equal(aux.commitments.data.length, 1);
    assert.equal(aux.commitments.data[0].quantity, "0.1");
    assert.equal(aux.adhesions.status, "loaded");
    failAdhesions = true;
    aux = await call(`/public-records/${recordId}/items/00001/refresh`, "POST");
    assert.equal(aux.units.status, "loaded");
    assert.equal(aux.adhesions.status, "error");
    assert.equal(aux.adhesions.data[0].quantity, "0.02");
    assert.ok(aux.adhesions.lastSyncedAt);
    const cancelledDraft = () =>
      req(`/public-records/${recordId}/draft`, "POST", {
        supplierDocument: supplierC,
      });
    assert.equal((await cancelledDraft()).status, 422);
    await call(`/public-records/${recordId}`);
    assert.equal((await cancelledDraft()).status, 422);
    // A failed optional purchase lookup must not erase the saved cancellation.
    failDetail = true;
    await call(`/public-records/${recordId}/refresh`, "POST");
    assert.equal((await cancelledDraft()).status, 422);
    const savedRecord = await db.publicRecord.findUniqueOrThrow({
      where: { id: recordId },
    });
    assert.ok(
      (savedRecord.snapshot as any).purchaseResultStates.some(
        (state: any) =>
          state.itemNumber === "1" &&
          state.supplierDocument === supplierC &&
          state.cancelled,
      ),
    );
    failDetail = false;
    const first = await call(`/public-records/${recordId}/draft`, "POST", {
      supplierDocument: supplierA,
    });
    const second = await call(`/public-records/${recordId}/draft`, "POST", {
      supplierDocument: supplierB,
    });
    assert.equal(first.created, true);
    assert.notEqual(first.id, second.id);
    // Another result for the same item and supplier prevents an all-cancelled state.
    reactivateCancelled = true;
    await call(`/public-records/${recordId}/refresh`, "POST");
    const reactivated = await call(
      `/public-records/${recordId}/draft`,
      "POST",
      {
        supplierDocument: supplierC,
      },
    );
    assert.equal(reactivated.created, true);
    const draft = await call(`/records/${first.id}`);
    assert.equal(draft.number, marker);
    assert.equal(draft.totalValue, "0.02");
    assert.equal(draft.items.length, 1);
    await call(`/records/${first.id}`, "PUT", {
      ...draft,
      object: "Edição local preservada",
      authorityName: "Pessoa local",
      items: draft.items.map((item: any) => ({
        ...item,
        warranty: "36 meses",
      })),
    });
    await db.documentExport.create({
      data: {
        recordId: first.id,
        format: "docx",
        templateVersion: "test",
        snapshot: { immutable: true },
      },
    });
    assert.deepEqual(
      await call(`/public-records/${recordId}/draft`, "POST", {
        supplierDocument: supplierA,
      }),
      { id: first.id, created: false },
    );
    const edited = await call(`/records/${first.id}`);
    assert.equal(edited.object, "Edição local preservada");
    assert.equal(edited.items[0].warranty, "36 meses");
    assert.equal(edited.exports.length, 1);
    // Source fields are read-only through the normal editor DTO.
    await call(`/records/${first.id}`, "PUT", {
      ...edited,
      sourcePublicRecordId: null,
      sourceSupplierDocument: null,
    });
    const protectedRow = await db.priceRecord.findUniqueOrThrow({
      where: { id: first.id },
    });
    assert.equal(protectedRow.sourcePublicRecordId, recordId);
    assert.equal(protectedRow.sourceSupplierDocument, supplierA);
  } finally {
    await db.priceRecord.deleteMany({
      where: { number: marker, uasg: "999999" },
    });
    await db.publicRecord.deleteMany({
      where: { externalId: { contains: marker } },
    });
    await db.publicPurchase.deleteMany({ where: { externalId: marker } });
    await app.close();
  }
});
