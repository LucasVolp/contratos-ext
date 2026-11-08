import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Dashboard fixtures isolate the demonstration from live institutions and accounts.
export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: "dashboard.spec.ts",
  use: { ...base.use, storageState: undefined },
});
