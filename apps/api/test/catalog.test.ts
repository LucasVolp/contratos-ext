import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapPurchase,
  mapPurchaseItems,
  mapPurchaseResultStates,
  mapPublicRecord,
  mapRecordItems,
  mapCommitments,
  linkedToPurchase,
} from "../src/catalog/mappers";
import { purchaseResultEvidence } from "../src/catalog/purchase-evidence";
import { CatalogClient } from "../src/catalog/client";
import { CatalogService } from "../src/catalog/service";
const supplier = "11222333000181";
test("public summaries preserve opaque identities, unknown values and tri-state SRP", () => {
  const p = mapPurchase({
    idCompra: "000ABC",
    numeroCompra: "90001",
    anoCompraPncp: 2025,
    unidadeOrgaoCodigoUnidade: "158148",
    valorTotalEstimado: null,
    srp: null,
  });
  assert.equal(p.externalId, "000ABC");
  assert.equal(p.srp, null);
  assert.equal(p.estimatedValue, null);
  assert.equal(mapPurchase({ idCompra: "a", srp: false }).srp, false);
  const ata = mapPublicRecord({
    numeroControlePncpAta: "pncp/2025-001",
    idCompra: "000ABC",
    numeroCompra: "90001",
    anoCompra: "2025",
    dataVigenciaInicial: "2026-01-01",
  });
  assert.equal(ata.purchaseExternalId, "000ABC");
  assert.equal(ata.startDate, "2026-01-01");
  assert.equal(
    linkedToPurchase(ata, { externalId: "000ABC", pncpId: "other" }),
    true,
  );
  assert.equal(
    linkedToPurchase(
      { ...ata, purchaseExternalId: "other", purchasePncpId: null },
      { externalId: "ABC", number: "90001", year: 2025 },
    ),
    false,
  );
});
test("item-result join uses exact id and retains multiple results and cancelled rows", () => {
  const items = mapPurchaseItems(
    [
      {
        idCompraItem: "001",
        numeroItemCompra: 7,
        numeroItemPncp: 2,
        descricaoResumida: "A",
        quantidade: "0.1",
        unidadeMedida: "UN",
      },
    ],
    [
      {
        idCompraItem: "001",
        sequencialResultado: 1,
        niFornecedor: supplier,
        quantidadeHomologada: "0.1",
        valorUnitarioHomologado: "0.2",
      },
      {
        idCompraItem: "001",
        sequencialResultado: 2,
        niFornecedor: supplier,
        dataCancelamentoPncp: "2026-01-02T10:00:00",
      },
      {
        idCompraItem: "different",
        sequencialResultado: 1,
        niFornecedor: "52998224725",
      },
    ],
  );
  assert.equal(items[0].number, "7");
  assert.equal(items[0].results.length, 2);
  assert.equal(items[0].results[0].quantity, "0.1");
  assert.equal(items[0].results[1].cancelled, true);
  assert.notEqual(
    items[0].results[0].externalId,
    items[0].results[1].externalId,
  );
});
test("published items retain alphanumeric supplier documents and exact source correspondence for units", () => {
  const rows = mapRecordItems(
    [
      {
        numeroItem: 2,
        niFornecedor: "12.ABC.345/01DE-35",
        descricaoItem: "A",
        quantidadeHomologadaVencedor: "0.25",
        valorUnitario: "0.10",
      },
    ],
    [
      {
        idCompraItem: "x",
        numeroItemCompra: 7,
        numeroItemPncp: 2,
        unidadeMedida: "KG",
      },
    ],
  );
  assert.equal(rows[0].supplierDocument, "12ABC34501DE35");
  assert.equal(rows[0].quantity, "0.25");
  assert.equal(rows[0].unit, "KG");
});
test("catalog client divides linked record windows across years without unofficial purchase filter", async () => {
  const calls: any[] = [];
  const transport: any = {
    pages: async (path: string, params: any) => {
      calls.push({ path, params });
      return [];
    },
  };
  await new CatalogClient(transport).records(
    "158148",
    "2025-01-01",
    "2026-12-31",
  );
  assert.ok(calls.length >= 2);
  assert.equal(calls[0].params.dataVigenciaInicialMin, "2025-01-01");
  assert.equal(calls.at(-1).params.dataVigenciaInicialMax, "2026-12-31");
  assert.ok(calls.every((c) => !("numeroCompra" in c.params)));
});
test("catalog synchronization collects all external data before any transaction", async () => {
  let writes = 0;
  const db: any = {
    $transaction: async () => {
      writes++;
    },
  };
  const client: any = {
    purchases: async () => {
      throw new Error("page two failed");
    },
  };
  await assert.rejects(
    () =>
      new CatalogService(db, client).syncPurchases({
        uasg: "158148",
        from: "2026-01-01",
        to: "2026-12-31",
      }, null),
    /page two/,
  );
  assert.equal(writes, 0);
});
test("summary sync never includes details in update and preserves existing item snapshots", async () => {
  const updates: any[] = [];
  const tx: any = {
    publicPurchase: {
      findUnique: async () => ({
        id: "old",
        snapshot: { items: [{ description: "saved" }] },
      }),
      upsert: async (arg: any) => {
        updates.push(arg);
        return arg.update;
      },
    },
  };
  const db: any = { $transaction: async (fn: any) => fn(tx) };
  const client: any = {
    purchases: async () => [
      { idCompra: "a", numeroCompra: "1", unidadeOrgaoCodigoUnidade: "158148" },
    ],
  };
  assert.deepEqual(
    await new CatalogService(db, client).syncPurchases({
      uasg: "158148",
      from: "2026-01-01",
      to: "2026-12-31",
    }, null),
    { created: 0, updated: 1, total: 1 },
  );
  assert.equal("snapshot" in updates[0].update, false);
  assert.equal("detailsSyncedAt" in updates[0].update, false);
});
test("existing source supplier draft is returned without touching any local data", async () => {
  let writes = 0;
  const db: any = {
    publicRecord: {
      findUnique: async () => ({
        id: "ata",
        detailsSyncedAt: new Date(),
        snapshot: {},
      }),
    },
    priceRecord: {
      findUnique: async () => ({
        id: "draft",
        object: "Edited",
        exports: [{}],
      }),
      create: async () => {
        writes++;
      },
    },
  };
  assert.deepEqual(
    await new CatalogService(db, {} as any).draft("ata", {
      supplierDocument: supplier,
    }),
    { id: "draft", created: false },
  );
  assert.equal(writes, 0);
});
test("a contradictory purchase id cannot be overridden by a matching PNCP field", () => {
  assert.equal(
    linkedToPurchase(
      { purchaseExternalId: "foreign", purchasePncpId: "same" },
      { externalId: "own", pncpId: "same" },
    ),
    false,
  );
});
test("invalid public dates stay unknown rather than creating impossible calendar values", () => {
  const row = mapPurchase({
    idCompra: "a",
    dataPublicacaoPncp: "2026-02-30T00:00:00",
  });
  assert.equal(row.publishedAt, null);
});

