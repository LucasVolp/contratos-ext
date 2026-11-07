import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../../src/app";
import { Database } from "../../src/database";
import { migrate } from "../../src/migrate";
import type { Viewer } from "../../src/auth/access";
import { createTestDatabase } from "../helpers/test-database";
import { testAuth, testViewer } from "../helpers/viewer";

const restricted: Viewer = {
  ...testViewer,
  role: "USUARIO",
  allInstitutions: false,
  institutions: [{ id: "i", name: "IFMS Três Lagoas", uasg: "158454" }],
};

async function setup(t: TestContext, viewer: Viewer = testViewer) {
  // after hooks run in registration order: close the app before the test
  // database helper drops the database.
  let cleanup = async () => {};
  t.after(() => cleanup());
  const db = await createTestDatabase(t);
  await migrate(db);
  const [{ name }] = await db.query<{ name: string }>("SELECT current_database() AS name");
  const url = new URL(process.env.DATABASE_URL || "postgresql://contracts:contracts_local@localhost:5540/contracts");
  url.pathname = "/" + name;
  const appDb = new Database(url.toString());
  const app = await createApplication({ db: appDb, auth: viewer === testViewer ? testAuth : { viewer: async () => viewer } });
  // Closing the app also ends its database pool.
  cleanup = () => app.close();
  return { db, app };
}

async function appContract(db: Database, number: string, uasg = "158148", object = "Objeto") {
  const id = randomUUID();
  await db.query(
    `INSERT INTO "Contract" (id, number, object, "supplierName", "supplierDocument", uasg, "initialValue", "globalValue", "updatedAt")
     VALUES ($1, $2, $3, 'Fornecedor', '08273364000157', $4, 1, 2, now())`,
    [id, number, object, uasg],
  );
  return id;
}

async function replica(db: Database, externalId: number, number: string, managing = "158148", origin = managing) {
  await db.query(
    `INSERT INTO public_sources.contracts (source, external_id, number, managing_unit_code, origin_unit_code, supplier_document,
       supplier_name, global_value, initial_value, start_date, end_date, status, header_resource, captured_at, source_data)
     VALUES ('CONTRATOS_GOV_BR', $1, $2, $3, $4, '08273364000157', 'Fornecedor', 682318.13, NULL, '2017-02-01', NULL, 'Ativo',
       'contract', '2026-11-05T10:00:00Z', '{}')`,
    [externalId, number, managing, origin],
  );
  for (const part of ["header", "history", "commitments", "guarantees", "responsibles", "items", "invoices", "files"]) {
    await db.query(
      `INSERT INTO public_sources.contract_parts (source, contract_external_id, part, status, captured_at, last_attempt_at, last_error, row_count)
       VALUES ('CONTRATOS_GOV_BR', $1, $2, $3, '2026-11-05T10:00:00Z', '2026-11-06T10:00:00Z', $4, 0)`,
      [externalId, part, part === "guarantees" ? "FAILED" : "AVAILABLE", part === "guarantees" ? "source returned HTTP 500" : null],
    );
  }
}

test("resolves a contract by managing UASG and normalized number", async (t) => {
  const { db, app } = await setup(t);
  const id = await appContract(db, "4/2017");
  const lower = await appContract(db, "2026ne000234");
  await replica(db, 13847, "00004/2017");
  await replica(db, 1057026, "2026NE000234");
  const response = await app.inject({ method: "GET", url: `/api/contracts/${id}/source` });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const body = response.json();
  assert.equal(body.resolution, "RESOLVED");
  assert.equal(body.source.externalId, "13847");
  assert.equal(body.source.globalValue, "682318.130000");
  assert.equal(body.source.initialValue, null);
  assert.equal(body.source.endDate, null);
  assert.equal(body.source.startDate, "2017-02-01");
  assert.equal(body.source.capturedAt, "2026-11-05T10:00:00.000Z");
  assert.equal(body.parts.length, 8);
  const guarantees = body.parts.find((p: { part: string }) => p.part === "guarantees");
  assert.deepEqual(guarantees, { part: "guarantees", status: "FAILED", capturedAt: "2026-11-05T10:00:00.000Z", lastAttemptAt: "2026-11-06T10:00:00.000Z", rowCount: 0 });
  assert.equal(JSON.stringify(body).includes("HTTP 500"), false);
  const second = (await app.inject({ method: "GET", url: `/api/contracts/${lower}/source` })).json();
  assert.equal(second.resolution, "RESOLVED");
  assert.equal(second.source.externalId, "1057026");
});

