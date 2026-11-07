import "../src/env";
import { Database } from "../src/database";
import { Repositories } from "../src/repositories";
import { validateRecord } from "../src/domain";
import { seedInstitutions } from "./institutions";
const db = new Database();
const repos = new Repositories(db);
function day(offset: number) {
  const result = new Date();
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}
// Demo contracts are replica rows, as if the daily sync had captured them. The
// demo unit 999999 is registered so the contract list shows them; external ids
// stay far from real Contratos.gov.br ids.
const DEMO_UASG = "999999";
const PARTS = ["header", "history", "commitments", "guarantees", "responsibles", "items", "invoices", "files"];
async function seed() {
  const samples = [
    {
      externalId: "9990000001",
      number: "DEMO-001",
      object: "Aquisição de equipamentos de informática",
      supplierName: "Tecnologia Exemplo Ltda.",
      startDate: day(-90),
      endDate: day(180),
      globalValue: "187500.00",
    },
    {
      externalId: "9990000002",
      number: "DEMO-002",
      object: "Serviços de manutenção predial",
      supplierName: "Serviços de Demonstração Ltda.",
      startDate: day(-340),
      endDate: day(15),
      globalValue: "42500.50",
    },
    {
      externalId: "9990000003",
      number: "DEMO-003",
      object: "Fornecimento de materiais de escritório",
      supplierName: "Papelaria Exemplo Ltda.",
      startDate: day(-400),
      endDate: day(-10),
      globalValue: "12500.00",
    },
    {
      externalId: "9990000004",
      number: "DEMO-004",
      object: "Instalação de rede de dados",
      supplierName: "Redes de Demonstração Ltda.",
      startDate: day(20),
      endDate: day(380),
      globalValue: "65000.00",
    },
  ];
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO "Institution" (id, name, uasg, organization, "updatedAt")
       VALUES (gen_random_uuid(), 'Unidade de demonstração', $1, 'Demonstração', now())
       ON CONFLICT (uasg) DO NOTHING`,
      [DEMO_UASG],
    );
    for (const sample of samples) {
      await tx.query(
        `INSERT INTO public_sources.contracts (source, external_id, number, managing_unit_code, supplier_document, supplier_name,
           object, start_date, end_date, initial_value, global_value, header_resource, captured_at, source_data)
         VALUES ('CONTRATOS_GOV_BR', $1::bigint, $2, $3, '11222333000181', $4, $5, $6::date, $7::date, $8::numeric, $8::numeric,
           'contracts_active_by_unit', now(), '{"demo": true}')
         ON CONFLICT DO NOTHING`,
        [sample.externalId, sample.number, DEMO_UASG, sample.supplierName, sample.object, sample.startDate, sample.endDate, sample.globalValue],
      );
      await tx.query(
        `INSERT INTO public_sources.contract_parts (source, contract_external_id, part, status, captured_at, last_attempt_at, row_count)
         SELECT 'CONTRATOS_GOV_BR', $1::bigint, part, 'AVAILABLE', now(), now(), 0 FROM unnest($2::text[]) AS part
         ON CONFLICT DO NOTHING`,
        [sample.externalId, PARTS],
      );
    }
  });
  const { items, ...data } = validateRecord({
    number: "DEMO-ARP-001",
    processNumber: "DEMO.00001/2026",
    purchaseNumber: "90001/2026",
    purchaseYear: 2026,
    object: "Registro de preços para equipamentos de escritório",
    startDate: day(-30),
    endDate: day(335),
    renewable: true,
    uasg: DEMO_UASG,
    organizationName: "Órgão de Demonstração",
    organizationDocument: "11222333000181",
    organizationStreet: "Rua de Exemplo",
    organizationNumber: "100",
    organizationCity: "Brasília",
    organizationState: "DF",
    authorityName: "Responsável de Demonstração",
    authorityRole: "Diretor(a)",
    supplierName: "Fornecedor de Demonstração Ltda.",
    supplierDocument: "12ABC34501DE35",
    supplierRepresentative: "Representante de Demonstração",
    items: [
      {
        number: 1,
        description:
          "Notebook para uso administrativo, 16 GB RAM e SSD de 512 GB",
        brand: "Marca exemplo",
        model: "Linha profissional",
        unit: "UN",
        quantity: "25",
        minimumQuantity: "1",
        unitPrice: "3500.00",
        warranty: "36 meses",
      },
      {
        number: 2,
        description: "Monitor de vídeo de 24 polegadas",
        brand: "Marca exemplo",
        model: "24 IPS",
        unit: "UN",
        quantity: "50",
        minimumQuantity: "1",
        unitPrice: "899.90",
        warranty: "12 meses",
      },
    ],
  });
  await repos.transaction(
    async (tx) => {
      const id = "20000000-0000-4000-8000-000000000001";
      if (!(await tx.records.get(id)))
        await tx.records.save(null, { id, ...data }, items);
    },
    { serializable: true },
  );
  console.log(
    "Demonstração pronta: 4 contratos e 1 ata. Os dados são fictícios; nenhum outro registro foi removido.",
  );
  const institutions = await seedInstitutions(db);
  console.log(
    `Instituições de ensino de MS: ${institutions.created} criadas, ${institutions.total - institutions.created} já existentes preservadas.`,
  );
}
seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
