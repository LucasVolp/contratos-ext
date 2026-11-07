const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

// `pnpm sources:sync -- -source …` inserts "--" after the subcommand; Go's flag
// parser would treat everything after it as positional arguments.
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const result = spawnSync("go", ["run", "./cmd/replicator", ...args], {
  cwd: resolve(root, "apps/etl"),
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL:
      process.env.SOURCES_DATABASE_URL ||
      process.env.FINANCE_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "",
  },
});
if (result.error) {
  console.error("Could not start the Go replicator:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
