import { randomUUID } from "node:crypto";
import { TestContext } from "node:test";
import { Database } from "../../src/database";

// A schema-qualified migration needs a database boundary, not just search_path.
// Only the randomly named database created here is removed at teardown.
export async function createTestDatabase(t: TestContext) {
  const admin = new Database();
  const name = "contracts_test_" + randomUUID().replaceAll("-", "");
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    await admin.close();
    throw error;
  }
  const url = new URL(
    process.env.DATABASE_URL ||
      "postgresql://contracts:contracts_local@localhost:5540/contracts",
  );
  url.pathname = "/" + name;
  const db = new Database(url.toString());
  t.after(async () => {
    try {
      await db.close();
      await admin.query(`DROP DATABASE "${name}"`);
    } finally {
      await admin.close();
    }
  });
  return db;
}
