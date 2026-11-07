import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
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
  await db.query(`INSERT INTO "Institution" (id, name, uasg, "updatedAt")
    VALUES (gen_random_uuid(), 'IFMS Reitoria', '158148', now()), (gen_random_uuid(), 'IFMS Três Lagoas', '158454', now())`);
  const [{ name }] = await db.query<{ name: string }>("SELECT current_database() AS name");
  const url = new URL(process.env.DATABASE_URL || "postgresql://contracts:contracts_local@localhost:5540/contracts");
  url.pathname = "/" + name;
  const appDb = new Database(url.toString());
  const app = await createApplication({ db: appDb, auth: viewer === testViewer ? testAuth : { viewer: async () => viewer } });
  // Closing the app also ends its database pool.
  cleanup = () => app.close();
  return { db, app };
}

function day(offset: number) {
  const result = new Date();
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}

interface ReplicaFields {
  number?: string;
  managing?: string;
  object?: string;
  supplierName?: string;
  supplierDocument?: string;
  startDate?: string | null;
  endDate?: string | null;
  globalValue?: string | null;
}

async function parts(db: Database, externalId: number) {
  for (const part of ["header", "history", "commitments", "guarantees", "responsibles", "items", "invoices", "files"]) {
    await db.query(
      `INSERT INTO public_sources.contract_parts (source, contract_external_id, part, status, captured_at, last_attempt_at, last_error, row_count)
       VALUES ('CONTRATOS_GOV_BR', $1, $2, $3, '2026-11-05T10:00:00Z', '2026-11-06T10:00:00Z', $4, 0)`,
      [externalId, part, part === "guarantees" ? "FAILED" : "AVAILABLE", part === "guarantees" ? "source returned HTTP 500" : null],
    );
  }
}

async function replica(db: Database, externalId: number, fields: ReplicaFields = {}) {
  const value = <K extends keyof ReplicaFields>(key: K, fallback: ReplicaFields[K]) => (key in fields ? fields[key] : fallback);
  await db.query(
    `INSERT INTO public_sources.contracts (source, external_id, number, managing_unit_code, origin_unit_code, supplier_document,
       supplier_name, object, global_value, initial_value, start_date, end_date, status, type_name, process_number,
       header_resource, captured_at, normalized_at, source_data)
     VALUES ('CONTRATOS_GOV_BR', $1, $2, $3, '158533', $4, $5, $6, $7, NULL, $8, $9, 'Ativo', 'Contrato', '23347.000001/2017-01',
       'contract', '2026-11-05T10:00:00Z', '2026-11-05T10:05:00Z', '{}')`,
    [
      externalId,
      value("number", "00004/2017"),
      value("managing", "158148"),
      value("supplierDocument", "08273364000157"),
      value("supplierName", "Fornecedor"),
      value("object", "Objeto"),
      value("globalValue", "682318.13"),
      value("startDate", "2017-02-01"),
      value("endDate", null),
    ],
  );
  await parts(db, externalId);
}

async function listingAttempt(db: Database, uasg: string, outcome: string, at: string) {
  const [run] = await db.query<{ id: string }>(
    `INSERT INTO public_sources.capture_runs (source, trigger, target_type, target_code, status, etl_version, started_at, finished_at)
     VALUES ('CONTRATOS_GOV_BR', 'SCHEDULED', 'MANAGEMENT_UNIT', $1, 'SUCCEEDED', 'test', $2, $2) RETURNING id`,
    [uasg, at],
  );
  let capture: string | null = null;
  if (outcome === "CAPTURED" || outcome === "UNCHANGED") {
    const [row] = await db.query<{ id: string }>(
      `INSERT INTO public_sources.captures (source, resource, request_key, content_hash, payload, first_captured_at, last_seen_at, first_run_id, last_run_id)
       VALUES ('CONTRATOS_GOV_BR', 'contracts_active_by_unit', '/api/contrato/ug/' || $1::text, encode(sha256(($1::text || $2::text)::bytea), 'hex'), '[]',
         $2::timestamptz, $2::timestamptz, $3, $3)
       RETURNING id`,
      [uasg, at, run.id],
    );
    capture = row.id;
  }
  await db.query(
    `INSERT INTO public_sources.capture_attempts (run_id, source, resource, request_key, outcome, capture_id, attempted_at)
     VALUES ($1, 'CONTRATOS_GOV_BR', 'contracts_active_by_unit', '/api/contrato/ug/' || $2, $3, $4, $5)`,
    [run.id, uasg, outcome, capture, at],
  );
}

