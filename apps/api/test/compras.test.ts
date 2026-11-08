import { test } from "node:test";
import assert from "node:assert/strict";
import { ComprasClient, mapImportedRecord } from "../src/compras";

test("public pagination collects every page with official parameter names", async () => {
  const urls: URL[] = [];
  const client = new ComprasClient(async (input: any) => {
    const url = new URL(String(input));
    urls.push(url);
    return Response.json({
      resultado: [{ page: Number(url.searchParams.get("pagina")) }],
      totalPaginas: 2,
    });
  });
  const data = await client.pages("/test", { codigoUnidadeGestora: "123" });
  assert.equal(data.length, 2);
  assert.equal(urls[1].searchParams.get("pagina"), "2");
  assert.equal(urls[0].searchParams.get("codigoUnidadeGestora"), "123");
});
test("pagination fails the entire fetch when later page fails", async () => {
  let calls = 0;
  const client = new ComprasClient(async () =>
    ++calls === 1
      ? Response.json({ resultado: [{}], totalPaginas: 2 })
      : new Response("Indisponível", { status: 500 }),
  );
  await assert.rejects(() => client.pages("/test", {}), /Compras.gov/);
});
test("multiple suppliers cannot be silently flattened into a single document", () => {
  assert.throws(
    () =>
      mapImportedRecord(
        { numeroAtaRegistroPreco: "1" },
        [
          { numeroItem: 1, niFornecedor: "11222333000181" },
          { numeroItem: 2, niFornecedor: "52998224725" },
        ],
        "000123",
      ),
    /fornecedores/,
  );
});
test("imported incomplete ata remains an editable draft and unrelated items are excluded", () => {
  const record = mapImportedRecord(
    {
      numeroAtaRegistroPreco: "1",
      objeto: "Papel",
      numeroControlePncpAta: "pncp",
    },
    [
      {
        numeroItem: 1,
        niFornecedor: "11222333000181",
        numeroControlePncpAta: "pncp",
        valorUnitario: "0.2",
        quantidadeHomologadaItem: "0.1",
      },
    ],
    "000123",
  );
  assert.equal(record.supplierDocument, "11222333000181");
  assert.equal(record.items[0].unitPrice, "0.2");
  assert.equal(record.organizationStreet, "");
});

test("ata modality uses Compras.gov codes 06 Dispensa and 05 Pregão", () => {
  for (const codigoModalidadeCompra of ["06", 6]) {
    assert.equal(
      mapImportedRecord(
        { numeroAtaRegistroPreco: "1", codigoModalidadeCompra },
        [],
        "000123",
      ).modality,
      "DISPENSA",
    );
  }
  assert.equal(
    mapImportedRecord(
      {
        numeroAtaRegistroPreco: "1",
        codigoModalidadeCompra: "05",
        nomeModalidadeCompra: "Pregão",
      },
      [],
      "000123",
    ).modality,
    "PREGAO",
  );
});

test("known modality names are normalized when a public code is missing or inconsistent", () => {
  assert.equal(
    mapImportedRecord(
      {
        numeroAtaRegistroPreco: "1",
        nomeModalidadeCompra: " DISPENSA ELETRÔNICA ",
      },
      [],
      "000123",
    ).modality,
    "DISPENSA",
  );
  assert.equal(
    mapImportedRecord(
      {
        numeroAtaRegistroPreco: "1",
        codigoModalidadeCompra: "08",
        nomeModalidadeCompra: "Dispensa",
      },
      [],
      "000123",
    ).modality,
    "DISPENSA",
  );
  assert.equal(
    mapImportedRecord(
      {
        numeroAtaRegistroPreco: "1",
        nomeModalidadeCompra: "Pregao - Eletronico",
      },
      [],
      "000123",
    ).modality,
    "PREGAO",
  );
});

test("unsupported named modalities cannot silently become a pregão document", () => {
  assert.throws(
    () =>
      mapImportedRecord(
        {
          numeroAtaRegistroPreco: "1",
          codigoModalidadeCompra: "03",
          nomeModalidadeCompra: "Concorrência",
        },
        [],
        "000123",
      ),
    (error: any) =>
      error.statusCode === 422 && /modalidade/i.test(error.message),
  );
});
