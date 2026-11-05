import { test, TestContext } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../src/app";
import { Database } from "../../src/database";
import { migrate } from "../../src/migrate";
import { createTestDatabase } from "../helpers/test-database";

async function setup(t: TestContext, type = "MONTHLY_EXECUTION") {
  const db = await createTestDatabase(t);
  await migrate(db);
  const [{ name }] = await db.query<{ name: string }>("SELECT current_database() AS name");
  const url = new URL(process.env.DATABASE_URL || "postgresql://contracts:contracts_local@localhost:5540/contracts");
  url.pathname = "/" + name;
  const app = await createApplication({ db: new Database(url.toString()) });
  const [{ id: run }] = await db.query(`INSERT INTO finance.ingestion_runs
    (type, source_file, period_start, period_end, scope_type, scope_codes, trigger_type, status, etl_version, finished_at)
    VALUES ($1, 'report.zip', '2026-01-01', '2026-12-31', $2, ARRAY['26421'], 'MANUAL', 'SUCCESS', 'test', now()) RETURNING id`,
    [type, type === "ANNUAL_BUDGET" ? "SUBORDINATE_AGENCY" : "MANAGEMENT"]);
  await db.query(`INSERT INTO finance.management_units (management_code, code, name)
    VALUES ('26421', '015814', 'Unit A'), ('26421', '158148', 'Unit B'), ('26415', '015814', 'Other institution')`);
  const get = async (path: string) => {
    const response = await app.inject({ method: "GET", url: "/api/finance" + path });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    return response.json();
  };
  return { db, app, get, run };
}

