const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
// Resolve input paths before changing into the independent Go module.
for (let i = 0; i < args.length; i++) {
  if (["-file", "--file", "-cache-dir", "--cache-dir"].includes(args[i])) {
    if (args[i + 1]) {
      args[i + 1] = resolve(process.cwd(), args[i + 1]);
      i++;
    }
  } else if (/^--?(file|cache-dir)=/.test(args[i])) {
    const separator = args[i].indexOf("=");
    args[i] = args[i].slice(0, separator + 1) + resolve(process.cwd(), args[i].slice(separator + 1));
  }
}
const result = spawnSync("go", ["run", "./cmd/etl", ...args], {
  cwd: resolve(root, "apps/etl"),
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: process.env.FINANCE_DATABASE_URL || process.env.DATABASE_URL || "",
    FINANCE_CACHE_DIR: process.env.FINANCE_CACHE_DIR
      ? resolve(process.cwd(), process.env.FINANCE_CACHE_DIR)
      : resolve(root, "data/finance"),
  },
});
if (result.error) {
  console.error("Could not start the Go ETL:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
