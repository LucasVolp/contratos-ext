import { FastifyInstance } from "fastify";
import { ContractService } from "./service";

type Data = Record<string, unknown>;

// Contract routes are keyed by the Contratos.gov.br external id, not a UUID.
export function registerContractRoutes(api: FastifyInstance, contracts: ContractService) {
  api.register(async (routes) => {
    type Contract = { Params: { externalId: string } };
    type Part = { Params: { externalId: string; part: string }; Querystring: Data };
    type Notes = Contract & { Body: Data };
    routes.addHook("onSend", async (_request, reply, payload) => {
      reply.header("Cache-Control", "no-store");
      return payload;
    });
    routes.get<{ Querystring: Data }>("/contracts", (request) => contracts.list(request.query, request.scope));
    routes.get<Contract>("/contracts/:externalId", (request) => contracts.detail(request.params.externalId, request.scope));
    routes.get<Part>("/contracts/:externalId/source/:part", (request) =>
      contracts.part(request.params.externalId, request.params.part, request.query, request.scope),
    );
    routes.put<Notes>("/contracts/:externalId/notes", (request) =>
      contracts.saveNotes(request.params.externalId, request.body, request.viewer!, request.scope),
    );
  });
}
