import { test, expect } from "@playwright/test";

test("keyboard focus remains above the sticky editor actions on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/contratos/novo");
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
  for (const width of [360, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      for (const path of [
        "/contratos",
        "/pregoes",
        "/atas",
        "/contratos/novo",
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
        if (path === "/contratos/novo") {
          const save = page.getByRole("button", {
            name: "Salvar contrato",
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
