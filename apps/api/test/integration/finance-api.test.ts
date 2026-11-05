import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../src/app";
import { Database } from "../../src/database";
import { migrate } from "../../src/migrate";
import { createTestDatabase } from "../helpers/test-database";

const current = "9007199254740993", unresolved = "9007199254740995";

async function setup(t: TestContext) {
  const db = await createTestDatabase(t);
  await migrate(db);
  const [{ name }] = await db.query<{ name: string }>("SELECT current_database() AS name");
  const url = new URL(process.env.DATABASE_URL || "postgresql://contracts:contracts_local@localhost:5540/contracts");
  url.pathname = "/" + name;
  // The app owns its connection pool; the fixture owns a separate pool for teardown.
  const appDb = new Database(url.toString());
  const app = await createApplication({ db: appDb });
  const [{ id: run }] = await db.query(`INSERT INTO finance.ingestion_runs
    (type, source_file, period_start, period_end, scope_type, scope_codes, trigger_type, status, etl_version, finished_at)
    VALUES ('DAILY_EXPENSES', 'test.zip', '2026-09-30', '2026-09-30', 'MANAGEMENT', ARRAY['26421'], 'MANUAL', 'SUCCESS', 'test', now()) RETURNING id`);
  await db.query(`INSERT INTO finance.management_units (management_code, code, name)
    VALUES ('26421', '015814', 'Unit A'), ('26421', '158148', 'Unit B'), ('26415', '015814', 'Other institution');
    INSERT INTO finance.expense_natures (code, parent_code)
    VALUES ('339030', NULL), ('33903001', '339030'), ('33903002', '339030'), ('339039', NULL);
    INSERT INTO finance.commitment_references (id, document_code) OVERRIDING SYSTEM VALUE
    VALUES (9007199254740993, '015814264212026NE000001'), (9007199254740995, '015814264212025NE000002'),
      (9007199254740997, '158148264212026NE000003'), (9007199254740999, '015814264152026NE000004')`);
  await db.query(`INSERT INTO finance.commitments
    (id, fiscal_year, management_code, management_unit_code, emission_date, favored_code, favored_name, process_number, expense_nature_code, original_value, ingestion_run_id)
    VALUES ($1, 2026, '26421', '015814', '2026-09-10', '11222333000181', 'Supplier A', 'PROC%_literal', '339030', '999999999999999999.123456', $2),
      (9007199254740997, 2026, '26421', '158148', '2026-09-11', NULL, 'Supplier B', NULL, NULL, NULL, $2),
      (9007199254740999, 2026, '26415', '015814', '2026-09-12', NULL, 'Other supplier', NULL, NULL, NULL, $2)`, [current, run]);
  await db.query(`INSERT INTO finance.commitment_items
    (commitment_id, sequential, expense_nature_code, current_value, quantity, unit_price, ingestion_run_id)
    VALUES ($1, 1, '33903001', '999999999999999999.123456', '0.1', '0.2', $2),
      ($1, 2, '339039', '0.876544', NULL, NULL, $2)`, [current, run]);
  await db.query(`INSERT INTO finance.commitment_item_history
    (commitment_id, item_sequential, source_key, operation_type, operation_date, total_value, ingestion_run_id)
    VALUES ($1, 1, 'first', 'INCLUSION', '2026-09-10', 10, $2),
      ($1, 1, 'second', 'CANCELLATION', '2026-09-15', '-2.000001', $2),
      ($1, 7, 'orphan-item', 'INCLUSION', '2026-09-16', 1, $2)`, [current, run]);
  const liquidations = await db.query(`INSERT INTO finance.liquidations
    (document_code, fiscal_year, management_code, management_unit_code, emission_date, ingestion_run_id)
    VALUES ('015814264212026NS000001', 2026, '26421', '015814', '2026-09-18', $1),
      ('015814264212026NS000002', 2026, '26421', '015814', '2026-09-19', $1) RETURNING id`, [run]);
  await db.query(`INSERT INTO finance.liquidation_commitments
    (liquidation_id, commitment_id, expense_nature_code, liquidated_value_brl, outstanding_value_liquidated_brl, ingestion_run_id)
    VALUES ($1, $3, '33903001', '10.1', 0, $4), ($1, $3, '339039', '20.2', 0, $4), ($2, $3, '33903001', '30.3', 0, $4)`, [liquidations[0].id, liquidations[1].id, current, run]);
  const payments = await db.query(`INSERT INTO finance.payments
    (document_code, fiscal_year, management_code, management_unit_code, emission_date, ingestion_run_id)
    VALUES ('015814264212026OB000001', 2026, '26421', '015814', '2026-09-20', $1),
      ('015814264212026OB000002', 2026, '26421', '015814', '2026-10-05', $1),
      ('015814264212026OB000003', 2026, '26421', '015814', '2026-10-06', $1) RETURNING id`, [run]);
  await db.query(`INSERT INTO finance.payment_commitments
    (payment_id, commitment_id, expense_nature_code, paid_value_brl, outstanding_value_paid_brl, ingestion_run_id)
    VALUES ($1, $4, '33903001', '0.1', 0, $6), ($1, $4, '33903002', '0.4', 0, $6),
      ($2, $4, '339039', '0.2', 0, $6), ($3, $5, '33903001', 0, '50.123456', $6)`, [payments[0].id, payments[1].id, payments[2].id, current, unresolved, run]);
  const get = async (path: string) => {
    const response = await app.inject({ method: "GET", url: "/api/finance" + path });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    return response.json();
  };
  return { db, app, get, run };
}

