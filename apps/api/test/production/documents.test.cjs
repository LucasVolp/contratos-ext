const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DocumentService, TEMPLATE_VERSION } = require("../../dist/documents");
const { validateRecord } = require("../../dist/domain");

for (const format of ["docx", "pdf"]) {
  test(`compiled CommonJS ${format} export persists the module template version with existing export history`, async () => {
    const record = {
      ...validateRecord({
        number: "77/2026",
        object: "Objeto de teste",
        uasg: "123456",
        processNumber: "Processo 1",
        purchaseNumber: "90001",
        purchaseYear: 2026,
        organizationName: "Organização de teste",
        organizationDocument: "12345678000199",
        organizationStreet: "Rua de teste",
        organizationCity: "Brasília",
        organizationState: "DF",
        authorityName: "Pessoa de teste",
        authorityRole: "Diretor",
        supplierName: "Fornecedor de teste",
        supplierDocument: "98765432000199",
        items: [
          {
            number: 1,
            description: "Material",
            unit: "UN",
            quantity: "2",
            minimumQuantity: "0",
            unitPrice: "3.50",
          },
        ],
      }),
      id: "record",
      exports: [],
    };
    let saved;
    const db = {
      documentExport: {
        create: async ({ data }) => {
          assert.equal(data.templateVersion, TEMPLATE_VERSION);
          assert.equal(data.snapshot.templateVersion, TEMPLATE_VERSION);
          saved = structuredClone(data);
        },
      },
    };
    const service = new DocumentService(
      db,
      { record: async () => record },
      async () => Buffer.from("%PDF-compiled-regression"),
    );
    const result = await service.generate("record", format);
    assert.ok(TEMPLATE_VERSION);
    assert.equal(saved.format, format);
    assert.equal(saved.snapshot.record.number, "77/2026");
    assert.equal("exports" in saved.snapshot.record, false);
    assert.equal(result.filename, `ata-77-2026.${format}`);
    assert.ok(result.buffer.length > 0);
  });
}
