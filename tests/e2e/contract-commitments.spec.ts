import { test, expect, type Page, type Route } from '@playwright/test';

// Contract ↔ commitment screens. Every API call is mocked: links come from the
// daily replica and the finance import, never from the UI.
const externalId = '13847';
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const detail = {
  externalId, number: '00004/2017', object: 'Gestão de frota', supplierName: 'Fornecedor de teste',
  supplierDocument: '08273364000157', uasg: '158148', unitName: 'Reitoria', startDate: '2017-02-01', endDate: '2027-01-31',
  globalValue: '1000.000000', status: 'ACTIVE', originUnitCode: '158148', typeName: 'Contrato', category: 'Serviços',
  processNumber: '23243.000390/2017-17', modality: 'Pregão', sourceStatus: 'Ativo', signatureDate: '2017-01-26',
  initialValue: '1000.000000', accumulatedValue: null, installmentCount: 12,
  capturedAt: '2026-11-06T10:00:00.000Z', normalizedAt: '2026-11-06T10:00:05.000Z',
};
const state = (part: string, status = 'AVAILABLE', rowCount = 1) =>
  ({ part, status, capturedAt: '2026-11-06T10:00:00.000Z', lastAttemptAt: '2026-11-06T10:00:00.000Z', rowCount });
const parts = (commitments = state('commitments', 'AVAILABLE', 6)) =>
  [state('header'), ...['history', 'items', 'invoices', 'guarantees', 'responsibles', 'files'].map(p => state(p, 'AVAILABLE', 0)), commitments];
const noNotes = { text: '', updatedAt: null, updatedBy: null };

const amounts = (committed: string | null, extra: Record<string, string | null> = {}) => ({
  committed, liquidated: committed, paid: committed, rpRegistered: '0.000000', rpToLiquidate: '0.000000',
  rpLiquidated: '0.000000', rpPaid: '0.000000', ...extra,
});
const link = (number: string, unitCode: string, unitName: string | null, committed: string, extra: Record<string, unknown> = {}) => ({
  transparencyCode: `${unitCode}26421${number}`, number, unitCode, unitName, issueDate: '2026-03-10', creditor: 'Fornecedor de teste',
  expenseNature: '339039', ...amounts(committed), financeStatus: 'CONFIRMED', financeCommitmentId: null, financeCommitted: null,
  lastImportedOn: null, linkable: false, ...extra,
});
const commitments = {
  commitments: [
    link('2026NE000001', '158345', 'CAMPUS A', '300.000000', { financeCommitmentId: '501', financeCommitted: '310.000000', linkable: true }),
    link('2024NE000002', '158345', 'CAMPUS A', '100.000000', { financeCommitmentId: '502', linkable: false }),
    link('2026NE000003', '158148', 'REITORIA', '50.000000', { financeStatus: 'NOT_FOUND' }),
    link('2026NE000004', '158148', 'REITORIA', '25.000000', { financeStatus: 'PENDING', lastImportedOn: '2026-10-23' }),
    link('2026NE000005', '999999', null, '10.000000', { financeStatus: 'OUT_OF_SCOPE' }),
    link('2025NE000006', '158148', 'REITORIA', '5.000000', { financeStatus: 'OUT_OF_SCOPE' }),
  ],
  campuses: [
    { unitCode: '999999', unitName: '999999', count: 1, ...amounts('10.000000') },
    { unitCode: '158345', unitName: 'CAMPUS A', count: 2, ...amounts('400.000000') },
    { unitCode: '158148', unitName: 'REITORIA', count: 3, ...amounts('80.000000', { liquidated: null }) },
  ],
  totals: { count: 6, ...amounts('490.000000', { liquidated: null }) },
  balance: { globalValue: '1000.000000', remaining: '510.000000' },
};
const noCommitments = { commitments: [], campuses: [], totals: { count: 0, ...amounts(null) }, balance: { globalValue: '1000.000000', remaining: null } };

async function mockContract(page: Page, options: { commitmentsPart?: unknown; body?: () => [unknown, number] } = {}) {
  await page.route(`**/api/contracts/${externalId}`, route =>
    json(route, { contract: detail, parts: parts(options.commitmentsPart as ReturnType<typeof state>), notes: noNotes }));
  await page.route(`**/api/contracts/${externalId}/source/*`, route => json(route, { data: [], total: 0, page: 1, limit: 20 }));
  await page.route(`**/api/contracts/${externalId}/commitments`, route => {
    const [body, status] = options.body?.() ?? [commitments, 200];
    return json(route, body, status);
  });
}

const section = (page: Page) => page.getByRole('region', { name: 'Empenhos por campus', exact: true });

