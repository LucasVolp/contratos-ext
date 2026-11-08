import { test } from "node:test";
import assert from "node:assert/strict";
import { ApplicationService } from "../src/service";

test("record replacement sends validated items to the repository without modifying exports", async () => {
  let update: any;
  const db: any = {
    records: {
      get: async () => ({ id: "id", items: [] }),
      save: async (id: string, fields: any, items: any[]) => {
        update = { id, fields, items };
        return { ...fields, items };
      },
    },
  };
  await new ApplicationService(db).saveRecord("id", {
    number: "1",
    object: "Objeto",
    uasg: "000123",
    items: [],
  });
  assert.equal(update.id, "id");
  assert.deepEqual(update.items, []);
  assert.equal("exports" in update.fields, false);
});
for (const scenario of ["manual", "importada e enriquecida"]) {
  test(`reimport rejects an existing ata ${scenario} and preserves every local field`, async () => {
    const existing = {
      id: "local-record",
      number: "77/2026",
      uasg: "000123",
      object: "Objeto local",
      processNumber: "Processo corrigido",
      organizationName: "Organização local",
      authorityName: "Signatário cadastrado",
      items: [
        {
          id: "local-item",
          number: 1,
          description: "Descrição revisada",
          quantity: "10",
          minimumQuantity: "2",
          unitPrice: "3.50",
          warranty: "36 meses",
        },
      ],
      exports: [{ id: "immutable-export", format: "docx" }],
      origin: scenario,
    };
    const original = structuredClone(existing);
    let writes = 0;
    const db: any = {
      records: {
        get: async () => existing,
        byIdentity: async () => [existing],
        update: async ({ data }: any) => {
          writes++;
          Object.assign(existing, data, { items: data.items.create });
          return existing;
        },
        create: async () => {
          writes++;
          return existing;
        },
      },
    };
    const external: any = {
      record: async () => ({
        number: "77/2026",
        uasg: "000123",
        object: "Objeto público",
        items: [],
      }),
    };
    await assert.rejects(
      () =>
        new ApplicationService(db, external).importRecord({
          number: "77/2026",
          uasg: "000123",
          from: "2026-01-01",
          to: "2026-12-31",
        }),
      (error: any) =>
        error.statusCode === 409 &&
        error.message.includes("Ata já cadastrada") &&
        error.message.includes("77/2026"),
    );
    assert.equal(writes, 0);
    assert.deepEqual(existing, original);
  });
}
