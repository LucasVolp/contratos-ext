import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../src/app";
import { Database } from "../../src/database";
import { migrate } from "../../src/migrate";
import type { Viewer } from "../../src/auth/access";
import { createTestDatabase } from "../helpers/test-database";
import { testAuth, testViewer } from "../helpers/viewer";

const restrictedTo = (...uasgs: string[]): Viewer => ({
  ...testViewer,
  role: "USUARIO",
  allInstitutions: false,
  institutions: uasgs.map((uasg) => ({ id: uasg, name: uasg, uasg })),
});

async function setup(t: TestContext, viewer: Viewer = testViewer) {
  // after hooks run in registration order: close the app before the test
  // database helper drops the database.
  let cleanup = async () => {};
  t.after(() => cleanup());
  const db = await createTestDatabase(t);
  await migrate(db);
  await db.query(`INSERT INTO "Institution" (id, name, uasg, "updatedAt")
    VALUES (gen_random_uuid(), 'IFMS Reitoria', '158148', now()), (gen_random_uuid(), 'IFMS Três Lagoas', '158454', now())`);
  await seed(db);
  const [{ name }] = await db.query<{ name: string }>("SELECT current_database() AS name");
  const url = new URL(process.env.DATABASE_URL || "postgresql://contracts:contracts_local@localhost:5540/contracts");
  url.pathname = "/" + name;
  const app = await createApplication({
    db: new Database(url.toString()),
    auth: viewer === testViewer ? testAuth : { viewer: async () => viewer },
  });
  cleanup = () => app.close();
  return { db, app };
}

async function contract(db: Database, externalId: number, managing: string, number: string, supplierDocument = "08273364000157") {
  await db.query(
    `INSERT INTO public_sources.contracts (source, external_id, number, managing_unit_code, supplier_document, supplier_name,
       global_value, process_number, header_resource, captured_at, normalized_at, source_data)
     VALUES ('CONTRATOS_GOV_BR', $1, $2, $3, $4, 'Fornecedor', 1000.00, '23347.000001/2017-01', 'contract',
       '2026-11-05T10:00:00Z', '2026-11-05T10:05:00Z', '{}')`,
    [externalId, number, managing, supplierDocument],
  );
}

// [number, unit_code, management_code, issue_date, committed]
const listed: [string, string, string, string, string][] = [
  ["2026NE000001", "158345", "26421", "2026-03-10", "300.00"],
  ["2024NE000002", "158345", "26421", "2024-05-02", "100.00"],
  ["2026NE000003", "158148", "26421", "2026-09-30", "50.00"],
  ["2026NE000004", "158148", "26421", "2026-11-01", "25.00"],
  ["2026NE000005", "999999", "99999", "2026-02-01", "10.00"],
  ["2025NE000006", "158148", "26421", "2025-06-01", "5.00"],
];

const code = (number: string) => {
  const row = listed.find((r) => r[0] === number)!;
  return row[1] + row[2] + row[0];
};

async function seed(db: Database) {
  await contract(db, 13847, "158148", "00004/2017");
  for (const [i, [number, unit, management, issued, committed]] of listed.entries()) {
    await db.query(
      `INSERT INTO public_sources.contract_commitments (source, external_id, contract_external_id, unit_code, management_code, number,
         issue_date, creditor, expense_nature, committed, to_liquidate, liquidated, paid, rp_registered, rp_to_liquidate, rp_liquidated,
         rp_paid, source_data)
       VALUES ('CONTRATOS_GOV_BR', $1, 13847, $2, $3, $4, $5, 'Fornecedor', '339039', $6, 0, $6, $6, 0, 0, 0, 0, '{}')`,
      [8000 + i, unit, management, number, issued, committed],
    );
  }
  const runs = await db.query<{ id: string }>(`INSERT INTO finance.ingestion_runs
    (type, source_file, period_start, period_end, scope_type, scope_codes, trigger_type, status, etl_version, finished_at)
    VALUES ('DAILY_EXPENSES', 'a.zip', '2026-01-02', '2026-01-02', 'MANAGEMENT', ARRAY['26421'], 'MANUAL', 'SUCCESS', 'test', now()),
           ('DAILY_EXPENSES', 'b.zip', '2026-09-30', '2026-09-30', 'MANAGEMENT', ARRAY['26421'], 'MANUAL', 'SUCCESS', 'test', now()),
           ('DAILY_EXPENSES', 'c.zip', '2026-10-23', '2026-10-23', 'MANAGEMENT', ARRAY['26421'], 'MANUAL', 'SUCCESS', 'test', now())
    RETURNING id`);
  const run = runs[0].id;
  await db.query(`INSERT INTO finance.management_units (management_code, code, name)
    VALUES ('26421', '158345', 'CAMPUS A'), ('26421', '158148', 'REITORIA')`);
  await db.query(
    `INSERT INTO finance.commitment_references (id, document_code) OVERRIDING SYSTEM VALUE VALUES (501, $1), (502, $2), (503, '158345264212026NE000099')`,
    [code("2026NE000001"), code("2024NE000002")],
  );
  await db.query(
    `INSERT INTO finance.commitments (id, fiscal_year, management_code, management_unit_code, emission_date, ingestion_run_id)
     VALUES (501, 2026, '26421', '158345', '2026-03-10', $1), (503, 2026, '26421', '158345', '2026-03-11', $1)`,
    [run],
  );
  await db.query(
    `INSERT INTO finance.commitment_items (commitment_id, sequential, current_value, ingestion_run_id) VALUES (501, 1, 310.00, $1)`,
    [run],
  );
}

