import { test, expect, type Page } from '@playwright/test';

const id = '40000000-0000-4000-8000-000000000101';
const contract = { id, number: '00004/2017', object: 'Gestão de frota', supplierName: 'Fornecedor de teste', supplierDocument: '08273364000157', uasg: '158148', unitName: 'Reitoria', startDate: '2017-02-01', endDate: '2023-01-31', initialValue: '545854.00', globalValue: '682318.13', status: 'EXPIRED', source: 'COMPRAS_GOV', lastSyncedAt: '2026-10-30T12:30:00.000Z' };
const available = (part: string, rowCount = 1) => ({ part, status: 'AVAILABLE', capturedAt: '2026-11-06T10:00:00.000Z', lastAttemptAt: '2026-11-06T10:00:00.000Z', rowCount });
const resolved = (parts: unknown[]) => ({
  resolution: 'RESOLVED', candidateCount: 1, parts,
  source: { externalId: '13847', number: '00004/2017', managingUnitCode: '158148', originUnitCode: '158148', typeName: 'Contrato', category: 'Serviços', processNumber: '23243.000390/2017-17', object: 'Gestão de frota', modality: 'Pregão', status: 'Ativo', supplierName: 'Fornecedor de teste', supplierDocument: '08273364000157', signatureDate: '2017-01-26', startDate: '2017-02-01', endDate: '2023-01-31', initialValue: '545854.000000', globalValue: '682318.130000', accumulatedValue: null, installmentCount: 12, capturedAt: '2026-11-06T10:00:00.000Z', normalizedAt: '2026-11-06T10:00:05.000Z' },
});
const page1 = (data: unknown[]) => ({ data, total: data.length, page: 1, limit: 20 });