test("financial HTTP pages preserve exact decimals, bigint IDs and independent document aggregates", async (t) => {
  const { app, get } = await setup(t);
  try {
    const units = await get("/units?managementCode=26421&limit=1&page=1");
    assert.equal(units.total, 2);
    assert.equal(units.data[0].code, "015814");
    const list = await get("/commitments?managementCode=26421&managementUnitCode=015814&limit=1");
    assert.equal(list.total, 2);
    assert.equal(list.data[0].id, current);
    assert.equal(list.data[0].committedValue, "1000000000000000000.000000");
    assert.equal(list.data[0].liquidatedValue, "60.600000");
    assert.equal(list.data[0].paidValue, "0.700000");
    assert.equal(list.data[0].priorYearPaidValue, "0.000000");
    assert.equal(list.data[0].liquidationPriorYearMovementValue, "0.000000");
    assert.equal(list.data[0].liquidationCount, 2);
    assert.equal(list.data[0].paymentCount, 2);
    assert.equal(list.data[0].historyCount, 3);
    assert.equal("_sortId" in list.data[0], false);
    const second = await get("/commitments?managementCode=26421&managementUnitCode=015814&limit=1&page=2");
    assert.equal(second.data[0].id, unresolved);
    const beyond = await get("/commitments?managementCode=26421&managementUnitCode=015814&limit=1&page=3");
    assert.deepEqual(beyond, { data: [], total: 2, page: 3, limit: 1 });
    const detail = await get(`/commitments/${current}`);
    assert.equal(detail.header.originalValue, "999999999999999999.123456");
    assert.equal(detail.headerAvailable, true);
    assert.equal(typeof detail.header.ingestionRunId, "string");
    assert.equal(detail.emissionDate, "2026-09-10");
    const items = await get(`/commitments/${current}/items?limit=1&page=2`);
    assert.equal(items.total, 2);
    assert.equal(items.data[0].sequential, 2);
    assert.equal(items.data[0].currentValue, "0.876544");
    const history = await get(`/commitments/${current}/history?itemSequential=1`);
    assert.equal(history.total, 2);
    assert.equal(history.data[1].totalValue, "-2.000001");
    const orphanHistory = await get(`/commitments/${current}/history?itemSequential=7`);
    assert.equal(orphanHistory.total, 1);
    const liquidations = await get(`/commitments/${current}/liquidations?limit=1`);
    assert.equal(liquidations.total, 3);
    assert.equal(typeof liquidations.data[0].documentId, "string");
    assert.equal(liquidations.data[0].priorYearMovementValue, "0.000000");
    const payments = await get(`/commitments/${current}/payments?limit=1`);
    assert.equal(payments.total, 3);
    assert.equal(payments.data[0].emissionDate, "2026-10-05");
    assert.equal(payments.data[0].paidValue, "0.200000");
    assert.equal("accountsPayable" in detail, false);
  } finally { await app.close(); }
});

