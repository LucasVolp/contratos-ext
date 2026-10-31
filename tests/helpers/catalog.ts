import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const requireApi = createRequire(resolve(process.cwd(), 'apps/api/package.json'));
const { Client } = requireApi('pg');
export const supplierA = '11222333000181';
export const supplierB = '12ABC34501DE35';
export async function catalogFixture() {
  const db = new Client({ connectionString: process.env.E2E_DATABASE_URL || 'postgresql://contracts:contracts_local@localhost:5540/contracts' });
  await db.connect();
  const purchaseId = randomUUID(), nonSrpId = randomUUID(), recordId = randomUUID(), decoyId = randomUUID();
  const key = `CAT-${Date.now()}`;
  const externalId = `${key}-COMPRA`, pncpId = `${key}-PNCP`;
  const raw = { idCompra: externalId, numeroControlePNCP: pncpId, numeroCompra: key, anoCompraPncp: 2025, codigoModalidade: 5, modalidadeNome: 'Pregão', srp: true, unidadeOrgaoCodigoUnidade: '999996', orgaoEntidadeCnpj: supplierA, processo: 'CAT-PROC-2025' };
  const items = [{ externalId: `${externalId}-1`, number: '1', description: 'Papel de teste do catálogo', unit: 'UN', quantity: '2', estimatedUnitPrice: '1.5', estimatedTotal: '3', status: 'Resultado informado', results: [
    { externalId: 'result-A', supplierDocument: supplierA, supplierName: 'Fornecedor A do catálogo', quantity: '1', unitPrice: '0.123456', totalValue: '0.123456', status: 'Informado', cancelled: false, cancelledAt: null, resultDate: '2025-12-15' },
    { externalId: 'result-B', supplierDocument: supplierB, supplierName: 'Fornecedor B do catálogo', quantity: '1', unitPrice: '2', totalValue: '2', status: 'Informado', cancelled: false, cancelledAt: null, resultDate: '2025-12-15' },
    { externalId: 'result-cancelled', supplierDocument: '52998224725', supplierName: 'Fornecedor com resultado cancelado', quantity: '1', unitPrice: '2', totalValue: '2', status: 'Cancelado', cancelled: true, cancelledAt: '2025-12-20', resultDate: '2025-12-15' },
  ] }];
  const insertPurchase = async (id: string, external: string, number: string, srp: boolean, snapshot: unknown) => db.query(`INSERT INTO "PublicPurchase" (id,"externalId","pncpId",number,year,uasg,"unitName",object,status,srp,"processNumber","organizationName","organizationDocument",city,state,"estimatedValue","awardedValue","publishedAt",summary,snapshot,"detailsSyncedAt","recordsSyncedAt") VALUES ($1,$2,$3,$4,2025,'999996','Unidade de teste',$5,'Divulgada',$6,'CAT-PROC-2025','Organização de teste',$7,'Campo Grande','MS',3,2,'2025-12-01',$8::jsonb,$9::jsonb,NOW(),NOW())`, [id,external,pncpId+(srp?'':'-OUTRA'),number,'Objeto de teste do catálogo',srp,supplierA,JSON.stringify(raw),JSON.stringify(snapshot)]);
  await insertPurchase(purchaseId, externalId, key, true, { items, rawItems: [], rawResults: [] });
  await insertPurchase(nonSrpId, externalId+'-NON-SRP', key+'-SEM-SRP', false, { items: [], rawItems: [], rawResults: [] });
  const recordItems = [
    { key: '1', number: '1', description: 'Papel de teste do catálogo', unit: 'UN', quantity: '1.5', unitPrice: '0.123456', totalValue: '0.185184', brand: 'Marca de teste', model: 'A4', supplierDocument: supplierA, supplierName: 'Fornecedor A do catálogo' },
    { key: '1', number: '1', description: 'Ar Condicionado - Instalação/Montagem/Desmontagem/Remoção - Parede e sistemas', unit: 'UN', quantity: '1', unitPrice: '2', totalValue: '2', brand: 'Marca de teste', model: 'A4', supplierDocument: supplierB, supplierName: 'Fornecedor B do catálogo' },
  ];
  const recordNumber = key+'-ATA';
  const recordSnapshot = { items: recordItems, rawItems: [], processNumber: 'CAT-PROC-2025', organizationDocument: supplierA, city: 'Campo Grande', state: 'MS', modality: 'PREGAO', purchaseSrp: true };
  const insertRecord = async (id: string, number: string, external: string, link: string) => db.query(`INSERT INTO "PublicRecord" (id,"externalId",number,uasg,"unitName","organizationName","purchaseExternalId","purchasePncpId","purchaseNumber","purchaseYear",object,"startDate","endDate","totalValue","itemsCount",situation,summary,snapshot,"detailsSyncedAt") VALUES ($1,$2,$3,'999996','Unidade de teste','Organização de teste',$4,$5,$6,2025,'Ata pública de teste','2026-01-01','2027-01-01',2.185184,1,'Vigente',$7::jsonb,$8::jsonb,NOW())`, [id,external,number,link,link===externalId?pncpId:'OUTRA-PNCP',key,JSON.stringify({ ...raw, numeroAtaRegistroPreco: number, numeroControlePncpAta: external, codigoModalidadeCompra: '05', anoCompra: '2025' }),JSON.stringify(recordSnapshot)]);
  await insertRecord(recordId,recordNumber,key+'-ATA-PNCP',externalId);
  await insertRecord(decoyId,key+'-ATA-OUTRA',key+'-ATA-OUTRA-PNCP','OUTRA-COMPRA');
  return { purchaseId,nonSrpId,recordId,decoyId,key,recordNumber,
    async cleanup() {
      await db.query('DELETE FROM "PriceRecord" WHERE "sourcePublicRecordId"=ANY($1::uuid[])',[[recordId,decoyId]]);
      await db.query('DELETE FROM "PublicRecord" WHERE id=ANY($1::uuid[])',[[recordId,decoyId]]);
      await db.query('DELETE FROM "PublicPurchase" WHERE id=ANY($1::uuid[])',[[purchaseId,nonSrpId]]);
      await db.end();
    }
  };
}
