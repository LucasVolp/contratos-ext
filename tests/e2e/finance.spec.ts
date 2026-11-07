import { test, expect } from "@playwright/test";
import { financeFixture } from "../helpers/finance";
let fixture: Awaited<ReturnType<typeof financeFixture>>;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  fixture = await financeFixture();
});
test.beforeEach(async ({ page }) => {
  const response = await page.request.post(fixture.baseURL + "/api/auth/login", {
    data: { email: fixture.email, password: fixture.password },
  });
  expect(response.ok()).toBe(true);
});
test.afterAll(async () => {
  if (fixture) await fixture.cleanup();
});

test("commitment filters, exact bigint links and linked movements reach persisted data", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(fixture.baseURL + "/financeiro/empenhos");
  await expect(
    page.getByRole("heading", { name: "Escolha o recorte da consulta." }),
  ).toBeVisible();
  await page.getByLabel("Órgão / gestão").fill("26421");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "21 empenhos" }),
  ).toBeVisible();
  await expect(
    page
      .getByText("R$ 123.456.789.012.345.678,123456", { exact: true })
      .first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Próxima", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await page
    .getByRole("link", { name: "015814264212026NE000021", exact: true })
    .click();
  await expect(
    page.getByText(/Este empenho aparece como referência/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Voltar", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole("link", { name: "Anterior", exact: true }).click();
  await page
    .getByRole("link", { name: "015814264212026NE000001", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(fixture.id));
  await expect(
    page
      .getByRole("region", { name: "Histórico dos itens", exact: true })
      .getByText("-R$ 1,123456", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Pagamentos", exact: true })
      .getByText("015814264212026OB000001", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Liquidações", exact: true })
      .getByText("015814264212026NS000001", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("monthly and annual reports preserve whole-filter totals and unknown values", async ({
  page,
}) => {
  await page.goto(
    fixture.baseURL +
      "/financeiro/execucao?managementCode=26421&fiscalYear=2026",
  );
  await expect(
    page.getByRole("heading", { name: "21 agrupamentos" }),
  ).toBeVisible();
  await expect(
    page.locator(".finance-metrics").getByText("R$ 21,000000", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".finance-metrics").getByText("-R$ 0,000021", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Próxima", exact: true }).click();
  await expect(
    page.locator(".finance-metrics").getByText("R$ 21,000000", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "LOA institucional", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "21 agrupamentos" }),
  ).toBeVisible();
  await expect(
    page.locator(".finance-metrics").getByText("R$ 21,000000", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".finance-metrics")
      .getByText("Não informado", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Unidade gestora")).toHaveCount(0);
  await page.getByLabel("Elemento de despesa", { exact: true }).fill("04");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page).toHaveURL(/expenseElementCode=04/);
  await expect(
    page.getByRole("heading", { name: "1 agrupamento" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Elemento de despesa", { exact: true }),
  ).toHaveValue("04");
});

test("mobile consultations expose empty, validation, not-found and retry states", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    fixture.baseURL +
      "/financeiro/execucao?managementCode=26421&fiscalYear=2026",
  );
  await expect(
    page.getByRole("heading", { name: "21 agrupamentos" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/contracts-finance-mobile.png",
    fullPage: true,
  });
  await page.goto(
    fixture.baseURL + "/financeiro/empenhos?managementCode=99999",
  );
  await expect(
    page.getByRole("heading", { name: "Nenhum registro encontrado." }),
  ).toBeVisible();
  await page.goto(
    fixture.baseURL + "/financeiro/execucao?managementCode=bad&fiscalYear=2026",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Não foi possível concluir" }),
  ).toBeVisible();
  await page.goto(fixture.baseURL + "/financeiro/empenhos/9223372036854775807");
  await expect(
    page.getByText("Empenho não encontrado", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/finance/execution?**", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Fonte indisponível para teste" },
    }),
  );
  await page.goto(
    fixture.baseURL +
      "/financeiro/execucao?managementCode=26421&fiscalYear=2026",
  );
  await expect(
    page.getByText("Fonte indisponível para teste", { exact: true }),
  ).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByRole("heading", { name: "21 agrupamentos" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "/tmp/contracts-finance-desktop.png",
    fullPage: true,
  });
});
