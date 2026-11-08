import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  passwordError,
} from "../src/auth/password";
import {
  assertUasg,
  inScope,
  narrowScope,
  scopeOf,
  uasgWhere,
  Viewer,
} from "../src/auth/access";
import { AuthService } from "../src/auth/service";
import { ApplicationService } from "../src/service";
import { ContractService } from "../src/contracts/service";
import { CatalogService } from "../src/catalog/service";

const viewer = (overrides: Partial<Viewer> = {}): Viewer => ({
  id: "u",
  name: "Usuária",
  email: "u@exemplo.gov.br",
  role: "USUARIO",
  allInstitutions: false,
  institutions: [{ id: "i", name: "IFMS Três Lagoas", uasg: "158454" }],
  impersonator: null,
  defaults: null,
  sessionId: "s",
  ...overrides,
});

test("passwords are salted scrypt hashes verified in constant time", async () => {
  const first = await hashPassword("senha-forte-1"),
    second = await hashPassword("senha-forte-1");
  assert.match(first, /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("senha-forte-1", first), true);
  assert.equal(await verifyPassword("senha-forte-2", first), false);
  assert.equal(await verifyPassword("senha-forte-1", "texto-puro"), false);
  assert.equal(await verifyPassword("x", "scrypt$1$1$1$abc$abc"), false);
  assert.ok(passwordError("curta"));
  assert.equal(passwordError("12345678"), null);
});

test("only the general manager scope is unrestricted", () => {
  assert.equal(scopeOf(viewer({ allInstitutions: true })), null);
  assert.deepEqual(scopeOf(viewer()), ["158454"]);
  assert.equal(inScope(null, "000001"), true);
  assert.equal(inScope(["158454"], "158454"), true);
  assert.equal(inScope(["158454"], "154054"), false);
  assert.deepEqual(uasgWhere(null), {});
  assert.deepEqual(uasgWhere([]), { uasg: { in: [] } });
  assert.throws(
    () => assertUasg(["158454"], "154054"),
    (error: any) =>
      error.getStatus() === 403 &&
      !!error.getResponse().fieldErrors.uasg &&
      error.message.includes("154054"),
  );
});

test("a requested UASG list narrows the scope and never widens it", () => {
  assert.equal(narrowScope(null, undefined), null);
  assert.deepEqual(narrowScope(null, "158132, 158454,158132"), [
    "158132",
    "158454",
  ]);
  assert.deepEqual(narrowScope(["158454"], "158132,158454"), ["158454"]);
  // Asking only for foreign UASGs yields an empty scope, not the full one.
  assert.deepEqual(narrowScope(["158454"], "158132"), []);
  assert.throws(
    () => narrowScope(null, "123,abc"),
    (e: any) => e.getStatus() === 400,
  );
});

test("default IFMS reach narrows the catalog without dropping explicit filters", async () => {
  let where: any;
  const table = {
    list: async (input: any) => ((where = input), []),
    stats: async () => ({ count: 0 }),
    count: async () => 0,
  };
  await new CatalogService({ purchases: table } as any, {} as any).purchases(
    { uasgs: "158132,158454", uasg: "158454" },
    null,
  );
  assert.deepEqual(where.scope, ["158132", "158454"]);
  assert.equal(where.uasg, "158454");
});

test("scoped contract listing keeps the scope when a UASG filter is requested", async () => {
  let where: any;
  const repository: any = {
    list: async (input: any) => {
      where = input;
      return [];
    },
    stats: async () => ({ count: 0 }),
    sync: async () => ({ lastCompletedAt: null, running: false, staleUnits: [] }),
  };
  await new ContractService(repository, { totals: async () => { throw new Error("unused"); } }).list({ uasg: "154054" }, ["158454"]);
  assert.deepEqual(where.scope, ["158454"]);
  assert.deepEqual(where.uasg, "154054");
});

test("out-of-scope records look missing", async () => {
  const db: any = {
    records: {
      get: async () => ({ id: "r", uasg: "154054", items: [] }),
    },
  };
  const app = new ApplicationService(db);
  await assert.rejects(
    () => app.record("r", ["158454"]),
    (e: any) => e.getStatus() === 404,
  );
});

test("public imports outside the scope are refused before calling Compras.gov", async () => {
  let calls = 0;
  const external: any = {
    record: async () => (calls++, {}),
  };
  const client: any = {
    purchases: async () => (calls++, []),
    records: async () => (calls++, []),
  };
  const app = new ApplicationService({} as any, external);
  const catalog = new CatalogService({} as any, client);
  const body = { uasg: "154054", from: "2026-01-01", to: "2026-01-31" };
  for (const run of [
    () => app.importRecord({ ...body, number: "1/2026" }, ["158454"]),
    () => catalog.syncPurchases(body, ["158454"]),
    () => catalog.syncRecords(body, ["158454"]),
  ])
    await assert.rejects(run, (e: any) => e.getStatus() === 403);
  assert.equal(calls, 0);
});

