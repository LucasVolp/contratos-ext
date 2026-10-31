import { test } from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { DocumentService, renderDocx } from "../src/documents";
import { validateRecord } from "../src/domain";
export const complete = {
  ...validateRecord({
    number: "77/2026",
    object: "Equipamentos de teste",
    uasg: "999999",
    processNumber: "Proc-XYZ",
    purchaseNumber: "12/2026",
    organizationName: "Órgão Exemplo",
    organizationDocument: "12345678000199",
    organizationStreet: "Rua Exemplo",
    organizationCity: "Brasília",
    organizationState: "DF",
    authorityName: "Ana Silva",
    authorityRole: "Diretora",
    supplierName: "Fornecedor Exemplo",
    supplierDocument: "98765432000199",
    items: [
      {
        number: 1,
        description: "Cadeira ABC",
        unit: "UN",
        quantity: "3",
        minimumQuantity: "1",
        unitPrice: "0.10",
      },
    ],
  }),
  id: "record",
  items: [
    {
      id: "item",
      number: 1,
      description: "Cadeira ABC",
      brand: "Marca",
      model: "Modelo",
      unit: "UN",
      quantity: "3",
      minimumQuantity: "1",
      unitPrice: "0.10",
      warranty: "12 meses",
    },
  ],
};
test("original styled Word template fills identifying fields, supplier document and all item tags", () => {
  const buffer = renderDocx(complete);
  const zip = new PizZip(buffer);
  const xml = zip.file("word/document.xml")!.asText();
  assert.ok(xml.includes("77/2026"));
  assert.ok(xml.includes("Proc-XYZ"));
  assert.ok(xml.includes("Cadeira ABC"));
  assert.ok(xml.includes("98.765.432/0001-99"));
  assert.ok(xml.includes("styles") || zip.file("word/styles.xml"));
  assert.ok(!/\{[^}]+\}/.test(xml));
  assert.ok(!xml.includes("undefined"));
  assert.ok(!xml.includes("XX do"));
  assert.ok(!xml.includes("SAGA"));
});
test("export failure never persists history", async () => {
  let writes = 0;
  const db: any = {
    documentExport: {
      create: async () => {
        writes++;
      },
    },
  };
  const app: any = { record: async () => complete };
  const converter = async () => {
    throw new Error("offline");
  };
  await assert.rejects(
    () => new DocumentService(db, app, converter).generate("record", "pdf"),
    /PDF|Gotenberg|offline/,
  );
  assert.equal(writes, 0);
});
test("successful export stores immutable full snapshot with version and selected item", async () => {
  let saved: any;
  const db: any = {
    documentExport: {
      create: async ({ data }: any) => {
        saved = data;
      },
    },
  };
  const app: any = { record: async () => complete };
  const result = await new DocumentService(db, app).generate(
    "record",
    "docx",
    "item",
  );
  assert.ok(result.buffer.length > 10000);
  assert.equal(saved.format, "docx");
  assert.equal(saved.snapshot.record.number, "77/2026");
  assert.equal(saved.snapshot.itemId, "item");
  assert.equal(saved.itemNumber, 1);
  assert.ok(saved.templateVersion);
});
test("incomplete export returns the exact same readiness fields", async () => {
  const app: any = {
    record: async () =>
      validateRecord({ number: "1", object: "Objeto", uasg: "123" }),
  };
  await assert.rejects(
    () => new DocumentService({}, app).generate("x", "docx"),
    (e: any) =>
      e.getStatus() === 422 &&
      e.getResponse().missingFields.includes("supplierDocument"),
  );
});

test("purchase year completes an imported purchase reference without duplicating a year", () => {
  for (const purchaseNumber of ["90001", "90001/2025"]) {
    const xml = new PizZip(
      renderDocx({ ...complete, purchaseNumber, purchaseYear: 2025 }),
    )
      .file("word/document.xml")!
      .asText();
    assert.ok(xml.includes("90001/2025"));
    assert.ok(!xml.includes("90001/2025/2025"));
  }
});

test("Word output uses clean legal text and readable non-splitting table rows", () => {
  const zip = new PizZip(renderDocx(complete));
  for (const name of [
    "word/document.xml",
    "word/styles.xml",
    "word/numbering.xml",
  ]) {
    const xml = zip.file(name)!.asText();
    assert.ok(
      !/<w:color\b[^>]*w:val="(?!000000")[^"]+"/.test(xml),
      `${name} contains colored text`,
    );
    assert.ok(
      !/w:fill="ffff00"/i.test(xml),
      `${name} contains editing highlights`,
    );
    assert.ok(
      !/<w:i(?:Cs)?(?:\s[^>]*)?\/>/.test(xml),
      `${name} contains instruction italics`,
    );
  }
  const xml = zip.file("word/document.xml")!.asText();
  assert.ok(
    !zip.file("word/numbering.xml")!.asText().includes('w:val="nothing"'),
    "clause numbers need separation from text",
  );
  assert.ok(xml.includes("w:tblHeader"));
  assert.ok(xml.includes("w:cantSplit"));
  assert.ok(!xml.includes("se exigida no edital"));
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  assert.ok(
    !paragraphs.some(
      (p) => p.includes("<w:numPr>") && !/<w:t(?:\s[^>]*)?>[^<\s]/.test(p),
    ),
    "empty numbered paragraph",
  );
  const widths = [...xml.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"/g)].map(
    (match) => Number(match[1]),
  );
  assert.ok(widths[1] >= 2000, "description needs more room");
  assert.ok(widths[7] >= 1200, "currency needs enough room");
});
