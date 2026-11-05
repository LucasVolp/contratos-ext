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

interface AnnualRow {
  year?: number; source?: string; agency?: string; budgetaryUnit?: string; action?: string;
  functionCode?: string; category?: string; group?: string; element?: string;
  initial?: string | null; updated?: string | null; committed?: string | null; executed?: string | null;
}
async function annual(db: Database, run: string, row: AnnualRow = {}) {
  await db.query(`INSERT INTO finance.annual_budgets
    (source, fiscal_year, superior_organ_code, subordinate_agency_code, budgetary_unit_code, function_code,
     subfunction_code, program_code, action_code, economic_category_code, expense_group_code, expense_element_code,
     initial_budget, updated_budget, committed_budget, executed_budget, ingestion_run_id)
    VALUES ($1,$2,'26000',$3,$4,$5,'363','5012',$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
    row.source ?? "TRANSPARENCY_PORTAL", row.year ?? 2026, row.agency ?? "26421", row.budgetaryUnit ?? "26421",
    row.functionCode ?? "12", row.action ?? "20RL", row.category ?? "3", row.group ?? "3", row.element ?? "30",
    row.initial === undefined ? "0" : row.initial, row.updated === undefined ? "0" : row.updated,
    row.committed === undefined ? "0" : row.committed, row.executed === undefined ? "0" : row.executed, run,
  ]);
}

test("annual budget rolls up source classifications without inventing campus or modality allocations", async (t) => {
  const { db, app, get, run } = await setup(t, "ANNUAL_BUDGET");
  try {
    // Annual reporting must work without any imported management-unit directory.
    await db.query("DELETE FROM finance.management_units");
    await annual(db, run, { initial: "999999999999999999.123456", updated: "20", committed: "0.1" });
    await annual(db, run, { functionCode: "28", initial: "0.876544", updated: "30", committed: "0.2", executed: null });
    await annual(db, run, { action: "20RG", category: "4", group: "4", element: "52", initial: "7", updated: "70", committed: "7", executed: "7" });
    await annual(db, run, { budgetaryUnit: "26422", initial: "11", updated: "110", committed: "11", executed: "11" });
    await annual(db, run, { agency: "26415", initial: "888" });
    await annual(db, run, { year: 2025, initial: "777" });
    await annual(db, run, { source: "OTHER_SOURCE", initial: "999" });
    const report = await get("/budgets?subordinateAgencyCode=26421&fiscalYear=2026&limit=1");
    assert.equal(report.total, 3);
    assert.equal(report.data.length, 1);
    assert.equal(report.summary.sourceRowCount, 4);
    assert.equal(report.summary.initialBudget, "1000000000000000018.000000");
    assert.equal(report.summary.updatedBudget, "230.000000");
    assert.equal(report.summary.committedBudget, "18.300000");
    assert.equal(report.summary.executedBudget, null);
    assert.equal(report.context.dataset, "ANNUAL_BUDGET");
    assert.equal(report.context.subordinateAgencyCode, "26421");
    assert.equal("managementUnitCode" in report.data[0], false);
    assert.equal("expenseNature" in report.data[0], false);
    assert.equal("applicationModalityCode" in report.data[0], false);
    const filtered = await get("/budgets?subordinateAgencyCode=26421&fiscalYear=2026&budgetaryUnitCode=26421&actionCode=20RL&economicCategoryCode=3&expenseGroupCode=3&expenseElementCode=30");
    assert.equal(filtered.total, 1);
    assert.equal(filtered.data[0].sourceRowCount, 2);
    assert.equal(filtered.data[0].initialBudget, "1000000000000000000.000000");
    assert.equal(filtered.data[0].actionCode, "20RL");
    const beyond = await get("/budgets?subordinateAgencyCode=26421&fiscalYear=2026&page=100&limit=1");
    assert.deepEqual(beyond.data, []);
    assert.deepEqual(beyond.summary, report.summary);
    const otherAgency = await get("/budgets?subordinateAgencyCode=26415&fiscalYear=2026");
    assert.equal(otherAgency.summary.initialBudget, "888.000000");
    const previous = await get("/budgets?subordinateAgencyCode=26421&fiscalYear=2025");
    assert.equal(previous.summary.initialBudget, "777.000000");
    const empty = await get("/budgets?subordinateAgencyCode=26421&fiscalYear=2024");
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.data, []);
    assert.equal(empty.summary.sourceRowCount, 0);
    assert.equal(empty.summary.initialBudget, null);
    assert.equal(empty.summary.lastImportedAt, null);
  } finally { await app.close(); }
});
