import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "../../src/database";
import { migrate } from "../../src/migrate";
import { createTestDatabase } from "../helpers/test-database";

async function setup(t: Parameters<typeof createTestDatabase>[0]) {
  const db = await createTestDatabase(t);
  await migrate(db);
  const [run] = await db.query(`INSERT INTO finance.ingestion_runs
    (type, source_file, period_start, period_end, scope_type, scope_codes,
     trigger_type, status, etl_version)
    VALUES ('DAILY_EXPENSES', '20260110.zip', '2026-01-10', '2026-01-10',
      'MANAGEMENT', ARRAY['26421'], 'MANUAL', 'IN_PROGRESS', 'test') RETURNING id`);
  await db.query(`INSERT INTO finance.management_units (management_code, code, name)
    VALUES ('26421', '015814', 'Unit A'), ('26421', '158148', 'Unit B')`);
  await db.query(`INSERT INTO finance.expense_natures (code, parent_code)
    VALUES ('339030', NULL), ('33903001', '339030'), ('339039', NULL)`);
  return { db, run: run.id as string };
}

async function reference(db: Database, code = "015814264212025NE000001") {
  const [row] = await db.query(`INSERT INTO finance.commitment_references (document_code)
    VALUES ($1) ON CONFLICT (source, document_code) DO UPDATE
    SET document_code = EXCLUDED.document_code RETURNING id`, [code]);
  return row.id as string;
}

async function payment(db: Database, run: string, code: string) {
  const [row] = await db.query(`INSERT INTO finance.payments
    (document_code, fiscal_year, management_code, management_unit_code, emission_date, ingestion_run_id)
    VALUES ($1, 2026, '26421', '015814', '2026-01-10', $2) RETURNING id`, [code, run]);
  return row.id as string;
}

