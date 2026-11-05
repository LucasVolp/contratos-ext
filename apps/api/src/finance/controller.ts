import { FastifyInstance } from "fastify";
import { FinanceService } from "./service";
import { FinanceQuery } from "./types";

export function registerFinanceRoutes(api: FastifyInstance, finance: FinanceService) {
  api.register(async (routes) => {
    type Query = { Querystring: FinanceQuery };
    type Commitment = Query & { Params: { commitmentId: string } };
    routes.addHook("onSend", async (_request, reply, payload) => {
      reply.header("Cache-Control", "no-store");
      return payload;
    });
    routes.get<Query>("/units", (request) => finance.units(request.query));
    routes.get<Query>("/execution", (request) => finance.execution(request.query));
    routes.get<Query>("/commitments", (request) => finance.commitments(request.query));
    // Financial identity columns are bigint, unlike UUIDs in the contract/catalog module.
    routes.get<Commitment>("/commitments/:commitmentId", (request) => finance.commitment(request.params.commitmentId, request.query));
    for (const kind of ["items", "history", "liquidations", "payments"] as const) {
      routes.get<Commitment>(`/commitments/:commitmentId/${kind}`, (request) => finance.collection(kind, request.params.commitmentId, request.query));
    }
  }, { prefix: "/finance" });
}
