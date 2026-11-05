const { rmSync, mkdirSync, readdirSync, copyFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { spawnSync } = require("node:child_process");
const root = resolve(__dirname, "..");
// Build only current sources; old generated ORM output must not survive upgrades.
rmSync(join(root, "dist"), { recursive: true, force: true });
const result = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc")], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(join(root, "dist/templates"), { recursive: true });
for (const file of readdirSync(join(root, "templates"))) {
  if (file.endsWith(".docx")) {
    copyFileSync(join(root, "templates", file), join(root, "dist/templates", file));
  }
}
