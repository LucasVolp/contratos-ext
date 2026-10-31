import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { isUASG } from "@contracts/validation";
import { Role } from "../generated/prisma/client";
export const ROLES: Role[] = [
  "GESTOR_GERAL",
  "DIRETOR",
  "ADMINISTRATIVO",
  "USUARIO",
];
export const roleLabels: Record<Role, string> = {
  GESTOR_GERAL: "Gestor geral",
  DIRETOR: "Diretor",
  ADMINISTRATIVO: "Administrativo",
  USUARIO: "Usuário",
};
export type InstitutionSummary = { id: string; name: string; uasg: string };
export type Viewer = {
  id: string;
  name: string;
  email: string;
  role: Role;
  // Only the general manager reaches every institution; other roles see their linked UASGs.
  allInstitutions: boolean;
  institutions: InstitutionSummary[];
  impersonator: { id: string; name: string; email: string } | null;
  // Suggested search reach for an unrestricted viewer: the whole organization of the linked institutions.
  defaults: { label: string; uasgs: string[] } | null;
  sessionId: string;
};
/** UASGs visible to the viewer; `null` means unrestricted. */
export type Scope = string[] | null;
export const isManager = (role: Role) => role === "GESTOR_GERAL";
export function scopeOf(viewer: Viewer): Scope {
  return viewer.allInstitutions
    ? null
    : viewer.institutions.map((institution) => institution.uasg);
}
export function inScope(scope: Scope, uasg: string) {
  return scope === null || scope.includes(uasg);
}
/** Narrows the scope to the `uasgs` list requested by a listing; it can never widen it. */
export function narrowScope(scope: Scope, requested: unknown): Scope {
  if (requested === undefined || requested === null || requested === "")
    return scope;
  const list = [
    ...new Set(
      String(requested)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (!list.length || list.some((value) => !isUASG(value)))
    throw new BadRequestException({
      message: "Abrangência inválida: use UASGs de 6 dígitos separadas por vírgula.",
      fieldErrors: { uasgs: "Use UASGs de 6 dígitos separadas por vírgula." },
    });
  return scope === null ? list : list.filter((uasg) => scope.includes(uasg));
}
export function uasgWhere(scope: Scope): { uasg?: { in: string[] } } {
  return scope === null ? {} : { uasg: { in: scope } };
}
export function assertUasg(scope: Scope, uasg: string) {
  if (inScope(scope, uasg)) return;
  throw new ForbiddenException({
    message: `Sua conta não tem acesso à UASG ${uasg}. Use uma UASG das instituições vinculadas ao seu perfil.`,
    fieldErrors: { uasg: "UASG fora das instituições do seu perfil." },
  });
}
export function requireManager(viewer: Viewer) {
  if (!isManager(viewer.role))
    throw new ForbiddenException(
      "Somente o gestor geral pode administrar usuários e instituições.",
    );
}
export function presentViewer({ sessionId, ...viewer }: Viewer) {
  return { ...viewer, roleLabel: roleLabels[viewer.role] };
}
