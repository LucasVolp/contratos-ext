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
  await page.getByRole("tab", { name: "Visão geral", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Situação da execução", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".execution-totals [data-metric=paidValue] dd"),
  ).toHaveText("Não informado");
  await expect(
    page.getByText("Cobertura diária não informada", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Unidade", { exact: true }).selectOption("015814");
  await expect(committed(page)).toHaveText("R$ 10,00");
  await expect(page).toHaveURL(/view=overview/);
  await page
    .getByRole("tab", { name: "Explorar a despesa", exact: true })
    .click();
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
  await page.getByRole("tab", { name: "Visão geral", exact: true }).click();
  await expect(committed(page)).toHaveText("R$ 10,00");
  await page
    .getByRole("tab", { name: "Explorar a despesa", exact: true })
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
    .getByRole("link", { name: "Consultar empenhos", exact: true })
    .click();
  await expect(page.getByLabel("Unidade", { exact: true })).toHaveValue(
    "015814",
  );
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
  await page.getByLabel("Unidade", { exact: true }).selectOption("158148");
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

test("purpose scopes never invent a Reitoria or campus attribution", async ({
  page,
}) => {
  await page.goto(fixture.baseURL + overview);
  await expect(committed(page)).toHaveText("R$ 21,00");
  for (const label of [
    "Despesas próprias da Reitoria",
    "Execução adjunta aos campi",
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Finalidade ainda não classificada",
        exact: true,
      }),
    ).toBeVisible();
    await expect(committed(page)).toHaveCount(0);
    await expect(page.getByText("R$ 21,00", { exact: true })).toHaveCount(0);
  }
  await page
    .getByRole("tab", { name: "Dados disponíveis", exact: true })
    .click();
  await expect(committed(page)).toHaveText("R$ 21,00");
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
  await page.getByLabel("Unidade", { exact: true }).selectOption("158148");
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
      await page.getByRole("tab", { name: "Visão geral", exact: true }).click();
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
      await page
        .getByRole("tab", { name: "Despesas próprias da Reitoria" })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Finalidade ainda não classificada",
        }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Dados disponíveis" }).click();
      await page
        .getByRole("tab", { name: "Restos a pagar", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Restos a pagar", exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Explorar a despesa" }).click();
      await expect(committed(page)).toHaveText("R$ 21,00");
    }
    if (width < 700) {
      await page
        .getByRole("button", { name: "Escolher despesa", exact: true })
        .click();
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
  await page.getByLabel("Exercício", { exact: true }).selectOption("2025");
  await expect(page).toHaveURL(/fiscalYear=2025/);
  await expect(
    page.getByRole("heading", {
      name: "Nenhum registro encontrado.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(committed(page)).toHaveText("Não informado");
  await page.reload();
  await expect(page.getByLabel("Exercício", { exact: true })).toHaveValue(
    "2025",
  );
  await expect(committed(page)).toHaveText("Não informado");
  await page.getByLabel("Exercício", { exact: true }).selectOption("2026");
  await expect(committed(page)).toHaveText("R$ 21,00");
});