test("catalog lists combine the scope with requested filters", async () => {
  const seen: any[] = [];
  const table = {
    list: async (input: any) => (seen.push(input), []),
    stats: async () => ({ count: 0 }),
    count: async () => 0,
  };
  const db: any = {
    purchases: table,
    publicRecords: table,
  };
  const catalog = new CatalogService(db, {} as any);
  await catalog.purchases({ uasg: "154054" }, ["158454"]);
  await catalog.records({ uasg: "154054", from: "2026-01-01" }, ["158454"]);
  for (const where of seen) {
    assert.deepEqual(where.scope, ["158454"]);
    assert.equal(where.uasg, "154054");
  }
});

test("login rejects wrong passwords uniformly and throttles repeated failures", async () => {
  const passwordHash = await hashPassword("senha-correta");
  let sessions = 0;
  const db: any = {
    userByEmail: async (email: string) =>
      email === "ana@exemplo.gov.br"
        ? { id: "u", email, passwordHash, active: true }
        : null,
    createSession: async () => sessions++,
  };
  const auth = new AuthService(db);
  for (const email of ["ana@exemplo.gov.br", "ninguem@exemplo.gov.br"])
    await assert.rejects(
      () => auth.login({ email, password: "errada-123" }),
      (e: any) =>
        e.getStatus() === 401 && e.message === "E-mail ou senha incorretos.",
    );
  for (let i = 0; i < 4; i++)
    await assert.rejects(() =>
      auth.login({ email: " ANA@exemplo.gov.br ", password: "errada-123" }),
    );
  // The correct password is refused too once the e-mail is throttled.
  await assert.rejects(
    () =>
      auth.login({ email: "ana@exemplo.gov.br", password: "senha-correta" }),
    (e: any) => e.getStatus() === 429,
  );
  assert.equal(sessions, 0);
  await assert.rejects(
    () => auth.login({ email: "", password: "" }),
    (e: any) =>
      e.getStatus() === 400 &&
      !!e.getResponse().fieldErrors.email &&
      !!e.getResponse().fieldErrors.password,
  );
});

test("inactive accounts cannot sign in even with the right password", async () => {
  const passwordHash = await hashPassword("senha-correta");
  const db: any = {
    userByEmail: async () => ({ id: "u", passwordHash, active: false }),
  };
  await assert.rejects(
    () =>
      new AuthService(db).login({ email: "a@b.br", password: "senha-correta" }),
    (e: any) => e.getStatus() === 403,
  );
});

test("reach refresh consults every UASG in reach and reports failures without discarding the rest", async () => {
  const consulted: string[] = [];
  const db: any = {
    institutions: async (scope: string[] | null) =>
      [
        { uasg: "158132", name: "IFMS - Reitoria" },
        { uasg: "158454", name: "IFMS - Campus Três Lagoas" },
        { uasg: "154054", name: "UFMS - Sede" },
      ].filter((row) => scope === null || scope.includes(row.uasg)),
  };
  const catalog = new CatalogService(db, {} as any);
  catalog.syncPurchases = (async (body: any) => {
    consulted.push(body.uasg);
    if (body.uasg === "158454") throw new Error("timeout interno");
    return { created: 1, updated: 2, total: 3 };
  }) as any;
  const result = await catalog.syncReach(
    "purchases",
    { uasgs: "158132,158454", from: "2026-01-01", to: "2026-01-31" },
    null,
  );
  assert.deepEqual(consulted.sort(), ["158132", "158454"]);
  assert.equal(result.created, 1);
  assert.equal(result.total, 3);
  assert.equal(result.failed, 1);
  const failure = result.results.find((row) => row.uasg === "158454")!;
  assert.equal(failure.name, "IFMS - Campus Três Lagoas");
  // Internal error details are not exposed to the user.
  assert.ok(!failure.error!.includes("timeout interno"));
  // A scoped user only refreshes linked UASGs, even when asking for others.
  consulted.length = 0;
  await catalog.syncReach(
    "purchases",
    { uasgs: "154054,158132", from: "2026-01-01", to: "2026-01-31" },
    ["158132"],
  );
  assert.deepEqual(consulted, ["158132"]);
  // Purchases keep the 366-day limit and nothing is consulted on an invalid period.
  consulted.length = 0;
  await assert.rejects(
    () =>
      catalog.syncReach(
        "purchases",
        { from: "2025-01-01", to: "2026-06-01" },
        null,
      ),
    (e: any) => e.getStatus() === 400,
  );
  await assert.rejects(
    () =>
      catalog.syncReach(
        "records",
        { from: "2026-01-01", to: "2026-01-31" },
        [],
      ),
    (e: any) => e.getStatus() === 422,
  );
  assert.deepEqual(consulted, []);
});

