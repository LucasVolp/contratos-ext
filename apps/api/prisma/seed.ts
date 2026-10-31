import "../src/env";
import { Database } from "../src/database";
import { validateRecord } from "../src/domain";
const db = new Database();
function day(offset: number) {
  const result = new Date();
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}
async function seed() {
  const samples = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      number: "DEMO-001",
      object: "Aquisição de equipamentos de informática",
      supplierName: "Tecnologia Exemplo Ltda.",
      startDate: day(-90),
      endDate: day(180),
      globalValue: "187500.00",
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      number: "DEMO-002",
      object: "Serviços de manutenção predial",
      supplierName: "Serviços de Demonstração Ltda.",
      startDate: day(-340),
      endDate: day(15),
      globalValue: "42500.50",
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      number: "DEMO-003",
      object: "Fornecimento de materiais de escritório",
      supplierName: "Papelaria Exemplo Ltda.",
      startDate: day(-400),
      endDate: day(-10),
      globalValue: "12500.00",
    },
    {
      id: "10000000-0000-4000-8000-000000000004",
      number: "DEMO-004",
      object: "Instalação de rede de dados",
      supplierName: "Redes de Demonstração Ltda.",
      startDate: day(20),
      endDate: day(380),
      globalValue: "65000.00",
    },
  ];
  for (const sample of samples) {
    const data = {
      ...sample,
      uasg: "999999",
      unitName: "Unidade de demonstração",
      supplierDocument: "11222333000181",
      initialValue: sample.globalValue,
      source: "MANUAL",
    };
    await db.contract.upsert({
      where: { id: data.id },
      create: data,
      update: {},
    });
  }
  const { items, ...data } = validateRecord({
    number: "DEMO-ARP-001",
    processNumber: "DEMO.00001/2026",
    purchaseNumber: "90001/2026",
    purchaseYear: 2026,
    object: "Registro de preços para equipamentos de escritório",
    startDate: day(-30),
    endDate: day(335),
    renewable: true,
    uasg: "999999",
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
  await db.priceRecord.upsert({
    where: { id: "20000000-0000-4000-8000-000000000001" },
    create: {
      id: "20000000-0000-4000-8000-000000000001",
      ...(data as any),
      items: { create: items },
    },
    update: {},
  });
  console.log(
    "Demonstração pronta: 4 contratos e 1 ata. Os dados são fictícios; nenhum outro registro foi removido.",
  );
}
seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
