import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { scopeOf, Viewer } from "./access";
import { AuthService, SESSION_COOKIE } from "./service";
const PUBLIC = "auth:public";
/** Marks a route reachable without a session, such as login and health. */
export const Public = () => SetMetadata(PUBLIC, true);
type AuthenticatedRequest = Request & { viewer?: Viewer };
export function sessionToken(request: Request) {
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
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const viewer = await this.auth.viewer(sessionToken(request));
    if (!viewer)
      throw new UnauthorizedException(
        "Sua sessão expirou ou não foi iniciada. Entre novamente.",
      );
    request.viewer = viewer;
    return true;
  }
}
const viewerOf = (context: ExecutionContext) => {
  const viewer = context.switchToHttp().getRequest<AuthenticatedRequest>()
    .viewer;
  if (!viewer) throw new UnauthorizedException("Sessão não iniciada.");
  return viewer;
};
export const CurrentViewer = createParamDecorator(
  (_: unknown, context: ExecutionContext) => viewerOf(context),
);
/** UASGs the signed-in viewer may read and write; `null` means every UASG. */
export const CurrentScope = createParamDecorator(
  (_: unknown, context: ExecutionContext) => scopeOf(viewerOf(context)),
);