test("purchase sync includes the final publication day and excludes next-day boundary rows", async () => {
  const calls: any[] = [];
  const transport: any = {
    pages: async (_path: string, params: any) => {
      calls.push(params);
      return params.dataPublicacaoPncpFinal === "2025-11-19"
        ? [
            { idCompra: "late18", dataPublicacaoPncp: "2025-11-18T07:00:00" },
            {
              idCompra: "midnight19",
              dataPublicacaoPncp: "2025-11-19T00:00:00",
            },
          ]
        : [];
    },
  };
  const rows = await new CatalogClient(transport).purchases(
    "158148",
    "2025-11-18",
    "2025-11-18",
  );
  assert.deepEqual(
    rows.map((row) => row.idCompra),
    ["late18"],
  );
  assert.equal(calls[0].dataPublicacaoPncpFinal, "2025-11-19");
});
test("inclusive publication windows neither lose nor duplicate the year seam", async () => {
  const calls: any[] = [];
  const all = [
    { idCompra: "last2025", dataPublicacaoPncp: "2025-12-31T07:00:00" },
    { idCompra: "first2026", dataPublicacaoPncp: "2026-01-01T00:00:00" },
    { idCompra: "outside", dataPublicacaoPncp: "2026-01-02T00:00:00" },
  ];
  const transport: any = {
    pages: async (_path: string, params: any) => {
      calls.push(params);
      return all.filter(
        (r) =>
          r.dataPublicacaoPncp >= params.dataPublicacaoPncpInicial &&
          r.dataPublicacaoPncp <= params.dataPublicacaoPncpFinal + "T00:00:00",
      );
    },
  };
  const rows = await new CatalogClient(transport).purchases(
    "158148",
    "2025-01-01",
    "2026-01-01",
  );
  assert.deepEqual(
    rows.map((row) => row.idCompra),
    ["last2025", "first2026"],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].dataPublicacaoPncpFinal, "2026-01-01");
  assert.equal(calls[1].dataPublicacaoPncpInicial, "2026-01-01");
});
test("draft excludes a supplier item whose exact purchase results are all confirmed cancelled", async () => {
  const source: any = {
    id: "ata",
    number: "77",
    object: "Material",
    uasg: "158148",
    detailsSyncedAt: new Date(),
    purchaseNumber: "90001",
    purchaseYear: 2025,
    snapshot: {
      modality: "PREGAO",
      purchaseSrp: true,
      rawItems: [{}],
      items: [
        {
          key: "1",
          number: "1",
          supplierDocument: supplier,
          supplierName: "Empresa",
          description: "Material",
          unit: "UN",
          quantity: "1",
          unitPrice: "2",
        },
      ],
      purchaseResultStates: [
        { itemNumber: "1", supplierDocument: supplier, cancelled: true },
      ],
    },
  };
  let writes = 0;
  const tx: any = {
    priceRecord: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => {
        writes++;
        return { id: "new" };
      },
    },
  };
  const db: any = {
    publicRecord: { findUnique: async () => source },
    priceRecord: { findUnique: async () => null },
    $transaction: async (fn: any) => fn(tx),
  };
  await assert.rejects(
    () =>
      new CatalogService(db, {} as any).draft("ata", {
        supplierDocument: supplier,
      }),
    (error: any) => error.getStatus() === 422,
  );
  assert.equal(writes, 0);
});

