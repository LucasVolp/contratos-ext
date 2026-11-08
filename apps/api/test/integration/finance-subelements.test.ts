import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../src/app";
import { Database } from "../../src/database";
import { migrate } from "../../src/migrate";
import { createTestDatabase } from "../helpers/test-database";
import { testViewer } from "../helpers/viewer";

test("subelement report aggregates daily sources independently with exact whole-filter totals, unknowns and restricted scope", async (t) => {
  const db = await createTestDatabase(t);
  await migrate(db);
  const [{ name }] = await db.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  const databaseUrl = new URL(
    process.env.DATABASE_URL ||
      "postgresql://contracts:contracts_local@localhost:5540/contracts",
  );
  databaseUrl.pathname = "/" + name;
  let viewer = testViewer;
  const app = await createApplication({
    db: new Database(databaseUrl.toString()),
    auth: { viewer: async () => viewer },
  });
  try {
    const [{ id: run }] = await db.query(`INSERT INTO finance.ingestion_runs
      (type,source_file,period_start,period_end,scope_type,scope_codes,trigger_type,status,etl_version)
      VALUES ('DAILY_EXPENSES','subelements.zip','2026-01-01','2026-12-31','MANAGEMENT',ARRAY['26421'],'MANUAL','IN_PROGRESS','test') RETURNING id`);
    await db.query(`INSERT INTO finance.management_units (management_code,code,name) VALUES ('26421','015814','Unit A'),('26421','158148','Unit B');
      INSERT INTO finance.expense_natures (code,parent_code) VALUES ('339001',NULL),('33900110','339001'),('33900120','339001');`);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [{ id }] = await db.query(
        `INSERT INTO finance.commitment_references (document_code) VALUES ($1) RETURNING id`,
        [`015814264212026NE00000${i}`],
      );
      ids.push(id);
      await db.query(
        `INSERT INTO finance.commitments (id,fiscal_year,management_code,management_unit_code,emission_date,expense_nature_code,ingestion_run_id)
        VALUES ($1,2026,'26421',$2,'2026-01-10','339001',$3)`,
        [id, i === 2 ? "158148" : "015814", run],
      );
    }
    const item = (
      id: string,
      sequential: number,
      subitem: string | null,
      amount: string | null,
    ) =>
      db.query(
        `INSERT INTO finance.commitment_items
      (commitment_id,sequential,expense_nature_code,subitem_code,subitem_description,current_value,ingestion_run_id)
      VALUES ($1,$2,'339001',$3,$4,$5,$6)`,
        [
          id,
          sequential,
          subitem,
          subitem ? `Child ${subitem}` : null,
          amount,
          run,
        ],
      );
    await item(ids[0], 1, "10", "100.000001");
    await item(ids[1], 1, "10", "49.999999");
    await item(ids[0], 2, "20", "20");
    await item(ids[0], 3, null, "5");
    await item(ids[2], 1, "10", "999");
    await db.query(
      `INSERT INTO finance.commitment_item_history (commitment_id,item_sequential,source_key,operation_type,operation_date,total_value,ingestion_run_id)
      VALUES ($1,1,'history','REINFORCEMENT','2026-01-10',888,$2)`,
      [ids[0], run],
    );
    for (const [kind, table, idColumn, amountColumn, values] of [
      [
        "liquidations",
        "liquidation_commitments",
        "liquidation_id",
        "liquidated_value_brl",
        ["40", "10"],
      ],
      [
        "payments",
        "payment_commitments",
        "payment_id",
        "paid_value_brl",
        ["20", "5"],
      ],
    ] as const) {
      for (let i = 0; i < 2; i++) {
        const [{ id }] = await db.query(
          `INSERT INTO finance.${kind} (document_code,fiscal_year,management_code,management_unit_code,emission_date,ingestion_run_id)
          VALUES ($1,2026,'26421','015814','2026-01-15',$2) RETURNING id`,
          [`${kind}-${i}`, run],
        );
        await db.query(
          `INSERT INTO finance.${table} (${idColumn},commitment_id,expense_nature_code,subitem_code,${amountColumn},ingestion_run_id)
          VALUES ($1,$2,'33900110','10',$3,$4)`,
          [id, ids[0], values[i], run],
        );
      }
    }
    const path =
      "/api/finance/subelements?managementCode=26421&managementUnitCode=015814&fiscalYear=2026&expenseNature=339001";
    const get = async (suffix = "") => {
      const response = await app.inject({ method: "GET", url: path + suffix });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    };
    const report = await get("&limit=1");
    assert.equal(report.total, 3);
    assert.equal(report.data.length, 1);
    assert.equal(report.data[0].code, "33900110");
    assert.equal(report.data[0].committedValue, "150.000000");
    assert.equal(report.data[0].liquidatedValue, "50.000000");
    assert.equal(report.data[0].paidValue, "25.000000");
    assert.equal(report.summary.committedValue, "175.000000");
    assert.equal(report.summary.liquidatedValue, "50.000000");
    assert.equal(report.summary.paidValue, "25.000000");
    assert.equal(report.summary.coverage, "NOT_VERIFIED");
    assert.equal(report.context.dataset, "DAILY_SUBELEMENTS");
    assert.equal(report.chart.length, 3);
    assert.equal(
      report.chart.find((row: { other: boolean }) => row.other).value,
      "5.000000",
    );
    const next = await get("&limit=1&page=2");
    assert.deepEqual(next.summary, report.summary);
    assert.equal(next.data[0].code, "33900120");
    assert.equal(next.data[0].paidValue, null);
    const empty = await get("&fromMonth=2&toMonth=2");
    assert.equal(empty.total, 0);
    assert.equal(empty.summary.committedValue, null);
    for (const suffix of ["&metric=bad", "&actionCode=20RL", "&unknown=1"])
      assert.equal(
        (await app.inject({ method: "GET", url: path + suffix })).statusCode,
        400,
      );
    await db.query(
      `INSERT INTO finance.commitment_items
      (commitment_id,sequential,source_ordinal,expense_nature_code,subitem_code,current_value,ingestion_run_id)
      VALUES ($1,1,2,'339001','10',1,$2)`,
      [ids[0], run],
    );
    const occurrences = await get();
    assert.equal(occurrences.summary.committedValue, "176.000000");
    assert.equal(
      occurrences.data.find((row: { code: string }) => row.code === "33900110")
        .committedValue,
      "151.000000",
    );
    await item(ids[0], 5, "20", "-25");
    const signed = await get();
    assert.equal(
      signed.data.find((row: { code: string }) => row.code === "33900120")
        .committedValue,
      "-5.000000",
    );
    for (let i = 0; i < 5; i++)
      await item(ids[0], 20 + i, String(21 + i), "100");
    const hiddenNegative = await get();
    assert.ok(
      hiddenNegative.chart.every(
        (slice: { value: string }) => !slice.value.startsWith("-"),
      ),
    );
    assert.equal(hiddenNegative.chartEligible, false);
    await item(ids[0], 4, "20", null);
    const missing = await get();
    assert.equal(missing.summary.committedValue, null);
    assert.equal(
      missing.data.find((row: { code: string }) => row.code === "33900120")
        .committedValue,
      null,
    );
    viewer = {
      ...testViewer,
      allInstitutions: false,
      role: "USUARIO",
      institutions: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          name: "Unit B",
          uasg: "158148",
        },
      ],
    };
    const restricted = await app.inject({
      method: "GET",
      url: path.replace("&managementUnitCode=015814", ""),
    });
    assert.equal(restricted.statusCode, 200, restricted.body);
    assert.equal(restricted.json().summary.committedValue, "999.000000");
  } finally {
    await app.close();
  }
});