interface MonthlyRow {
  month?: string; management?: string; unit?: string; source?: string; action?: string;
  category?: string; group?: string; modality?: string | null; element?: string;
  committed?: string | null; liquidated?: string | null; paid?: string | null;
  registered?: string | null; canceled?: string | null; priorYearPaid?: string | null;
}
async function monthly(db: Database, run: string, row: MonthlyRow = {}) {
  await db.query(`INSERT INTO finance.monthly_execution
    (source, reference_month, management_code, management_unit_code, superior_organ_code, subordinate_agency_code,
     action_code, economic_category_code, expense_group_code, application_modality_code, expense_element_code,
     committed_value_brl, liquidated_value_brl, paid_value_brl, registered_payables_value_brl,
     canceled_payables_value_brl, outstanding_value_paid_brl, ingestion_run_id)
    VALUES ($1,$2,$3,$4,'26000','26421',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
    row.source ?? "TRANSPARENCY_PORTAL", row.month ?? "2026-09-01", row.management ?? "26421", row.unit ?? "015814",
    row.action ?? "20RL", row.category ?? "3", row.group ?? "3", row.modality === undefined ? "90" : row.modality, row.element ?? "30",
    row.committed === undefined ? "0" : row.committed, row.liquidated === undefined ? "0" : row.liquidated,
    row.paid === undefined ? "0" : row.paid, row.registered === undefined ? "0" : row.registered,
    row.canceled === undefined ? "0" : row.canceled, row.priorYearPaid === undefined ? "0" : row.priorYearPaid, run,
  ]);
}

test("monthly execution groups unit and source classification with whole-filter exact totals", async (t) => {
  const { db, app, get, run } = await setup(t);
  try {
    await monthly(db, run, { committed: "999999999999999999.123456", paid: "0.1" });
    await monthly(db, run, { month: "2026-10-01", action: "20RG", committed: "0.876544", paid: "0.2", registered: "100", canceled: "-2.000001", priorYearPaid: "1.234567" });
    await monthly(db, run, { element: "39", committed: "2", paid: null });
    await monthly(db, run, { category: "4", group: "4", modality: null, element: "52", committed: "7" });
    await monthly(db, run, { unit: "158148", committed: "5" });
    await monthly(db, run, { source: "OTHER_SOURCE", committed: "999" });
    await monthly(db, run, { management: "26415", committed: "888" });
    await monthly(db, run, { month: "2025-09-01", committed: "777" });
    const report = await get("/execution?managementCode=26421&fiscalYear=2026&limit=1");
    assert.equal(report.total, 4);
    assert.equal(report.data.length, 1);
    assert.equal(report.data[0].expenseNature, "339030");
    assert.equal(report.data[0].managementUnitCode, "015814");
    assert.equal(report.data[0].unitName, "Unit A");
    assert.equal(report.data[0].committedValue, "1000000000000000000.000000");
    assert.equal(report.data[0].paidValue, "0.300000");
    assert.equal(report.data[0].registeredPayablesValue, "100.000000");
    assert.equal(report.data[0].canceledPayablesValue, "-2.000001");
    assert.equal(report.data[0].priorYearPaidValue, "1.234567");
    assert.equal(report.summary.sourceRowCount, 5);
    assert.equal(report.summary.observedMonthCount, 2);
    assert.equal(report.summary.firstMonth, "2026-09-01");
    assert.equal(report.summary.lastMonth, "2026-10-01");
    assert.equal(report.summary.committedValue, "1000000000000000014.000000");
    assert.equal(report.summary.paidValue, null);
    assert.equal(report.context.dataset, "MONTHLY_EXECUTION");
    assert.equal(report.context.fromMonth, 1);
    assert.equal(report.context.toMonth, 12);
    const all = await get("/execution?managementCode=26421&fiscalYear=2026");
    const unknown = all.data.find((row: { expenseNature: string | null }) => row.expenseNature === null);
    assert.equal(unknown.expenseElementCode, "52");
    assert.equal(unknown.applicationModalityCode, null);
    const beyond = await get("/execution?managementCode=26421&fiscalYear=2026&limit=1&page=9");
    assert.deepEqual(beyond.data, []);
    assert.deepEqual(beyond.summary, report.summary);
    const filtered = await get("/execution?managementCode=26421&fiscalYear=2026&managementUnitCode=015814&expenseNature=339030&actionCode=20RG&fromMonth=10&toMonth=10");
    assert.equal(filtered.total, 1);
    assert.equal(filtered.summary.sourceRowCount, 1);
    assert.equal(filtered.summary.committedValue, "0.876544");
    assert.equal(filtered.summary.observedMonthCount, 1);
    const empty = await get("/execution?managementCode=26421&fiscalYear=2026&fromMonth=1&toMonth=1");
    assert.deepEqual(empty.data, []);
    assert.equal(empty.total, 0);
    assert.equal(empty.summary.sourceRowCount, 0);
    assert.equal(empty.summary.observedMonthCount, 0);
    assert.equal(empty.summary.committedValue, null);
    assert.equal(empty.summary.lastImportedAt, null);
  } finally { await app.close(); }
});

test("monthly execution never adds detailed documents or internal planning to its totals", async (t) => {
  const { db, app, get, run } = await setup(t);
  try {
    await monthly(db, run, { committed: "10" });
    await db.query(`INSERT INTO finance.expense_natures (code) VALUES ('339030');
      INSERT INTO finance.budget_distributions (id, fiscal_year, management_code, management_unit_code, expense_nature_code, type, amount)
      VALUES ('00000000-0000-4000-8000-000000000001', 2026, '26421', '015814', '339030', 'ESTIMATE', 200)`);
    const [{ id: reference }] = await db.query("INSERT INTO finance.commitment_references (document_code) VALUES ('015814264212026NE000001') RETURNING id");
    await db.query(`INSERT INTO finance.commitments (id, fiscal_year, management_code, management_unit_code, emission_date, ingestion_run_id)
      VALUES ($1, 2026, '26421','015814','2026-09-01',$2);
      `, [reference, run]);
    await db.query("INSERT INTO finance.commitment_items (commitment_id, sequential, current_value, ingestion_run_id) VALUES ($1,1,999,$2)", [reference, run]);
    const report = await get("/execution?managementCode=26421&fiscalYear=2026");
    assert.equal(report.summary.committedValue, "10.000000");
    assert.equal("accountsPayable" in report.summary, false);
    assert.equal("plannedValue" in report.summary, false);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM finance.expense_natures"))[0].count, 1);
  } finally { await app.close(); }
});
