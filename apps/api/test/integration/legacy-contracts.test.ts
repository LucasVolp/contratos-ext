import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../../src/migrate";
import { createTestDatabase } from "../helpers/test-database";

const migrations = resolve(__dirname, "../../migrations");

test("contract notes migration archives existing contracts as LegacyContract", async (t) => {
  const db = await createTestDatabase(t);
  const directory = await mkdtemp(join(tmpdir(), "contracts-legacy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = (await readdir(migrations)).filter(
    (name) => name.endsWith(".sql") && name < "202611090002",
  );
  for (const file of before)
    await writeFile(join(directory, file), await readFile(join(migrations, file)));
  await migrate(db, directory);
  const id = randomUUID();
  await db.query(
    `INSERT INTO "Contract" (id, number, object, "supplierName", "supplierDocument", uasg, "initialValue", "globalValue", source, "externalId", "updatedAt")
     VALUES ($1, '00004/2017', 'Manutenção', 'Fornecedor', '08273364000157', '158148', 0.1, 682318.13, 'COMPRAS_GOV', '13847', now())`,
    [id],
  );
  await migrate(db);
  const [archived] = await db.query<{ number: string; globalValue: string; source: string }>(
    'SELECT number, "globalValue"::text AS "globalValue", source FROM "LegacyContract" WHERE id = $1',
    [id],
  );
  assert.deepEqual(archived, { number: "00004/2017", globalValue: "682318.130000", source: "COMPRAS_GOV" });
  const [{ exists }] = await db.query<{ exists: boolean }>(`SELECT to_regclass('"Contract"') IS NOT NULL AS exists`);
  assert.equal(exists, false);
  const indexes = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'LegacyContract' ORDER BY indexname`,
  );
  assert.deepEqual(
    indexes.map((row) => row.indexname),
    ["LegacyContract_number_uasg_key", "LegacyContract_pkey", "LegacyContract_uasg_idx"],
  );
});
