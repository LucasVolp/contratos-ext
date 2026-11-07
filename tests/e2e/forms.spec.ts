import { test, expect } from "@playwright/test";

test("cadastro e edição de contrato pela interface aceitam valores brasileiros", async ({
  page,
  request,
}) => {
  const number = `FORM-${Date.now()}`;
  let id = "";
  try {
    await page.goto("/contratos/novo");
    await page.locator('[name="number"]').fill(number);
    await page.locator('[name="uasg"]').fill("999998");
    await page
      .locator('[name="object"]')
      .fill("Contrato cadastrado pelo fluxo visual");
    await page
      .locator('[name="supplierName"]')
      .fill("Empresa de verificação visual");
    await page.locator('[name="supplierDocument"]').fill("11222333000181");
    await page.locator('[name="startDate"]').fill("2026-01-01");
    await page.locator('[name="endDate"]').fill("2027-01-01");
    await page.locator('[name="initialValue"]').fill("1.250,10");
    await page.locator('[name="globalValue"]').fill("1.250,10");
    await page
      .getByRole("button", { name: "Salvar contrato", exact: true })
      .click();
    await expect(page).toHaveURL(/\/contratos\/[0-9a-f-]{36}$/);
    id = page.url().split("/").pop()!;
    expect(
      (await (await request.get(`/api/contracts/${id}`)).json()).globalValue,
    ).toBe("1250.1");
    await page
      .getByRole("link", { name: "Editar contrato", exact: true })
      .click();
    await page.locator('[name="globalValue"]').fill("1.300,50");
    await page
      .getByRole("button", { name: "Salvar contrato", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/contratos/${id}$`));
    expect(
      (await (await request.get(`/api/contracts/${id}`)).json()).globalValue,
    ).toBe("1300.5");
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Excluir contrato", exact: true })
      .click();
    await expect(page).toHaveURL(/\/contratos$/);
    expect((await request.get(`/api/contracts/${id}`)).status()).toBe(404);
  } finally {
    if (id) await request.delete(`/api/contracts/${id}`);
  }
});

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
  let sent: Record<string, string> | undefined;
  await page.route("**/api/contracts", async (route) => {
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
  await page.goto("/contratos/novo");
  await page.getByLabel("Número", { exact: true }).fill("VALIDACAO");
  await page
    .getByLabel("Objeto", { exact: true })
    .fill("Verificação da validação");
  await page.getByLabel("Razão social do fornecedor").fill("Empresa");
  await page.locator('[name="uasg"]').fill("12");
  await page.locator('[name="supplierDocument"]').fill("11111111111");
  await page.locator('[name="globalValue"]').fill("-1");
  await page
    .getByRole("button", { name: "Salvar contrato", exact: true })
    .click();
  await expect(page.locator('[name="uasg"]')).toBeFocused();
  for (const name of ["uasg", "supplierDocument", "globalValue"])
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
  await page.locator('[name="initialValue"]').fill("999999999999999999.123456");
  await page.locator('[name="globalValue"]').fill("R$ 1.234,567890");
  await page.locator('[name="globalValue"]').blur();
  await expect(page.locator('[name="globalValue"]')).toHaveValue(
    "R$ 1.234,567890",
  );
  await page
    .getByRole("button", { name: "Salvar contrato", exact: true })
    .click();
  await expect(
    page.getByText("Documento rejeitado pelo servidor."),
  ).toBeVisible();
  await expect(page.locator('[name="supplierDocument"]')).toBeFocused();
  expect(sent?.supplierDocument).toBe("12ABC34501DE35");
  expect(sent?.uasg).toBe("001234");
  expect(sent?.initialValue).toBe("999999999999999999.123456");
  expect(sent?.globalValue).toBe("1234.567890");
});

test("consulta de importação valida intervalo ao sair do campo e mantém UASG com zeros", async ({
  page,
}) => {
  await page.goto("/contratos/importar");
  await page.locator('[name="uasg"]').fill("001234");
  await page.locator('[name="from"]').fill("2026-12-01");
  await page.locator('[name="to"]').fill("2026-01-01");
  await page.locator('[name="to"]').blur();
  await expect(page.locator('[name="to"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page
    .getByRole("button", { name: "Importar contratos", exact: true })
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
  await page.goto("/contratos");
  await page.getByRole("button", { name: "Filtros" }).click();
  const filter = page.locator('[name="uasg"]');
  await filter.focus();
  await filter.blur();
  await expect(page.locator("#uasg-error")).toHaveCount(0);
});
