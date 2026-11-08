import { test, expect } from "@playwright/test";

const viewer = {
  id: "dashboard-viewer",
  name: "Dashboard test viewer",
  email: "dashboard@example.test",
  role: "USUARIO",
  roleLabel: "Usuário",
  allInstitutions: false,
  institutions: [{ id: "test-institution", name: "Instituição de teste", uasg: "999999" }],
  impersonator: null,
  defaults: null,
};

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "contracts_session", value: "dashboard-fixture", url: baseURL! }]);
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: viewer }));
});

test("home presents an explicitly illustrative dashboard without route shortcuts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Painel de gestão", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Painel de gestão", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/Demonstração.*dados fictícios/)).toBeVisible();
  await expect(page.locator(".dashboard a")).toHaveCount(0);
  await page.getByLabel("Abrangência do exemplo", { exact: true }).selectOption("rectory");
  await page.getByLabel("Período financeiro", { exact: true }).selectOption("month");
  await expect(page.locator(".dashboard-financial-stages")).toContainText("R$ 420,00 mil");
});

test("signatures are local simulations, empty queues remain usable and reload restores fixtures", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Assinaturas (2)", exact: true }).click();
  const queue = page.getByRole("region", { name: "Lista de pendências", exact: true });
  await expect(queue.locator("article")).toHaveCount(2);
  for (let remaining = 1; remaining >= 0; remaining--) {
    await queue.getByRole("button", { name: "Revisar documento", exact: true }).first().click();
    await queue.getByRole("button", { name: "Simular assinatura", exact: true }).click();
    await expect(queue.locator("article")).toHaveCount(remaining);
  }
  await expect(queue).toContainText("Nenhum item nesta seleção");
  await expect(page.getByRole("status").filter({ hasText: "Nenhum documento foi assinado" })).toBeVisible();
  expect(writes).toEqual([]);
  await page.reload();
  await expect(queue.locator("article")).toHaveCount(3);
});

test("notification read state updates locally and restores on reload", async ({ page }) => {
  await page.goto("/");
  const notifications = page.getByRole("region", { name: "Lista de notificações", exact: true });
  await page.getByRole("button", { name: /Marcar como lida: Contrato/ }).click();
  await expect(notifications.locator(".is-read")).toHaveCount(1);
  await page.getByRole("button", { name: "Marcar todas como lidas", exact: true }).click();
  await expect(notifications.locator(".is-read")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Marcar todas como lidas", exact: true })).toBeDisabled();
  await page.reload();
  await expect(notifications.locator(".is-read")).toHaveCount(0);
});

test("dashboard fits desktop and mobile screens with keyboard accessible work lists", async ({ page }) => {
  for (const [width, height] of [[1440, 900], [1366, 768], [390, 844], [360, 800]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Painel de gestão", exact: true })).toBeVisible();
    for (const appearance of ["light", "dark", "system"]) {
      await page.getByLabel("Aparência", { exact: true }).selectOption(appearance);
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        regions: [...document.querySelectorAll<HTMLElement>(".dashboard-task-list, .dashboard-notification-list")].map((element) => ({
          height: element.clientHeight,
          bottom: element.getBoundingClientRect().bottom,
          overflow: getComputedStyle(element).overflowY,
        })),
      }));
      expect(dimensions.width, `${width} ${appearance}`).toBeLessThanOrEqual(width);
      expect(dimensions.height, `${height} ${appearance}`).toBeLessThanOrEqual(height);
      for (const region of dimensions.regions) {
        expect(region.height).toBeGreaterThan(100);
        expect(region.bottom).toBeLessThanOrEqual(height);
        expect(region.overflow).toBe("auto");
      }
    }
    const notifications = page.getByRole("region", { name: "Lista de notificações", exact: true });
    await notifications.focus();
    await expect(notifications).toBeFocused();
    await page.keyboard.press("End");
    await expect.poll(() => notifications.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /Marcar como lida: Processo/ })).toBeInViewport();
    if (width < 700) {
      await page.getByLabel("Exibir pendências", { exact: true }).selectOption("pending");
      await expect(page.locator(".dashboard-task-list article")).toHaveCount(1);
    }
  }
});

test("session failures offer retry without exposing illustrative content before access is confirmed", async ({ page }) => {
  let failed = true;
  await page.route("**/api/auth/me", (route) => failed
    ? route.fulfill({ status: 503, json: { message: "Sessão indisponível" } })
    : route.fulfill({ json: viewer }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Não foi possível confirmar sua sessão");
  await expect(page.locator(".dashboard")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Painel de gestão", exact: true })).toBeVisible();
});

test("leaving the dashboard restores the regular workspace layout", async ({ page }) => {
  await page.route("**/api/catalog/purchases**", (route) => route.fulfill({ json: { data: [], total: 0, page: 1, limit: 12 } }));
  await page.goto("/");
  await page.getByRole("link", { name: /Fase 1: Pregão/ }).click();
  await expect(page).toHaveURL(/\/pregoes/);
  await expect(page.locator(".workspace-dashboard")).toHaveCount(0);
  await expect(page.locator("main")).not.toHaveCSS("overflow", "hidden");
});
