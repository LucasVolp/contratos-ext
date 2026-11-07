import type { Viewer } from "../../src/auth/access";
export const testViewer: Viewer = {
  id: "10000000-0000-4000-8000-000000000009",
  name: "Test manager",
  email: "test@example.test",
  role: "GESTOR_GERAL",
  allInstitutions: true,
  institutions: [],
  impersonator: null,
  defaults: null,
  sessionId: "10000000-0000-4000-8000-000000000010",
};
export const testAuth = { viewer: async () => testViewer };
