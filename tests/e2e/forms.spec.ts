import { test, expect } from '@playwright/test';

test('cadastro e edição de contrato pela interface aceitam valores brasileiros', async ({ page, request }) => {
  const number = `FORM-${Date.now()}`;
  let id = '';
  try {
    await page.goto('/contratos/novo');
    await page.locator('[name="number"]').fill(number);
    await page.locator('[name="uasg"]').fill('999998');
    await page.locator('[name="object"]').fill('Contrato cadastrado pelo fluxo visual');
    await page.locator('[name="supplierName"]').fill('Empresa de verificação visual');
    await page.locator('[name="supplierDocument"]').fill('12345678000190');
    await page.locator('[name="startDate"]').fill('2026-01-01');
    await page.locator('[name="endDate"]').fill('2027-01-01');
    await page.locator('[name="initialValue"]').fill('1.250,10');
    await page.locator('[name="globalValue"]').fill('1.250,10');
    await page.getByRole('button', { name: 'Salvar contrato', exact: true }).click();
    await expect(page).toHaveURL(/\/contratos\/[0-9a-f-]{36}$/);
    id = page.url().split('/').pop()!;
    expect((await (await request.get(`/api/contracts/${id}`)).json()).globalValue).toBe('1250.1');
    await page.getByRole('link', { name: 'Editar contrato', exact: true }).click();
    await page.locator('[name="globalValue"]').fill('1.300,50');
    await page.getByRole('button', { name: 'Salvar contrato', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/contratos/${id}$`));
    expect((await (await request.get(`/api/contracts/${id}`)).json()).globalValue).toBe('1300.5');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Excluir contrato', exact: true }).click();
    await expect(page).toHaveURL(/\/contratos$/);
    expect((await request.get(`/api/contracts/${id}`)).status()).toBe(404);
  } finally { if (id) await request.delete(`/api/contracts/${id}`); }
});

test('rascunho de ata com itens é preenchido e liberado para exportação pela interface', async ({ page, request }) => {
  const number = `FORM-ATA-${Date.now()}`;
  let id = '';
  try {
    await page.goto('/atas/nova');
    await page.locator('[name="number"]').fill(number);
    await page.locator('[name="uasg"]').fill('999998');
    await page.locator('[name="object"]').fill('Ata criada pelo editor visual');
    await page.getByRole('button', { name: /Adicionar item/i }).click();
    await page.locator('[name="item-0-description"]').fill('Material para validação de formulário');
    await page.locator('[name="item-0-unit"]').fill('UN');
    await page.locator('[name="item-0-quantity"]').fill('1,50');
    await page.locator('[name="item-0-unitPrice"]').fill('2,00');
    await page.getByRole('button', { name: 'Salvar ata', exact: true }).click();
    await expect(page).toHaveURL(/\/atas\/[0-9a-f-]{36}$/);
    id = page.url().split('/').pop()!;
    expect((await (await request.get(`/api/records/${id}`)).json()).totalValue).toBe('3');
    await expect(page.getByRole('button', { name: 'Baixar DOCX' })).toBeDisabled();
    await page.getByRole('link', { name: 'Editar ata', exact: true }).click();
    const fields: Record<string, string> = {
      processNumber: 'PROC-2026', purchaseNumber: '90001', purchaseYear: '2026',
      organizationName: 'Organização de verificação', organizationDocument: '12345678000190',
      organizationStreet: 'Rua dos Testes', organizationCity: 'Campo Grande', organizationState: 'MS',
      authorityName: 'Maria Exemplo', authorityRole: 'Diretora',
      supplierName: 'Empresa de verificação', supplierDocument: '98765432000190',
    };
    for (const [key, value] of Object.entries(fields)) await page.locator(`[name="${key}"]`).fill(value);
    await page.getByRole('button', { name: 'Salvar ata', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/atas/${id}$`));
    await expect(page.getByRole('button', { name: 'Baixar DOCX' })).toBeEnabled();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar DOCX' }).click();
    expect((await downloadEvent).suggestedFilename()).toMatch(/\.docx$/);
  } finally { if (id) await request.delete(`/api/records/${id}`); }
});
