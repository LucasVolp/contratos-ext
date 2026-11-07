const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
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
