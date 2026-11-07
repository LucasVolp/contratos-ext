import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const requireApi = createRequire(resolve(process.cwd(), "apps/api/package.json"));
const { Client } = requireApi("pg");
const units = [
  { uasg: "990001", name: "ORGAO DE TESTE - REITORIA", city: "SÃO PAULO", uf: "SP", registered: false, organization: null },
  { uasg: "990002", name: "ORGAO DE TESTE - CAMPUS NORTE", city: "CAMPINAS", uf: "SP", registered: false, organization: null },
];
async function cleanup() {
  const db = new Client({
    connectionString:
      process.env.E2E_DATABASE_URL ||
      "postgresql://contracts:contracts_local@localhost:5540/contracts",
  });
  await db.connect();
  await db.query(`DELETE FROM "Institution" WHERE uasg = ANY($1)`, [units.map((u) => u.uasg)]);
  await db.end();
}
test.beforeEach(cleanup);
test.afterEach(cleanup);

test("órgão de outra UF é cadastrado do Compras.gov e vira abrangência de atualização de pregões", async ({
  page,
}) => {
  let searched = "";
  await page.route("**/api/institutions/public?**", (route) => {
    searched = new URL(route.request().url()).searchParams.get("q") ?? "";
    return route.fulfill({
      json: { truncated: false, organs: [{ document: "10882594000165", name: "ORGAO DE TESTE", units }] },
    });
  });
  await page.goto("/administracao/instituicoes");
  await page.getByRole("button", { name: "Adicionar do Compras.gov" }).click();
  const panel = page.getByRole("region", { name: "Adicionar do Compras.gov" });
  await panel.getByLabel("UASG, CNPJ ou nome").fill("990001");
  await panel.getByRole("button", { name: "Buscar" }).click();
  expect(searched).toBe("990001");
  await expect(panel.getByText("2 UASGs ativas")).toBeVisible();
  await panel.getByRole("button", { name: "Cadastrar 2 UASGs" }).click();
  await expect(panel.locator(".field-error")).toHaveText(/Informe a sigla da organização/);
  await panel.getByLabel("Sigla da organização").fill("zzteste");
  await panel.getByRole("button", { name: "Cadastrar 2 UASGs" }).click();
  await expect(page.getByText("ZZTESTE: 2 UASGs cadastradas")).toBeVisible();
  await expect(page.getByRole("cell", { name: "ORGAO DE TESTE - CAMPUS NORTE", exact: true })).toBeVisible();

  let sent: Record<string, string> | undefined;
  await page.route("**/api/purchases/sync-reach", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: { from: sent!.from, to: sent!.to, created: 0, updated: 0, total: 0, incomplete: 0, failed: 0, results: [] },
    });
  });
  await page.goto("/pregoes");
  const reach = page.getByLabel("Abrangência da busca");
  await expect(reach.locator("option", { hasText: "ZZTESTE · 2 UASGs" })).toHaveCount(1);
  await reach.selectOption({ label: "ZZTESTE · 2 UASGs" });
  await page.getByRole("button", { name: "Atualizar do Compras.gov" }).first().click();
  const form = page.getByRole("form", { name: "Atualizar do Compras.gov" });
  await expect(form).toContainText("ZZTESTE (2 UASGs)");
  await form.getByRole("button", { name: "Atualizar agora" }).click();
  await expect.poll(() => sent?.uasgs).toBe("990001,990002");
});
