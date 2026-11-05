import { test } from "node:test";
import assert from "node:assert/strict";
import { ApplicationService } from "../src/service";

const base = {
  id: "id",
  number: "1",
  uasg: "000123",
  object: "Material",
  startDate: "2026-01-01",
  endDate: "2099-01-01",
  initialValue: "0.1",
  globalValue: "0.2",
  supplierName: "Empresa",
  supplierDocument: "52998224725",
};
test("contract pagination and whole-filter statistics execute in database", async () => {
  let args: any;
  const db: any = {
    contracts: {
      list: async (filter: any, page: number, limit: number) => {
        args = { filter, page, limit };
        return [{ ...base, id: "2", globalValue: "0.1" }];
      },
      stats: async () => ({ count: 2, totalValue: "0.3", expiringCount: 0 }),
    },
  };
  const result = await new ApplicationService(db).contracts({
    page: "2",
    limit: "1",
    from: "2026-01-01",
    status: "ACTIVE",
  });
  assert.equal(args.page, 2);
  assert.equal(args.limit, 1);
  assert.ok(JSON.stringify(args.filter).includes("2026-01-01"));
  assert.equal(result.data.length, 1);
  assert.equal(result.total, 2);
  assert.equal(result.stats.totalValue, "0.3");
});
test("failing import never starts database transaction", async () => {
  let writes = 0;
  const db: any = {
    transaction: async () => {
      writes++;
    },
  };
  const external: any = {
    contracts: async () => {
      throw new Error("página 2 falhou");
    },
  };
  await assert.rejects(
    () =>
      new ApplicationService(db, external).importContracts({
        uasg: "000123",
        from: "2026-01-01",
        to: "2026-12-31",
      }),
    /página 2/,
  );
  assert.equal(writes, 0);
});
test("import waits for all data and commits upserts in one transaction", async () => {
  let fetchComplete = false,
    transactions = 0;
  const store: any[] = [];
  const tx: any = {
    contracts: {
      byIdentity: async () => null,
      upsert: async (create: any) => {
        assert.equal(fetchComplete, true);
        store.push(create);
        return create;
      },
    },
  };
  const db: any = {
    transaction: async (fn: any) => {
      transactions++;
      return fn(tx);
    },
  };
  const external: any = {
    contracts: async () => {
      fetchComplete = true;
      return [base, { ...base, number: "2" }];
    },
  };
  const result = await new ApplicationService(db, external).importContracts({
    uasg: "000123",
    from: "2026-01-01",
    to: "2026-12-31",
  });
  assert.deepEqual(result, { created: 2, updated: 0, total: 2 });
  assert.equal(transactions, 1);
  assert.equal(store.length, 2);
});
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
test("not found maps to HTTP 404", async () => {
  const db: any = { contracts: { get: async () => null } };
  await assert.rejects(
    () => new ApplicationService(db).contract("nope"),
    (e: any) => e.statusCode === 404,
  );
});

test("import refuses an existing manual contract before performing any write", async () => {
  const manual = {
    ...base,
    source: "MANUAL",
    object: "Conteúdo editado localmente",
  };
  const original = structuredClone(manual);
  let writes = 0;
  const tx: any = {
    contracts: {
      byIdentity: async (number: string) =>
        number === manual.number ? manual : null,
      upsert: async (update: any) => {
        writes++;
        Object.assign(manual, update);
      },
    },
  };
  const db: any = { transaction: async (run: any) => run(tx) };
  const external: any = {
    contracts: async () => [
      { ...base, number: "NEW", source: "COMPRAS_GOV" },
      { ...base, source: "COMPRAS_GOV" },
    ],
  };
  await assert.rejects(
    () =>
      new ApplicationService(db, external).importContracts({
        uasg: "000123",
        from: "2026-01-01",
        to: "2026-12-31",
      }),
    (error: any) =>
      error.statusCode === 409 &&
      error.message.includes("1") &&
      error.message.includes("123"),
  );
  assert.equal(writes, 0);
  assert.deepEqual(manual, original);
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
