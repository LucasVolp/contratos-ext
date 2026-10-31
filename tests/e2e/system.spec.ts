import { test, expect } from '@playwright/test';
const suffix = Date.now().toString(36);
const contract = {
  number: `QA-${suffix}`, object: 'Aquisição de materiais para verificação de persistência',
  supplierName: 'Fornecedor de teste automatizado', supplierDocument: '11222333000181',
  uasg: '999999', unitName: 'Unidade de teste', startDate: '2026-01-01', endDate: '2026-12-31',
  initialValue: '1250.10', globalValue: '1250.10',
};
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
let contractId: string;
let recordId: string;
test.describe.serial('Sistema independente', () => {
  test.afterAll(async ({ request }) => {
    if (contractId) await request.delete(`/api/contracts/${contractId}`);
    if (recordId) await request.delete(`/api/records/${recordId}`);
  });
  test('API persiste contrato e rejeita vigência invertida', async ({ request }) => {
    const invalid = await request.post('/api/contracts', { data: { ...contract, startDate: '2027-01-01' } });
    expect(invalid.status()).toBe(400);
    const created = await request.post('/api/contracts', { data: contract });
    expect(created.status(), await created.text()).toBe(201);
    const body = await created.json(); contractId = body.id;
    expect(body.globalValue).toBe('1250.1');
    const duplicate = await request.post('/api/contracts', { data: contract });
    expect(duplicate.status()).toBe(409);
    const list = await request.get(`/api/contracts?search=${contract.number}`);
    const result = await list.json(); expect(result.total).toBe(1); expect(result.data[0].id).toBe(contractId);
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
  test('contratos disponíveis na interface com busca real', async ({ page }) => {
    await page.goto('/contratos');
    await expect(page.getByRole('heading', { name: 'Contratos', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Buscar contratos' }).fill(contract.number);
    await expect(page.getByText(contract.number, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(contract.number) }).first().click();
    await expect(page.getByText(contract.object, { exact: true }).first()).toBeVisible();
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
    await page.goto('/contratos'); await expect(page.getByRole('heading', { name: 'Contratos', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.goto(`/atas/${recordId}`); await expect(page.getByRole('button', { name: /baixar docx/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
  test('edição e exclusão persistem e rotas inexistentes respondem 404', async ({ request }) => {
    const update = await request.put(`/api/contracts/${contractId}`, { data: { ...contract, globalValue: '1300.50' } }); expect(update.ok()).toBe(true);
    const reload = await request.get(`/api/contracts/${contractId}`); expect((await reload.json()).globalValue).toBe('1300.5');
    expect((await request.delete(`/api/contracts/${contractId}`)).ok()).toBe(true);
    expect((await request.delete(`/api/records/${recordId}`)).ok()).toBe(true);
    expect((await request.get(`/api/contracts/${contractId}`)).status()).toBe(404);
  });
});
