import { test, expect } from "@playwright/test";
import { compactMoney, formatMoney } from "../../apps/web/lib/decimal-display";
import { financeFixture } from "../helpers/finance";
let fixture: Awaited<ReturnType<typeof financeFixture>>;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  fixture = await financeFixture();
});
test.beforeEach(async ({ page }) => {
  const response = await page.request.post(
    fixture.baseURL + "/api/auth/login",
    { data: { email: fixture.email, password: fixture.password } },
  );
  expect(response.ok()).toBe(true);
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});
test.afterAll(async () => {
  if (fixture) await fixture.cleanup();
});
const overview = "/financeiro?managementCode=26421&fiscalYear=2026";
const committed = (page: import("@playwright/test").Page) =>
  page.locator(".panel-metrics").first().locator(".panel-metric.committed dd");

test("shared money presentation keeps significant decimal places, large aggregates and subcent values", () => {
  expect(formatMoney("6.000000000000")).toBe("R$ 6,00");
  expect(formatMoney("123456789012345678.123456")).toBe(
    "R$ 123.456.789.012.345.678,123456",
  );
  expect(formatMoney("-1.123456")).toBe("-R$ 1,123456");
  expect(compactMoney("6.000000000000")).toBe("R$ 6,00");
  expect(compactMoney("1234567.890000000000")).toBe("R$ 1,23 mi");
  expect(compactMoney("0.000000123456")).toBe("R$ 0,000000123456");
  expect(compactMoney("-0.000021")).toBe("-R$ 0,000021");
  expect(formatMoney(null)).toBe("Não informado");
  expect(compactMoney("0.000000000000")).toBe("R$ 0,00");
});