test("purchase cancellation states use exact item IDs, PNCP numbers and normalized suppliers", () => {
  const items = [
    { idCompraItem: "opaque-A", numeroItemCompra: 7, numeroItemPncp: 1 },
    { idCompraItem: "opaque-B", numeroItemCompra: 1, numeroItemPncp: 2 },
  ];
  const results = [
    {
      idCompraItem: "opaque-A",
      niFornecedor: "11.222.333/0001-81",
      cancelado: true,
    },
    {
      idCompraItem: "opaque-A",
      niFornecedor: supplier,
      dataCancelamentoPncp: "2026-01-01",
    },
    { idCompraItem: "opaque-A", niFornecedor: "52998224725", cancelado: false },
    {
      idCompraItem: "opaque-B",
      niFornecedor: supplier,
      situacaoCompraItemResultadoNome: "Cancelado",
    },
    {
      idCompraItem: "foreign",
      numeroItemPncp: 1,
      niFornecedor: supplier,
      cancelado: false,
    },
  ];
  assert.deepEqual(mapPurchaseResultStates(items, results), [
    { itemNumber: "1", supplierDocument: supplier, cancelled: true },
    { itemNumber: "1", supplierDocument: "52998224725", cancelled: false },
    { itemNumber: "2", supplierDocument: supplier, cancelled: true },
  ]);
  const active = mapPurchaseResultStates(items, [
    ...results,
    { idCompraItem: "opaque-A", niFornecedor: supplier },
  ]);
  assert.equal(
    active.find(
      (row) => row.itemNumber === "1" && row.supplierDocument === supplier,
    )?.cancelled,
    false,
  );
  assert.equal(
    active.find(
      (row) => row.itemNumber === "2" && row.supplierDocument === supplier,
    )?.cancelled,
    true,
  );
});

for (const pncpOnly of [false, true]) {
  for (const oldStates of [
    [],
    [{ itemNumber: "1", supplierDocument: supplier, cancelled: false }],
  ]) {
    test(`newer cached cancellation replaces stale ${oldStates.length ? "active" : "empty"} record evidence (${pncpOnly ? "PNCP" : "id"})`, async () => {
      const oldTime = "2026-01-01T00:00:00.000Z";
      const newTime = "2026-01-02T00:00:00.000Z";
      const header = {
        numeroControlePncpAta: "ata",
        ...(pncpOnly ? {} : { idCompra: "purchase" }),
        numeroControlePncpCompra: "pncp",
      };
      const source: any = {
        id: "ata",
        externalId: "ata",
        detailsSyncedAt: new Date(oldTime),
        snapshot: {
          items: [],
          purchaseResultStates: oldStates,
          purchaseResultsSyncedAt: oldTime,
        },
      };
      const cached: any = {
        externalId: "purchase",
        pncpId: "pncp",
        detailsSyncedAt: new Date(newTime),
        summary: { idCompra: "purchase" },
        snapshot: {
          rawItems: [{ idCompraItem: "opaque", numeroItemPncp: 1 }],
          rawResults: [
            { idCompraItem: "opaque", niFornecedor: supplier, cancelado: true },
          ],
        },
      };
      const db: any = {
        publicRecord: {
          findUnique: async () => source,
          update: async ({ data }: any) => {
            source.snapshot = data.snapshot;
          },
        },
        publicPurchase: {
          findUnique: async () => cached,
          findFirst: async () => cached,
        },
      };
      const client: any = {
        record: async () => ({ headers: [header], items: [] }),
        purchase: async () => {
          throw new Error("offline");
        },
      };
      const service = new CatalogService(db, client);
      service.record = async () => source as any;
      await service.refreshRecord("ata");
      assert.deepEqual(source.snapshot.purchaseResultStates, [
        { itemNumber: "1", supplierDocument: supplier, cancelled: true },
      ]);
      assert.equal(source.snapshot.purchaseResultsSyncedAt, newTime);
    });
  }
}