type Link = { number: string; financeStatus: string; financeCommitted: string | null; lastImportedOn: string | null; linkable: boolean; financeCommitmentId: string | null };
type Campus = { unitCode: string; unitName: string; count: number; committed: string | null; liquidated: string | null };

const commitmentsOf = async (app: Awaited<ReturnType<typeof setup>>["app"], id = "13847") =>
  app.inject({ method: "GET", url: `/api/contracts/${id}/commitments` });

const byNumber = (links: Link[], number: string) => links.find((l) => l.number === number)!;

test("lists commitments with their finance status", async (t) => {
  const { app } = await setup(t);
  const response = await commitmentsOf(app);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const links: Link[] = response.json().commitments;
  assert.equal(links.length, 6);
  const expected: Record<string, [string, string | null, string | null]> = {
    "2026NE000001": ["CONFIRMED", "310.000000", null],
    "2024NE000002": ["CONFIRMED", null, null],
    "2026NE000003": ["NOT_FOUND", null, null],
    "2026NE000004": ["PENDING", null, "2026-10-23"],
    "2026NE000005": ["OUT_OF_SCOPE", null, null],
    "2025NE000006": ["OUT_OF_SCOPE", null, null],
  };
  for (const [number, [status, financeCommitted, lastImportedOn]] of Object.entries(expected)) {
    const link = byNumber(links, number);
    assert.deepEqual(
      { status: link.financeStatus, financeCommitted: link.financeCommitted, lastImportedOn: link.lastImportedOn },
      { status, financeCommitted, lastImportedOn },
      number,
    );
  }
  assert.equal(byNumber(links, "2026NE000001").financeCommitmentId, "501");
  assert.equal(byNumber(links, "2026NE000003").financeCommitmentId, null);
});

test("groups by issuing campus with totals and balance", async (t) => {
  const { app } = await setup(t);
  const body = (await commitmentsOf(app)).json();
  assert.deepEqual(
    body.campuses.map((c: Campus) => ({ unitCode: c.unitCode, unitName: c.unitName, committed: c.committed, count: c.count })),
    [
      { unitCode: "999999", unitName: "999999", committed: "10.000000", count: 1 },
      { unitCode: "158345", unitName: "CAMPUS A", committed: "400.000000", count: 2 },
      { unitCode: "158148", unitName: "REITORIA", committed: "80.000000", count: 3 },
    ],
  );
  assert.equal(body.totals.committed, "490.000000");
  assert.equal(body.totals.count, 6);
  assert.equal(body.totals.rpPaid, "0.000000");
  assert.deepEqual(body.balance, { globalValue: "1000.000000", remaining: "510.000000" });
});

test("null amount nulls the totals that include it", async (t) => {
  const { db, app } = await setup(t);
  await db.query(`UPDATE public_sources.contract_commitments SET liquidated = NULL WHERE number = '2026NE000003'`);
  const body = (await commitmentsOf(app)).json();
  const campus = (unitCode: string) => body.campuses.find((c: Campus) => c.unitCode === unitCode);
  assert.equal(campus("158148").liquidated, null);
  assert.equal(body.totals.liquidated, null);
  assert.equal(campus("158345").liquidated, "400.000000");
  assert.equal(body.balance.remaining, "510.000000");
});

test("balance is unknown when total committed is unknown", async (t) => {
  const { db, app } = await setup(t);
  await db.query(`UPDATE public_sources.contract_commitments SET committed = NULL WHERE number = '2026NE000004'`);
  const body = (await commitmentsOf(app)).json();
  assert.equal(body.totals.committed, null);
  assert.deepEqual(body.balance, { globalValue: "1000.000000", remaining: null });
});

test("header-less reference is confirmed without comparison", async (t) => {
  const { app } = await setup(t);
  const link = byNumber((await commitmentsOf(app)).json().commitments, "2024NE000002");
  assert.equal(link.financeStatus, "CONFIRMED");
  assert.equal(link.financeCommitted, null);
  assert.equal(link.financeCommitmentId, "502");
  assert.equal(link.linkable, true);
});

test("linkable only inside the viewer scope", async (t) => {
  const { app } = await setup(t, restrictedTo("158148"));
  const response = await commitmentsOf(app);
  assert.equal(response.statusCode, 200);
  const links: Link[] = response.json().commitments;
  assert.equal(byNumber(links, "2026NE000001").linkable, false);
  for (const link of links) if (link.financeCommitmentId === null) assert.equal(link.linkable, false, link.number);
});

test("same 404 as the contract", async (t) => {
  const { app } = await setup(t, restrictedTo("158454"));
  for (const id of ["13847", "99999", "abc"]) {
    const response = await commitmentsOf(app, id);
    assert.equal(response.statusCode, 404, id);
    assert.equal(response.json().message, "Contrato não encontrado.");
  }
});