test.describe('empenhos do contrato', () => {
  test('mostra empenhos por campus com totais, saldo e origem', async ({ page }) => {
    await mockContract(page);
    await page.goto(`/contratos/${externalId}`);
    const area = section(page);
    await expect(area.getByRole('heading', { name: 'Empenhos por campus' })).toBeVisible();
    await expect(area.getByText('Empenhos informados pelo Contratos.gov.br. Valores do Contratos.gov.br, incluindo restos a pagar.')).toBeVisible();
    const campuses = area.getByRole('region', { name: 'Tabela: empenhos por campus' });
    await expect(campuses.getByRole('row', { name: /CAMPUS A/ })).toContainText('R$ 400,00');
    await expect(campuses.getByRole('row', { name: /Total do contrato/ })).toContainText('R$ 490,00');
    await expect(area.getByText('SALDO DO CONTRATO')).toBeVisible();
    await expect(area.getByText('R$ 510,00')).toBeVisible();
    await expect(area.getByText('Valor global informado pelo Contratos.gov.br (R$ 1.000,00) menos o total empenhado.')).toBeVisible();
  });

  test('situação de cada empenho é explícita', async ({ page }) => {
    await mockContract(page);
    await page.goto(`/contratos/${externalId}`);
    const list = section(page).getByRole('region', { name: 'Tabela: empenhos do contrato' });
    await expect(list.getByText('Na execução financeira')).toHaveCount(2);
    await expect(list.getByText('Não encontrado nos dados importados')).toBeVisible();
    await expect(list.getByText('Aguardando importação — última importação em 23/10/2026')).toBeVisible();
    await expect(list.getByText('Fora do escopo da importação financeira')).toHaveCount(2);
    await expect(list.getByText('Execução financeira: R$ 310,00')).toBeVisible();
  });

  test('empenho fora do escopo do usuário não vira link', async ({ page }) => {
    await mockContract(page);
    await page.goto(`/contratos/${externalId}`);
    const list = section(page).getByRole('region', { name: 'Tabela: empenhos do contrato' });
    await expect(list.getByRole('link', { name: '2026NE000001' })).toHaveAttribute('href', '/financeiro/empenhos/501');
    await expect(list.getByText('2024NE000002')).toBeVisible();
    await expect(list.getByRole('link', { name: '2024NE000002' })).toHaveCount(0);
  });

  test('filtra a lista por campus', async ({ page }) => {
    await mockContract(page);
    await page.goto(`/contratos/${externalId}`);
    const area = section(page);
    await area.getByLabel('Campus', { exact: true }).selectOption({ label: 'CAMPUS A' });
    const rows = area.getByRole('region', { name: 'Tabela: empenhos do contrato' }).getByRole('row');
    await expect(rows).toHaveCount(3); // header + 2
    await expect(rows.filter({ hasText: '2026NE000003' })).toHaveCount(0);
  });

  test('contrato sem empenhos não inventa totais', async ({ page }) => {
    await mockContract(page, { commitmentsPart: state('commitments', 'AVAILABLE', 0), body: () => [noCommitments, 200] });
    await page.goto(`/contratos/${externalId}`);
    const area = section(page);
    await expect(area.getByText('O Contratos.gov.br não informa empenhos para este contrato.')).toBeVisible();
    await expect(area.getByText('R$ 0,00')).toHaveCount(0);
    await expect(area.getByText('SALDO DO CONTRATO')).toHaveCount(0);
  });

  test('valor ausente aparece como Não informado', async ({ page }) => {
    await mockContract(page);
    await page.goto(`/contratos/${externalId}`);
    const campuses = section(page).getByRole('region', { name: 'Tabela: empenhos por campus' });
    await expect(campuses.getByRole('row', { name: /REITORIA/ })).toContainText('Não informado');
    await expect(campuses.getByRole('row', { name: /Total do contrato/ })).toContainText('Não informado');
  });

  test('falha ao carregar empenhos oferece nova tentativa', async ({ page }) => {
    let fail = true;
    await mockContract(page, { body: () => (fail ? [{ message: 'Empenhos indisponíveis no teste' }, 503] : [commitments, 200]) });
    await page.goto(`/contratos/${externalId}`);
    const area = section(page);
    await expect(area.getByText('Empenhos indisponíveis no teste')).toBeVisible();
    fail = false;
    await area.getByRole('button', { name: /Tentar novamente/i }).click();
    await expect(area.getByText('R$ 510,00')).toBeVisible();
  });

  for (const width of [360, 390]) {
    test(`cabe em ${width}px sem rolagem horizontal da página`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockContract(page);
      await page.goto(`/contratos/${externalId}`);
      await expect(section(page).getByText('R$ 510,00')).toBeVisible();
      await expect(section(page).getByLabel('Campus', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});

const commitmentId = '501';
const financeCommitment = {
  id: commitmentId, source: 'TRANSPARENCY_PORTAL', documentCode: '158345264212026NE000001', resumedCode: '2026NE000001',
  headerAvailable: true, fiscalYear: 2026, managementCode: '26421', managementUnitCode: '158345', unitName: 'CAMPUS A',
  emissionDate: '2026-03-10', favoredCode: '08273364000157', favoredName: 'Fornecedor de teste', processNumber: '23243.000390/2017-17',
  expenseNature: '339039', itemCount: 0, historyCount: 0, liquidationCount: 0, paymentCount: 0, committedValue: '310.000000',
  liquidatedValue: '0', liquidationPriorYearMovementValue: '0', paidValue: '0', priorYearPaidValue: '0',
  header: { type: 'Ordinário', documentTypeCode: null, documentType: null, budgetPlanCode: null, budgetPlanName: null, observation: null,
    originalValue: '310.000000', valueBrl: '310.000000', conversionRate: null, ingestionRunId: '1', updatedAt: '2026-10-23T10:00:00.000Z' },
};
const listing = (extra: Record<string, unknown> = {}) => ({
  externalId, number: '00004/2017', supplierName: 'Fornecedor de teste', supplierDocument: '08273364000157', uasg: '158148',
  unitName: 'Reitoria', ...extra,
});

async function mockCommitment(page: Page, contracts: () => [unknown, number]) {
  await page.route('**/api/finance/**', route => {
    const path = new URL(route.request().url()).pathname;
    return json(route, path.endsWith(`/commitments/${commitmentId}`) ? financeCommitment : { data: [], total: 0, page: 1, limit: 20 });
  });
  await page.route(`**/api/contracts/by-commitment/${commitmentId}`, route => {
    const [body, status] = contracts();
    return json(route, body, status);
  });
}

const contractBlock = (page: Page) => page.getByRole('region', { name: 'Contrato', exact: true });

test.describe('contrato do empenho', () => {
  test('empenho mostra o contrato que o lista', async ({ page }) => {
    await mockCommitment(page, () => [{ contracts: [listing()] }, 200]);
    await page.goto(`/financeiro/empenhos/${commitmentId}`);
    const block = contractBlock(page);
    await expect(block.getByRole('link', { name: '00004/2017' })).toHaveAttribute('href', `/contratos/${externalId}`);
    await expect(block.getByText('Fornecedor de teste')).toBeVisible();
    await expect(block.getByText('08.273.364/0001-57')).toBeVisible();
    await expect(block.getByText('Informado pelo Contratos.gov.br')).toBeVisible();
  });

  test('contrato fora do escopo aparece sem link', async ({ page }) => {
    await mockCommitment(page, () => [{ contracts: [listing({ externalId: null })] }, 200]);
    await page.goto(`/financeiro/empenhos/${commitmentId}`);
    const block = contractBlock(page);
    await expect(block.getByText('00004/2017')).toBeVisible();
    await expect(block.getByRole('link', { name: '00004/2017' })).toHaveCount(0);
  });

  test('empenho sem contrato informa que não há contrato identificado', async ({ page }) => {
    await mockCommitment(page, () => [{ contracts: [] }, 200]);
    await page.goto(`/financeiro/empenhos/${commitmentId}`);
    await expect(contractBlock(page).getByText('Sem contrato identificado.')).toBeVisible();
  });

  test('falha no bloco de contrato não derruba a página do empenho', async ({ page }) => {
    let fail = true;
    await mockCommitment(page, () => (fail ? [{ message: 'Contratos indisponíveis no teste' }, 503] : [{ contracts: [listing()] }, 200]));
    await page.goto(`/financeiro/empenhos/${commitmentId}`);
    await expect(page.getByRole('heading', { name: '2026NE000001', level: 1 })).toBeVisible();
    const block = contractBlock(page);
    await expect(block.getByText('Contratos indisponíveis no teste')).toBeVisible();
    fail = false;
    await block.getByRole('button', { name: /Tentar novamente/i }).click();
    await expect(block.getByRole('link', { name: '00004/2017' })).toBeVisible();
  });
});

test('bloco de contrato do empenho cabe em 360px sem rolagem horizontal da página', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await mockCommitment(page, () => [{ contracts: [listing({ supplierName: 'Fornecedor com razão social bastante longa para quebrar a linha em telas estreitas' })] }, 200]);
  await page.goto(`/financeiro/empenhos/${commitmentId}`);
  await expect(contractBlock(page).getByRole('link', { name: '00004/2017' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