test("financial filters select full commitments without losing unresolved cross-year references", async (t) => {
  const { db, app, get, run } = await setup(t);
  try {
    const prefix = await get("/commitments?managementCode=26421&expenseNature=339030");
    assert.equal(prefix.total, 2);
    const specific = await get("/commitments?managementCode=26421&expenseNature=339039");
    assert.equal(specific.total, 1);
    assert.equal(specific.data[0].committedValue, "1000000000000000000.000000");
    const old = await get("/commitments?managementCode=26421&fiscalYear=2025");
    assert.equal(old.total, 1);
    assert.equal(old.data[0].id, unresolved);
    assert.equal(old.data[0].headerAvailable, false);
    assert.equal(old.data[0].managementUnitCode, "015814");
    assert.equal(old.data[0].committedValue, null);
    const detail = await get(`/commitments/${unresolved}`);
    assert.equal(detail.header, null);
    const payments = await get(`/commitments/${unresolved}/payments`);
    assert.equal(payments.data[0].fiscalYear, 2026);
    assert.equal(payments.data[0].priorYearPaidValue, "50.123456");
    assert.equal(payments.data[0].paidValue, "0.000000");
    assert.equal((await get("/commitments?managementCode=26415")).total, 1);
    assert.equal((await get("/commitments?managementCode=26421&favoredCode=11222333000181")).total, 1);
    assert.equal((await get("/commitments?managementCode=26421&search=%25_" )).total, 1);
    assert.equal((await get("/commitments?managementCode=26421&search=%27%20OR%20TRUE--")).total, 0);
    assert.equal((await get("/commitments?managementCode=26421&from=2026-09-10&to=2026-09-10")).total, 1);
    await db.query(`INSERT INTO finance.commitments
      (id, fiscal_year, management_code, management_unit_code, emission_date, ingestion_run_id)
      VALUES ($1, 2025, '26421', '015814', '2025-12-20', $2)`, [unresolved, run]);
    const resolved = await get(`/commitments/${unresolved}`);
    assert.equal(resolved.headerAvailable, true);
    assert.equal(resolved.priorYearPaidValue, "50.123456");
  } finally { await app.close(); }
});

test("financial API distinguishes unknown values, zero activity and unknown references", async (t) => {
  const { db, app, get, run } = await setup(t);
  try {
    const empty = await get("/commitments/9007199254740997");
    assert.equal(empty.committedValue, null);
    assert.equal(empty.paidValue, "0");
    assert.equal(empty.paymentCount, 0);
    await db.query(`INSERT INTO finance.commitment_items (commitment_id, sequential, current_value, ingestion_run_id)
      VALUES ($1, 3, NULL, $2)`, [current, run]);
    await db.query("UPDATE finance.payment_commitments SET paid_value_brl = NULL WHERE commitment_id = $1 AND expense_nature_code = '33903001'", [current]);
    const unknown = await get(`/commitments/${current}`);
    assert.equal(unknown.committedValue, null);
    assert.equal(unknown.paidValue, null);
    assert.equal(unknown.priorYearPaidValue, "0.000000");
    for (const suffix of ["", "/items", "/history", "/liquidations", "/payments"]) {
      const response = await app.inject({ method: "GET", url: `/api/finance/commitments/9223372036854775807${suffix}` });
      assert.equal(response.statusCode, 404, response.body);
    }
  } finally { await app.close(); }
});