test("reports NOT_FOUND and AMBIGUOUS", async (t) => {
  const { db, app } = await setup(t);
  const missing = await appContract(db, "9/2020");
  const missingBody = (await app.inject({ method: "GET", url: `/api/contracts/${missing}/source` })).json();
  assert.equal(missingBody.resolution, "NOT_FOUND");
  assert.equal(missingBody.source, null);
  assert.deepEqual(missingBody.parts, []);
  const twice = await appContract(db, "5/2021");
  await replica(db, 501, "5/2021");
  await replica(db, 502, "0005/2021");
  const ambiguous = (await app.inject({ method: "GET", url: `/api/contracts/${twice}/source` })).json();
  assert.equal(ambiguous.resolution, "AMBIGUOUS");
  assert.equal(ambiguous.candidateCount, 2);
  assert.equal(ambiguous.source, null);
  assert.equal((await app.inject({ method: "GET", url: `/api/contracts/${twice}/source/items` })).statusCode, 404);
});

test("matches only the managing unit", async (t) => {
  const { db, app } = await setup(t);
  const id = await appContract(db, "7/2022", "158148");
  await replica(db, 700, "7/2022", "158533", "158148");
  const body = (await app.inject({ method: "GET", url: `/api/contracts/${id}/source` })).json();
  assert.equal(body.resolution, "NOT_FOUND");
});

test("serves part pages with text decimals and nulls", async (t) => {
  const { db, app } = await setup(t);
  const id = await appContract(db, "4/2017");
  await replica(db, 13847, "00004/2017");
  for (let i = 1; i <= 25; i++) {
    await db.query(
      `INSERT INTO public_sources.contract_items (source, external_id, contract_external_id, catalog_item, quantity, unit_value, total_value, start_date, source_data)
       VALUES ('CONTRATOS_GOV_BR', $1, 13847, 'Item', 750.625, NULL, 6755.63, NULL, '{}')`,
      [i],
    );
  }
  const page = (await app.inject({ method: "GET", url: `/api/contracts/${id}/source/items` })).json();
  assert.equal(page.total, 25);
  assert.equal(page.data.length, 20);
  assert.equal(page.page, 1);
  assert.equal(page.data[0].externalId, "1");
  assert.equal(page.data[0].quantity, "750.625000");
  assert.equal(page.data[0].unitValue, null);
  assert.equal(page.data[0].startDate, null);
  const second = (await app.inject({ method: "GET", url: `/api/contracts/${id}/source/items?page=2` })).json();
  assert.equal(second.data.length, 5);
  assert.equal((await app.inject({ method: "GET", url: `/api/contracts/${id}/source/items?limit=101` })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: `/api/contracts/${id}/source/items?sort=x` })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: `/api/contracts/${id}/source/payments` })).statusCode, 400);
});

test("orders history by signature date and exposes qualifications", async (t) => {
  const { db, app } = await setup(t);
  const id = await appContract(db, "4/2017");
  await replica(db, 13847, "00004/2017");
  await db.query(`INSERT INTO public_sources.contract_amendments (source, external_id, contract_external_id, number, type_name, qualifications, signature_date, new_global_value, source_data)
    VALUES ('CONTRATOS_GOV_BR', 2, 13847, '00002/2019', 'Termo Aditivo', ARRAY['INFORMATIVO','VIGÊNCIA'], '2019-01-31', 682318.13, '{}'),
           ('CONTRATOS_GOV_BR', 1, 13847, '00004/2017', 'Contrato', '{}', '2017-01-26', NULL, '{}'),
           ('CONTRATOS_GOV_BR', 3, 13847, '00009/2023', 'Apostilamento', '{}', NULL, NULL, '{}')`);
  const page = (await app.inject({ method: "GET", url: `/api/contracts/${id}/source/history` })).json();
  assert.deepEqual(page.data.map((row: { number: string }) => row.number), ["00004/2017", "00002/2019", "00009/2023"]);
  assert.deepEqual(page.data[1].qualifications, ["INFORMATIVO", "VIGÊNCIA"]);
  assert.equal(page.data[1].newGlobalValue, "682318.130000");
});

test("responsibles expose only masked documents", async (t) => {
  const { db, app } = await setup(t);
  const id = await appContract(db, "4/2017");
  await replica(db, 13847, "00004/2017");
  await db.query(`INSERT INTO public_sources.contract_responsibles (source, external_id, contract_external_id, responsible_name, masked_document, role, source_data)
    VALUES ('CONTRATOS_GOV_BR', 1, 13847, 'MARIA EXEMPLO', '***.456.789-**', 'Fiscal Técnico', '{"usuario":"***.456.789-** - MARIA EXEMPLO"}')`);
  const response = await app.inject({ method: "GET", url: `/api/contracts/${id}/source/responsibles` });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes("***.456.789-**"), true);
  assert.equal(response.body.includes("supplierDocument"), false);
  assert.equal(response.body.includes("usuario"), false);
  assert.equal(response.json().data[0].name, "MARIA EXEMPLO");
});

test("out-of-scope viewer gets 404", async (t) => {
  const { db, app } = await setup(t, restricted);
  const id = await appContract(db, "4/2017");
  await replica(db, 13847, "00004/2017");
  assert.equal((await app.inject({ method: "GET", url: `/api/contracts/${id}/source` })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/api/contracts/${id}/source/items` })).statusCode, 404);
});
