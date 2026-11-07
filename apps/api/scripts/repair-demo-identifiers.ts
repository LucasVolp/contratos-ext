import { Database } from "../src/database";
const db = new Database();
async function repair() {
  await db.transaction(async (tx) => {
    const id = "20000000-0000-4000-8000-000000000001";
    const organizations = await tx.query(
      'UPDATE "PriceRecord" SET "organizationDocument"=$1, "updatedAt"=CURRENT_TIMESTAMP WHERE id=$2::uuid AND "organizationDocument"=$3 RETURNING id',
      ["11222333000181", id, "00000000000100"],
    );
    const suppliers = await tx.query(
      'UPDATE "PriceRecord" SET "supplierDocument"=$1, "updatedAt"=CURRENT_TIMESTAMP WHERE id=$2::uuid AND "supplierDocument"=$3 RETURNING id',
      ["12ABC34501DE35", id, "00000000000200"],
    );
    console.log({
      organizations: organizations.length,
      suppliers: suppliers.length,
    });
  });
}
repair()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
