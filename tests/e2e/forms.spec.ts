import { test, expect } from "@playwright/test";

test("rascunho de ata com itens é preenchido e liberado para exportação pela interface", async ({
  page,
  request,
}) => {
  const number = `FORM-ATA-${Date.now()}`;
  let id = "";
  try {
    await page.goto("/atas/nova");
    await page.locator('[name="number"]').fill(number);
    await page.locator('[name="uasg"]').fill("999998");
    await page.locator('[name="object"]').fill("Ata criada pelo editor visual");
    await page.getByRole("button", { name: /Adicionar item/i }).click();
    await page
      .locator('[name="item-0-description"]')
      .fill("Material para validação de formulário");
    await page.locator('[name="item-0-unit"]').fill("UN");
    await page.locator('[name="item-0-quantity"]').fill("1,50");
    await page.locator('[name="item-0-unitPrice"]').fill("2,00");
    await page.getByRole("button", { name: "Salvar ata", exact: true }).click();
    await expect(page).toHaveURL(/\/atas\/[0-9a-f-]{36}$/);
    id = page.url().split("/").pop()!;
    expect(
      (await (await request.get(`/api/records/${id}`)).json()).totalValue,
    ).toBe("3");
    await expect(
      page.getByRole("button", { name: "Baixar DOCX" }),
    ).toBeDisabled();
    await page.getByRole("link", { name: "Editar ata", exact: true }).click();
    const fields: Record<string, string> = {
      processNumber: "PROC-2026",
      purchaseNumber: "90001",
      purchaseYear: "2026",
      organizationName: "Organização de verificação",
      organizationDocument: "11222333000181",
      organizationStreet: "Rua dos Testes",
      organizationCity: "Campo Grande",
      organizationState: "MS",
      authorityName: "Maria Exemplo",
      authorityRole: "Diretora",
      supplierName: "Empresa de verificação",
      supplierDocument: "11222333000181",
    };
    for (const [key, value] of Object.entries(fields))
      await page.locator(`[name="${key}"]`).fill(value);
    await page.getByRole("button", { name: "Salvar ata", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/atas/${id}$`));
    await expect(
      page.getByRole("button", { name: "Baixar DOCX" }),
    ).toBeEnabled();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Baixar DOCX" }).click();
    expect((await downloadEvent).suggestedFilename()).toMatch(/\.docx$/);
  } finally {
    if (id) await request.delete(`/api/records/${id}`);
  }
});

test("validação apresenta todos os erros, aplica máscaras e preserva precisão no envio", async ({
  page,
}) => {
  let sent: Record<string, unknown> | undefined;
  await page.route("**/api/records", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Confira o fornecedor.",
        fieldErrors: { supplierDocument: "Documento rejeitado pelo servidor." },
      }),
    });
  });
  await page.goto("/atas/nova");
  await page.getByLabel("Número", { exact: true }).fill("VALIDACAO");
  await page
    .getByLabel("Objeto", { exact: true })
    .fill("Verificação da validação");
  await page.getByRole("button", { name: /Adicionar item/i }).click();
  await page.locator('[name="item-0-unitPrice"]').fill("-1");
  await page.locator('[name="uasg"]').fill("12");
  await page.locator('[name="supplierDocument"]').fill("11111111111");
  await page.getByRole("button", { name: "Salvar ata", exact: true }).click();
  await expect(page.locator('[name="uasg"]')).toBeFocused();
  for (const name of ["uasg", "supplierDocument", "item-0-unitPrice"])
    await expect(page.locator(`[name="${name}"]`)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  await expect(page.getByText(/Revise 3 campos:/)).toBeVisible();
  expect(sent).toBeUndefined();
  await page.locator('[name="uasg"]').fill("001234");
  await page.locator('[name="supplierDocument"]').fill("12abc34501de35");
  await expect(page.locator('[name="supplierDocument"]')).toHaveValue(
    "12.ABC.345/01DE-35",
  );
  await page
    .locator('[name="item-0-quantity"]')
    .fill("999999999999999999.123456");
  await page.locator('[name="item-0-unitPrice"]').fill("R$ 1.234,567890");
  await page.locator('[name="item-0-unitPrice"]').blur();
  await expect(page.locator('[name="item-0-unitPrice"]')).toHaveValue(
    "R$ 1.234,567890",
  );
  await page.getByRole("button", { name: "Salvar ata", exact: true }).click();
  await expect(
    page.getByText("Documento rejeitado pelo servidor."),
  ).toBeVisible();
  await expect(page.locator('[name="supplierDocument"]')).toBeFocused();
  const [item] = sent?.items as Record<string, string>[];
  expect(sent?.supplierDocument).toBe("12ABC34501DE35");
  expect(sent?.uasg).toBe("001234");
  expect(item.quantity).toBe("999999999999999999.123456");
  expect(item.unitPrice).toBe("1234.567890");
});

test("consulta de importação valida intervalo ao sair do campo e mantém UASG com zeros", async ({
  page,
}) => {
  await page.goto("/atas/importar");
  await page.locator('[name="uasg"]').fill("001234");
  await page.locator('[name="number"]').fill("1/2026");
  await page.locator('[name="from"]').fill("2026-12-01");
  await page.locator('[name="to"]').fill("2026-01-01");
  await page.locator('[name="to"]').blur();
  await expect(page.locator('[name="to"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page
    .getByRole("button", { name: "Importar ata", exact: true })
    .click();
  await expect(page.locator('[name="to"]')).toBeFocused();
  await expect(page.locator('[name="uasg"]')).toHaveValue("001234");
});

test("filtros opcionais de UASG não acusam campo obrigatório ao sair vazios", async ({
  page,
}) => {
  for (const path of ["/pregoes", "/atas/publicadas"]) {
    await page.goto(path);
    const uasg = page.locator('[name="uasg"]');
    await expect(page.locator('label[for="uasg"]')).toContainText("opcional");
    await uasg.focus();
    await uasg.blur();
    await expect(uasg).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#uasg-error")).toHaveCount(0);
    // Format is still checked once something is typed.
    await uasg.fill("12");
    await uasg.blur();
    await expect(uasg).toHaveAttribute("aria-invalid", "true");
  }
  // Contracts come only from the daily replica; the list itself is mocked.
  await page.route(
    (url) => url.pathname === "/api/contracts",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          total: 0,
          page: 1,
          limit: 12,
          stats: { count: 0, totalValue: "0", expiringCount: 0 },
          sync: { lastCompletedAt: null, running: true, staleUnits: [] },
        }),
      }),
  );
  await page.goto("/contratos");
  await page.getByRole("button", { name: "Filtros" }).click();
  const filter = page.locator('[name="uasg"]');
  await filter.focus();
  await filter.blur();
  await expect(page.locator("#uasg-error")).toHaveCount(0);
});
