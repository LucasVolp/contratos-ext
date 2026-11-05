import "./env";
import Fastify from "fastify";
import { ApplicationService } from "./service";
import { DocumentService } from "./documents";
import { Database } from "./database";
import { Data, readiness } from "./domain";
import { CatalogClient } from "./catalog/client";
import { CatalogService } from "./catalog/service";
import { Repositories } from "./repositories";
import {
  BadRequestException,
  HttpError,
  ServiceUnavailableException,
} from "./errors";
import { registerCatalogRoutes } from "./catalog/controller";
declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    repositories: Repositories;
    catalogClient: CatalogClient;
  }
}
export interface ApplicationOptions {
  db?: Database;
  client?: CatalogClient;
}
export async function createApplication(options: ApplicationOptions = {}) {
  const db = options.db ?? new Database();
  const repositories = new Repositories(db);
  const catalogClient = options.client ?? new CatalogClient();
  const service = new ApplicationService(repositories);
  const documents = new DocumentService(repositories, service);
  const catalog = new CatalogService(repositories, catalogClient);
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    routerOptions: { ignoreTrailingSlash: true },
  });
  app.decorate("db", db);
  app.decorate("repositories", repositories);
  app.decorate("catalogClient", catalogClient);
  // Preserve bodyless refresh POSTs sent with Content-Type: application/json.
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      if (body === "") return done(null, undefined);
      parseJson(request, String(body), done);
    },
  );
  app.addHook("preValidation", async (request) => {
    const params = request.params as Record<string, string>;
    if (
      params?.id &&
      !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
        params.id,
      )
    )
      throw new BadRequestException("Identificador inválido.");
    if (
      request.body !== undefined &&
      (request.body === null ||
        typeof request.body !== "object" ||
        Array.isArray(request.body))
    )
      throw new BadRequestException("Informe um objeto JSON válido.");
    if (
      Object.values(request.query as Data).some(
        (value) => typeof value !== "string",
      )
    )
      throw new BadRequestException("Parâmetros de consulta inválidos.");
  });
  app.setErrorHandler(
    (
      error: Error & {
        code?: string;
        constraint?: string;
        statusCode?: number;
      },
      request,
      reply,
    ) => {
      if (error instanceof HttpError)
        return reply.code(error.statusCode).send(error.body);
      if (error.code === "23505")
        return reply
          .code(409)
          .send({
            message: error.constraint?.includes("supplierDocument")
              ? "Já existe documento com este número, UASG e fornecedor. Abra e edite o cadastro existente."
              : "Já existe um registro com esse número nesta UASG. Edite o registro existente.",
          });
      if (error.code === "22P02")
        return reply.code(400).send({ message: "Identificador inválido." });
      if (error.code === "40001" || error.code === "40P01")
        return reply
          .code(409)
          .send({
            message:
              "O registro foi alterado simultaneamente. Atualize os dados e tente novamente.",
          });
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
        return reply.code(error.statusCode).send({ message: error.message });
      console.error("Falha interna da API:", error.message);
      return reply
        .code(500)
        .send({
          message:
            "Não foi possível concluir a operação. Verifique o serviço e tente novamente.",
        });
    },
  );
  app.addHook("onClose", async () => db.close());
  app.get("/health", async () => {
    try {
      await db.query("SELECT 1");
      return { status: "ok", database: "ok" };
    } catch {
      throw new ServiceUnavailableException(
        "Banco de dados indisponível. Verifique PostgreSQL e DATABASE_URL.",
      );
    }
  });
  await app.register(
    async (api) => {
      type Id = {
        Params: {
          id: string;
        };
      };
      type Query = {
        Querystring: Data;
      };
      type Body = {
        Body: Data;
      };
      api.get<Query>("/contracts", (request) =>
        service.contracts(request.query),
      );
      api.post<Body>("/contracts/import", async (request, reply) =>
        reply.code(201).send(await service.importContracts(request.body)),
      );
      api.post<Body>("/contracts", async (request, reply) =>
        reply.code(201).send(await service.saveContract(null, request.body)),
      );
      api.get<Id>("/contracts/:id", (request) =>
        service.contract(request.params.id),
      );
      api.put<Id & Body>("/contracts/:id", (request) =>
        service.saveContract(request.params.id, request.body),
      );
      api.delete<Id>("/contracts/:id", (request) =>
        service.deleteContract(request.params.id),
      );
      api.get<Query>("/records", (request) => service.records(request.query));
      api.post<Body>("/records/import", async (request, reply) =>
        reply.code(201).send(await service.importRecord(request.body)),
      );
      api.post<Body>("/records", async (request, reply) =>
        reply.code(201).send(await service.saveRecord(null, request.body)),
      );
      api.get<Id & Query>("/records/:id/readiness", async (request) =>
        readiness(
          await service.record(request.params.id),
          request.query.itemId,
        ),
      );
      api.get<Id>("/records/:id/exports", (request) =>
        service.exports(request.params.id),
      );
      api.get<Id & Query>("/records/:id/document", async (request, reply) => {
        const result = await documents.generate(
          request.params.id,
          request.query.format ?? "docx",
          request.query.itemId,
        );
        return reply
          .headers({
            "Content-Type": result.contentType,
            "Content-Disposition": `attachment; filename="${result.filename}"`,
            "Content-Length": String(result.buffer.length),
            "Cache-Control": "no-store",
          })
          .send(result.buffer);
      });
      api.get<Id>("/records/:id", (request) =>
        service.record(request.params.id),
      );
      api.put<Id & Body>("/records/:id", (request) =>
        service.saveRecord(request.params.id, request.body),
      );
      api.delete<Id>("/records/:id", (request) =>
        service.deleteRecord(request.params.id),
      );
      registerCatalogRoutes(api, catalog);
    },
    { prefix: "/api" },
  );
  return app;
}