test("lists replica contracts of registered UASGs with stats and sync state", async (t) => {
  const { db, app } = await setup(t);
  await replica(db, 13847, { object: "Serviços de vigilância", startDate: day(-10), endDate: day(100) });
  await replica(db, 13848, { number: "00005/2018", startDate: null, endDate: null, globalValue: "1000.5" });
  await replica(db, 13849, { number: "00001/2020", managing: "999999" });
  const before = (await app.inject({ method: "GET", url: "/api/contracts" })).json();
  assert.deepEqual(before.sync, { lastCompletedAt: null, running: false, staleUnits: [] });

  await db.query(`INSERT INTO public_sources.daily_runs (source, status, etl_version, started_at, finished_at)
    VALUES ('CONTRATOS_GOV_BR', 'COMPLETED', 'test', '2026-11-06T03:00:00Z', '2026-11-06T03:40:00Z'),
           ('CONTRATOS_GOV_BR', 'COMPLETED', 'test', '2026-11-07T03:00:00Z', '2026-11-07T03:42:00Z'),
           ('CONTRATOS_GOV_BR', 'CANCELLED', 'test', '2026-11-07T04:00:00Z', '2026-11-07T04:10:00Z')`);
  await listingAttempt(db, "158148", "CAPTURED", "2026-11-07T03:10:00Z");
  await listingAttempt(db, "158454", "FAILED", "2026-11-07T03:20:00Z");
  await listingAttempt(db, "999999", "FAILED", "2026-11-07T03:30:00Z");

  const response = await app.inject({ method: "GET", url: "/api/contracts" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const body = response.json();
  assert.equal(body.total, 2);
  assert.equal(body.page, 1);
  assert.equal(body.limit, 12);
  assert.deepEqual(body.data[0], {
    externalId: "13847",
    number: "00004/2017",
    object: "Serviços de vigilância",
    supplierName: "Fornecedor",
    supplierDocument: "08273364000157",
    uasg: "158148",
    unitName: "IFMS Reitoria",
    startDate: day(-10),
    endDate: day(100),
    globalValue: "682318.130000",
    status: "ACTIVE",
  });
  assert.equal(body.data[1].externalId, "13848");
  assert.equal(body.data[1].status, "UNKNOWN");
  assert.equal(body.data[1].endDate, null);
  assert.deepEqual(body.stats, {
    count: 2,
    totalValue: "683318.630000",
    expiringCount: 0,
    vigency: { active: 1, expiring: 0, ended: 0, upcoming: 0, unknown: 1, activeValue: "682318.130000" },
  });
  assert.deepEqual(body.sync, {
    lastCompletedAt: "2026-11-07T03:42:00.000Z",
    running: false,
    staleUnits: [{ uasg: "158454", name: "IFMS Três Lagoas", lastGoodAt: null }],
  });

  await listingAttempt(db, "158454", "UNCHANGED", "2026-11-06T03:20:00Z");
  await db.query(`INSERT INTO public_sources.daily_runs (source, status, etl_version, started_at)
    VALUES ('CONTRATOS_GOV_BR', 'RUNNING', 'test', '2026-11-07T05:00:00Z')`);
  const later = (await app.inject({ method: "GET", url: "/api/contracts" })).json();
  assert.deepEqual(later.sync, {
    lastCompletedAt: "2026-11-07T03:42:00.000Z",
    running: true,
    staleUnits: [{ uasg: "158454", name: "IFMS Três Lagoas", lastGoodAt: "2026-11-06T03:20:00.000Z" }],
  });
});

test("unrestricted viewer sees only registered UASGs", async (t) => {
  const { db, app } = await setup(t);
  await replica(db, 13847);
  await replica(db, 13850, { managing: "158454" });
  await replica(db, 13849, { managing: "999999" });
  const ids = async () =>
    (await app.inject({ method: "GET", url: "/api/contracts" })).json().data.map((row: { externalId: string }) => row.externalId).sort();
  assert.deepEqual(await ids(), ["13847", "13850"]);
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13849" })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13849/source/items" })).statusCode, 404);
  assert.equal((await app.inject({ method: "PUT", url: "/api/contracts/13849/notes", payload: { notes: "x" } })).statusCode, 404);
  await db.query(`DELETE FROM "Institution" WHERE uasg = '158454'`);
  assert.deepEqual(await ids(), ["13847"]);
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13850" })).statusCode, 404);
});

