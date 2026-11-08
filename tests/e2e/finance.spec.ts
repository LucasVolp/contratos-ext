import { test, expect } from "@playwright/test";
import {
  compactMoney,
  formatMoney,
  chartUnits,
} from "../../apps/web/lib/decimal-display";
import { financeFixture } from "../helpers/finance";
import {
  executionComposition,
  rankExecutionNatures,
  expenseBarData,
} from "../../apps/web/lib/finance-chart";
import type { ExecutionNature } from "../../apps/web/lib/finance-types";
import { interpretScopeSearch } from "../../apps/web/lib/finance-scope-search";
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
  page
    .locator(".execution-totals")
    .first()
    .locator("[data-metric=committedValue] dd");

async function applyScope(page: import("@playwright/test").Page, text: string) {
  const search = page.getByLabel("Buscar recorte", { exact: true });
  await search.fill(text);
  await search.press("Enter");
}

test("execution uses scope search without redundant scope selectors and restores its visible scope", async ({ page }) => {
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  for (const label of ["Unidade", "Exercício", "Período"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  const search = page.getByLabel("Buscar recorte", { exact: true });
  await search.fill("015814 2026 janeiro");
  await search.press("Enter");
  await expect(committed(page)).toHaveText("R$ 10,00");
  await page.reload();
  await expect(page.getByLabel("Recorte atual", { exact: true })).toContainText(
    "Unidade de teste A · Exercício 2026 · Janeiro",
  );
  await expect(page.getByRole("button", { name: "Atualizar painel", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Instituição", exact: true })).toBeVisible();
  await search.fill("todas as unidades ano inteiro");
  await search.press("Enter");
  await expect(committed(page)).toHaveText("R$ 21,00");
  await expect(page.getByLabel("Recorte atual", { exact: true })).toContainText("Ano inteiro");
});

test("institution selector stays compact when opened and clears the previous unit on change", async ({ page }) => {
  await page.route("**/api/finance/units?*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.push({
      ...body.data[0],
      code: "999999",
      managementCode: "99999",
      managementName: "Instituição de teste com nome extenso para verificar o seletor em telas pequenas",
    });
    body.total = body.data.length;
    await route.fulfill({ response, json: body });
  });
  await page.goto(fixture.baseURL + overview + "&managementUnitCode=015814");
  await expect(committed(page)).toHaveText("R$ 10,00");
  const selector = page.getByRole("combobox", { name: "Instituição", exact: true });
  await expect(selector).toHaveValue("26421");
  await expect(selector.locator("option:checked")).toHaveText("IFRO");
  await expect(selector).toHaveAttribute("title", "Instituição de teste");
  await expect(page.getByLabel("Código do órgão", { exact: true })).toHaveCount(0);
  for (const [width, theme] of [[360, "dark"], [390, "system"], [1440, "light"]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByLabel("Aparência", { exact: true }).selectOption(theme);
    const before = await page.locator(".finance-toolbar").boundingBox();
    await selector.click();
    expect(await page.locator(".finance-toolbar").boundingBox()).toEqual(before);
    await page.keyboard.press("Escape");
    const bounds = await selector.boundingBox();
    const refresh = await page.getByRole("button", { name: "Atualizar painel", exact: true }).boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(refresh!.x);
    expect(Math.abs(bounds!.y - refresh!.y)).toBeLessThanOrEqual(1);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeLessThanOrEqual(220);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/finance-institution-${width}-${theme}.png` });
  }
  await selector.selectOption("99999");
  await expect(page).toHaveURL(/managementCode=99999/);
  expect(new URL(page.url()).searchParams.has("managementUnitCode")).toBe(false);
  expect(new URL(page.url()).searchParams.get("fiscalYear")).toBe("2026");
  await expect(selector).toHaveValue("99999");
  await page.reload();
  await expect(selector).toHaveValue("99999");
});

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

const searchUnits = [
  { code: "015814", name: "Campus São Paulo" },
  { code: "158148", name: "Campus São Roque" },
  { code: "158270", name: "Reitoria" },
];

test("scope search understands units, fiscal years and periods in plain text", () => {
  const read = (text: string) => interpretScopeSearch(text, searchUnits);
  expect(read("campus sao paulo 2025 1º semestre")).toMatchObject({
    changes: {
      managementUnitCode: "015814",
      fiscalYear: "2025",
      fromMonth: "1",
      toMonth: "6",
    },
    labels: ["Campus São Paulo", "Exercício 2025", "1º semestre"],
    unmatched: [],
    candidates: [],
  });
  expect(read("Reitoria").changes).toEqual({ managementUnitCode: "158270" });
  expect(read("158148").changes).toEqual({ managementUnitCode: "158148" });
  expect(read("exercício de 2024").changes).toEqual({ fiscalYear: "2024" });
  expect(read("terceiro trimestre").changes).toEqual({
    fromMonth: "7",
    toMonth: "9",
  });
  expect(read("2º sem").changes).toEqual({ fromMonth: "7", toMonth: "12" });
  expect(read("março").changes).toEqual({ fromMonth: "3", toMonth: "3" });
  expect(read("de jan a abr 2026").changes).toEqual({
    fiscalYear: "2026",
    fromMonth: "1",
    toMonth: "4",
  });
  expect(read("até junho").changes).toEqual({ fromMonth: "1", toMonth: "6" });
  expect(read("03/2024").changes).toEqual({
    fiscalYear: "2024",
    fromMonth: "3",
    toMonth: "3",
  });
  expect(read("ano inteiro").changes).toEqual({
    fromMonth: "1",
    toMonth: "12",
  });
  expect(read("todas as unidades").changes).toEqual({
    managementUnitCode: "",
  });
});

test("scope search reports ambiguous units and words it did not understand", () => {
  const ambiguous = interpretScopeSearch("campus 2025", searchUnits);
  expect(ambiguous.changes).toEqual({ fiscalYear: "2025" });
  expect(ambiguous.candidates.map((unit) => unit.code)).toEqual([
    "015814",
    "158148",
  ]);
  const typo = interpretScopeSearch("reitoria xpto", searchUnits);
  expect(typo.changes).toEqual({ managementUnitCode: "158270" });
  expect(typo.unmatched).toEqual(["xpto"]);
  expect(interpretScopeSearch("", searchUnits).labels).toEqual([]);
  expect(
    interpretScopeSearch("reitoria 2º trimestre", searchUnits, {
      unitKey: "budgetaryUnitCode",
      periods: false,
    }),
  ).toMatchObject({
    changes: { budgetaryUnitCode: "158270" },
    unmatched: ["2º trimestre"],
  });
});

test("scope search applies what it understood to the panel filters", async ({
  page,
}) => {
  await page.goto(fixture.baseURL + overview);
  const search = page.getByLabel("Buscar recorte", { exact: true });
  await search.fill("unidade de teste b 2025 1º semestre");
  await expect(page.locator(".scope-search-preview")).toContainText(
    "Unidade de teste B · Exercício 2025 · 1º semestre",
  );
  await search.press("Enter");
  await expect(page).toHaveURL(/managementUnitCode=158148/);
  await expect(page).toHaveURL(/fiscalYear=2025/);
  await expect(page).toHaveURL(/fromMonth=1&toMonth=6|toMonth=6.*fromMonth=1/);
  await expect(page.getByLabel("Recorte atual", { exact: true })).toContainText("Unidade de teste B");
  await expect(page.getByLabel("Recorte atual", { exact: true })).toContainText("Exercício 2025");
  await expect(page.getByLabel("Recorte atual", { exact: true })).toContainText("1º semestre");
  await expect(page.getByRole("status").filter({ hasText: "Aplicado" })).toContainText(
    "Unidade de teste B",
  );
  await search.fill("unidade de teste 2026");
  await search.press("Enter");
  await expect(page).toHaveURL(/fiscalYear=2026/);
  await page
    .getByRole("button", { name: "Usar Unidade de teste A", exact: true })
    .click();
  await expect(page.getByLabel("Recorte atual", { exact: true })).toContainText("Unidade de teste A");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(search).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("city, year and month search updates the URL and confirms the applied scope visibly", async ({ page }) => {
  await page.route("**/api/finance/units?*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        data: body.data.map((unit: { code: string; name: string | null }) =>
          unit.code === "015814" ? { ...unit, name: "Campus Três Lagoas" } : unit,
        ),
      },
    });
  });
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  const search = page.getByLabel("Buscar recorte", { exact: true });
  await search.fill("tres lagoas 2024 janeiro");
  await expect(page.locator(".scope-search-preview")).toContainText(
    "Campus Três Lagoas · Exercício 2024 · Janeiro",
  );
  // Typing previews the interpretation without changing the consulted scope.
  await expect(page).toHaveURL(/fiscalYear=2026/);
  await search.press("Enter");
  await expect(page.getByLabel("Recorte atual", { exact: true })).toHaveText("Campus Três Lagoas · Exercício 2024 · Janeiro");
  const url = new URL(page.url());
  expect(url.searchParams.get("managementUnitCode")).toBe("015814");
  expect(url.searchParams.get("fiscalYear")).toBe("2024");
  expect(url.searchParams.get("fromMonth")).toBe("1");
  expect(url.searchParams.get("toMonth")).toBe("1");
  await expect(page.getByRole("status").getByText(/Aplicado:/)).toBeVisible();

  for (const colorScheme of ["light", "dark", "no-preference"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [360, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(search).toBeVisible();
      await expect(page.getByRole("button", { name: "Aplicar", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test("approved finance workspace replaces trends and rankings with overview and element exploration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture.baseURL + overview);
  await expect(
    page.getByRole("heading", { name: "Execução da despesa", exact: true }),
  ).toBeVisible();
  await expect(committed(page)).toHaveText("R$ 21,00");
  await expect(
    page.getByRole("heading", { name: "Evolução mensal", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Execução nas unidades", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Todas as despesas", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Situação da execução", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".execution-totals [data-metric=paidValue] dd"),
  ).toHaveText("Não informado");
  await expect(
    page.getByText("Cobertura diária não informada", { exact: true }),
  ).toBeVisible();
  await applyScope(page, "015814");
  await expect(committed(page)).toHaveText("R$ 10,00");
  await page
    .getByRole("button", { name: "Explorar elemento 3.3.90.01", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/element=339001/);
  await expect(committed(page)).toHaveText("R$ 1,00");
  await expect(
    page.getByRole("heading", {
      name: "Gasto por subelemento",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Todas as despesas", exact: true })
    .first()
    .click();
  await expect(committed(page)).toHaveText("R$ 10,00");
  await page
    .getByRole("button", { name: "Explorar elemento 3.3.90.01", exact: true })
    .first()
    .click();
  await expect(committed(page)).toHaveText("R$ 1,00");
  await page.reload();
  await expect(committed(page)).toHaveText("R$ 1,00");
  await expect(
    page.getByRole("link", {
      name: "Consultar empenhos deste elemento",
      exact: true,
    }),
  ).toHaveAttribute("href", /expenseNature=339001/);
  await page
    .getByRole("button", { name: "Todas as despesas", exact: true })
    .first()
    .click();
  await expect(committed(page)).toHaveText("R$ 10,00");
  await page
    .getByRole("navigation", { name: "Consultas financeiras", exact: true })
    .getByRole("link", { name: "Empenhos", exact: true })
    .click();
  await expect(page.getByLabel("Recorte atual", { exact: true })).toContainText("Unidade de teste A");
  expect(errors).toEqual([]);
});

test("execution donut uses disjoint balances and top five defaults to committed with restorable stage selection", async ({
  page,
}) => {
  await page.route("**/api/finance/execution?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const params = new URL(route.request().url()).searchParams;
    if (params.get("limit") === "1" && !params.has("expenseNature"))
      body.summary.paidValue = "1.05";
    await route.fulfill({ response, json: body });
  });
  await page.goto(fixture.baseURL + overview);
  await expect(
    page.getByRole("img", { name: "Composição da execução do recorte" }),
  ).toBeVisible();
  const top = page.getByRole("region", {
    name: "Top 5 elementos de despesa",
    exact: true,
  });
  await expect(top.locator("ol > li")).toHaveCount(5);
  await expect(
    top.getByLabel("Ordenar elementos por", { exact: true }),
  ).toHaveValue("committedValue");
  await top
    .getByLabel("Ordenar elementos por", { exact: true })
    .selectOption("liquidatedValue");
  await expect(page).toHaveURL(/rankingMetric=liquidatedValue/);
  await page.reload();
  await expect(
    top.getByLabel("Ordenar elementos por", { exact: true }),
  ).toHaveValue("liquidatedValue");
  await top
    .getByLabel("Ordenar elementos por", { exact: true })
    .selectOption("paidValue");
  await expect(
    top.getByText("Valores não informados para esta etapa.", { exact: true }),
  ).toBeVisible();
  await expect(top.locator("ol > li")).toHaveCount(0);
  await top
    .getByLabel("Ordenar elementos por", { exact: true })
    .selectOption("committedValue");
  await top
    .getByRole("button", { name: "Explorar elemento 3.3.90.01", exact: true })
    .click();
  await expect(page).toHaveURL(/element=339001/);
});

test("expense exploration bounds long classifications and shows source subitems inside the selected element", async ({
  page,
}) => {
  await page.goto(fixture.baseURL + overview);
  const ledger = page.locator(".execution-ledger");
  await expect(ledger.locator("tbody tr")).toHaveCount(6);
  await ledger
    .getByRole("button", { name: "Próxima página", exact: true })
    .click();
  await expect(page).toHaveURL(/elementPage=2/);
  await expect(ledger.locator("tbody tr")).toHaveCount(6);
  await expect(committed(page)).toHaveText("R$ 21,00");
  await page.reload();
  await expect(page).toHaveURL(/elementPage=2/);
  await expect(
    ledger.getByRole("button", {
      name: "Explorar elemento 3.3.90.07",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expandir lista de elementos", exact: true })
    .click();
  const navigator = page.getByRole("navigation", {
    name: "Elementos da despesa",
    exact: true,
  });
  expect(
    await navigator.evaluate(
      (node) =>
        node.clientHeight <= 360 && node.scrollHeight > node.clientHeight,
    ),
  ).toBe(true);
  await expect(
    page.getByText("Role para ver mais", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ver próximos elementos", exact: true })
    .click();
  await expect
    .poll(() => navigator.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Ver elementos anteriores", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Localizar despesa", { exact: true }).fill("3.3.90.01");
  await expect(
    page.getByText("Role para ver mais", { exact: true }),
  ).toHaveCount(0);
  await navigator
    .getByRole("button", { name: "Explorar elemento 3.3.90.01", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Gasto por subelemento",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByText("Consultar documentos de origem", { exact: true })
    .click();
  await page
    .getByRole("button", { name: /Consultar subelementos de 2026NE/ })
    .first()
    .click();
  await expect(
    page.getByRole("table", { name: "Subelementos do documento" }),
  ).toContainText("Subelemento de teste");
  await expect(
    page.getByRole("table", { name: "Subelementos do documento" }),
  ).toContainText("3.3.90.01.10");
  await expect(
    page.getByRole("table", { name: "Subelementos do documento" }),
  ).toContainText("123.456.789.012.345.678,123456");
  await expect(committed(page)).toHaveText("R$ 1,00");
  await page.reload();
  await expect(
    page.getByRole("table", { name: "Subelementos do documento" }),
  ).toContainText("Subelemento de teste");
  let sourceRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/items?")) sourceRequests++;
  });
  await page
    .getByRole("button", { name: "Atualizar painel", exact: true })
    .click();
  await expect.poll(() => sourceRequests).toBeGreaterThan(0);
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.getByLabel("Aparência", { exact: true }).selectOption(theme);
      await expect(
        page.getByRole("table", { name: "Subelementos do documento" }),
      ).toBeVisible();
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll("main *")]
          .filter(
            (node) =>
              node.getBoundingClientRect().right > innerWidth + 1 &&
              !node.closest(".table-scroll"),
          )
          .map((node) => ({
            tag: node.tagName,
            className: node.className,
            right: node.getBoundingClientRect().right,
            width: node.getBoundingClientRect().width,
          }))
          .slice(0, 15),
      }));
      expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(
        layout.width,
      );
      if (width === 1440) {
        await page.screenshot({
          path: `/tmp/contracts-subitems-${theme}.png`,
          fullPage: true,
        });
      }
    }
  }
  await page.getByRole("button", { name: "Pagamentos", exact: true }).click();
  await expect(
    page.getByText("Nenhum registro disponível nesta coleção do documento.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Itens do empenho", exact: true })
    .click();
  await expect(
    page.getByRole("table", { name: "Subelementos do documento" }),
  ).toContainText("Subelemento de teste");
  const documents = page.locator(".execution-subitems");
  await documents
    .getByRole("button", { name: "Próxima página", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/documentPage=2/);
  await expect(
    page.getByRole("table", { name: "Subelementos do documento" }),
  ).toHaveCount(0);
  await applyScope(page, "158148");
  await expect(page).not.toHaveURL(/documentPage|document=|sourcePage/);
  await expect(
    page.getByRole("heading", {
      name: "Elemento não encontrado neste recorte.",
      exact: true,
    }),
  ).toBeVisible();
});

test("subelement overview consolidates all daily items before browsing individual documents", async ({
  page,
}) => {
  await page.goto(fixture.baseURL + overview + "&element=339001");
  await expect(
    page.getByRole("heading", { name: "Gasto por subelemento", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("figure", { name: "Distribuição do gasto por subelemento" }),
  ).toBeVisible();
  await expect(page.locator(".expense-bar-value").first()).toHaveText(
    "R$ 2.469.135.780.246.913.562,46912",
  );
  await expect(page.locator(".execution-subelement-summary")).toHaveCount(0);
  expect(
    await page
      .getByRole("figure", { name: "Distribuição do gasto por subelemento" })
      .evaluate((node) => node.getBoundingClientRect().height),
  ).toBeLessThan(300);
  await expect(committed(page)).toHaveText("R$ 1,00");
  await expect(
    page.getByRole("button", { name: /Consultar subelementos de 2026NE/ }),
  ).toHaveCount(0);
  await page
    .getByLabel("Visualizar gasto por", { exact: true })
    .selectOption("paidValue");
  await expect(page).toHaveURL(/subelementMetric=paidValue/);
  await expect(
    page.getByRole("figure", { name: "Distribuição do gasto por subelemento" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Não há valores suficientes para compor o gráfico desta etapa.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Visualizar gasto por", { exact: true }),
  ).toHaveValue("paidValue");
});

test("both sidebars collapse independently, preserve navigation and retain the preference", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  const main = page.getByRole("complementary", {
    name: "Barra principal",
    exact: true,
  });
  const content = page.locator(".workspace-content");
  const before = await content.boundingBox();
  await page
    .getByRole("button", { name: "Recolher menu principal", exact: true })
    .click();
  await expect(main).toHaveClass(/is-collapsed/);
  expect((await content.boundingBox())!.width).toBeGreaterThan(before!.width);
  await expect(
    main.getByRole("link", { name: "Financeiro", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Documentos para assinatura", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expandir lista de elementos", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recolher lista de elementos", exact: true })
    .click();
  await expect(page.locator(".execution-workspace")).toHaveClass(
    /is-navigator-collapsed/,
  );
  await expect(
    page.getByLabel("Localizar despesa", { exact: true }),
  ).toHaveCount(0);
  await expect(committed(page)).toHaveText("R$ 21,00");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expandir menu principal", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Expandir lista de elementos",
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByRole("button", { name: "Expandir menu principal", exact: true })
      .click();
    await expect(
      main.getByRole("link", { name: "Financeiro", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Recolher menu principal", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Expandir lista de elementos", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Recolher lista de elementos",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Recolher lista de elementos", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("execution opens directly and legacy purpose links still show available records", async ({
  page,
}) => {
  for (const purpose of ["all", "own", "campus"]) {
    await page.goto(fixture.baseURL + overview + `&purpose=${purpose}`);
    await expect(committed(page)).toHaveText("R$ 21,00");
    await expect(
      page.getByRole("tablist", { name: "Finalidade da execução" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Finalidade ainda não classificada" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Situação da execução", exact: true }),
    ).toBeVisible();
  }
});

test("chart coordinates accept insignificant decimal padding without losing source precision", () => {
  expect(chartUnits("0.100000000000")).toBe(100000n);
  expect(chartUnits("-1.123456000000")).toBe(-1123456n);
  expect(chartUnits(null)).toBeNull();
});

test("execution chart keeps unknown and negative stages separate from composable balances", () => {
  const nature: ExecutionNature = {
    code: "339018",
    name: null,
    summary: {
      committedValue: "100.000000000000",
      liquidatedValue: "60",
      paidValue: "40",
      registeredPayablesValue: null,
      canceledPayablesValue: null,
      priorYearPaidValue: null,
      sourceRowCount: 1,
      observedMonthCount: 1,
      firstMonth: null,
      lastMonth: null,
      lastImportedAt: null,
    },
  };
  const composed = executionComposition(nature.summary);
  expect(composed.status).toBe("ready");
  expect(composed.parts.map((part) => part.value)).toEqual(["40", "20", "40"]);
  expect(
    executionComposition({ ...nature.summary, paidValue: null }).status,
  ).toBe("missing");
  expect(
    executionComposition({ ...nature.summary, liquidatedValue: "-10" }).status,
  ).toBe("inconsistent");
  expect(
    executionComposition({
      ...nature.summary,
      committedValue: "0",
      liquidatedValue: "0",
      paidValue: "0",
    }).status,
  ).toBe("zero");
  const bars = expenseBarData(
    [
      { label: "Positive", value: "100" },
      { label: "Negative", value: "-20" },
      { label: "Unknown", value: null },
    ],
    "80",
  );
  expect(bars.signed).toBe(true);
  expect(bars.rows.map((row) => row.width)).toEqual([100, 20, null]);
  const ranked = rankExecutionNatures(
    [
      {
        ...nature,
        code: "339001",
        summary: {
          ...nature.summary,
          committedValue: "9007199254740992.000000000001",
        },
      },
      {
        ...nature,
        code: "339002",
        summary: {
          ...nature.summary,
          committedValue: "9007199254740992.000000000002",
        },
      },
      {
        ...nature,
        code: "339003",
        summary: { ...nature.summary, committedValue: null },
      },
    ],
    "committedValue",
  );
  expect(ranked.rows.map((row) => row.code)).toEqual(["339002", "339001"]);
  expect(ranked.missingCount).toBe(1);
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
    page.getByRole("heading", {
      name: "Detalhamento por elemento",
      exact: true,
    }),
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
  await applyScope(page, "158148");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Consulta indisponível para teste" })
      .first(),
  ).toBeVisible();
  // A failed query for a different scope has no metrics to display. The previous
  // scope's figures must disappear until this scope is successfully consulted.
  await expect(committed(page)).toHaveCount(0);
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
    await applyScope(page, "015814");
    await waiting;
    await applyScope(page, "158148");
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
  await applyScope(page, "158148");
  await expect(page.getByText("Não reconheci: 158148.", { exact: true })).toBeVisible();
  await expect(committed(page)).toHaveText("R$ 10,00");
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

test("overview keeps filters beside tabs and the chart visible on desktop", async ({ page }) => {
  await page.route("**/api/finance/execution?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const params = new URL(route.request().url()).searchParams;
    if (params.get("limit") === "1" && !params.has("expenseNature"))
      body.summary.paidValue = "1.05";
    await route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  const tabs = await page.getByRole("main")
    .getByRole("navigation", { name: "Consultas financeiras" })
    .boundingBox();
  const filters = await page.getByLabel("Filtros do painel").boundingBox();
  expect(tabs).not.toBeNull();
  expect(filters).not.toBeNull();
  expect(tabs!.x + tabs!.width).toBeLessThanOrEqual(filters!.x);
  expect(tabs!.y).toBeLessThan(filters!.y + filters!.height);
  expect(filters!.y).toBeLessThan(tabs!.y + tabs!.height);
  await expect(page.getByRole("img", { name: "Composição da execução do recorte" })).toBeVisible();
  const chart = await page.locator(".execution-donut-plot").boundingBox();
  expect(chart).not.toBeNull();
  expect(chart!.y + chart!.height).toBeLessThanOrEqual(1000);
  await page.screenshot({ path: "/tmp/finance-toolbar-desktop.png" });
});

test("small-screen panels preserve navigation, essential actions, empty, invalid and missing states", async ({
  page,
}) => {
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(fixture.baseURL + overview);
    await expect(committed(page)).toHaveText("R$ 21,00");
    await expect(
      page.getByRole("heading", {
        name: "Detalhamento por elemento",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Atualizar painel", exact: true }),
    ).toBeVisible();
    for (const theme of ["light", "dark", "system"]) {
      await page.getByLabel("Aparência", { exact: true }).selectOption(theme);
      await page
        .getByRole("button", { name: "Todas as despesas", exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Situação da execução",
          exact: true,
        }),
      ).toBeVisible();
      await page.locator(".execution-source > summary").click();
      await expect(
        page.getByText("Origem e cobertura da consulta", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator(".execution-source > summary").click();
      await page.screenshot({
        path: `/tmp/contracts-finance-overview-${width}-${theme}.png`,
      });
      await expect(committed(page)).toHaveText("R$ 21,00");
    }
    if (width < 700) {
      const expand = page.getByRole("button", {
        name: "Expandir lista de elementos",
        exact: true,
      });
      if (await expand.isVisible()) await expand.click();
      const picker = page.getByRole("button", {
        name: "Escolher despesa",
        exact: true,
      });
      if ((await picker.getAttribute("aria-expanded")) !== "true")
        await picker.click();
      await expect(
        page.getByText("Role para ver mais", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Ver próximos elementos", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Ver elementos anteriores",
          exact: true,
        }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Escolher despesa", exact: true })
        .click();
    }
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

test("fiscal year selection persists across reload without reusing another year's figures", async ({
  page,
}) => {
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  await applyScope(page, "2025");
  await expect(page).toHaveURL(/fiscalYear=2025/);
  await expect(
    page.getByRole("heading", {
      name: "Nenhum registro encontrado.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(committed(page)).toHaveText("Não informado");
  await page.reload();
  await expect(page.getByLabel("Recorte atual", { exact: true })).toContainText("Exercício 2025");
  await expect(committed(page)).toHaveText("Não informado");
  await applyScope(page, "2026");
  await expect(committed(page)).toHaveText("R$ 21,00");
});

test("subelement pagination preserves content and scroll while loading and on the shorter last page", async ({
  page,
}) => {
  for (const [width, theme] of [
    [1440, "light"],
    [390, "dark"],
    [360, "system"],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    let release = () => {};
    let received = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      received = resolve;
    });
    await page.route("**/api/finance/subelements?**", async (route) => {
      const response = await route.fetch();
      const report = await response.json();
      const requested = Number(
        new URL(route.request().url()).searchParams.get("page"),
      );
      const rows = Array.from({ length: 7 }, (_, index) => ({
        ...report.data[0],
        code: `339001${String(index + 1).padStart(2, "0")}`,
        name: `Pagination test subelement ${index + 1}`,
      }));
      if (requested === 2) {
        received();
        await held;
      }
      await route.fulfill({
        response,
        json: {
          ...report,
          page: requested,
          total: 7,
          limit: 6,
          data: rows.slice((requested - 1) * 6, requested * 6),
        },
      });
    });
    try {
      await page.goto(fixture.baseURL + overview + "&element=339001");
      await page.getByLabel("Aparência", { exact: true }).selectOption(theme);
      const section = page.getByRole("region", {
        name: "Gasto por subelemento",
        exact: true,
      });
      const table = section.getByRole("table", {
        name: "Detalhamento do gasto por subelemento",
      });
      await expect(table).toContainText("Pagination test subelement 1");
      const next = section.getByRole("button", {
        name: "Próxima página",
        exact: true,
      });
      await next.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => window.scrollY);
      await next.click();
      await waiting;
      await expect(table).toBeVisible();
      await expect(table).toContainText("Pagination test subelement 1");
      expect(
        Math.abs((await page.evaluate(() => window.scrollY)) - before),
      ).toBeLessThan(3);
      release();
      await expect(table).toContainText("Pagination test subelement 7");
      await expect(table).not.toContainText("Pagination test subelement 1");
      expect(
        Math.abs((await page.evaluate(() => window.scrollY)) - before),
      ).toBeLessThan(3);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await section
        .getByRole("button", { name: "Página anterior", exact: true })
        .click();
      await expect(table).toContainText("Pagination test subelement 1");
      expect(
        Math.abs((await page.evaluate(() => window.scrollY)) - before),
      ).toBeLessThan(3);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  }
});

test("failed subelement page retains the consulted page and retry loads the requested page", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/finance/subelements?**", async (route) => {
    const response = await route.fetch();
    const report = await response.json();
    const requested = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    if (requested === 2 && fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        json: { message: "Consulta indisponível para teste" },
      });
      return;
    }
    await route.fulfill({
      response,
      json: {
        ...report,
        page: requested,
        total: 7,
        limit: 6,
        data: [
          {
            ...report.data[0],
            name:
              requested === 1
                ? "Consulted first page"
                : "Requested second page",
          },
        ],
      },
    });
  });
  await page.goto(fixture.baseURL + overview + "&element=339001");
  const section = page.getByRole("region", {
    name: "Gasto por subelemento",
    exact: true,
  });
  const table = section.getByRole("table", {
    name: "Detalhamento do gasto por subelemento",
  });
  await expect(table).toContainText("Consulted first page");
  await section
    .getByRole("button", { name: "Próxima página", exact: true })
    .click();
  await expect(section.getByRole("alert")).toContainText(
    "Consulta indisponível para teste",
  );
  await expect(table).toContainText("Consulted first page");
  await section
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(table).toContainText("Requested second page");
  await expect(section.getByRole("alert")).toHaveCount(0);
});

test("unified execution starts collapsed and emphasizes paid payables beside current payments", async ({
  page,
}) => {
  await page.route("**/api/finance/execution?**", async (route) => {
    const response = await route.fetch();
    const report = await response.json();
    report.summary.priorYearPaidValue = "7.5";
    report.data = report.data.map((row: Record<string, unknown>) => ({
      ...row,
      priorYearPaidValue: "0.5",
    }));
    await route.fulfill({ response, json: report });
  });
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  await expect(
    page.getByRole("tablist", { name: "Leitura financeira" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Expandir lista de elementos",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(
        ".execution-totals [data-metric=priorYearPaidValue] > dd:first-of-type",
      )
      .first(),
  ).toHaveText("R$ 7,50");
  await expect(page.locator(".execution-ledger thead th")).toHaveText([
    "Elemento de despesa",
    "Empenhado",
    "Liquidado",
    "Pago",
    "R.P.",
  ]);
  await expect(
    page.locator(".execution-ledger tbody tr").first().locator("td").last(),
  ).toContainText("R$ 0,50");
  await page
    .getByText("Detalhar restos a pagar", { exact: true })
    .first()
    .click();
  await expect(
    page.getByText("R.P. cancelados", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("R.P. inscritos", { exact: true })).toBeVisible();
});

for (const collection of ["commitments", "budgets"] as const) {
  test(`${collection} pagination preserves the visible page and scroll during a delayed request`, async ({
    page,
  }) => {
    const budget = collection === "budgets";
    await page.goto(
      fixture.baseURL +
        (budget
          ? "/financeiro/loa?subordinateAgencyCode=26421&fiscalYear=2026"
          : "/financeiro/empenhos?managementCode=26421&fiscalYear=2026"),
    );
    if (budget)
      await page
        .getByRole("button", { name: "Ver detalhamento", exact: true })
        .click();
    const region = page.getByRole("region", {
      name: budget ? "Detalhamento do painel" : "Resultados da consulta",
      exact: true,
    });
    const table = region.getByRole("table");
    await expect(table.locator("tbody tr")).toHaveCount(20);
    let release = () => {};
    let received = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      received = resolve;
    });
    await page.route(`**/api/finance/${collection}?**`, async (route) => {
      if (new URL(route.request().url()).searchParams.get("page") !== "2")
        return route.continue();
      const response = await route.fetch();
      received();
      await held;
      await route.fulfill({ response });
    });
    try {
      const next = region.getByRole("button", {
        name: "Próxima página",
        exact: true,
      });
      await next.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => scrollY);
      await next.click();
      await waiting;
      await expect(table.locator("tbody tr")).toHaveCount(20);
      await expect(region.getByRole("status")).toContainText(
        "Carregando página 2",
      );
      expect(
        Math.abs((await page.evaluate(() => scrollY)) - before),
      ).toBeLessThan(3);
      release();
      await expect(table.locator("tbody tr")).toHaveCount(1);
      await expect(region.getByRole("status")).toContainText(
        "Página 2 carregada",
      );
      expect(
        Math.abs((await page.evaluate(() => scrollY)) - before),
      ).toBeLessThan(3);
    } finally {
      release();
    }
  });
}

test("overview and element detail share the same canvas geometry across themes and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, theme] of [
    [1440, "light"],
    [390, "dark"],
    [360, "system"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixture.baseURL + overview);
    await page.getByLabel("Aparência", { exact: true }).selectOption(theme);
    await expect(committed(page)).toHaveText("R$ 21,00");
    const canvas = page.locator(".execution-canvas");
    const origin = await canvas.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y + scrollY, width: rect.width };
    });
    await page
      .getByRole("region", { name: "Top 5 elementos de despesa", exact: true })
      .getByRole("button", { name: "Explorar elemento 3.3.90.01", exact: true })
      .click();
    await expect(
      page.getByRole("table", {
        name: "Detalhamento do gasto por subelemento",
        exact: true,
      }),
    ).toBeVisible();
    const detail = await canvas.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y + scrollY, width: rect.width };
    });
    expect(detail).toEqual(origin);
    expect(
      await canvas.evaluate(
        (node) =>
          node.contains(document.activeElement) ||
          node === document.activeElement,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Todas as despesas", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Situação da execução", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/contracts-unified-finance-${width}-${theme}.png`,
      fullPage: true,
    });
  }
});
