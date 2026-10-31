import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaClient } from "../generated/prisma/client";
import { Data } from "../domain";
import { hashPassword, passwordError, verifyPassword } from "./password";
import { isManager, Viewer } from "./access";
export const SESSION_COOKIE = "contracts_session";
export const sessionTtlMs = () =>
  Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 12) * 3600_000;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
export function emailError(email: string) {
  if (!email) return "Informe o e-mail.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return "Informe um e-mail válido.";
  return null;
}
const viewerInclude = {
  institutions: { include: { institution: true } },
} as const;
const FAILURE_LIMIT = 5,
  FAILURE_WINDOW_MS = 15 * 60_000;
export class AuthService {
  // Per-email counter in process memory: enough to slow guessing on a single API instance.
  private readonly failures = new Map<string, { count: number; since: number }>();
  private dummyHash?: Promise<string>;
  constructor(
    readonly db: PrismaClient,
    private readonly now: () => number = Date.now,
  ) {}
  private throttled(email: string) {
    const entry = this.failures.get(email);
    if (!entry) return false;
    if (this.now() - entry.since > FAILURE_WINDOW_MS) {
      this.failures.delete(email);
      return false;
    }
    return entry.count >= FAILURE_LIMIT;
  }
  private fail(email: string) {
    const entry = this.failures.get(email);
    if (!entry || this.now() - entry.since > FAILURE_WINDOW_MS)
      this.failures.set(email, { count: 1, since: this.now() });
    else entry.count++;
  }
  async login(body: Data) {
    const email = normalizeEmail(body?.email),
      password = typeof body?.password === "string" ? body.password : "";
    const fieldErrors: Record<string, string> = {};
    if (!email) fieldErrors.email = "Informe o e-mail.";
    if (!password) fieldErrors.password = "Informe a senha.";
    if (Object.keys(fieldErrors).length)
      throw new BadRequestException({
        message: Object.values(fieldErrors).join(" · "),
        fieldErrors,
      });
    if (this.throttled(email))
      throw new HttpException(
        "Muitas tentativas sem sucesso. Aguarde 15 minutos e tente novamente.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const user = await this.db.user.findUnique({ where: { email } });
    // Hash even for unknown e-mails so response time does not reveal which accounts exist.
    this.dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !valid) {
      this.fail(email);
      throw new UnauthorizedException("E-mail ou senha incorretos.");
    }
    if (!user.active)
      throw new ForbiddenException(
        "Sua conta está desativada. Procure o gestor geral do sistema.",
      );
    this.failures.delete(email);
    await this.db.session.deleteMany({
      where: { expiresAt: { lte: new Date(this.now()) } },
    });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now() + sessionTtlMs());
    await this.db.session.create({
      data: { tokenHash: digest(token), userId: user.id, expiresAt },
    });
    const viewer = await this.viewer(token);
    if (!viewer) throw new UnauthorizedException("Sessão não iniciada.");
    return { token, expiresAt, viewer };
  }
  async viewer(token: string | undefined): Promise<Viewer | null> {
    if (!token) return null;
    const session = await this.db.session.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: { include: viewerInclude }, impersonator: true },
    });
    if (!session) return null;
    const impersonator = session.impersonator;
    if (
      session.expiresAt.getTime() <= this.now() ||
      !session.user.active ||
      (impersonator && (!impersonator.active || !isManager(impersonator.role)))
    ) {
      await this.db.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    const { user } = session;
    const manager = isManager(user.role);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      allInstitutions: manager,
      institutions: user.institutions
        .map(({ institution: { id, name, uasg } }) => ({ id, name, uasg }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      impersonator: impersonator
        ? {
            id: impersonator.id,
            name: impersonator.name,
            email: impersonator.email,
          }
        : null,
      defaults: manager
        ? await this.defaults(user.institutions.map((link) => link.institution))
        : null,
      sessionId: session.id,
    };
  }
  /** A link to the IFMS rectorate suggests every IFMS UASG; links without organization count alone. */
  private async defaults(
    linked: Array<{ name: string; uasg: string; organization: string }>,
  ) {
    if (!linked.length) return null;
    const organizations = [
      ...new Set(linked.map((i) => i.organization).filter(Boolean)),
    ].sort();
    const members = organizations.length
      ? await this.db.institution.findMany({
          where: { organization: { in: organizations } },
          select: { uasg: true },
        })
      : [];
    const loose = linked.filter((i) => !i.organization);
    return {
      label: [...organizations, ...loose.map((i) => i.name)].join(", "),
      uasgs: [
        ...new Set([...members, ...linked].map((i) => i.uasg)),
      ].sort(),
    };
  }
  async logout(token: string | undefined) {
    if (token)
      await this.db.session.deleteMany({ where: { tokenHash: digest(token) } });
    return { loggedOut: true };
  }
  async impersonate(viewer: Viewer, userId: string) {
    if (viewer.impersonator)
      throw new BadRequestException(
        "Volte para a sua conta antes de entrar como outro usuário.",
      );
    if (!isManager(viewer.role))
      throw new ForbiddenException(
        "Somente o gestor geral pode entrar como outro usuário.",
      );
    if (userId === viewer.id)
      throw new BadRequestException("Você já está usando esta conta.");
    const target = await this.db.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException("Usuário não encontrado.");
    if (!target.active)
      throw new BadRequestException(
        "Este usuário está desativado. Reative a conta antes de usá-la.",
      );
    await this.db.session.update({
      where: { id: viewer.sessionId },
      data: { userId: target.id, impersonatorId: viewer.id },
    });
    return { switched: true };
  }
  async stopImpersonation(viewer: Viewer) {
    if (!viewer.impersonator)
      throw new BadRequestException("Você já está usando a sua própria conta.");
    await this.db.session.update({
      where: { id: viewer.sessionId },
      data: { userId: viewer.impersonator.id, impersonatorId: null },
    });
    return { switched: true };
  }
  async changePassword(viewer: Viewer, body: Data) {
    if (viewer.impersonator)
      throw new ForbiddenException(
        "Não é possível alterar a senha de outro usuário enquanto usa a conta dele. Use a administração de usuários.",
      );
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: viewer.id },
    });
    const fieldErrors: Record<string, string> = {};
    if (
      typeof body?.currentPassword !== "string" ||
      !(await verifyPassword(body.currentPassword, user.passwordHash))
    )
      fieldErrors.currentPassword = "A senha atual não confere.";
    const invalid = passwordError(body?.newPassword);
    if (invalid) fieldErrors.newPassword = invalid;
    if (Object.keys(fieldErrors).length)
      throw new BadRequestException({
        message: Object.values(fieldErrors).join(" · "),
        fieldErrors,
      });
    await this.db.$transaction([
      this.db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword) },
      }),
      // Other devices must sign in again with the new password.
      this.db.session.deleteMany({
        where: {
          OR: [{ userId: user.id }, { impersonatorId: user.id }],
          id: { not: viewer.sessionId },
        },
      }),
    ]);
    return { changed: true };
  }
  /** Creates or restores a general manager; with `onlyIfEmpty` it runs only on a database without users. */
  async ensureManager(
    input: { email?: string; password?: string; name?: string },
    onlyIfEmpty = false,
  ) {
    const email = normalizeEmail(input.email);
    const problem = emailError(email) ?? passwordError(input.password);
    if (problem) throw new Error(problem);
    if (onlyIfEmpty && (await this.db.user.count())) return null;
    const passwordHash = await hashPassword(String(input.password));
    const name = input.name?.trim() || "Gestor geral";
    const user = await this.db.user.upsert({
      where: { email },
      create: { email, name, passwordHash, role: "GESTOR_GERAL" },
      update: { passwordHash, role: "GESTOR_GERAL", active: true },
    });
    return user;
  }
}
