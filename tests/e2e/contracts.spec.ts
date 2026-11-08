import { test, expect, type Page, type Route } from '@playwright/test';

// Every contract endpoint is mocked: the replica is filled by the daily ETL, never by the UI.
const externalId = '13847';
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const summary = {
  externalId, number: '00004/2017', object: 'Gestão de frota', supplierName: 'Fornecedor de teste',
  supplierDocument: '08273364000157', uasg: '158148', unitName: 'Reitoria',
  startDate: '2017-02-01', endDate: '2023-01-31', globalValue: '682318.130000', status: 'EXPIRED',
};
const person = {
  ...summary, externalId: '13900', number: '00010/2024', object: 'Serviço de manutenção predial',
  supplierName: 'Joana da Silva', supplierDocument: '***.456.789-**', startDate: null, endDate: null,
  globalValue: '1200.000000', status: 'UNKNOWN',
};
const stats = { count: 2, totalValue: '683518.13', expiringCount: 0, vigency: { active: 0, expiring: 0, ended: 1, upcoming: 0, unknown: 1, activeValue: null } };
const neverRun = 'Os contratos ainda não foram carregados. A sincronização diária com o Contratos.gov.br ainda não foi executada.';
const completed = { lastCompletedAt: '2026-11-07T06:42:00.000Z', running: false, staleUnits: [] };
const list = (data: unknown[], sync: unknown = completed) => ({ data, total: data.length, page: 1, limit: 12, stats: { ...stats, count: data.length }, sync });

const detail = {
  ...summary, originUnitCode: '158148', typeName: 'Contrato', category: 'Serviços', processNumber: '23243.000390/2017-17',
  modality: 'Pregão', sourceStatus: 'Ativo', signatureDate: '2017-01-26', initialValue: '545854.000000',
  accumulatedValue: null, installmentCount: 12, capturedAt: '2026-11-06T10:00:00.000Z', normalizedAt: '2026-11-06T10:00:05.000Z',
};
const available = (part: string, rowCount = 1) => ({ part, status: 'AVAILABLE', capturedAt: '2026-11-06T10:00:00.000Z', lastAttemptAt: '2026-11-06T10:00:00.000Z', rowCount });
const allParts = ['header', 'history', 'items', 'invoices', 'guarantees', 'responsibles', 'files'];
const noNotes = { text: '', updatedAt: null, updatedBy: null };
const page1 = (data: unknown[]) => ({ data, total: data.length, page: 1, limit: 20 });

async function mockList(page: Page, body: unknown, seen: URL[] = []) {
  await page.route(url => url.pathname === '/api/contracts', route => {
    seen.push(new URL(route.request().url()));
    return json(route, body);
  });
}

async function mockDetail(page: Page, options: { contract?: unknown; parts?: unknown[]; notes?: unknown; rows?: Record<string, unknown[]> } = {}) {
  await page.route(`**/api/contracts/${externalId}`, route =>
    json(route, { contract: options.contract ?? detail, parts: options.parts ?? allParts.map(p => available(p)), notes: options.notes ?? noNotes }));
  await page.route(`**/api/contracts/${externalId}/source/*`, route => {
    const part = new URL(route.request().url()).pathname.split('/').pop()!;
    return json(route, page1(options.rows?.[part] ?? []));
  });
}