async function mock(page: Page, summary: unknown, parts: Record<string, unknown[]> = {}) {
  await page.route(`**/api/contracts/${id}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) }));
  await page.route(`**/api/contracts/${id}/source`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) }));
  await page.route(`**/api/contracts/${id}/source/*`, route => {
    const part = new URL(route.request().url()).pathname.split('/').pop()!;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(page1(parts[part] ?? [])) });
  });
}

const allParts = ['header', 'history', 'items', 'invoices', 'guarantees', 'responsibles', 'files'];

test('contrato vinculado mostra termos, itens e atualização da fonte', async ({ page }) => {
  await mock(page, resolved(allParts.map(p => available(p))), {
    history: [{ externalId: '48748', number: '00002/2019', typeName: 'Termo Aditivo', qualifications: ['INFORMATIVO', 'VIGÊNCIA'], observation: 'Prorrogação por 12 meses', signatureDate: '2019-01-31', publicationDate: null, startDate: '2019-02-01', endDate: '2020-01-31', initialValue: null, globalValue: '545854.500000', newGlobalValue: '682318.130000', contractStatus: 'Ativo' }],
    items: [{ externalId: '634291', purchaseItemNumber: '00003', itemType: 'Serviço', catalogItem: 'Gerenciamento de frota', description: null, quantity: '750.625000', unitValue: '1.000000', totalValue: '6755.630000', startDate: '2021-04-19' }],
  });
  await page.goto(`/contratos/${id}`);
  await expect(page.getByRole('heading', { name: 'Dados do Contratos.gov.br' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Termos e aditivos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Itens' })).toBeVisible();
  await expect(page.getByText('R$ 682.318,13').first()).toBeVisible();
  await expect(page.getByText('INFORMATIVO, VIGÊNCIA')).toBeVisible();
  await expect(page.getByText(/Atualizado em 06\/11\/2026/).first()).toBeVisible();
});

test('parte com falha exibe os últimos dados salvos', async ({ page }) => {
  const parts = allParts.map(p => available(p));
  parts[4] = { part: 'guarantees', status: 'FAILED', capturedAt: '2026-11-05T10:00:00.000Z', lastAttemptAt: '2026-11-06T10:00:00.000Z', rowCount: 1 };
  await mock(page, resolved(parts), { guarantees: [{ externalId: '91001', guaranteeType: 'Seguro Garantia', amount: '27292.700000', dueDate: '2023-04-30' }] });
  await page.goto(`/contratos/${id}`);
  const section = page.getByRole('region', { name: 'Garantias', exact: true });
  await expect(section.getByText(/A última consulta falhou em 06\/11\/2026/)).toBeVisible();
  await expect(section.getByText(/exibindo dados de 05\/11\/2026/)).toBeVisible();
  await expect(section.getByText('Seguro Garantia')).toBeVisible();
});

test('valores ausentes aparecem como Não informado', async ({ page }) => {
  await mock(page, resolved(allParts.map(p => available(p))), {
    items: [{ externalId: '1', purchaseItemNumber: null, itemType: 'Serviço', catalogItem: 'Item sem valores', description: null, quantity: null, unitValue: null, totalValue: null, startDate: null }],
  });
  await page.goto(`/contratos/${id}`);
  const section = page.getByRole('region', { name: 'Itens', exact: true });
  await expect(section.getByText('Item sem valores')).toBeVisible();
  await expect(section.getByText('Não informado').first()).toBeVisible();
  await expect(section).not.toContainText('Invalid Date');
  await expect(section).not.toContainText('R$ 0,00');
  await expect(section).not.toContainText('NaN');
});

test('parte nunca consultada e parte sem registros na fonte são distintas', async ({ page }) => {
  const parts = allParts.map(p => available(p, 0));
  parts[5] = { part: 'responsibles', status: 'MISSING', capturedAt: null, lastAttemptAt: null, rowCount: 0 };
  parts[3] = { part: 'invoices', status: 'NOT_FOUND', capturedAt: null, lastAttemptAt: '2026-11-06T10:00:00.000Z', rowCount: 0 };
  await mock(page, resolved(parts));
  await page.goto(`/contratos/${id}`);
  await expect(page.getByRole('region', { name: 'Gestores e fiscais', exact: true }).getByText('Não consultado')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Faturas', exact: true }).getByText('O Contratos.gov.br não possui registros desta parte.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Garantias', exact: true }).getByText('Nenhum registro informado pela fonte.')).toBeVisible();
});

test('contrato sem correspondência informa ausência sem tabelas', async ({ page }) => {
  await mock(page, { resolution: 'NOT_FOUND', candidateCount: 0, source: null, parts: [] });
  await page.goto(`/contratos/${id}`);
  await expect(page.getByText('Este contrato ainda não foi encontrado nos dados do Contratos.gov.br para a UASG informada.')).toBeVisible();
  await expect(page.locator('table')).toHaveCount(0);
});

test('vinculação ambígua pede revisão', async ({ page }) => {
  await mock(page, { resolution: 'AMBIGUOUS', candidateCount: 2, source: null, parts: [] });
  await page.goto(`/contratos/${id}`);
  await expect(page.getByText('Há 2 contratos com este número e UASG no Contratos.gov.br. A vinculação precisa de revisão.')).toBeVisible();
});

test('falha ao consultar os dados da fonte oferece nova tentativa', async ({ page }) => {
  let fail = true;
  await mock(page, resolved([]));
  await page.route(`**/api/contracts/${id}/source`, route => fail
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Serviço indisponível no teste' }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resolution: 'NOT_FOUND', candidateCount: 0, source: null, parts: [] }) }));
  await page.goto(`/contratos/${id}`);
  await expect(page.getByText('Serviço indisponível no teste')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: /Tentar novamente/i }).click();
  await expect(page.getByText(/ainda não foi encontrado nos dados do Contratos.gov.br/)).toBeVisible();
});

for (const width of [360, 390, 1440]) {
  test(`seções cabem em ${width}px sem rolagem horizontal da página`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mock(page, resolved(allParts.map(p => available(p))), {
      invoices: [{ externalId: '1', number: '28', series: null, invoiceType: 'Prestação de serviços', billingInstrument: 'Nota Fiscal Eletrônica', issueDate: '2026-11-04', dueDate: '2026-11-18', amount: '6100.000000', netAmount: '6100.000000', disallowance: '0.000000', liquidationDate: null, status: 'Pendente', referenceMonth: null, referenceYear: null }],
    });
    await page.goto(`/contratos/${id}`);
    await expect(page.getByRole('heading', { name: 'Faturas' })).toBeVisible();
    await expect(page.getByText('R$ 6.100,00').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