test("filters by search, status, uasg and vigência", async (t) => {
  const { db, app } = await setup(t);
  await replica(db, 1, { number: "00001/2026", object: "Vigilância armada", startDate: day(-10), endDate: day(100) });
  await replica(db, 2, { number: "00002/2026", object: "Limpeza", supplierName: "Limpa Tudo 100% Ltda", startDate: day(-10), endDate: day(10) });
  await replica(db, 3, { number: "00003/2026", object: "Manutenção", startDate: day(-400), endDate: day(-5), managing: "158454" });
  await replica(db, 4, { number: "00004/2026", object: "Reforma", startDate: day(5), endDate: day(200) });
  await replica(db, 5, { number: "00005/2026", object: "Copa", startDate: null, endDate: null, supplierDocument: "12345678901" });
  const ids = async (query: string) => {
    const response = await app.inject({ method: "GET", url: `/api/contracts?${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().data.map((row: { externalId: string }) => row.externalId).sort();
  };
  assert.deepEqual(await ids("search=vigil"), ["1"]);
  assert.deepEqual(await ids("search=00002"), ["2"]);
  assert.deepEqual(await ids("search=100%25"), ["2"]);
  assert.deepEqual(await ids(`search=${encodeURIComponent("%' OR TRUE --")}`), []);
  assert.deepEqual(await ids(`search=${encodeURIComponent("Três Lagoas")}`), ["3"]);
  assert.deepEqual(await ids("search=08273364"), ["1", "2", "3", "4"]);
  // A CPF is never searchable, since it is only shown masked.
  assert.deepEqual(await ids("search=12345678901"), []);
  assert.deepEqual(await ids("status=ACTIVE"), ["1"]);
  assert.deepEqual(await ids("status=EXPIRING"), ["2"]);
  assert.deepEqual(await ids("status=EXPIRED"), ["3"]);
  assert.deepEqual(await ids("status=UPCOMING"), ["4"]);
  assert.deepEqual(await ids("status=UNKNOWN"), ["5"]);
  assert.deepEqual(await ids("uasg=158454"), ["3"]);
  assert.deepEqual(await ids("uasgs=158454"), ["3"]);
  assert.deepEqual(await ids(`from=${day(50)}`), ["1", "4"]);
  assert.deepEqual(await ids(`to=${day(0)}`), ["1", "2", "3"]);
  assert.deepEqual(await ids(`from=${day(-6)}&to=${day(-6)}`), ["1", "2", "3"]);
  const page = (await app.inject({ method: "GET", url: "/api/contracts?limit=2&page=2" })).json();
  assert.equal(page.total, 5);
  // end_date DESC NULLS LAST: 4, 1, 2, 3, 5.
  assert.deepEqual(page.data.map((row: { externalId: string }) => row.externalId), ["2", "3"]);
});

test("rejects invalid filters", async (t) => {
  const { app } = await setup(t);
  const message = async (query: string) => {
    const response = await app.inject({ method: "GET", url: `/api/contracts?${query}` });
    assert.equal(response.statusCode, 400, query);
    return response.json().message;
  };
  assert.equal(await message("uasg=12"), "Informe a UASG com exatamente 6 dígitos, incluindo zeros iniciais.");
  assert.equal(await message("from=2026-02-30"), "Data inválida. Informe uma data real no formato AAAA-MM-DD.");
  assert.equal(await message("from=2026-03-01&to=2026-02-01"), "O fim da vigência ou consulta deve ser igual ou posterior ao início.");
  assert.equal(await message("status=OPEN"), "Status de contrato inválido.");
  assert.equal(await message("limit=101"), "Paginação inválida: page >= 1 e limit entre 1 e 100.");
  assert.equal(await message("uasgs=12"), "Abrangência inválida: use UASGs de 6 dígitos separadas por vírgula.");
});

test("restricted viewer sees only their UASG", async (t) => {
  const { db, app } = await setup(t, restricted);
  await replica(db, 13847);
  await replica(db, 13850, { managing: "158454" });
  const list = (await app.inject({ method: "GET", url: "/api/contracts" })).json();
  assert.deepEqual(list.data.map((row: { externalId: string }) => row.externalId), ["13850"]);
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/contracts?uasgs=158148" })).json().data, []);
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13850" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13847" })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13847/source/items" })).statusCode, 404);
  const notes = await app.inject({ method: "PUT", url: "/api/contracts/13847/notes", payload: { notes: "Interno" } });
  assert.equal(notes.statusCode, 404);
  assert.equal(notes.json().message, "Contrato não encontrado.");
  assert.equal((await db.query(`SELECT * FROM "ContractNote"`)).length, 0);
});

test("invalid external ids are 404", async (t) => {
  const { app } = await setup(t);
  for (const id of ["abc", "0", "99999999999999999999", "9223372036854775808", "-1", "1.5"]) {
    for (const [method, url] of [
      ["GET", `/api/contracts/${id}`],
      ["GET", `/api/contracts/${id}/source/items`],
      ["PUT", `/api/contracts/${id}/notes`],
    ] as const) {
      const response = await app.inject({ method, url, payload: method === "PUT" ? { notes: "x" } : undefined });
      assert.equal(response.statusCode, 404, `${method} ${url}`);
      assert.equal(response.json().message, "Contrato não encontrado.");
    }
  }
});

test("detail returns header, parts and empty notes", async (t) => {
  const { db, app } = await setup(t);
  await replica(db, 13847, { startDate: "2017-02-01", endDate: null });
  await db.query(`UPDATE public_sources.contracts SET signature_date = '2017-01-26', accumulated_value = 1500.25,
    installment_count = 12, category = 'Serviços', modality = 'Pregão' WHERE external_id = 13847`);
  const response = await app.inject({ method: "GET", url: "/api/contracts/13847" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const body = response.json();
  assert.deepEqual(body.contract, {
    externalId: "13847",
    number: "00004/2017",
    object: "Objeto",
    supplierName: "Fornecedor",
    supplierDocument: "08273364000157",
    uasg: "158148",
    unitName: "IFMS Reitoria",
    startDate: "2017-02-01",
    endDate: null,
    globalValue: "682318.130000",
    status: "UNKNOWN",
    originUnitCode: "158533",
    typeName: "Contrato",
    category: "Serviços",
    processNumber: "23347.000001/2017-01",
    modality: "Pregão",
    sourceStatus: "Ativo",
    signatureDate: "2017-01-26",
    initialValue: null,
    accumulatedValue: "1500.250000",
    installmentCount: 12,
    capturedAt: "2026-11-05T10:00:00.000Z",
    normalizedAt: "2026-11-05T10:05:00.000Z",
  });
  assert.equal(body.parts.length, 8);
  assert.equal(body.parts[0].part, "header");
  const guarantees = body.parts.find((p: { part: string }) => p.part === "guarantees");
  assert.deepEqual(guarantees, {
    part: "guarantees",
    status: "FAILED",
    capturedAt: "2026-11-05T10:00:00.000Z",
    lastAttemptAt: "2026-11-06T10:00:00.000Z",
    rowCount: 0,
  });
  assert.equal(JSON.stringify(body).includes("HTTP 500"), false);
  assert.deepEqual(body.notes, { text: "", updatedAt: null, updatedBy: null });
});

test("serves part pages with text decimals and nulls", async (t) => {
  const { db, app } = await setup(t);
  await replica(db, 13847);
  for (let i = 1; i <= 25; i++) {
    await db.query(
      `INSERT INTO public_sources.contract_items (source, external_id, contract_external_id, catalog_item, quantity, unit_value, total_value, start_date, source_data)
       VALUES ('CONTRATOS_GOV_BR', $1, 13847, 'Item', 750.625, NULL, 6755.63, NULL, '{}')`,
      [i],
    );
  }
  const response = await app.inject({ method: "GET", url: "/api/contracts/13847/source/items" });
  assert.equal(response.headers["cache-control"], "no-store");
  const page = response.json();
  assert.equal(page.total, 25);
  assert.equal(page.data.length, 20);
  assert.equal(page.page, 1);
  assert.equal(page.data[0].externalId, "1");
  assert.equal(page.data[0].quantity, "750.625000");
  assert.equal(page.data[0].unitValue, null);
  assert.equal(page.data[0].startDate, null);
  const second = (await app.inject({ method: "GET", url: "/api/contracts/13847/source/items?page=2" })).json();
  assert.equal(second.data.length, 5);
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13847/source/items?limit=101" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13847/source/items?sort=x" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13847/source/payments" })).statusCode, 400);
});

test("orders history by signature date and exposes qualifications", async (t) => {
  const { db, app } = await setup(t);
  await replica(db, 13847);
  await db.query(`INSERT INTO public_sources.contract_amendments (source, external_id, contract_external_id, number, type_name, qualifications, signature_date, new_global_value, source_data)
    VALUES ('CONTRATOS_GOV_BR', 2, 13847, '00002/2019', 'Termo Aditivo', ARRAY['INFORMATIVO','VIGÊNCIA'], '2019-01-31', 682318.13, '{}'),
           ('CONTRATOS_GOV_BR', 1, 13847, '00004/2017', 'Contrato', '{}', '2017-01-26', NULL, '{}'),
           ('CONTRATOS_GOV_BR', 3, 13847, '00009/2023', 'Apostilamento', '{}', NULL, NULL, '{}')`);
  const page = (await app.inject({ method: "GET", url: "/api/contracts/13847/source/history" })).json();
  assert.deepEqual(page.data.map((row: { number: string }) => row.number), ["00004/2017", "00002/2019", "00009/2023"]);
  assert.deepEqual(page.data[1].qualifications, ["INFORMATIVO", "VIGÊNCIA"]);
  assert.equal(page.data[1].newGlobalValue, "682318.130000");
});

test("responsibles expose only masked documents", async (t) => {
  const { db, app } = await setup(t);
  await replica(db, 13847);
  await db.query(`INSERT INTO public_sources.contract_responsibles (source, external_id, contract_external_id, responsible_name, masked_document, role, source_data)
    VALUES ('CONTRATOS_GOV_BR', 1, 13847, 'MARIA EXEMPLO', '***.456.789-**', 'Fiscal Técnico', '{"usuario":"***.456.789-** - MARIA EXEMPLO"}')`);
  const response = await app.inject({ method: "GET", url: "/api/contracts/13847/source/responsibles" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes("***.456.789-**"), true);
  assert.equal(response.body.includes("supplierDocument"), false);
  assert.equal(response.body.includes("usuario"), false);
  assert.equal(response.json().data[0].name, "MARIA EXEMPLO");
});

test("notes are saved with author and survive replica updates", async (t) => {
  const { db, app } = await setup(t);
  await db.query(`INSERT INTO "User" (id, name, email, "passwordHash", "updatedAt") VALUES ($1, $2, $3, 'x', now())`, [
    testViewer.id,
    testViewer.name,
    testViewer.email,
  ]);
  await replica(db, 13847);
  const saved = await app.inject({ method: "PUT", url: "/api/contracts/13847/notes", payload: { notes: "  Fiscal substituído em outubro.  " } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.headers["cache-control"], "no-store");
  const notes = saved.json();
  assert.equal(notes.text, "Fiscal substituído em outubro.");
  assert.equal(notes.updatedBy, "Test manager");
  assert.match(notes.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  // notes survive replica updates
  await db.query(`UPDATE public_sources.contracts SET object = 'novo' WHERE external_id = 13847`);
  await db.query(`DELETE FROM public_sources.contract_parts WHERE contract_external_id = 13847`);
  await parts(db, 13847);
  const detail = (await app.inject({ method: "GET", url: "/api/contracts/13847" })).json();
  assert.equal(detail.contract.object, "novo");
  assert.deepEqual(detail.notes, notes);

  const tooLong = await app.inject({ method: "PUT", url: "/api/contracts/13847/notes", payload: { notes: "a".repeat(10001) } });
  assert.equal(tooLong.statusCode, 400);
  assert.equal(tooLong.json().message, "As observações internas podem ter no máximo 10.000 caracteres.");
  assert.equal((await app.inject({ method: "PUT", url: "/api/contracts/13847/notes", payload: { notes: 5 } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PUT", url: "/api/contracts/13847/notes", payload: { notes: "a".repeat(10000) } })).statusCode, 200);

  const cleared = await app.inject({ method: "PUT", url: "/api/contracts/13847/notes", payload: { notes: "" } });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().text, "");
  assert.equal((await app.inject({ method: "GET", url: "/api/contracts/13847" })).json().notes.text, "");
});

test("supplier CPF is masked", async (t) => {
  const { db, app } = await setup(t);
  await replica(db, 13847, { supplierDocument: "12345678901" });
  const list = await app.inject({ method: "GET", url: "/api/contracts" });
  assert.equal(list.json().data[0].supplierDocument, "***.456.789-**");
  assert.equal(list.body.includes("12345678901"), false);
  const detail = await app.inject({ method: "GET", url: "/api/contracts/13847" });
  assert.equal(detail.json().contract.supplierDocument, "***.456.789-**");
  assert.equal(detail.body.includes("12345678901"), false);
});

test("old contract write routes are gone", async (t) => {
  const { app } = await setup(t);
  const uuid = "10000000-0000-4000-8000-000000000001";
  for (const [method, url] of [
    ["POST", "/api/contracts"],
    ["POST", "/api/contracts/import"],
    ["PUT", `/api/contracts/${uuid}`],
    ["DELETE", `/api/contracts/${uuid}`],
  ] as const) {
    const response = await app.inject({ method, url, payload: method === "DELETE" ? undefined : { number: "1", uasg: "158148" } });
    assert.equal(response.statusCode, 404, `${method} ${url}`);
  }
  assert.equal((await app.inject({ method: "GET", url: `/api/contracts/${uuid}/source` })).statusCode, 404);
});