test("public unit search expands a UASG or a name match to every unit of the same body", async () => {
  const { PublicUnits } = await import("../src/auth/public-units");
  const units = [
    {
      codigoUasg: "158349",
      nomeUasg: "INST.FED.DE ED.,CIENC. E TEC DE SÃO PAULO",
      cnpjCpfOrgao: "10882594000165",
      siglaUf: "SP",
      statusUasg: true,
    },
    {
      codigoUasg: "158714",
      nomeUasg: "INST.FED.DE SÃO PAULO/CAMPUS CAMPINAS",
      cnpjCpfOrgao: "10882594000165",
      siglaUf: "SP",
      statusUasg: true,
    },
    {
      codigoUasg: "999001",
      nomeUasg: "PREFEITURA DE CAMPINAS",
      cnpjCpfOrgao: "11111111000191",
      siglaUf: "SP",
      statusUasg: true,
    },
  ];
  const calls: any[] = [];
  const transport = {
    pages: async (path: string, params: any) => {
      calls.push({ path, params });
      if (path.includes("Orgao"))
        return [{ nomeOrgao: "INSTITUTO FEDERAL DE SÃO PAULO" }];
      if (params.codigoUasg)
        return units.filter((u) => u.codigoUasg === params.codigoUasg);
      if (params.cnpjCpfOrgao)
        return units.filter((u) => u.cnpjCpfOrgao === params.cnpjCpfOrgao);
      return units.filter((u) => u.siglaUf === params.siglaUf);
    },
  };
  const db: any = {
    registered: async () => [{ uasg: "158349", organization: "IFSP" }],
  };
  const search = new PublicUnits(db, transport);
  const byUasg = await search.search({ q: "158714" });
  assert.equal(byUasg.organs.length, 1);
  assert.equal(byUasg.organs[0].name, "INSTITUTO FEDERAL DE SÃO PAULO");
  assert.deepEqual(byUasg.organs[0].units.map((u) => u.uasg).sort(), [
    "158349",
    "158714",
  ]);
  assert.equal(
    byUasg.organs[0].units.find((u) => u.uasg === "158349")!.registered,
    true,
  );
  // Name search ignores accents and punctuation and keeps bodies apart.
  const byName = await search.search({ q: "sao paulo campinas", uf: "sp" });
  assert.deepEqual(
    byName.organs.map((o) => o.units.length),
    [2],
  );
  const campinas = await search.search({ q: "Campinas", uf: "SP" });
  assert.equal(campinas.organs.length, 2);
  await assert.rejects(
    () => search.search({ q: "ab" }),
    (e: any) => e.getStatus() === 400,
  );
  // The public registry answers 404 unless every query carries the status filter.
  for (const call of calls)
    assert.equal(
      call.path.includes("Orgao")
        ? call.params.statusOrgao
        : call.params.statusUasg,
      true,
      JSON.stringify(call),
    );
});

test("bulk institution import creates missing UASGs and keeps existing names", async () => {
  const { DirectoryService } = await import("../src/auth/directory");
  const created: any[] = [],
    updated: any[] = [];
  const tx: any = {
    institutionByUasg: async (uasg: string) =>
      uasg === "158349" ? { id: "x", uasg, organization: "" } : null,
    saveInstitution: async (id: string | null, data: any) =>
      id ? updated.push(data) : created.push(data),
  };
  const directory = new DirectoryService({
    transaction: (fn: any) => fn(tx),
  } as any);
  const result = await directory.importInstitutions({
    organization: "ifsp",
    units: [
      { uasg: "158349", name: "Reitoria" },
      { uasg: "158714", name: "Campus Campinas" },
      { uasg: "158714", name: "Campus Campinas" },
    ],
  });
  assert.deepEqual(result, { created: 1, existing: 1, organization: "IFSP" });
  assert.deepEqual(created, [
    { uasg: "158714", name: "Campus Campinas", organization: "IFSP" },
  ]);
  assert.deepEqual(updated, [{ organization: "IFSP" }]);
  await assert.rejects(
    () => directory.importInstitutions({ organization: "", units: [] }),
    (e: any) =>
      e.getStatus() === 400 && !!e.getResponse().fieldErrors.organization,
  );
});
