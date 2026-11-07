import { FastifyInstance } from "fastify";
import { CatalogService } from "./service";
import { Raw } from "./types";
export function registerCatalogRoutes(
  api: FastifyInstance,
  catalog: CatalogService,
) {
  api.addHook("preHandler", async (request) => {
    const params = request.params as { id?: string };
    if (!params?.id) return;
    if (request.routeOptions.url?.startsWith("/api/purchases/"))
      await catalog.authorizePurchase(params.id, request.scope);
    if (request.routeOptions.url?.startsWith("/api/public-records/"))
      await catalog.authorizeRecord(params.id, request.scope);
  });
  type Id = {
    Params: {
      id: string;
    };
  };
  type Query = {
    Querystring: Raw;
  };
  type Body = {
    Body: Raw;
  };
  api.post<Body>("/purchases/sync-reach", (request) =>
    catalog.syncReach("purchases", request.body, request.scope),
  );
  api.post<Body>("/public-records/sync-reach", (request) =>
    catalog.syncReach("records", request.body, request.scope),
  );
  api.get<Query>("/purchases", (request) =>
    catalog.purchases(request.query, request.scope),
  );
  api.post<Body>("/purchases/sync", async (request, reply) =>
    reply
      .code(201)
      .send(await catalog.syncPurchases(request.body, request.scope)),
  );
  api.get<Id>("/purchases/:id", (request) =>
    catalog.purchase(request.params.id),
  );
  api.post<Id & Body>("/purchases/:id/ensure-details", async (request, reply) =>
    reply
      .code(201)
      .send(
        await catalog.ensurePurchase(request.params.id, request.body ?? {}),
      ),
  );
  api.post<Id>("/purchases/:id/refresh", async (request, reply) =>
    reply.code(201).send(await catalog.refreshPurchase(request.params.id)),
  );
  api.post<Id & Body>(
    "/purchases/:id/records/refresh",
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await catalog.refreshLinkedRecords(
            request.params.id,
            request.body ?? {},
          ),
        ),
  );
  api.get<Query>("/public-records", (request) =>
    catalog.records(request.query, request.scope),
  );
  api.post<Body>("/public-records/sync", async (request, reply) =>
    reply
      .code(201)
      .send(await catalog.syncRecords(request.body, request.scope)),
  );
  api.get<Id>("/public-records/:id", (request) =>
    catalog.record(request.params.id),
  );
  api.post<Id & Body>(
    "/public-records/:id/ensure-details",
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await catalog.ensureRecord(request.params.id, request.body ?? {}),
        ),
  );
  api.post<Id & Body>(
    "/public-records/:id/supplements/refresh",
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await catalog.refreshSupplements(
            request.params.id,
            request.body ?? {},
          ),
        ),
  );
  api.post<Id>("/public-records/:id/refresh", async (request, reply) =>
    reply.code(201).send(await catalog.refreshRecord(request.params.id)),
  );
  api.post<{
    Params: {
      id: string;
      itemKey: string;
    };
  }>("/public-records/:id/items/:itemKey/refresh", async (request, reply) =>
    reply
      .code(201)
      .send(
        await catalog.refreshSupplement(
          request.params.id,
          request.params.itemKey,
        ),
      ),
  );
  api.post<Id & Body>("/public-records/:id/draft", async (request, reply) =>
    reply.code(201).send(await catalog.draft(request.params.id, request.body)),
  );
}
