import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
// The financial suite provisions its own database, API, web server and sessions.
export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: "finance.spec.ts",
  use: { ...base.use, storageState: undefined },
});
