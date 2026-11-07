import type { FastifyRequest } from "fastify";
import { SESSION_COOKIE } from "./service";
export function sessionToken(request: Pick<FastifyRequest, "headers">) {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
