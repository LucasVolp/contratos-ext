import { test, expect } from '@playwright/test';
let seedRecord: string;
test.beforeAll(async ({ request }) => {
  const created = await request.post('/api/records', { data: {
    number: `RECOVERY-${Date.now()}`, object: 'Ata de teste de recuperação', uasg: '999997',
    processNumber: 'QA-2026', purchaseNumber: '90001/2026', purchaseYear: 2026,
    organizationName: 'Organização de teste', organizationDocument: '11222333000181',
    organizationStreet: 'Rua Exemplo', organizationCity: 'Campo Grande', organizationState: 'MS',
    authorityName: 'Maria Exemplo', authorityRole: 'Diretora', supplierName: 'Fornecedor de teste', supplierDocument: '11222333000181',
    items: [{ number: 1, description: 'Material de teste', unit: 'UN', quantity: '1', minimumQuantity: '0', unitPrice: '1' }],
  } });
  expect(created.status()).toBe(201);
  seedRecord = (await created.json()).id;
});
test.afterAll(async ({ request }) => { if (seedRecord) await request.delete(`/api/records/${seedRecord}`); });

test('falhas temporárias de preparação e histórico oferecem repetição sem falso vazio', async ({ page }) => {
  let readinessCalls = 0;
  let failReadiness = true;
  let failHistory = true;
  let historyCalls = 0;
  await page.route(`**/api/records/${seedRecord}/readiness*`, route => {
    readinessCalls++;
    if (failReadiness) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Verificação indisponível para teste' }) });
    return route.continue();
  });
  await page.route(`**/api/records/${seedRecord}/exports`, route => {
    historyCalls++;
    if (failHistory) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Histórico indisponível para teste' }) });
    return route.continue();
  });
  await page.goto(`/atas/${seedRecord}`);
  const preparationError = page.locator('.error-state').filter({ hasText: 'Verificação indisponível para teste' });
  await expect(preparationError).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baixar DOCX' })).toBeDisabled();
  failReadiness = false;
  await preparationError.getByRole('button', { name: /Tentar novamente/i }).click({ timeout: 3000 });
  await expect(page.getByRole('button', { name: 'Baixar DOCX' })).toBeEnabled();
  const historyError = page.locator('.error-state').filter({ hasText: 'Histórico indisponível para teste' });
  if (await historyError.isVisible()) {
    await expect(page.locator('.export-history')).not.toContainText('Nenhum documento gerado ainda.');
    failHistory = false;
    await historyError.getByRole('button', { name: /Tentar novamente/i }).click();
  }
  await expect(page.locator('.export-history')).not.toContainText('Histórico indisponível para teste');
  expect(readinessCalls).toBeGreaterThan(1);
  expect(historyCalls).toBeGreaterThan(1);
});

test('número de compra já completo não recebe ano duplicado na ficha', async ({ page }) => {
  await page.goto(`/atas/${seedRecord}`);
  const purchase = page.locator('.metadata > div').filter({ has: page.getByText('Compra', { exact: true }) }).locator('dd');
  await expect(purchase).toHaveText('90001/2026');
});

test('contrato importado informa origem e data da última importação', async ({ page }) => {
  const id = '40000000-0000-4000-8000-000000000001';
  await page.route(`**/api/contracts/${id}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, number: 'IMPORT-QA', object: 'Contrato importado para teste visual', supplierName: 'Fornecedor de teste', supplierDocument: '11222333000181', uasg: '999999', unitName: 'Unidade de teste', startDate: '2026-01-01', endDate: '2027-01-01', initialValue: '100', globalValue: '100', status: 'ACTIVE', source: 'COMPRAS_GOV', lastSyncedAt: '2026-10-30T12:30:00.000Z' }) }));
  await page.goto(`/contratos/${id}`);
  await expect(page.getByText('Última importação', { exact: true })).toBeVisible();
  await expect(page.locator('.metadata')).toContainText('30/10/2026');
});

test('falha ao carregar edição bloqueia formulário até repetir a leitura com sucesso', async ({ page }) => {
  const id = '40000000-0000-4000-8000-000000000002';
  let failLoad = true;
  let writes = 0;
  await page.route(`**/api/contracts/${id}`, route => {
    if (route.request().method() === 'PUT') { writes++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id }) }); }
    if (failLoad) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Contrato temporariamente indisponível no teste' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, number: 'LOAD-QA', object: 'Dados originais preservados', supplierName: 'Fornecedor original', supplierDocument: '11222333000181', uasg: '999999', unitName: 'Unidade de teste', startDate: '2026-01-01', endDate: '2027-01-01', initialValue: '100', globalValue: '100', status: 'ACTIVE', source: 'MANUAL' }) });
  });
  await page.goto(`/contratos/${id}/editar`);
  await expect(page.getByText('Contrato temporariamente indisponível no teste', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar contrato', exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
  failLoad = false;
  await page.getByRole('button', { name: /Tentar novamente/i }).click();
  await expect(page.locator('[name="number"]')).toHaveValue('LOAD-QA');
  await expect(page.locator('[name="object"]')).toHaveValue('Dados originais preservados');
  await expect(page.getByRole('button', { name: 'Salvar contrato', exact: true })).toBeEnabled();
  expect(writes).toBe(0);
});
