import {test,expect} from '@playwright/test';
import {catalogFixture,supplierB} from '../helpers/catalog';
let fixture:Awaited<ReturnType<typeof catalogFixture>>, purchase:any, record:any;
test.beforeAll(async({request})=>{fixture=await catalogFixture();purchase=await(await request.get(`/api/purchases/${fixture.purchaseId}`)).json();record=await(await request.get(`/api/public-records/${fixture.recordId}`)).json();});
test.afterAll(async()=>{if(fixture)await fixture.cleanup();});

test('abrir pregão atualiza itens e atas automaticamente sem exigir um clique',async({page})=>{
  let ensure=0;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});
  const fresh={...purchase,items:[{...purchase.items[0],description:'Item atualizado automaticamente'}]};
  await page.route(`**/api/purchases/${fixture.purchaseId}`,route=>route.fulfill({json:{...purchase,items:[],linkedRecords:[]}}));
  await page.route(`**/api/purchases/${fixture.purchaseId}/ensure-details`,async route=>{ensure++;await pending;return route.fulfill({json:{data:fresh,errors:{}}})});
  await page.goto(`/pregoes/${fixture.purchaseId}`);
  try {
    await expect(page.getByText('Atualizando dados públicos automaticamente…',{exact:true})).toBeVisible();
    await expect(page.getByText('Nenhum item informado na última consulta bem sucedida.',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Nenhuma ata publicada encontrada para este pregão.',{exact:true})).toHaveCount(0);
  } finally {release();}
  await expect(page.getByRole('heading',{name:'Item atualizado automaticamente',exact:true})).toBeVisible();
  await expect(page.locator(`a[href="/atas/publicadas/${fixture.recordId}"]`)).toBeVisible();
  expect(ensure).toBe(1);
});

test('ata carrega todos os participantes e saldos, compartilha o item entre fornecedores e permite repetir o lote',async({page})=>{
  let ensures=0,batches=0;const forced:boolean[]=[];
  const supplement=(updated=false)=>({
    units:{status:'loaded',data:[{code:'999996',name:updated?'Campus atualizado em lote':'Campus carregado automaticamente',type:'Participante',supplierDocument:'11222333000181',quantity:'10',adhesionBalance:'5',commitmentBalance:'9.123456',excluded:false}],lastSyncedAt:'2026-10-31T12:00:00Z',error:null},
    commitments:{status:updated?'loaded':'error',data:[{unit:'999996',type:'Participante',quantity:'10',committed:'0.876544',balance:'9.123456'}],lastSyncedAt:'2026-10-31T12:00:00Z',error:updated?null:'Saldos indisponíveis; última consulta preservada.'},
    adhesions:{status:'loaded',data:[],lastSyncedAt:'2026-10-31T12:00:00Z',error:null},
  });
  await page.route(`**/api/public-records/${fixture.recordId}`,route=>route.fulfill({json:{...record,items:[],suppliers:[],detailsSyncedAt:null}}));
  await page.route(`**/api/public-records/${fixture.recordId}/ensure-details`,route=>{ensures++;return route.fulfill({json:{data:record,errors:{}}})});
  await page.route(`**/api/public-records/${fixture.recordId}/supplements/refresh`,route=>{batches++;forced.push(route.request().postDataJSON()?.force===true);const updated=batches>1;return route.fulfill({json:{data:{...record,items:record.items.map((item:any)=>({...item,supplement:supplement(updated)}))},errors:updated?{}:{supplements:'Algumas consultas não puderam ser atualizadas. Os dados anteriores foram preservados.'},summary:{items:1,loaded:updated?1:0,failed:updated?0:1}}})});
  await page.goto(`/atas/publicadas/${fixture.recordId}`);
  await expect(page.getByRole('cell',{name:/^Campus carregado automaticamente/})).toHaveCount(2);
  await expect(page.getByText('9,123456',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('Saldos indisponíveis; última consulta preservada.',{exact:true}).first()).toBeVisible();
  expect(ensures).toBe(1);expect(batches).toBe(1);expect(forced).toEqual([false]);
  await page.getByRole('button',{name:'Atualizar participantes e saldos',exact:true}).click();
  await expect(page.getByRole('cell',{name:/^Campus atualizado em lote/})).toHaveCount(2);
  await expect(page.getByText('Saldos indisponíveis; última consulta preservada.',{exact:true})).toHaveCount(0);
  expect(forced).toEqual([false,true]);
});

test('falha na atualização automática mantém os itens salvos e informa o problema',async({page})=>{
  let ensures=0;
  await page.route(`**/api/purchases/${fixture.purchaseId}/ensure-details`,route=>{ensures++;return route.fulfill({json:{data:purchase,errors:{details:'A fonte pública está indisponível. Os itens salvos foram preservados.'}}})});
  await page.goto(`/pregoes/${fixture.purchaseId}`);
  await expect(page.getByText('A fonte pública está indisponível. Os itens salvos foram preservados.',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Papel de teste do catálogo',exact:true})).toBeVisible();
  expect(ensures).toBe(1);
});

test('preparação carrega automaticamente os fornecedores antes de criar o documento',async({page,request})=>{
  let ensures=0;
  await page.route(`**/api/public-records/${fixture.recordId}`,route=>route.fulfill({json:{...record,items:[],suppliers:[],detailsSyncedAt:null}}));
  await page.route(`**/api/public-records/${fixture.recordId}/ensure-details`,route=>{ensures++;return route.fulfill({json:{data:record,errors:{}}})});
  await page.goto(`/atas/publicadas/${fixture.recordId}/preparar`);
  const supplier=page.getByRole('combobox',{name:/Fornecedor/});
  await expect(supplier).toBeEnabled();
  await expect(supplier.locator('option')).toHaveCount(3);
  await supplier.selectOption(supplierB);
  await page.getByRole('button',{name:'Preparar documento',exact:true}).click();
  await expect(page).toHaveURL(/\/atas\/[0-9a-f-]{36}\/editar$/);
  const id=page.url().split('/').at(-2)!;
  expect((await(await request.get(`/api/records/${id}`)).json()).supplierDocument).toBe(supplierB);
  expect(ensures).toBe(1);
});
