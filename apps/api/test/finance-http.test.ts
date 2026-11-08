import { testAuth } from "./helpers/viewer";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/app";
import { Database } from "../src/database";

test("financial HTTP validation rejects invalid filters and bigint identities before querying", async () => {
  let queries = 0,
    closed = 0;
  const db = {
    query: async () => {
      queries++;
      return [];
    },
    close: async () => {
      closed++;
    },
  } as unknown as Database;
  const app = await createApplication({ db, auth: testAuth });
  try {
    for (const url of [
      "/api/finance/commitments",
      "/api/finance/commitments?managementCode=26421&unknown=yes",
      "/api/finance/commitments?managementCode=26421&managementUnitCode=123",
      "/api/finance/commitments?managementCode=26421&fiscalYear=1000",
      "/api/finance/commitments?managementCode=26421&expenseNature=3390",
      "/api/finance/commitments?managementCode=26421&from=2026-02-30",
      "/api/finance/commitments?managementCode=26421&from=2026-10-01&to=2026-09-01",
      "/api/finance/commitments?managementCode=26421&limit=101",
      "/api/finance/commitments?managementCode=26421&page=1e5",
      "/api/finance/commitments?managementCode=26421&page=9007199254740991&limit=100",
      "/api/finance/commitments?managementCode=26421&managementCode=26415",
      "/api/finance/units?managementCode=bad",
      "/api/finance/commitments/0",
      "/api/finance/commitments/01",
      "/api/finance/commitments/not-a-number/items",
      "/api/finance/commitments/9223372036854775808",
      "/api/finance/commitments/1?extra=yes",
      "/api/finance/commitments/1/history?itemSequential=0",
      "/api/finance/commitments/1/payments?limit=-1",
      "/api/finance/commitments/1/items?page=0",
      "/api/finance/execution?managementCode=26421",
      "/api/finance/execution?fiscalYear=2026",
      "/api/finance/execution?managementCode=26421&fiscalYear=2026&fromMonth=0",
      "/api/finance/execution?managementCode=26421&fiscalYear=2026&toMonth=13",
      "/api/finance/execution?managementCode=26421&fiscalYear=2026&fromMonth=10&toMonth=9",
      "/api/finance/execution?managementCode=26421&fiscalYear=2026&expenseNature=33903001",
      "/api/finance/execution?managementCode=26421&fiscalYear=2026&actionCode=20RL%27",
      "/api/finance/execution?managementCode=26421&fiscalYear=2026&from=2026-01-01",
      "/api/finance/subelements?managementCode=26421&fiscalYear=2026",
      "/api/finance/subelements?managementCode=26421&fiscalYear=2026&expenseNature=33900110",
      "/api/finance/subelements?managementCode=26421&fiscalYear=2026&expenseNature=339001&metric=bad",
      "/api/finance/subelements?managementCode=26421&fiscalYear=2026&expenseNature=339001&actionCode=20RL",
      "/api/finance/budgets?subordinateAgencyCode=26421",
      "/api/finance/budgets?fiscalYear=2026",
      "/api/finance/budgets?subordinateAgencyCode=26421&fiscalYear=2026&managementUnitCode=015814",
      "/api/finance/budgets?subordinateAgencyCode=26421&fiscalYear=2026&expenseNature=339030",
      "/api/finance/budgets?subordinateAgencyCode=26421&fiscalYear=2026&expenseElementCode=4",
      "/api/finance/budgets?subordinateAgencyCode=26421&fiscalYear=2026&budgetaryUnitCode=158148",
    ]) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 400, url);
    }
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/finance/commitments",
          payload: {},
        })
      ).statusCode,
      404,
    );
    assert.equal(queries, 0);
  } finally {
    await app.close();
  }
  assert.equal(closed, 1);
});