test("unit filtering updates authoritative figures, comparisons, monthly values and document reach", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture.baseURL + overview);
  await expect(
    page.getByRole("heading", { name: "Visão financeira", exact: true }),
  ).toBeVisible();
  await expect(committed(page)).toHaveText("R$ 21,00");
  await expect(
    page.getByRole("img", {
      name: "Evolução mensal dos valores empenhados, liquidados e pagos",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("1 de 12 meses com registros", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".panel-metrics").first().locator(".panel-metric.paid dd"),
  ).toHaveText("Não informado");
  await page.getByLabel("Unidade", { exact: true }).selectOption("015814");
  await expect(page).toHaveURL(/managementUnitCode=015814/);
  await expect(committed(page)).toHaveText("R$ 10,00");
  await expect(
    page.getByRole("heading", { name: "Unidade de teste A", exact: true }),
  ).toBeVisible();
  await page.getByText("Ver valores mensais", { exact: true }).click();
  const monthly = page.getByRole("region", {
    name: "Valores mensais",
    exact: true,
  });
  await expect(monthly.getByRole("row", { name: /Jan/ })).toContainText(
    "R$ 10,00",
  );
  await expect(monthly.getByRole("row", { name: /Fev/ })).toContainText(
    "Sem registros",
  );
  const metric = page
    .getByRole("group", { name: "Valor usado nas comparações" })
    .getByRole("button", { name: "Pago", exact: true });
  await metric.focus();
  await page.keyboard.press("Space");
  await expect(metric).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("group", { name: "Valor usado nas comparações" })
    .getByRole("button", { name: "Empenhado", exact: true })
    .click();
  const nature = page.getByRole("region", {
    name: "Naturezas de despesa",
    exact: true,
  });
  await nature.getByRole("button", { name: /Natureza 339001:/ }).click();
  await expect(page).toHaveURL(/expenseNature=339001/);
  await expect(committed(page)).toHaveText("R$ 1,00");
  await page
    .getByRole("button", { name: "Remover filtro de natureza" })
    .click();
  await expect(committed(page)).toHaveText("R$ 10,00");
  await page.reload();
  await expect(page.getByLabel("Unidade", { exact: true })).toHaveValue(
    "015814",
  );
  await page
    .getByRole("link", { name: "Consultar empenhos", exact: true })
    .click();
  await expect(page.getByLabel("Unidade", { exact: true })).toHaveValue(
    "015814",
  );
  await expect(
    page.getByRole("heading", { name: "21 empenhos", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("commitment pagination retains exact identifiers, return scope and separate movement collections", async ({
  page,
}) => {
  await page.goto(
    fixture.baseURL +
      "/financeiro/empenhos?managementCode=26421&fiscalYear=2026",
  );
  await expect(
    page.getByRole("heading", { name: "21 empenhos", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("R$ 123.456.789.012.345.678,123456", { exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Próxima página", exact: true })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await page
    .getByRole("link", { name: "015814264212026NE000021", exact: true })
    .click();
  await expect(
    page.getByText(/Este empenho aparece como referência/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Voltar", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await page
    .getByRole("button", { name: "Página anterior", exact: true })
    .click();
  await page
    .getByRole("link", { name: "015814264212026NE000001", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(fixture.id));
  const sections = page.getByRole("group", { name: "Dados do empenho" });
  await sections
    .getByRole("button", { name: "Histórico dos itens", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Histórico dos itens", exact: true })
      .getByText("-R$ 1,123456", { exact: true }),
  ).toBeVisible();
  await sections
    .getByRole("button", { name: "Pagamentos", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Pagamentos", exact: true })
      .getByText("015814264212026OB000001", { exact: true }),
  ).toBeVisible();
  await sections
    .getByRole("button", { name: "Liquidações", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Liquidações", exact: true })
      .getByText("015814264212026NS000001", { exact: true }),
  ).toBeVisible();
});

test("institutional budget remains distinct and whole-filter values survive detail pagination", async ({
  page,
}) => {
  await page.goto(
    fixture.baseURL +
      "/financeiro/loa?subordinateAgencyCode=26421&fiscalYear=2026",
  );
  await expect(
    page.getByRole("heading", { name: "LOA institucional", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".panel-metric")
      .filter({ hasText: "Dotação inicial do exercício" })
      .locator("dd"),
  ).toHaveText("R$ 21,00");
  await expect(
    page.getByRole("heading", { name: "Por ação orçamentária", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Unidade", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Unidade orçamentária", { exact: true })
    .selectOption("26421");
  await expect(page).toHaveURL(/budgetaryUnitCode=26421/);
  await page
    .getByRole("button", { name: "Ver detalhamento", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Detalhamento", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Próxima página", exact: true })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page
      .locator(".panel-metric")
      .filter({ hasText: "Dotação inicial do exercício" })
      .locator("dd"),
  ).toHaveText("R$ 21,00");
  await expect(
    page
      .locator(".panel-metric")
      .filter({ hasText: "Realizado na fonte orçamentária" })
      .locator("dd"),
  ).toHaveText("Não informado");
});

test("failed refresh retains the last consulted data and a different scope never shows old figures", async ({
  page,
}) => {
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  await expect(
    page.getByRole("heading", { name: "Evolução mensal", exact: true }),
  ).toBeVisible();
  await page.route("**/api/finance/execution?**", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Consulta indisponível para teste" },
    }),
  );
  await page
    .getByRole("button", { name: "Atualizar painel", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Os dados da última consulta foram preservados." }),
  ).toBeVisible();
  await expect(committed(page)).toHaveText("R$ 21,00");
  await page.getByLabel("Unidade", { exact: true }).selectOption("158148");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Consulta indisponível para teste" })
      .first(),
  ).toBeVisible();
  await expect(committed(page)).toHaveText("Não informado");
  await page.unrouteAll({ behavior: "wait" });
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .first()
    .click();
  await expect(committed(page)).toHaveText("R$ 11,00");
});

test("a delayed result cannot replace the values of a newer unit selection", async ({
  page,
}) => {
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  let release: () => void = () => {};
  let received: () => void = () => {};
  let completed: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    received = resolve;
  });
  const done = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route("**/api/finance/execution?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (
      query.get("managementUnitCode") === "015814" &&
      query.get("limit") === "1" &&
      !query.has("fromMonth")
    ) {
      const response = await route.fetch();
      received();
      await held;
      try {
        await route.fulfill({ response });
      } catch {
        /* The browser may already have canceled the obsolete request. */
      } finally {
        completed();
      }
    } else await route.continue();
  });
  try {
    await page.getByLabel("Unidade", { exact: true }).selectOption("015814");
    await waiting;
    await page.getByLabel("Unidade", { exact: true }).selectOption("158148");
    await expect(committed(page)).toHaveText("R$ 11,00");
    release();
    await done;
    await expect(committed(page)).toHaveText("R$ 11,00");
  } finally {
    release();
  }
});

test("a restricted viewer sees only linked units and no institutional LOA entry", async ({
  page,
}) => {
  const institution = await page.request.post(
    fixture.baseURL + "/api/institutions",
    { data: { name: "Unit A", uasg: "015814", organization: "TEST" } },
  );
  expect(institution.ok()).toBe(true);
  const created = await page.request.post(fixture.baseURL + "/api/users", {
    data: {
      name: "Scoped viewer",
      email: "scoped-browser@example.test",
      password: "Scoped-browser-2026!",
      role: "USUARIO",
      institutionIds: [(await institution.json()).id],
    },
  });
  expect(created.ok()).toBe(true);
  const login = await page.request.post(fixture.baseURL + "/api/auth/login", {
    data: {
      email: "scoped-browser@example.test",
      password: "Scoped-browser-2026!",
    },
  });
  expect(login.ok()).toBe(true);
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 10,00");
  await expect(
    page
      .getByLabel("Unidade", { exact: true })
      .getByRole("option", { name: "Unidade de teste B", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "LOA institucional", exact: true }),
  ).toHaveCount(0);
  await page.goto(
    fixture.baseURL +
      "/financeiro/loa?subordinateAgencyCode=26421&fiscalYear=2026",
  );
  await expect(
    page.getByText(
      "A consulta ao orçamento institucional está disponível ao gestor geral.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("small-screen panels preserve navigation, essential actions, empty, invalid and missing states", async ({
  page,
}) => {
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(fixture.baseURL + overview);
    await expect(committed(page)).toHaveText("R$ 21,00");
    await expect(
      page.getByRole("heading", { name: "Naturezas de despesa", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Atualizar painel", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/contracts-finance-panel-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto(
    fixture.baseURL + "/financeiro?managementCode=99999&fiscalYear=2026",
  );
  await expect(
    page.getByRole("heading", {
      name: "Nenhum registro encontrado.",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(
    fixture.baseURL + "/financeiro?managementCode=bad&fiscalYear=2026",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Não foi possível concluir" }),
  ).toBeVisible();
  await page.goto(fixture.baseURL + "/financeiro/empenhos/9223372036854775807");
  await expect(
    page.getByText("Empenho não encontrado", { exact: true }),
  ).toBeVisible();
});

test("fiscal year selection persists across reload without reusing another year's figures", async ({ page }) => {
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  await page.getByLabel("Exercício", { exact: true }).selectOption("2025");
  await expect(page).toHaveURL(/fiscalYear=2025/);
  await expect(page.getByRole("heading", { name: "Nenhum registro encontrado.", exact: true })).toBeVisible();
  await expect(committed(page)).toHaveText("Não informado");
  await page.reload();
  await expect(page.getByLabel("Exercício", { exact: true })).toHaveValue("2025");
  await expect(committed(page)).toHaveText("Não informado");
  await page.getByLabel("Exercício", { exact: true }).selectOption("2026");
  await expect(committed(page)).toHaveText("R$ 21,00");
});
