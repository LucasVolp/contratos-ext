import type { FastifyInstance } from "fastify";
import { presentViewer, requireManager } from "./access";
import { DirectoryService } from "./directory";
import { PublicUnits } from "./public-units";
import { sessionToken } from "./guard";
import { AuthService, SESSION_COOKIE, sessionTtlMs } from "./service";
import type { Data } from "../domain";
const cookie = (value: string, age: number) =>
  `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${process.env.SESSION_COOKIE_SECURE === "true" ? "; Secure" : ""}`;
export function registerAuthRoutes(
  api: FastifyInstance,
  auth: AuthService,
  directory: DirectoryService,
  publicUnits: PublicUnits,
) {
  type Body = { Body: Data };
  type Id = { Params: { id: string } };
  api.post<Body>(
    "/auth/login",
    { config: { public: true } },
    async (request, reply) => {
      const { token, viewer } = await auth.login(request.body);
      reply.header(
        "Set-Cookie",
        cookie(token, Math.floor(sessionTtlMs() / 1000)),
      );
      return presentViewer(viewer);
    },
  );
  api.post(
    "/auth/logout",
    { config: { public: true } },
    async (request, reply) => {
      reply.header("Set-Cookie", cookie("", 0));
      return auth.logout(sessionToken(request));
    },
  );
  api.get("/auth/me", (request) => presentViewer(request.viewer!));
  api.post<Body>("/auth/password", (request) =>
    auth.changePassword(request.viewer!, request.body),
  );
  api.post<{ Params: { userId: string } }>(
    "/auth/impersonate/:userId",
    (request) => auth.impersonate(request.viewer!, request.params.userId),
  );
  api.post("/auth/impersonation/stop", (request) =>
    auth.stopImpersonation(request.viewer!),
  );
  api.get("/users", (request) => {
    requireManager(request.viewer!);
    return directory.users();
  });
  api.post<Body>("/users", async (request, reply) => {
    requireManager(request.viewer!);
    reply.code(201);
    return directory.createUser(request.body);
  });
  api.put<Body & Id>("/users/:id", (request) => {
    requireManager(request.viewer!);
    return directory.updateUser(
      request.viewer!,
      request.params.id,
      request.body,
    );
  });
  api.get("/institutions", (request) =>
    directory.institutions(request.viewer!),
  );
  api.get<{ Querystring: Data }>("/institutions/public", (request) => {
    requireManager(request.viewer!);
    return publicUnits.search(request.query);
  });
  api.post<Body>("/institutions/import", async (request, reply) => {
    requireManager(request.viewer!);
    reply.code(201);
    return directory.importInstitutions(request.body);
  });
  api.post<Body>("/institutions", async (request, reply) => {
    requireManager(request.viewer!);
    reply.code(201);
    return directory.saveInstitution(null, request.body);
  });
  api.put<Body & Id>("/institutions/:id", (request) => {
    requireManager(request.viewer!);
    return directory.saveInstitution(request.params.id, request.body);
  });
}
