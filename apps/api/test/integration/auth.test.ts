import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../src/app";
import { Database } from "../../src/database";
import { migrate } from "../../src/migrate";
import { AuthService } from "../../src/auth/service";
import { AuthRepository } from "../../src/auth/repository";
import { createTestDatabase } from "../helpers/test-database";

test("real sessions enforce institution scope, management roles, impersonation and password revocation", async (t) => {
  const db = await createTestDatabase(t);
  await migrate(db);
  const [{ name }] = await db.query("SELECT current_database() AS name");
  const url = new URL(
    process.env.DATABASE_URL ||
      "postgresql://contracts:contracts_local@localhost:5540/contracts",
  );
  url.pathname = "/" + name;
  const app = await createApplication({ db: new Database(url.toString()) });
  const auth = new AuthService(new AuthRepository(db));
  const password = "Test-password-2026!";
  await auth.ensureManager({ email: "manager@example.test", password });
  const call = async (
    path: string,
    cookie = "",
    method = "GET",
    payload?: unknown,
  ) =>
    app.inject({
      method: method as "GET" | "POST" | "PUT",
      url: "/api" + path,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const login = async (email: string, pass = password) => {
    const result = await call("/auth/login", "", "POST", {
      email,
      password: pass,
    });
    assert.equal(result.statusCode, 200, result.body);
    return String(result.headers["set-cookie"]).split(";")[0];
  };
  try {
    assert.equal((await call("/contracts")).statusCode, 401);
    assert.equal((await app.inject({ url: "/health" })).statusCode, 200);
    const manager = await login("manager@example.test");
    const institution = await call("/institutions", manager, "POST", {
      name: "Unit A",
      uasg: "015814",
      organization: "TEST",
    });
    assert.equal(institution.statusCode, 201, institution.body);
    const institutionId = institution.json().id;
    const created = await call("/users", manager, "POST", {
      name: "Scoped user",
      email: "user@example.test",
      password,
      role: "USUARIO",
      institutionIds: [institutionId],
    });
    assert.equal(created.statusCode, 201, created.body);
    const userId = created.json().id;
    assert.equal(created.json().passwordHash, undefined);
    const user = await login("user@example.test");
    assert.equal((await call("/users", user)).statusCode, 403);
    const body = {
      number: "AUTH-1",
      object: "Scope test",
      supplierName: "Supplier",
      supplierDocument: "11222333000181",
      initialValue: "10",
      globalValue: "10",
      startDate: "2020-01-01",
      endDate: "2099-01-01",
    };
    const own = await call("/contracts", manager, "POST", {
      ...body,
      uasg: "015814",
    });
    assert.equal(own.statusCode, 201, own.body);
    const other = await call("/contracts", manager, "POST", {
      ...body,
      uasg: "158148",
    });
    assert.equal(other.statusCode, 201, other.body);
    const listing = await call("/contracts", user);
    assert.equal(listing.statusCode, 200, listing.body);
    assert.equal(listing.json().total, 1);
    assert.equal(listing.json().stats.vigency.active, 1);
    assert.equal(listing.json().stats.vigency.activeValue, "10.000000");
    assert.equal((await call("/contracts?uasg=158148", user)).json().total, 0);
    assert.equal(
      (await call("/contracts/" + other.json().id, user)).statusCode,
      404,
    );
    assert.equal(
      (await call("/contracts", user, "POST", { ...body, uasg: "158148" }))
        .statusCode,
      403,
    );
    await db.query(
      `INSERT INTO finance.management_units(management_code,code,name) VALUES ('26421','015814','A'),('26421','158148','B')`,
    );
    await db.query(
      `INSERT INTO finance.commitment_references(document_code) VALUES ('158148264212026NE000001')`,
    );
    const [{ id }] = await db.query(
      "SELECT id::text FROM finance.commitment_references",
    );
    assert.equal((await call("/finance/units", user)).json().total, 1);
    assert.equal(
      (await call("/finance/commitments?managementCode=26421", user)).json()
        .total,
      0,
    );
    assert.equal(
      (await call("/finance/commitments/" + id, user)).statusCode,
      404,
    );
    assert.equal(
      (await call("/finance/commitments/" + id + "/payments", user)).statusCode,
      404,
    );
    assert.equal(
      (
        await call(
          "/finance/budgets?subordinateAgencyCode=26421&fiscalYear=2026",
          user,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await call("/auth/impersonate/" + userId, manager, "POST")).statusCode,
      200,
    );
    assert.equal((await call("/auth/me", manager)).json().id, userId);
    assert.equal(
      (
        await call("/auth/password", manager, "POST", {
          currentPassword: password,
          newPassword: "New-password-2026!",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await call("/auth/impersonation/stop", manager, "POST")).statusCode,
      200,
    );
    assert.equal(
      (
        await call("/auth/password", user, "POST", {
          currentPassword: password,
          newPassword: "New-password-2026!",
        })
      ).statusCode,
      200,
    );
    const another = await login("user@example.test", "New-password-2026!");
    const reset = await call("/users/" + userId, manager, "PUT", {
      name: "Scoped user",
      email: "user@example.test",
      role: "USUARIO",
      password: "Reset-password-2026!",
      institutionIds: [institutionId],
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal((await call("/auth/me", user)).statusCode, 401);
    assert.equal((await call("/auth/me", another)).statusCode, 401);
    const me = (await call("/auth/me", manager)).json();
    assert.equal(
      (
        await call("/users/" + me.id, manager, "PUT", {
          name: "Manager",
          email: "manager@example.test",
          role: "USUARIO",
          institutionIds: [institutionId],
        })
      ).statusCode,
      400,
    );
    assert.equal((await call("/auth/logout", manager, "POST")).statusCode, 200);
    assert.equal((await call("/auth/me", manager)).statusCode, 401);
  } finally {
    await app.close();
  }
});
