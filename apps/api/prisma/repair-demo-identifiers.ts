import "../src/env";
import { Database } from "../src/database";
const db = new Database();
async function repair() {
  const contractIds = [1, 2, 3, 4].map(
    (number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  );
  const contracts = await db.contract.updateMany({
    where: { id: { in: contractIds }, supplierDocument: "00000000000100" },
    data: { supplierDocument: "11222333000181" },
  });
  const id = "20000000-0000-4000-8000-000000000001";
  const organization = await db.priceRecord.updateMany({
    where: { id, organizationDocument: "00000000000100" },
    data: { organizationDocument: "11222333000181" },
  });
  const supplier = await db.priceRecord.updateMany({
    where: { id, supplierDocument: "00000000000200" },
    data: { supplierDocument: "12ABC34501DE35" },
  });
  console.log({
    contracts: contracts.count,
    organizations: organization.count,
    suppliers: supplier.count,
  });
}
repair()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
