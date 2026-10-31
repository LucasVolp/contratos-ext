import { existsSync } from "node:fs";
import { resolve } from "node:path";
const envPath = resolve(__dirname, "../../.env");
if (existsSync(envPath)) process.loadEnvFile(envPath);
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://contracts:contracts_local@localhost:5540/contracts",
  },
});
