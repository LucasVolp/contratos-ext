import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createTestDatabase } from "../helpers/test-database";
import { Repositories } from "../../src/repositories";
import { migrate } from "../../src/migrate";
import { CatalogDrafts } from "../../src/catalog/drafts";
async function isolated(t: TestContext) {
  const db = await createTestDatabase(t);
  await migrate(db);
  return { db, repos: new Repositories(db) };
}
const contract = {
  number: "SQL-1",
  uasg: "999999",
  object: "Material",
  supplierName: "Empresa",
  supplierDocument: "11222333000181",
  initialValue: "999999999999999999.123456",
  globalValue: "0.2",
};
const fields = {
  number: "ATA-SQL",
  uasg: "999999",
  object: "Material",
  supplierDocument: "11222333000181",
};
const item = {
  number: 1,
  quantity: "0.1",
  minimumQuantity: "0",
  unitPrice: "0.2",
};
test("SQL migrations initialize an empty database and recognize an existing installation without replaying DDL", async (t) => {
  const { db, repos } = await isolated(t);
  const saved = await repos.contracts.create(contract);
  const record = await repos.records.save(null, fields, [item]);
  await repos.exports.create({
    recordId: record.id,
    format: "docx",
    templateVersion: "test",
    snapshot: { immutable: true },
  });
  await migrate(db);
  assert.equal(
    (await repos.contracts.get(saved.id))!.initialValue,
    contract.initialValue,
  );
  // Reconstruct deployed ORM history; new SQL-only migrations stay in their own journal.
  await db.query(
    'CREATE TABLE "_prisma_migrations" (migration_name text, checksum text, finished_at timestamptz, rolled_back_at timestamptz)',
  );
  const directory = resolve(__dirname, "../../migrations");
  const legacyFiles = [
    "202610300001_initial.sql",
    "202610310001_public_catalog.sql",
    "202610310002_authentication.sql",
    "202610310003_institution_organization.sql",
  ];
  for (const file of legacyFiles) {
    const checksum = createHash("sha256")
      .update(await readFile(join(directory, file)))
      .digest("hex");
    await db.query(
      'INSERT INTO "_prisma_migrations" VALUES ($1,$2,now(),NULL)',
      [file.slice(0, -4), checksum],
    );
  }
  await db.query('DELETE FROM "_sql_migrations" WHERE name = ANY($1::text[])', [
    legacyFiles.map((file) => file.slice(0, -4)),
  ]);
  await migrate(db);
  const after = (await repos.records.get(record.id))!;
  assert.equal(after.items[0].id, record.items[0].id);
  assert.equal(after.exports!.length, 1);
  assert.deepEqual(await repos.contracts.get(saved.id), saved);
  assert.equal(
    (await db.query('SELECT * FROM "_sql_migrations"')).length,
    (await readdir(directory)).filter((name) => name.endsWith(".sql")).length,
  );
  const temporary = await mkdtemp(join(tmpdir(), "contracts-migrations-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const file of (await readdir(directory)).filter((name) =>
    name.endsWith(".sql"),
  )) {
    await writeFile(
      join(temporary, file),
      (await readFile(join(directory, file), "utf8")) + "\n-- modified\n",
    );
  }
  await assert.rejects(() => migrate(db, temporary), /Migração alterada/);
  await db.query('INSERT INTO "_prisma_migrations" VALUES ($1,$2,NULL,NULL)', [
    "failed",
    "checksum",
  ]);
  await assert.rejects(() => migrate(db), /incompleta/);
});
test("SQL replacement rolls back parent and items on failure and retains immutable export history", async (t) => {
  const { repos } = await isolated(t);
  const saved = await repos.records.save(null, fields, [item]);
  await repos.exports.create({
    recordId: saved.id,
    format: "docx",
    templateVersion: "test",
    snapshot: { immutable: true },
  });
  await assert.rejects(
    () =>
      repos.records.save(saved.id, { ...fields, object: "Should roll back" }, [
        item,
        item,
      ]),
    (error: any) => error.code === "23505",
  );
  const after = (await repos.records.get(saved.id))!;
  assert.equal(after.object, fields.object);
  assert.equal(after.items[0].id, saved.items[0].id);
  assert.equal(after.exports!.length, 1);
  const stats = await repos.records.stats("ATA-SQL");
  assert.equal(stats.totalValue, "0.02");
  assert.equal(stats.exportsCount, 1);
  await repos.records.remove(saved.id);
  assert.deepEqual(await repos.exports.list(saved.id), []);
});
test("SQL filters, pagination, exact decimals, UTC timestamps and independent JSON patches survive the driver change", async (t) => {
  const { repos } = await isolated(t);
  const at = new Date("2026-01-02T03:04:05.678Z");
  const saved = await repos.contracts.create({ ...contract, lastSyncedAt: at });
  assert.equal(saved.initialValue, contract.initialValue);
  assert.equal(saved.lastSyncedAt!.toISOString(), at.toISOString());
  await repos.contracts.create({
    ...contract,
    number: "SQL-2",
    globalValue: "0.1",
  });
  const filters = {
    today: "2026-11-04",
    boundary: "2026-12-04",
    search: "SQL-",
  };
  assert.equal((await repos.contracts.list(filters, 2, 1)).length, 1);
  assert.equal((await repos.contracts.stats(filters)).totalValue, "0.3");
  assert.equal(
    (await repos.contracts.stats({ ...filters, search: "%' OR TRUE --" }))
      .count,
    0,
  );
  const purchase = await repos.purchases.upsert({
    number: "1",
    externalId: "purchase",
    uasg: "999999",
    snapshot: { initial: true },
  });
  await Promise.all([
    repos.transaction(async (tx) => {
      await tx.purchases.update(purchase.id, { detailsSyncedAt: at });
      await tx.purchases.mergeSnapshot(purchase.id, { items: [1] });
    }),
    repos.transaction(async (tx) => {
      await tx.purchases.update(purchase.id, { recordsSyncedAt: at });
      await tx.purchases.mergeSnapshot(purchase.id, {
        recordsLookup: { incompleteRecords: [] },
      });
    }),
  ]);
  await repos.purchases.upsert({
    number: "updated",
    externalId: "purchase",
    uasg: "999999",
    snapshot: { shouldNotReplace: true },
  });
  assert.deepEqual((await repos.purchases.get(purchase.id))!.snapshot, {
    initial: true,
    items: [1],
    recordsLookup: { incompleteRecords: [] },
  });
});
test("concurrent supplier draft requests converge to one document without replacing local content", async (t) => {
  const { repos } = await isolated(t);
  const source = await repos.publicRecords.upsert({
    externalId: "draft-source",
    number: "ATA-1",
    object: "Material",
    uasg: "999999",
    detailsSyncedAt: new Date(),
    snapshot: {
      modality: "PREGAO",
      purchaseSrp: true,
      rawItems: [{}],
      items: [
        {
          number: "1",
          key: "1",
          supplierDocument: fields.supplierDocument,
          supplierName: "Empresa",
          description: "Material",
          unit: "UN",
          quantity: "1",
          unitPrice: "2",
        },
      ],
    },
  });
  const drafts = new CatalogDrafts(repos);
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      drafts.create(source.id, { supplierDocument: fields.supplierDocument }),
    ),
  );
  assert.equal(new Set(results.map((row) => row.id)).size, 1);
  assert.equal(results.filter((row) => row.created).length, 1);
  const saved = (await repos.records.get(results[0].id))!;
  await repos.records.save(
    saved.id,
    { ...fields, number: saved.number, object: "Local edit" },
    saved.items,
  );
  assert.deepEqual(
    await drafts.create(source.id, {
      supplierDocument: fields.supplierDocument,
    }),
    { id: saved.id, created: false },
  );
  assert.equal((await repos.records.get(saved.id))!.object, "Local edit");
});