test("draft uses newer local purchase cancellation without refreshing the record", async () => {
  const source: any = {
    id: "ata",
    purchaseExternalId: "purchase",
    detailsSyncedAt: new Date("2026-01-01"),
    snapshot: {
      modality: "PREGAO",
      purchaseResultStates: [],
      purchaseResultsSyncedAt: "2026-01-01T00:00:00.000Z",
      rawItems: [{}],
      items: [{ number: "1", supplierDocument: supplier }],
    },
  };
  const cached: any = {
    detailsSyncedAt: new Date("2026-01-02"),
    snapshot: {
      rawItems: [{ idCompraItem: "opaque", numeroItemPncp: 1 }],
      rawResults: [
        { idCompraItem: "opaque", niFornecedor: supplier, cancelado: true },
      ],
    },
  };
  const db: any = {
    publicRecord: { findUnique: async () => source },
    publicPurchase: { findUnique: async () => cached },
    priceRecord: { findUnique: async () => null },
  };
  await assert.rejects(
    () =>
      new CatalogService(db, {} as any).draft("ata", {
        supplierDocument: supplier,
      }),
    (error: any) => error.getStatus?.() === 422,
  );
});

test("older cached active results preserve newer record cancellation and its evidence timestamp", () => {
  const newer = "2026-01-03T00:00:00.000Z";
  const states = [
    { itemNumber: "1", supplierDocument: supplier, cancelled: true },
  ];
  const evidence = purchaseResultEvidence(
    { purchaseResultStates: states, purchaseResultsSyncedAt: newer },
    new Date("2026-01-04"),
    {
      detailsSyncedAt: new Date("2026-01-02"),
      snapshot: {
        rawItems: [{ idCompraItem: "opaque", numeroItemPncp: 1 }],
        rawResults: [
          { idCompraItem: "opaque", niFornecedor: supplier, cancelado: false },
        ],
      },
    },
  );
  assert.deepEqual(evidence, { states, syncedAt: newer });
  assert.deepEqual(
    purchaseResultEvidence(
      {
        purchaseResultStates: evidence.states,
        purchaseResultsSyncedAt: evidence.syncedAt,
      },
      new Date("2026-01-05"),
      null,
    ),
    evidence,
  );
});

test("padded PNCP item numbers join units and commitments without changing display keys", () => {
  const rows = mapRecordItems(
    [{ numeroItem: "00001", idCompra: "opaque" }],
    [{ idCompra: "opaque", numeroItemPncp: 1, unidadeMedida: "KG" }],
  );
  assert.equal(rows[0].key, "00001");
  assert.equal(rows[0].number, "00001");
  assert.equal(rows[0].unit, "KG");
  assert.equal(
    mapCommitments(
      [{ numeroItem: 1 }, { numeroItem: "00002" }, { numeroItem: "A1" }],
      "00001",
    ).length,
    1,
  );
});

test("padded record item cannot bypass cancellation for the same numeric PNCP item", async () => {
  const source: any = {
    id: "ata",
    detailsSyncedAt: new Date(),
    snapshot: {
      modality: "PREGAO",
      purchaseResultStates: [
        { itemNumber: "1", supplierDocument: supplier, cancelled: true },
      ],
      rawItems: [{}],
      items: [{ number: "00001", supplierDocument: supplier }],
    },
  };
  const db: any = {
    publicRecord: { findUnique: async () => source },
    priceRecord: { findUnique: async () => null },
  };
  await assert.rejects(
    () =>
      new CatalogService(db, {} as any).draft("ata", {
        supplierDocument: supplier,
      }),
    (error: any) => error.getStatus?.() === 422,
  );
});

