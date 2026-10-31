import { test, expect } from "@playwright/test";
import { catalogFixture, supplierA, supplierB } from "../helpers/catalog";
let fixture: Awaited<ReturnType<typeof catalogFixture>>;
test.beforeAll(async () => {
  fixture = await catalogFixture();
});
test.afterAll(async () => {
  if (fixture) await fixture.cleanup();
});
// Existing catalogue scenarios isolate the new automatic bulk transport from
// the public government service; automatic-loading behavior has its own suite.
test.beforeEach(async ({page,request})=>{
  await page.route(`**/api/public-records/${fixture.recordId}/supplements/refresh`,async route=>{
    const data=await(await request.get(`/api/public-records/${fixture.recordId}`)).json();
    return route.fulfill({json:{data,errors:{},summary:{items:1,loaded:0,failed:0}}});
  });
});

test("pregões listam dados salvos, todos resultados e atas ligadas pelo identificador exato", async ({
  page,
}) => {
  await page.goto("/pregoes");
  await expect(
    page.getByRole("heading", { name: "Pregões", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Buscar pregões" }).fill(fixture.key);
  await page.getByRole("link", { name: fixture.key, exact: true }).click();
  await expect(
    page.getByText("Papel de teste do catálogo", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Fornecedor A do catálogo", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Fornecedor B do catálogo", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Cancelado", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.locator(`a[href="/atas/publicadas/${fixture.recordId}"]`),
  ).toContainText(fixture.recordNumber);
  await expect(
    page.locator(`a[href="/atas/publicadas/${fixture.decoyId}"]`),
  ).toHaveCount(0);
  await page.route(`**/api/purchases/${fixture.purchaseId}/refresh`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Fonte pública temporariamente indisponível",
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Atualizar detalhes", exact: true })
    .click();
  await expect(
    page.getByText("Fonte pública temporariamente indisponível", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Papel de teste do catálogo", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Papel de teste do catálogo", { exact: true }).first(),
  ).toBeVisible();
});

test("atas públicas exibem auxiliares por item e preservam erro separado de dados salvos", async ({
  page,
}) => {
  await page.goto(`/atas/publicadas/${fixture.recordId}`);
  await expect(
    page.getByRole("heading", { name: fixture.recordNumber, exact: true }),
  ).toBeVisible();
  const supplement = {
    units: {
      status: "loaded",
      data: [
        {
          code: "999996",
          name: "Campus de teste",
          type: "Participante",
          supplierDocument: supplierA,
          quantity: "10",
          adhesionBalance: "5",
          commitmentBalance: "9.123456",
          excluded: false,
        },
      ],
      lastSyncedAt: "2026-10-31T12:00:00Z",
      error: null,
    },
    commitments: {
      status: "error",
      data: [
        {
          unit: "999996",
          type: "Participante",
          quantity: "10",
          committed: "0.876544",
          balance: "9.123456",
        },
      ],
      lastSyncedAt: "2026-10-30T12:00:00Z",
      error: "Saldos indisponíveis; exibindo última consulta salva.",
    },
    adhesions: {
      status: "loaded",
      data: [],
      lastSyncedAt: "2026-10-31T12:00:00Z",
      error: null,
    },
  };
  await page.route(
    `**/api/public-records/${fixture.recordId}/items/1/refresh`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(supplement),
      }),
  );
  await page
    .getByRole("button", { name: /Consultar participantes e saldos/i })
    .first()
    .click();
  await expect(
    page.getByRole("cell", { name: /^Campus de teste\b/ }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByText(/Saldos indisponíveis; exibindo última consulta salva/)
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("9,123456", { exact: true }).first(),
  ).toBeVisible();
});

test("documentos por fornecedor usam a mesma ata oficial sem apagar preenchimento local", async ({
  request,
}) => {
  const nonSrp = await request.post(
    `/api/purchases/${fixture.nonSrpId}/records/refresh`,
    { data: {} },
  );
  expect(nonSrp.status()).toBe(422);
  const first = await request.post(
    `/api/public-records/${fixture.recordId}/draft`,
    { data: { supplierDocument: supplierA } },
  );
  expect(first.ok(), await first.text()).toBe(true);
  const created = await first.json();
  let record = await (await request.get(`/api/records/${created.id}`)).json();
  expect(record.number).toBe(fixture.recordNumber);
  expect(record.items).toHaveLength(1);
  expect(record.supplierDocument).toBe(supplierA);
  expect(record.items[0].unitPrice).toBe("0.123456");
  const update = await request.put(`/api/records/${created.id}`, {
    data: {
      ...record,
      organizationStreet: "Rua preservada manualmente",
      authorityName: "Maria Exemplo",
      authorityRole: "Diretora",
    },
  });
  expect(update.ok(), await update.text()).toBe(true);
  const repeat = await request.post(
    `/api/public-records/${fixture.recordId}/draft`,
    { data: { supplierDocument: supplierA } },
  );
  expect((await repeat.json()).id).toBe(created.id);
  record = await (await request.get(`/api/records/${created.id}`)).json();
  expect(record.organizationStreet).toBe("Rua preservada manualmente");
  const second = await request.post(
    `/api/public-records/${fixture.recordId}/draft`,
    { data: { supplierDocument: supplierB } },
  );
  expect(second.ok(), await second.text()).toBe(true);
  expect((await second.json()).id).not.toBe(created.id);
  const ready = await request.get(`/api/records/${created.id}/readiness`);
  expect((await ready.json()).ready).toBe(true);
  const pdf = await request.get(
    `/api/records/${created.id}/document?format=pdf`,
  );
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("preparação visual exige fornecedor e abre o rascunho correspondente", async ({
  page,
  request,
}) => {
  await page.goto(`/atas/publicadas/${fixture.recordId}/preparar`);
  const supplier = page.getByRole("combobox", { name: /Fornecedor/i });
  await expect(supplier).toBeVisible();
  await supplier.selectOption(supplierB);
  await page
    .getByRole("button", { name: "Preparar documento", exact: true })
    .click();
  await expect(page).toHaveURL(/\/atas\/[0-9a-f-]{36}\/editar$/);
  const id = page.url().split("/").at(-2)!;
  expect(
    (await (await request.get(`/api/records/${id}`)).json()).supplierDocument,
  ).toBe(supplierB);
});

test("catálogos e navegação cabem no celular com dados carregados", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pregoes");
  await expect(page.getByRole("table")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.goto(`/atas/publicadas/${fixture.recordId}`);
  await expect(
    page.getByRole("heading", { name: fixture.recordNumber, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("atualização pelo Compras.gov valida o período antes de consultar a abrangência", async ({
  page,
}) => {
  let sent: Record<string, string> | undefined;
  await page.route("**/api/purchases/sync-reach", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        from: sent!.from,
        to: sent!.to,
        created: 1,
        updated: 0,
        total: 1,
        incomplete: 0,
        failed: 1,
        results: [
          { uasg: "158132", name: "Reitoria de teste", created: 1, updated: 0, total: 1, incomplete: 0, error: null },
          { uasg: "158454", name: "Campus de teste", created: 0, updated: 0, total: 0, incomplete: 0, error: "Fonte indisponível." },
        ],
      }),
    });
  });
  await page.goto("/pregoes");
  await expect(page).toHaveURL(/\/pregoes$/);
  await page.getByRole("button", { name: "Atualizar do Compras.gov" }).first().click();
  const form = page.getByRole("form", { name: "Atualizar do Compras.gov" });
  await form.locator('[name="from"]').fill("2026-12-01");
  await form.locator('[name="to"]').fill("2026-01-01");
  await form.getByRole("button", { name: "Atualizar agora" }).click();
  await expect(form.locator('[name="to"]')).toHaveAttribute("aria-invalid", "true");
  expect(sent).toBeUndefined();
  await form.locator('[name="from"]').fill("2026-01-01");
  await form.locator('[name="to"]').fill("2026-01-31");
  await form.getByRole("button", { name: "Atualizar agora" }).click();
  await expect.poll(() => sent?.from).toBe("2026-01-01");
  expect(sent?.to).toBe("2026-01-31");
  // A failing UASG is reported without hiding the ones that worked.
  await expect(form.getByRole("alert")).toContainText("1 de 2 UASGs");
  await expect(form).toContainText("Fonte indisponível.");
  // The standalone consultation pages no longer exist.
  for (const path of ["/pregoes/consultar", "/atas/publicadas/consultar"]) {
    await page.goto(path);
    await expect(page.getByText("Este caminho não está no arquivo.")).toBeVisible();
    await expect(page.getByText(/uuid is expected/i)).toHaveCount(0);
  }
});

test("itens do pregão são paginados após atualização e a busca não consulta novamente a fonte", async ({
  page,
  request,
}) => {
  const base = await (
    await request.get(`/api/purchases/${fixture.purchaseId}`)
  ).json();
  const items = Array.from({ length: 12 }, (_, index) => ({
    ...base.items[0],
    externalId: `item-${index + 1}`,
    number: String(index + 1),
    description: `Material ${index + 1}`,
  }));
  let refreshes = 0;
  await page.route(`**/api/purchases/${fixture.purchaseId}`, (route) =>
    route.fulfill({ json: { ...base, items: [], detailsSyncedAt: null } }),
  );
  await page.route(
    `**/api/purchases/${fixture.purchaseId}/refresh`,
    (route) => {
      refreshes++;
      return route.fulfill({
        json: { ...base, items, detailsSyncedAt: new Date().toISOString() },
      });
    },
  );
  await page.goto(`/pregoes/${fixture.purchaseId}`);
  await page
    .getByRole("button", { name: "Atualizar detalhes", exact: true })
    .click();
  await expect(page.locator(".catalog-purchase-item")).toHaveCount(5);
  const pagination = page.getByRole("navigation", {
    name: "Paginação dos itens",
    exact: true,
  });
  await pagination.getByRole("button", { name: "Próxima página" }).click();
  await expect(
    page.getByRole("heading", { name: "Material 6", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Material 1", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Buscar itens do pregão" })
    .fill("Material 12");
  await expect(page.locator(".catalog-purchase-item")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Material 12", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Buscar itens do pregão" }).fill("");
  await page
    .getByRole("combobox", { name: "Itens por página" })
    .selectOption("10");
  await expect(page.locator(".catalog-purchase-item")).toHaveCount(10);
  await expect(
    page.getByText("Fornecedor B do catálogo", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Cancelado", { exact: true }).first(),
  ).toBeVisible();
  expect(refreshes).toBe(1);
});

test("consulta de atas distingue ausência, indisponibilidade e identificador ausente sem apagar atas salvas", async ({
  page,
  request,
}) => {
  const base = await (
    await request.get(`/api/purchases/${fixture.purchaseId}`)
  ).json();
  const record = await (
    await request.get(`/api/public-records/${fixture.recordId}`)
  ).json();
  let calls = 0;
  await page.route(`**/api/purchases/${fixture.purchaseId}`, (route) =>
    route.fulfill({
      json: { ...base, linkedRecords: [], recordsSyncedAt: null },
    }),
  );
  await page.route(
    `**/api/purchases/${fixture.purchaseId}/records/refresh`,
    (route) => {
      calls++;
      if (calls === 1)
        return route.fulfill({
          json: { total: 0, records: [], from: "2025-01-01", to: "2026-12-31" },
        });
      if (calls === 2)
        return route.fulfill({
          status: 502,
          json: {
            message:
              "A API pública retornou ata sem identificador oficial. Nenhum dado foi importado.",
          },
        });
      if (calls === 3)
        return route.fulfill({
          json: {
            total: 1,
            records: [record],
            from: "2025-01-01",
            to: "2026-12-31",
          },
        });
      return route.fulfill({
        json: {
          total: 1,
          records: [record],
          recordsLookup: { incompleteRecords: [{ number: "00043/2026" }] },
        },
      });
    },
  );
  await page.goto(`/pregoes/${fixture.purchaseId}`);
  await page
    .getByRole("button", { name: "Consultar atas vinculadas", exact: true })
    .click();
  await expect(
    page.getByText("Nenhuma ata publicada encontrada para este pregão.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Não foi possível consultar as atas" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Consultar atas vinculadas", exact: true })
    .click();
  const error = page
    .getByRole("alert")
    .filter({ hasText: "Não foi possível consultar as atas deste pregão" });
  await expect(error).toBeVisible();
  await expect(error).toContainText("Tente novamente");
  await expect(
    page.getByText("Nenhuma ata publicada encontrada para este pregão.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(error).not.toContainText("Nenhum dado foi importado");
  await error.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.locator(`a[href="/atas/publicadas/${fixture.recordId}"]`),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Consultar atas vinculadas", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Consulta parcial: 1 ata sem identificador PNCP" }),
  ).toBeVisible();
  await expect(error).toHaveCount(0);
  await expect(
    page.locator(`a[href="/atas/publicadas/${fixture.recordId}"]`),
  ).toBeVisible();
});