test.describe('lista de contratos', () => {
  test('mostra contratos da réplica com origem, data e CPF mascarado, sem importar ou cadastrar', async ({ page }) => {
    await mockList(page, list([summary, person]));
    await page.goto('/contratos');
    await expect(page.getByText('Dados do Contratos.gov.br · atualizados em 07/11/2026 03:42')).toBeVisible();
    await expect(page.getByRole('link', { name: '00004/2017', exact: true })).toHaveAttribute('href', `/contratos/${externalId}`);
    await expect(page.getByText('08.273.364/0001-57')).toBeVisible();
    await expect(page.getByText('***.456.789-**')).toBeVisible();
    await expect(page.getByText('Vigência não informada')).toBeVisible();
    await expect(page.getByText('R$ 682.318,13')).toBeVisible();
    await expect(page.getByRole('link', { name: /Importar/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Novo contrato/ })).toHaveCount(0);
  });

  test('primeira atualização em andamento substitui o estado vazio genérico', async ({ page }) => {
    await mockList(page, list([], { lastCompletedAt: null, running: true, staleUnits: [] }));
    await page.goto('/contratos');
    await expect(page.getByText('A primeira atualização dos contratos está em andamento. Os contratos aparecem conforme cada UASG é concluída.')).toHaveCount(1);
    await expect(page.getByText('Contratos em atualização')).toBeVisible();
    await expect(page.getByText(neverRun)).toHaveCount(0);
    await expect(page.getByText('Nenhum contrato corresponde aos filtros.')).toHaveCount(0);
    await expect(page.getByText('Nenhum registro encontrado.')).toHaveCount(0);
  });

  test('sem execução concluída nem em andamento informa que a sincronização ainda não foi executada', async ({ page }) => {
    await mockList(page, list([], { lastCompletedAt: null, running: false, staleUnits: [] }));
    await page.goto('/contratos');
    await expect(page.getByText(neverRun)).toHaveCount(1);
    await expect(page.getByText(neverRun)).toBeVisible();
    await expect(page.getByText(/primeira atualização/)).toHaveCount(0);
    await expect(page.getByText('Contratos em atualização')).toHaveCount(0);
    await expect(page.getByText('Nenhum contrato encontrado.')).toHaveCount(0);
  });

  test('busca sem resultado informa que nenhum contrato corresponde aos filtros', async ({ page }) => {
    const seen: URL[] = [];
    await page.route(url => url.pathname === '/api/contracts', route => {
      const url = new URL(route.request().url());
      seen.push(url);
      return json(route, list(url.searchParams.get('search') ? [] : [summary]));
    });
    await page.goto('/contratos');
    await expect(page.getByRole('link', { name: '00004/2017', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Buscar contratos' }).fill('inexistente');
    await expect(page.getByText('Nenhum contrato corresponde aos filtros.')).toBeVisible();
    expect(seen.some(url => url.searchParams.get('search') === 'inexistente')).toBe(true);
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page.getByRole('link', { name: '00004/2017', exact: true })).toBeVisible();
  });

  test('UASG sem atualização na última execução é nomeada com a data dos últimos dados', async ({ page }) => {
    await mockList(page, list([summary], { ...completed, staleUnits: [
      { uasg: '158148', name: 'Reitoria', lastGoodAt: '2026-11-05T06:30:00.000Z' },
      { uasg: '158999', name: 'Campus Novo', lastGoodAt: null },
    ] }));
    await page.goto('/contratos');
    await expect(page.getByText('Não foi possível atualizar Reitoria (158148) na última execução. Dados de 05/11/2026 03:30.')).toBeVisible();
    await expect(page.getByText('Campus Novo (158999) ainda não tem dados do Contratos.gov.br.')).toBeVisible();
    // A unit never captured is not reported as a failure.
    await expect(page.getByText(/Não foi possível atualizar Campus Novo/)).toHaveCount(0);
  });

  test('falha ao listar oferece nova tentativa', async ({ page }) => {
    let fail = true;
    await page.route(url => url.pathname === '/api/contracts', route =>
      fail ? json(route, { message: 'Lista indisponível no teste' }, 503) : json(route, list([summary])));
    await page.goto('/contratos');
    await expect(page.getByText('Lista indisponível no teste')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: /Tentar novamente/i }).click();
    await expect(page.getByRole('link', { name: '00004/2017', exact: true })).toBeVisible();
  });
});

test.describe('ficha do contrato', () => {
  test('cabeçalho somente leitura com origem, data de captura e partes da fonte', async ({ page }) => {
    await mockDetail(page, { rows: {
      history: [{ externalId: '48748', number: '00002/2019', typeName: 'Termo Aditivo', qualifications: ['INFORMATIVO', 'VIGÊNCIA'], observation: 'Prorrogação por 12 meses', signatureDate: '2019-01-31', publicationDate: null, startDate: '2019-02-01', endDate: '2020-01-31', initialValue: null, globalValue: '545854.500000', newGlobalValue: '682318.130000', contractStatus: 'Ativo' }],
      items: [{ externalId: '634291', purchaseItemNumber: '00003', itemType: 'Serviço', catalogItem: 'Gerenciamento de frota', description: null, quantity: '750.625000', unitValue: '1.000000', totalValue: '6755.630000', startDate: '2021-04-19' }],
      files: [{ externalId: '9', description: 'Contrato assinado', fileType: 'Contrato', origin: 'SEI', url: 'https://contratos.example/arquivo.pdf', seiLink: null }],
    } });
    await page.goto(`/contratos/${externalId}`);
    await expect(page.getByRole('heading', { name: '00004/2017', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Gestão de frota' })).toBeVisible();
    await expect(page.getByText('23243.000390/2017-17')).toBeVisible();
    await expect(page.getByText('08.273.364/0001-57')).toBeVisible();
    await expect(page.getByText('01/02/2017 a 31/01/2023')).toBeVisible();
    await expect(page.getByText('Capturado em 06/11/2026 07:00')).toBeVisible();
    await expect(page.getByRole('link', { name: /Editar contrato/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Excluir/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Termos e aditivos' })).toBeVisible();
    await expect(page.getByText('INFORMATIVO, VIGÊNCIA')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Itens', exact: true }).getByText('750,625')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contrato assinado (abre em nova aba)' })).toHaveAttribute('target', '_blank');
  });

  test('salva observações internas e mostra quem salvou e quando', async ({ page }) => {
    await mockDetail(page, { notes: { text: 'Fiscal substituído em outubro.', updatedAt: '2026-11-01T13:00:00.000Z', updatedBy: 'Carlos Fiscal' } });
    let sent: unknown;
    await page.route(`**/api/contracts/${externalId}/notes`, route => {
      sent = route.request().postDataJSON();
      return json(route, { text: 'Garantia renovada até 2027.', updatedAt: '2026-11-07T13:15:00.000Z', updatedBy: 'Maria Gestora' });
    });
    await page.goto(`/contratos/${externalId}`);
    await expect(page.getByRole('heading', { name: 'Observações internas' })).toBeVisible();
    await expect(page.getByText('Informações da equipe que não constam no Contratos.gov.br. A atualização diária não altera este campo.')).toBeVisible();
    await expect(page.getByText('Salvo por Carlos Fiscal em 01/11/2026 10:00')).toBeVisible();
    const notes = page.getByRole('textbox', { name: 'Observações internas' });
    await expect(notes).toHaveValue('Fiscal substituído em outubro.');
    await notes.fill('Garantia renovada até 2027.');
    await page.getByRole('button', { name: 'Salvar observações' }).click();
    await expect(page.getByText('Salvo por Maria Gestora em 07/11/2026 10:15')).toBeVisible();
    expect(sent).toEqual({ notes: 'Garantia renovada até 2027.' });
  });

  test('texto digitado durante o salvamento não é perdido', async ({ page }) => {
    await mockDetail(page);
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/contracts/${externalId}/notes`, async route => {
      const sent = route.request().postDataJSON() as { notes: string };
      await held;
      return json(route, { text: sent.notes.trim(), updatedAt: '2026-11-07T13:15:00.000Z', updatedBy: 'Maria Gestora' });
    });
    await page.goto(`/contratos/${externalId}`);
    const notes = page.getByRole('textbox', { name: 'Observações internas' });
    await notes.fill('Primeira parte.');
    await page.getByRole('button', { name: 'Salvar observações' }).click();
    await expect(page.getByText('Salvando…')).toBeVisible();
    await notes.press('End');
    await notes.pressSequentially(' Segunda parte.');
    release();
    await expect(page.getByText('Salvo por Maria Gestora em 07/11/2026 10:15')).toBeVisible();
    await expect(notes).toHaveValue('Primeira parte. Segunda parte.');
  });

  test('falha ao salvar observações mantém o texto e oferece nova tentativa', async ({ page }) => {
    await mockDetail(page);
    let fail = true;
    await page.route(`**/api/contracts/${externalId}/notes`, route => fail
      ? json(route, { message: 'Serviço indisponível no teste' }, 503)
      : json(route, { text: 'Nova observação', updatedAt: '2026-11-07T13:15:00.000Z', updatedBy: 'Maria Gestora' }));
    await page.goto(`/contratos/${externalId}`);
    const notes = page.getByRole('textbox', { name: 'Observações internas' });
    await notes.fill('Nova observação');
    await page.getByRole('button', { name: 'Salvar observações' }).click();
    await expect(page.getByText('Serviço indisponível no teste')).toBeVisible();
    await expect(notes).toHaveValue('Nova observação');
    fail = false;
    await page.getByRole('button', { name: /Tentar novamente/i }).click();
    await expect(page.getByText('Salvo por Maria Gestora em 07/11/2026 10:15')).toBeVisible();
  });

  test('observações acima do limite são apontadas antes do envio', async ({ page }) => {
    await mockDetail(page);
    let writes = 0;
    await page.route(`**/api/contracts/${externalId}/notes`, route => { writes++; return json(route, noNotes); });
    await page.goto(`/contratos/${externalId}`);
    const notes = page.getByRole('textbox', { name: 'Observações internas' });
    await notes.fill('a'.repeat(10001));
    await page.getByRole('button', { name: 'Salvar observações' }).click();
    await expect(page.getByText('As observações internas podem ter no máximo 10.000 caracteres.')).toBeVisible();
    await expect(notes).toHaveAttribute('aria-invalid', 'true');
    await expect(notes).toBeFocused();
    expect(writes).toBe(0);
  });

  test('vigência sem datas e contrato ainda sem partes não inventam dados', async ({ page }) => {
    await mockDetail(page, { contract: { ...detail, startDate: null, endDate: null, status: 'UNKNOWN', processNumber: null }, parts: [] });
    await page.goto(`/contratos/${externalId}`);
    await expect(page.getByText('Vigência não informada')).toBeVisible();
    await expect(page.getByText('Os registros deste contrato no Contratos.gov.br ainda não estão disponíveis.')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Observações internas' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Não informada a Não informada');
  });

  test('parte com falha exibe os últimos dados salvos', async ({ page }) => {
    const parts = allParts.map(p => available(p));
    parts[4] = { part: 'guarantees', status: 'FAILED', capturedAt: '2026-11-05T10:00:00.000Z', lastAttemptAt: '2026-11-06T10:00:00.000Z', rowCount: 1 };
    await mockDetail(page, { parts, rows: { guarantees: [{ externalId: '91001', guaranteeType: 'Seguro Garantia', amount: '27292.700000', dueDate: '2023-04-30' }] } });
    await page.goto(`/contratos/${externalId}`);
    const section = page.getByRole('region', { name: 'Garantias', exact: true });
    await expect(section.getByText(/A última consulta falhou em 06\/11\/2026/)).toBeVisible();
    await expect(section.getByText(/exibindo dados de 05\/11\/2026/)).toBeVisible();
    await expect(section.getByText('Seguro Garantia')).toBeVisible();
  });

  test('valores ausentes aparecem como Não informado', async ({ page }) => {
    await mockDetail(page, { rows: {
      items: [{ externalId: '1', purchaseItemNumber: null, itemType: 'Serviço', catalogItem: 'Item sem valores', description: null, quantity: null, unitValue: null, totalValue: null, startDate: null }],
    } });
    await page.goto(`/contratos/${externalId}`);
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
    await mockDetail(page, { parts });
    await page.goto(`/contratos/${externalId}`);
    await expect(page.getByRole('region', { name: 'Gestores e fiscais', exact: true }).getByText('Não consultado')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Faturas', exact: true }).getByText('O Contratos.gov.br não possui registros desta parte.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Garantias', exact: true }).getByText('Nenhum registro informado pela fonte.')).toBeVisible();
  });

  test('falha ao carregar a ficha oferece nova tentativa', async ({ page }) => {
    let fail = true;
    await mockDetail(page);
    await page.route(`**/api/contracts/${externalId}`, route => fail
      ? json(route, { message: 'Contrato temporariamente indisponível no teste' }, 503)
      : json(route, { contract: detail, parts: [], notes: noNotes }));
    await page.goto(`/contratos/${externalId}`);
    await expect(page.getByText('Contrato temporariamente indisponível no teste')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: /Tentar novamente/i }).click();
    await expect(page.getByRole('heading', { name: '00004/2017', level: 1 })).toBeVisible();
  });
});

for (const path of ['/contratos/abc', '/contratos/novo', '/contratos/importar', `/contratos/${externalId}/editar`]) {
  test(`${path} responde com a página não encontrada`, async ({ page }) => {
    // Dynamic routes stream before notFound(), so Next keeps 200 and renders the 404 page.
    await page.goto(path);
    await expect(page.getByText('Este caminho não está no arquivo.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Observações internas' })).toHaveCount(0);
  });
}

for (const width of [360, 390, 1440]) {
  test(`lista e ficha cabem em ${width}px sem rolagem horizontal da página`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockList(page, list([summary, person], { ...completed, staleUnits: [{ uasg: '158148', name: 'Instituto Federal de Educação, Ciência e Tecnologia — Reitoria', lastGoodAt: '2026-11-05T06:30:00.000Z' }] }));
    await page.goto('/contratos');
    await expect(page.getByRole('link', { name: '00004/2017', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await mockDetail(page, { rows: {
      invoices: [{ externalId: '1', number: '28', series: null, invoiceType: 'Prestação de serviços', billingInstrument: 'Nota Fiscal Eletrônica', issueDate: '2026-11-04', dueDate: '2026-11-18', amount: '6100.000000', netAmount: '6100.000000', disallowance: '0.000000', liquidationDate: null, status: 'Pendente', referenceMonth: null, referenceYear: null }],
    } });
    await page.goto(`/contratos/${externalId}`);
    await expect(page.getByRole('heading', { name: 'Faturas' })).toBeVisible();
    await expect(page.getByText('R$ 6.100,00').first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Observações internas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar observações' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