function linkedLookupFixture(rows: any[]) {
  const saved: any[] = [];
  let writes = 0;
  const purchase = {
    id: "local",
    externalId: "own",
    pncpId: "own-pncp",
    srp: true,
    year: 2025,
    uasg: "158148",
  };
  const tx: any = {
    publicRecord: {
      findUnique: async () => null,
      upsert: async ({ create }: any) => {
        saved.push({ id: "ata-local", ...create });
      },
    },
    publicPurchase: {
      update: async () => {
        writes++;
      },
    },
    $executeRaw: async () => 1,
  };
  const db: any = {
    publicPurchase: {
      findUnique: async () => purchase,
      findMany: async () => [],
    },
    publicRecord: { findMany: async () => saved },
    $transaction: async (fn: any) => fn(tx),
  };
  return {
    service: new CatalogService(db, { records: async () => rows } as any),
    saved,
    writes: () => writes,
  };
}

test("linked lookup ignores unrelated ARPs without PNCP identifiers before validating matching records", async () => {
  const f = linkedLookupFixture([
    { idCompra: "foreign", numeroAtaRegistroPreco: "LEGACY" },
    { idCompra: "foreign", numeroControlePncpCompra: "own-pncp" },
    {
      idCompra: "own",
      numeroAtaRegistroPreco: "001/2026",
      numeroControlePncpAta: "official-id",
    },
  ]);
  const result = await f.service.refreshLinkedRecords("local");
  assert.equal(result.total, 1);
  assert.equal(result.records[0].externalId, "official-id");
  assert.equal(f.writes(), 1);
});

test("matching ARPs without PNCP identifiers return a partial lookup alongside valid records", async () => {
  const f = linkedLookupFixture([
    { idCompra: "own", numeroAtaRegistroPreco: "001/2026" },
    {
      idCompra: "own",
      numeroAtaRegistroPreco: "002/2026",
      numeroControlePncpAta: "valid-id",
    },
  ]);
  const result = await f.service.refreshLinkedRecords("local");
  assert.equal(result.total, 1);
  assert.deepEqual(result.recordsLookup, {
    incompleteRecords: [{ number: "001/2026" }],
  });
  assert.equal(f.writes(), 1);
  assert.equal(f.saved.length, 1);
});

test("only incomplete matching ARPs are distinct from a confirmed absence", async () => {
  const f = linkedLookupFixture([
    { idCompra: "own", numeroAtaRegistroPreco: "001/2026" },
  ]);
  const result = await f.service.refreshLinkedRecords("local");
  assert.equal(result.total, 0);
  assert.equal(result.recordsLookup.incompleteRecords.length, 1);
  assert.equal(f.writes(), 1);
});

test("unrelated incomplete records produce a confirmed empty lookup rather than an upstream error", async () => {
  const f = linkedLookupFixture([
    { idCompra: "foreign", numeroAtaRegistroPreco: "LEGACY" },
  ]);
  const result = await f.service.refreshLinkedRecords("local");
  assert.equal(result.total, 0);
  assert.equal(f.writes(), 1);
});
test("record sync saves identified atas and reports those without official identifier", async () => {
  const stored: string[] = [];
  const tx: any = {
    publicRecord: {
      findUnique: async () => null,
      upsert: async (arg: any) => stored.push(arg.where.externalId),
    },
  };
  const db: any = { $transaction: async (fn: any) => fn(tx) };
  const client: any = {
    records: async () => [
      { numeroControlePncpAta: "ATA-1", numeroAtaRegistroPreco: "1/2026", codigoUnidadeGerenciadora: "158132" },
      { numeroControlePncpAta: "", numeroAtaRegistroPreco: "2/2026", codigoUnidadeGerenciadora: "158132" },
      { numeroControlePncpAta: "ATA-3", numeroAtaRegistroPreco: "3/2026", ataExcluido: true },
    ],
  };
  const result = await new CatalogService(db, client).syncRecords(
    { uasg: "158132", from: "2026-01-01", to: "2026-12-31" },
    null,
  );
  assert.deepEqual(stored, ["ATA-1"]);
  assert.deepEqual(result, {
    created: 1,
    updated: 0,
    total: 1,
    incompleteRecords: [{ number: "2/2026" }],
  });
});
