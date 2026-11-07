import { test, expect, type Page } from '@playwright/test';
const suffix = Date.now().toString(36);
// Contracts come only from the daily replica, so the contract list is mocked.
const contract = {
  externalId: '13847', number: `QA-${suffix}`, object: 'Aquisição de materiais para verificação de persistência',
  supplierName: 'Fornecedor de teste automatizado', supplierDocument: '11222333000181',
  uasg: '999999', unitName: 'Unidade de teste', startDate: '2026-01-01', endDate: '2026-12-31',
  globalValue: '1250.100000', status: 'ACTIVE',
};
const contractList = {
  data: [contract], total: 1, page: 1, limit: 12,
  stats: { count: 1, totalValue: '1250.1', expiringCount: 0, vigency: { active: 1, expiring: 0, ended: 0, upcoming: 0, unknown: 0, activeValue: '1250.1' } },
  sync: { lastCompletedAt: '2026-11-07T06:42:00.000Z', running: false, staleUnits: [] },
};
const mockContracts = (page: Page) =>
  page.route(url => url.pathname === '/api/contracts', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contractList) }));
const record = {
  number: `ATA-QA-${suffix}`, object: 'Materiais de expediente para teste documental', uasg: '999999',
  processNumber: '12345.001234/2026-01', purchaseNumber: '90001', purchaseYear: 2026,
  modality: 'PREGAO', renewable: false, startDate: '2026-01-01', endDate: '2026-12-31',
  organizationName: 'Organização demonstrativa de testes', organizationDocument: '11222333000181',
  organizationStreet: 'Rua das Palmeiras', organizationNumber: '120', organizationCity: 'Campo Grande', organizationState: 'MS',
  authorityName: 'Maria de Teste', authorityRole: 'Diretora Administrativa', authorityRegistration: '1234567',
  ordinanceNumber: '123/2026', ordinanceDate: '2026-01-01', ordinancePublicationDate: '2026-01-02',
  supplierName: 'Fornecedor de teste automatizado', supplierDocument: '11222333000181', supplierRepresentative: 'João de Teste',
  items: [
    { number: 1, description: 'Papel para impressão de documentos', brand: 'Teste', model: 'A4', unit: 'resma', quantity: '3', minimumQuantity: '1', unitPrice: '0.10', warranty: '12 meses' },
    { number: 2, description: 'Caneta esferográfica azul', brand: 'Teste', model: 'Azul', unit: 'unidade', quantity: '10', minimumQuantity: '1', unitPrice: '2.50', warranty: '12 meses' },
  ],
};
let recordId: string;
test.describe.serial('Sistema independente', () => {
  test.afterAll(async ({ request }) => {
    if (recordId) await request.delete(`/api/records/${recordId}`);
  });
  test('API calcula totais decimais e identifica pendências da ata', async ({ request }) => {
    const draft = await request.post('/api/records', { data: { number: `RASC-${suffix}`, object: 'Rascunho', uasg: '999999', items: [] } });
    expect(draft.status(), await draft.text()).toBe(201);
    const draftId = (await draft.json()).id;
    const readiness = await request.get(`/api/records/${draftId}/readiness`);
    expect((await readiness.json()).ready).toBe(false);
    const blocked = await request.get(`/api/records/${draftId}/document?format=docx`); expect(blocked.status()).toBe(422);
    await request.delete(`/api/records/${draftId}`);
    const created = await request.post('/api/records', { data: record }); expect(created.status(), await created.text()).toBe(201);
    const body = await created.json(); recordId = body.id;
    expect(body.totalValue).toBe('25.3');
    const ready = await request.get(`/api/records/${recordId}/readiness`); expect((await ready.json()).ready).toBe(true);
  });
  test('gera DOCX e PDF reais e registra snapshots', async ({ request }) => {
    const docx = await request.get(`/api/records/${recordId}/document?format=docx`);
    expect(docx.status(), await docx.text().catch(() => '')).toBe(200);
    expect(docx.headers()['content-type']).toContain('officedocument');
    expect((await docx.body()).subarray(0, 2).toString()).toBe('PK');
    const pdf = await request.get(`/api/records/${recordId}/document?format=pdf`);
    expect(pdf.status()).toBe(200); expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const history = await request.get(`/api/records/${recordId}/exports`);
    const exports = await history.json(); expect(exports.length).toBe(2); expect(exports.map((e: {format: string}) => e.format).sort()).toEqual(['docx', 'pdf']);
  });
  test('contratos da réplica disponíveis na interface com busca', async ({ page }) => {
    await mockContracts(page);
    await page.goto('/contratos');
    // The sidebar shows the purchase phases in order; contracts are the third one.
    await expect(page.getByRole('link', { name: /Fase 3: Contrato/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Contratos', exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Buscar contratos' }).fill(contract.number);
    // The test contract runs from 2026-01-01 to 2026-12-31: in force, outside the 30-day window.
    const summary = page.getByRole('region', { name: 'Resumo dos contratos' });
    await expect(summary).toContainText('1contrato');
    await expect(summary.getByRole('img')).toHaveAttribute('aria-label', '1 em vigor, 0 vencem em 30 dias, 0 encerrados, 0 a iniciar ou sem data');
    await expect(summary.getByRole('link', { name: /Novo ciclo/ })).toHaveAttribute('href', '/pregoes');
    await expect(page.getByText(contract.number, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: contract.number, exact: true })).toHaveAttribute('href', `/contratos/${contract.externalId}`);
  });
  test('documentos mostram prontidão e exportação no resumo', async ({ page }) => {
    await page.goto('/atas');
    await page.getByRole('textbox', { name: 'Buscar atas' }).fill(record.number);
    const summary = page.getByRole('region', { name: 'Resumo dos documentos' });
    await expect(summary).toContainText('1documento');
    await expect(summary.getByRole('img')).toHaveAttribute('aria-label', '1 prontos, 0 com pendências');
    await expect(summary.getByRole('link', { name: /Fase 3/ })).toHaveAttribute('href', '/contratos');
  });
  test('ata mostra dados e permite download no navegador', async ({ page }) => {
    await page.goto(`/atas/${recordId}`);
    await expect(page.getByText(record.number, { exact: true }).first()).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /baixar docx/i }).click();
    const download = await downloadPromise; expect(download.suggestedFilename()).toMatch(/\.docx$/);
  });
  test('navegação móvel mantém módulos e não extrapola viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockContracts(page);
    await page.goto('/contratos'); await expect(page.getByRole('button', { name: 'Trocar de usuário' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.goto(`/atas/${recordId}`); await expect(page.getByRole('button', { name: /baixar docx/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
  test('exclusão da ata persiste e a API não cria nem altera contratos', async ({ request }) => {
    expect((await request.delete(`/api/records/${recordId}`)).ok()).toBe(true);
    expect((await request.get(`/api/records/${recordId}`)).status()).toBe(404);
    expect((await request.post('/api/contracts', { data: contract })).status()).toBe(404);
    expect((await request.post('/api/contracts/import', { data: { uasg: '999999' } })).status()).toBe(404);
  });
});
