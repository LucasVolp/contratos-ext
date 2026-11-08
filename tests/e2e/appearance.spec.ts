import { test, expect, type Page } from "@playwright/test";
import { uncapturedFacts } from "../helpers/contract-facts";

// Contracts come only from the daily replica, so their API is mocked here.
const contract = {
  externalId: "13847",
  number: "00004/2017",
  object: "Gestão de frota",
  supplierName: "Fornecedor de teste",
  supplierDocument: "08273364000157",
  uasg: "158148",
  unitName: "Reitoria",
  startDate: "2017-02-01",
  endDate: "2023-01-31",
  globalValue: "682318.130000",
  status: "EXPIRED",
};
async function mockContracts(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/contracts",
    (route) =>
      route.fulfill({
        json: {
          data: [contract],
          total: 1,
          page: 1,
          limit: 12,
          stats: { count: 1, totalValue: "682318.13", expiringCount: 0 },
          sync: {
            lastCompletedAt: "2026-11-07T06:42:00.000Z",
            running: false,
            staleUnits: [{ uasg: "158148", name: "Reitoria", lastGoodAt: null }],
          },
        },
      }),
  );
  await page.route("**/api/contracts/13847", (route) =>
    route.fulfill({
      json: {
        contract: {
          ...contract,
          originUnitCode: "158148",
          typeName: "Contrato",
          category: "Serviços",
          processNumber: "23243.000390/2017-17",
          modality: "Pregão",
          sourceStatus: "Ativo",
          signatureDate: "2017-01-26",
          initialValue: "545854.000000",
          accumulatedValue: null,
          installmentCount: 12,
          capturedAt: "2026-11-06T10:00:00.000Z",
          normalizedAt: "2026-11-06T10:00:05.000Z",
        },
        parts: [],
        notes: { text: "", updatedAt: null, updatedBy: null },
        facts: uncapturedFacts,
      },
    }),
  );
}

test("keyboard focus remains above the sticky editor actions on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/atas/nova");
  await page.locator('[name="number"]').focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator('[name="object"]')).toBeFocused();
  const field = await page.locator('[name="object"]').boundingBox();
  const actions = await page.locator(".editor-actions").boundingBox();
  expect(field).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(field!.y + field!.height).toBeLessThanOrEqual(actions!.y);
});

test("appearance persists across navigation, reload and another tab", async ({
  page,
  context,
}) => {
  await mockContracts(page);
  await page.goto("/contratos");
  await page.getByLabel("Aparência", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByLabel("Aparência", { exact: true })).toHaveValue(
    "dark",
  );
  await page.getByRole("link", { name: /Fase 1: Pregão/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  const other = await context.newPage();
  await other.goto("/atas");
  await expect(other.locator("html")).toHaveClass(/dark/);
  await page.getByLabel("Aparência", { exact: true }).selectOption("light");
  await expect(other.locator("html")).toHaveClass(/light/);
  await other.close();
});

test("system appearance follows OS changes and remains available on login", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await mockContracts(page);
  await page.goto("/contratos");
  await page.getByLabel("Aparência", { exact: true }).selectOption("system");
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  // Close the authenticated document before clearing cookies so its session
  // listener cannot race the explicit login navigation.
  await page.close();
  await context.clearCookies();
  const login = await context.newPage();
  await login.emulateMedia({ colorScheme: "dark" });
  await login.goto("/login");
  await expect(login.locator("html")).toHaveClass(/dark/);
  await login.getByLabel("Aparência", { exact: true }).selectOption("light");
  await expect(login.locator("html")).toHaveClass(/light/);
  await expect(
    login.getByRole("button", { name: "Entrar", exact: true }),
  ).toBeVisible();
  await login.close();
});

test("both themes keep navigation and essential actions usable at mobile and desktop widths", async ({
  page,
}) => {
  await mockContracts(page);
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      for (const path of [
        "/contratos",
        "/pregoes",
        "/atas",
        "/atas/nova",
        "/contratos/13847",
        "/financeiro",
      ]) {
        await page.goto(path);
        await page.getByLabel("Aparência", { exact: true }).selectOption(theme);
        await expect(
          page.getByRole("button", { name: "Trocar de usuário" }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: /Fase 3: Contrato/ }),
        ).toBeVisible();
        if (path === "/atas/nova" || path === "/contratos/13847") {
          const save = page.getByRole("button", {
            name: path === "/atas/nova" ? "Salvar ata" : "Salvar observações",
            exact: true,
          });
          await expect(save).toBeVisible();
          await expect(save).toBeEnabled();
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${path}, ${theme}, ${width}px`,
        ).toBe(true);
      }
    }
  }
});
