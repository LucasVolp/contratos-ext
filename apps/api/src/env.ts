import { existsSync } from "node:fs";
import { resolve } from "node:path";
const path = resolve(__dirname, "../../../.env");
if (existsSync(path)) process.loadEnvFile(path);