test("financial migration upgrades existing contracts and replay preserves financial data", async (t) => {
  const db = await createTestDatabase(t);
  const directory = await mkdtemp(join(tmpdir(), "contracts-finance-upgrade-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of ["202610300001_initial.sql", "202610310001_public_catalog.sql"]) {
    await writeFile(join(directory, file), await readFile(resolve(__dirname, "../../migrations", file)));
  }
  await migrate(db, directory);
  const id = randomUUID();
  await db.query(`INSERT INTO "Contract"
    (id, number, object, "supplierName", "supplierDocument", uasg, "initialValue", "globalValue", "updatedAt")
    VALUES ($1, 'EXISTING', 'Material', 'Supplier', '11222333000181', '015814', 0.1, 0.2, now())`, [id]);
  await migrate(db);
  const ref = await reference(db);
  await migrate(db);
  assert.equal((await db.query('SELECT "globalValue" FROM "Contract" WHERE id = $1', [id]))[0].globalValue, "0.2");
  assert.equal((await db.query("SELECT id FROM finance.commitment_references"))[0].id, ref);
  assert.equal((await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'finance' AND table_type = 'BASE TABLE'")).length, 15);
  assert.equal((await db.query('SELECT * FROM "_sql_migrations"')).length, 10);
});

test("payments, liquidations and item history can precede a prior-year commitment header", async (t) => {
  const { db, run } = await setup(t);
  const ref = await reference(db);
  const pay = await payment(db, run, "015814264212026OB000001");
  await db.query(`INSERT INTO finance.payment_commitments
    (payment_id, commitment_id, expense_nature_code, paid_value_brl, outstanding_value_paid_brl, ingestion_run_id)
    VALUES ($1, $2, '33903001', 10.123456, 5.12, $3)`, [pay, ref, run]);
  const [liq] = await db.query(`INSERT INTO finance.liquidations
    (document_code, fiscal_year, management_code, management_unit_code, emission_date, ingestion_run_id)
    VALUES ('015814264212026NS000001', 2026, '26421', '015814', '2026-01-09', $1) RETURNING id`, [run]);
  await db.query(`INSERT INTO finance.liquidation_commitments
    (liquidation_id, commitment_id, expense_nature_code, liquidated_value_brl, ingestion_run_id)
    VALUES ($1, $2, '33903001', 80, $3)`, [liq.id, ref, run]);
  await db.query(`INSERT INTO finance.commitment_item_history
    (commitment_id, item_sequential, source_key, operation_type, operation_date, total_value, ingestion_run_id)
    VALUES ($1, 1, 'source-operation-1', 'CANCELLATION', '2026-01-09', -2.1, $2)`, [ref, run]);
  assert.equal((await db.query("SELECT * FROM finance.commitments")).length, 0);
  await db.query(`INSERT INTO finance.commitments
    (id, resumed_code, fiscal_year, management_code, management_unit_code, emission_date, ingestion_run_id)
    VALUES ($1, '2025NE000001', 2025, '26421', '015814', '2025-12-20', $2)`, [ref, run]);
  const [joined] = await db.query(`SELECT c.fiscal_year, u.code, pc.paid_value_brl, h.total_value
    FROM finance.commitments c
    JOIN finance.management_units u ON (u.management_code, u.code) = (c.management_code, c.management_unit_code)
    JOIN finance.payment_commitments pc ON pc.commitment_id = c.id
    JOIN finance.commitment_item_history h ON h.commitment_id = c.id WHERE c.id = $1`, [ref]);
  assert.deepEqual(joined, { fiscal_year: 2025, code: "015814", paid_value_brl: "10.123456", total_value: "-2.1" });
  await assert.rejects(() => db.query("DELETE FROM finance.commitment_references WHERE id = $1", [ref]), { code: "23503" });
  await assert.rejects(() => db.query(`INSERT INTO finance.payment_commitments
    (payment_id, commitment_id, ingestion_run_id) VALUES ($1, 999999, $2)`, [pay, run]), { code: "23503" });
});

test("partial payments and nullable classifications are idempotent without collapsing separate documents", async (t) => {
  const { db, run } = await setup(t);
  const ref = await reference(db);
  assert.equal(await reference(db), ref);
  const otherUnit = await reference(db, "158148264212025NE000001");
  assert.notEqual(otherUnit, ref);
  const first = await payment(db, run, "PAY-1");
  const second = await payment(db, run, "PAY-2");
  const upsert = (pay: string, value: string) => db.query(`INSERT INTO finance.payment_commitments
    (payment_id, commitment_id, paid_value_brl, ingestion_run_id) VALUES ($1,$2,$3,$4)
    ON CONFLICT (payment_id, commitment_id, expense_nature_code, subitem_code)
    DO UPDATE SET paid_value_brl = EXCLUDED.paid_value_brl, ingestion_run_id = EXCLUDED.ingestion_run_id`, [pay, ref, value, run]);
  await upsert(first, "0.1");
  await upsert(first, "0.2");
  await upsert(second, "0.1");
  const [result] = await db.query("SELECT count(*)::int AS count, sum(paid_value_brl) AS total FROM finance.payment_commitments");
  assert.deepEqual(result, { count: 2, total: "0.3" });
  await assert.rejects(() => payment(db, run, "PAY-1"), { code: "23505" });
  await assert.rejects(() => db.query(`INSERT INTO finance.expense_natures (code, parent_code)
    VALUES ('33903901', '339030')`), { code: "23514" });
  await assert.rejects(() => db.query(`INSERT INTO finance.expense_natures (code) VALUES ('33903002')`), { code: "23514" });
});

test("an invalid document rolls back its whole load and preserves the previous version", async (t) => {
  const { db, run } = await setup(t);
  const ref = await reference(db);
  const pay = await payment(db, run, "PAY-ROLLBACK");
  await db.query(`INSERT INTO finance.payment_commitments
    (payment_id, commitment_id, paid_value_brl, ingestion_run_id) VALUES ($1,$2,12.34,$3)`, [pay, ref, run]);
  await assert.rejects(() => db.transaction(async (tx) => {
    await tx.query("UPDATE finance.payment_commitments SET paid_value_brl = 999 WHERE payment_id = $1", [pay]);
    await tx.query(`INSERT INTO finance.commitments
      (id, fiscal_year, management_code, management_unit_code, emission_date, ingestion_run_id)
      VALUES ($1, 2025, '26421', '999999', '2025-01-01', $2)`, [ref, run]);
  }), { code: "23503" });
  assert.equal((await db.query("SELECT paid_value_brl FROM finance.payment_commitments WHERE payment_id = $1", [pay]))[0].paid_value_brl, "12.34");
  assert.equal((await db.query("SELECT * FROM finance.commitments")).length, 0);
});

test("monthly aggregates retain every classification dimension and annual budgets need no campus", async (t) => {
  const { db, run } = await setup(t);
  const insertMonthly = (category: string, value: string, day = "2026-01-01") => db.query(`INSERT INTO finance.monthly_execution
    (reference_month, management_code, management_unit_code, superior_organ_code, subordinate_agency_code,
     action_code, economic_category_code, expense_group_code, expense_element_code, committed_value_brl, ingestion_run_id)
    VALUES ($1, '26421', '015814', '26000', '26421', '20RL', $2, '3', '30', $3, $4)
    ON CONFLICT (source, reference_month, management_code, management_unit_code,
      superior_organ_code, subordinate_agency_code, action_code, budget_plan_code,
      economic_category_code, expense_group_code, expense_element_code,
      application_modality_code, federative_unit, municipality, amendment_author_code)
    DO UPDATE SET committed_value_brl = EXCLUDED.committed_value_brl`, [day, category, value, run]);
  await insertMonthly("3", "10");
  await insertMonthly("3", "20");
  await insertMonthly("4", "30");
  assert.equal((await db.query("SELECT * FROM finance.monthly_execution")).length, 2);
  await assert.rejects(() => insertMonthly("3", "0", "2026-01-02"), { code: "23514" });
  await db.query(`INSERT INTO finance.annual_budgets
    (fiscal_year, superior_organ_code, subordinate_agency_code, budgetary_unit_code,
     function_code, subfunction_code, program_code, action_code, economic_category_code,
     expense_group_code, expense_element_code, initial_budget, ingestion_run_id)
    VALUES (2026, '26000', '26421', '26421', '12', '363', '5012', '20RL', '3', '3', '30', 100, $1)`, [run]);
  await db.query(`INSERT INTO finance.budget_distributions
    (id, fiscal_year, management_code, management_unit_code, expense_nature_code, type, amount)
    VALUES ($1, 2026, '26421', '015814', '339030', 'ESTIMATE', 25)`, [randomUUID()]);
  assert.equal((await db.query("SELECT initial_budget FROM finance.annual_budgets"))[0].initial_budget, "100");
  assert.equal((await db.query("SELECT amount FROM finance.budget_distributions"))[0].amount, "25");
  assert.equal((await db.query("SELECT * FROM finance.commitments")).length, 0);
  await assert.rejects(() => db.query("UPDATE finance.ingestion_runs SET status = 'SUCCESS' WHERE id = $1", [run]), { code: "23514" });
  await db.query("UPDATE finance.ingestion_runs SET status = 'SUCCESS', finished_at = now() WHERE id = $1", [run]);
});
