import { request, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export const STORAGE_STATE = "tests/.auth/state.json";
// Signs in once as a general manager and shares the session cookie with every test.
export default async function globalSetup(config: FullConfig) {
  const baseURL =
    config.projects[0].use.baseURL || "http://localhost:3100";
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/auth/login", {
    data: {
      email: process.env.E2E_EMAIL || "gestor@contratos.local",
      password: process.env.E2E_PASSWORD || "troque-esta-senha",
    },
  });
  if (!response.ok())
    throw new Error(
      `Login dos testes falhou (${response.status()}): ${await response.text()}. Defina E2E_EMAIL e E2E_PASSWORD de um gestor geral.`,
    );
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  await context.storageState({ path: STORAGE_STATE });
  await context.dispose();
}
