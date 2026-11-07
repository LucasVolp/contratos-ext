import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { Database } from "../../apps/api/src/database";
import { migrate } from "../../apps/api/src/migrate";
import { createApplication } from "../../apps/api/src/app";

export async function financeFixture() {
  const admin = new Database();
  const name = `contracts_web_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(
    process.env.DATABASE_URL ||
      "postgresql://contracts:contracts_local@localhost:5540/contracts",
  );
  url.pathname = `/${name}`;
  const db = new Database(url.toString());
  const app = await createApplication({ db });
  let web: ReturnType<typeof spawn> | undefined;
  async function cleanup() {
    if (web && web.exitCode === null) {
      const done = once(web, "exit");
      web.kill("SIGTERM");
      await done;
    }
    await app.close();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.close();
  }
  try {
    await migrate(db);
    const [{ id: run }] = await db.query(`INSERT INTO finance.ingestion_runs
      (type,source_file,period_start,period_end,scope_type,scope_codes,trigger_type,status,etl_version)
      VALUES ('DAILY_EXPENSES','fixture.zip','2026-01-01','2026-12-31','MANAGEMENT',ARRAY['26421'],'MANUAL','IN_PROGRESS','test') RETURNING id`);
    await db.query(`INSERT INTO finance.management_units (management_code,code,name,management_name)
      VALUES ('26421','015814','Unidade de teste','Instituição de teste')`);
    await db.query(
      `INSERT INTO finance.expense_natures (code) VALUES ('339030')`,
    );
    for (let i = 0; i < 21; i++) {
      const id = String(9007199254740993n + BigInt(i));
      const code = `015814264212026NE${String(i + 1).padStart(6, "0")}`;
      await db.query(
        `INSERT INTO finance.commitment_references (id,document_code) OVERRIDING SYSTEM VALUE VALUES ($1,$2)`,
        [id, code],
      );
      if (i < 20)
        await db.query(
          `INSERT INTO finance.commitments (id,resumed_code,fiscal_year,management_code,management_unit_code,emission_date,favored_name,expense_nature_code,ingestion_run_id)
        VALUES ($1,$2,2026,'26421','015814','2026-01-10','Fornecedor de teste','339030',$3)`,
          [id, `2026NE${String(i + 1).padStart(6, "0")}`, run],
        );
      if (i < 20)
        await db.query(
          `INSERT INTO finance.commitment_items (commitment_id,sequential,expense_nature_code,description,current_value,ingestion_run_id)
        VALUES ($1,1,'339030','Material de teste',123456789012345678.123456,$2)`,
          [id, run],
        );
      await db.query(
        `INSERT INTO finance.monthly_execution
        (reference_month,management_code,management_unit_code,superior_organ_code,subordinate_agency_code,action_code,
        economic_category_code,expense_group_code,application_modality_code,expense_element_code,committed_value_brl,
        liquidated_value_brl,paid_value_brl,registered_payables_value_brl,canceled_payables_value_brl,outstanding_value_paid_brl,ingestion_run_id)
        VALUES ('2026-01-01','26421','015814','26000','26421','20RL','3','3','90',$1,1,0.1,NULL,2,-0.000001,0,$2)`,
        [String(i + 1).padStart(2, "0"), run],
      );
      await db.query(
        `INSERT INTO finance.annual_budgets
        (fiscal_year,superior_organ_code,subordinate_agency_code,budgetary_unit_code,function_code,subfunction_code,
         program_code,action_code,economic_category_code,expense_group_code,expense_element_code,initial_budget,updated_budget,committed_budget,executed_budget,ingestion_run_id)
        VALUES (2026,'26000','26421','26421','12','363','5012','20RL','3','3',$1,1,2,0.1,NULL,$2)`,
        [String(i + 1).padStart(2, "0"), run],
      );
    }
    const id = "9007199254740993";
    await db.query(
      `INSERT INTO finance.commitment_item_history
      (commitment_id,item_sequential,source_key,operation_type,operation_date,total_value,ingestion_run_id)
      VALUES ($1,1,'fixture-operation','CANCELLATION','2026-01-11',-1.123456,$2)`,
      [id, run],
    );
    const [{ id: payment }] = await db.query(
      `INSERT INTO finance.payments
      (document_code,fiscal_year,management_code,management_unit_code,emission_date,ingestion_run_id)
      VALUES ('015814264212026OB000001',2026,'26421','015814','2026-01-11',$1) RETURNING id`,
      [run],
    );
    await db.query(
      `INSERT INTO finance.payment_commitments
      (payment_id,commitment_id,expense_nature_code,paid_value_brl,outstanding_value_paid_brl,ingestion_run_id)
      VALUES ($1,$2,'339030',0.123456,2,$3)`,
      [payment, id, run],
    );
    const [{ id: liquidation }] = await db.query(
      `INSERT INTO finance.liquidations
      (document_code,fiscal_year,management_code,management_unit_code,emission_date,ingestion_run_id)
      VALUES ('015814264212026NS000001',2026,'26421','015814','2026-01-11',$1) RETURNING id`,
      [run],
    );
    await db.query(
      `INSERT INTO finance.liquidation_commitments
      (liquidation_id,commitment_id,expense_nature_code,liquidated_value_brl,ingestion_run_id)
      VALUES ($1,$2,'339030',1.123456,$3)`,
      [liquidation, id, run],
    );
    const apiUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const port = process.env.FINANCE_E2E_PORT || "3140";
    const baseURL = `http://127.0.0.1:${port}`;
    let logs = "";
    web = spawn(
      process.execPath,
      [
        resolve("apps/web/node_modules/next/dist/bin/next"),
        "start",
        "--port",
        port,
        "--hostname",
        "127.0.0.1",
      ],
      {
        cwd: resolve("apps/web"),
        env: { ...process.env, API_INTERNAL_URL: apiUrl },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    web.stdout?.on("data", (data) => {
      logs += String(data);
    });
    web.stderr?.on("data", (data) => {
      logs += String(data);
    });
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (web.exitCode !== null)
        throw new Error(`Financial web server exited: ${logs}`);
      try {
        if ((await fetch(baseURL + "/financeiro")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error(`Financial web server did not start: ${logs}`);
    return { baseURL, id, headerlessId: "9007199254741013", cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
