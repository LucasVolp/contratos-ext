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

test("automatic public endpoints share requests, retain partial cache, and bulk refresh every unique item", async () => {
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(),
    db = app.get(Database),
    client = app.get(CatalogClient);
  const marker = `AUTO-${Date.now()}`;
  const call = async (path: string, body: unknown = {}) => {
    const response = await fetch(`${base}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const purchase = await db.publicPurchase.create({
    data: {
      externalId: marker,
      uasg: "999998",
      number: marker,
      srp: true,
      year: 2026,
      summary: {},
      snapshot: { items: [{ number: "cached" }] },
    },
  });
  const record = await db.publicRecord.create({
    data: {
      externalId: `ATA-${marker}`,
      uasg: "999998",
      number: marker,
      summary: {},
      detailsSyncedAt: new Date(),
      snapshot: {
        items: [
          { key: "00001", supplierDocument: "a" },
          { key: "1", supplierDocument: "b" },
          { key: "2", supplierDocument: "c" },
        ],
      },
    },
  });
  let purchaseCalls = 0,
    recordsCalls = 0,
    units = 0,
    commitments = 0,
    adhesions = 0,
    fail = false;
  Object.assign(client, {
    purchase: async () => {
      purchaseCalls++;
      await new Promise((r) => setTimeout(r, 10));
      throw Error("offline");
    },
    records: async () => {
      recordsCalls++;
      throw Error("offline");
    },
    record: async () => {
      throw Error("offline");
    },
    units: async () => {
      units++;
      return [{ codigoUnidade: "u" }];
    },
    commitments: async () => {
      commitments++;
      return [{ numeroItem: "1", quantidadeRegistrada: "3" }];
    },
    adhesions: async () => {
      adhesions++;
      if (fail) throw Error("offline");
      return [{ unidadeNaoParticipante: "u", quantidadeAprovadaAdesao: "2" }];
    },
  });
  try {
    const [first, second] = await Promise.all([
      call(`/purchases/${purchase.id}/ensure-details`),
      call(`/purchases/${purchase.id}/ensure-details`),
    ]);
    assert.equal(first.status, 201);
    assert.deepEqual(first, second);
    assert.ok(first.body.errors.details);
    assert.ok(first.body.errors.records);
    assert.equal(first.body.data.items[0].number, "cached");
    assert.deepEqual([purchaseCalls, recordsCalls], [1, 1]);
    await call(`/purchases/${purchase.id}/ensure-details`);
    assert.deepEqual([purchaseCalls, recordsCalls], [1, 1]);
    await call(`/purchases/${purchase.id}/ensure-details`, { force: true });
    assert.deepEqual([purchaseCalls, recordsCalls], [2, 2]);
    const fresh = await call(`/public-records/${record.id}/ensure-details`);
    assert.deepEqual(fresh.body.errors, {});
    const failed = await call(`/public-records/${record.id}/ensure-details`, {
      force: true,
    });
    assert.ok(failed.body.errors.details);
    assert.equal(failed.body.data.items.length, 3);
    const [bulk, duplicate] = await Promise.all([
      call(`/public-records/${record.id}/supplements/refresh`),
      call(`/public-records/${record.id}/supplements/refresh`),
    ]);
    assert.equal(bulk.status, 201);
    assert.deepEqual(bulk, duplicate);
    assert.deepEqual(bulk.body.summary, { items: 2, loaded: 2, failed: 0 });
    assert.deepEqual([units, commitments, adhesions], [2, 1, 2]);
    assert.deepEqual(
      bulk.body.data.items[0].supplement,
      bulk.body.data.items[1].supplement,
    );
    await call(`/public-records/${record.id}/supplements/refresh`);
    assert.deepEqual([units, commitments, adhesions], [2, 1, 2]);
    fail = true;
    const partial = await call(
      `/public-records/${record.id}/supplements/refresh`,
      { force: true },
    );
    assert.equal(partial.status, 201);
    assert.ok(partial.body.errors.supplements);
    assert.deepEqual(partial.body.summary, { items: 2, loaded: 0, failed: 2 });
    assert.equal(
      partial.body.data.items[0].supplement.adhesions.status,
      "error",
    );
    assert.equal(
      partial.body.data.items[0].supplement.adhesions.data[0].quantity,
      "2",
    );
    await call(`/public-records/${record.id}/supplements/refresh`);
    assert.equal(adhesions, 4);
    await db.publicRecord.update({
      where: { id: record.id },
      data: { detailsSyncedAt: null },
    });
    assert.equal(
      (await call(`/public-records/${record.id}/supplements/refresh`)).status,
      422,
    );
    assert.equal(
      (
        await call(
          "/public-records/00000000-0000-4000-8000-000000000000/ensure-details",
        )
      ).status,
      404,
    );
  } finally {
    await db.publicRecord.delete({ where: { id: record.id } });
    await db.publicPurchase.delete({ where: { id: purchase.id } });
    await app.close();
  }
});
