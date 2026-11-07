import { FastifyInstance } from "fastify";
import { ContractSourceService } from "./service";

type Data = Record<string, unknown>;

export function registerContractSourceRoutes(api: FastifyInstance, sources: ContractSourceService) {
  api.register(async (routes) => {
    type Contract = { Params: { id: string }; Querystring: Data };
    type Part = { Params: { id: string; part: string }; Querystring: Data };
    routes.addHook("onSend", async (_request, reply, payload) => {
      reply.header("Cache-Control", "no-store");
      return payload;
    });
    routes.get<Contract>("/contracts/:id/source", (request) => sources.summary(request.params.id, request.scope));
    routes.get<Part>("/contracts/:id/source/:part", (request) =>
      sources.part(request.params.id, request.params.part, request.query, request.scope),
    );
  });
}
