import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "../errors";
import { isUASG } from "@contracts/validation";
import { Role } from "./access";
import { AuthRepository, AuthUser } from "./repository";
import { Data } from "../domain";
import { hashPassword, passwordError } from "./password";
import { emailError, normalizeEmail } from "./service";
import { isManager, roleLabels, ROLES, Viewer } from "./access";
type UserRow = AuthUser;
function invalid(fieldErrors: Record<string, string>) {
  if (Object.keys(fieldErrors).length)
    throw new BadRequestException({
      message: Object.values(fieldErrors).join(" · "),
      fieldErrors,
    });
}
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
export function presentUser({ passwordHash, institutions, ...user }: UserRow) {
  return {
    ...user,
    roleLabel: roleLabels[user.role],
    institutions: institutions
      .map(({ institution: { id, name, uasg } }) => ({ id, name, uasg }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}
/** Administration of accounts and institutions, reserved to the general manager by the controllers. */
export class DirectoryService {
  constructor(readonly db: AuthRepository) {}
  async institutions(viewer: Viewer) {
    return this.db.institutions(
      viewer.allInstitutions ? null : viewer.institutions.map((i) => i.id),
    );
  }
  private institutionInput(body: Data) {
    const name = text(body?.name),
      uasg = text(body?.uasg),
      organization = text(body?.organization).toUpperCase();
    const errors: Record<string, string> = {};
    if (organization.length > 60)
      errors.organization = "Use até 60 caracteres.";
    if (!name) errors.name = "Informe o nome da instituição.";
    else if (name.length > 300) errors.name = "Use até 300 caracteres.";
    if (!isUASG(uasg)) errors.uasg = "Informe a UASG com 6 dígitos.";
    invalid(errors);
    return { name, uasg, organization };
  }
  async saveInstitution(id: string | null, body: Data) {
    const data = this.institutionInput(body);
    const clash = await this.db.institutionByUasg(data.uasg);
    if (clash && clash.id !== id)
      throw new ConflictException({
        message: `A UASG ${data.uasg} já pertence a ${clash.name}.`,
        fieldErrors: { uasg: "UASG já cadastrada em outra instituição." },
      });
    if (id) {
      if (!(await this.db.institution(id)))
        throw new NotFoundException("Instituição não encontrada.");
      return this.db.saveInstitution(id, data);
    }
    return this.db.saveInstitution(null, data);
  }
  /** Registers several UASGs of one body at once; existing UASGs keep their name and links. */
  async importInstitutions(body: Data) {
    const organization = text(body?.organization).toUpperCase();
    const units: unknown[] = Array.isArray(body?.units) ? body.units : [];
    const errors: Record<string, string> = {};
    if (!organization)
      errors.organization = "Informe a sigla da organização, como IFSP.";
    else if (organization.length > 60)
      errors.organization = "Use até 60 caracteres.";
    const rows = units
      .map((unit) => unit as Data)
      .map((unit) => ({ uasg: text(unit?.uasg), name: text(unit?.name) }));
    if (!rows.length) errors.units = "Selecione ao menos uma UASG.";
    else if (rows.length > 200)
      errors.units = "Selecione até 200 UASGs por vez.";
    else if (
      rows.some(
        (row) => !isUASG(row.uasg) || !row.name || row.name.length > 300,
      )
    )
      errors.units = "Há UASG sem código de 6 dígitos ou sem nome.";
    invalid(errors);
    return this.db.transaction(async (tx) => {
      let created = 0,
        existing = 0;
      for (const row of new Map(rows.map((r) => [r.uasg, r])).values()) {
        const current = await tx.institutionByUasg(row.uasg);
        if (!current) {
          await tx.saveInstitution(null, { ...row, organization });
          created++;
          continue;
        }
        existing++;
        if (!current.organization)
          await tx.saveInstitution(current.id, { organization });
      }
      return { created, existing, organization };
    });
  }
  async users() {
    return (await this.db.users()).map(presentUser);
  }
  private async userInput(body: Data, creating: boolean) {
    const name = text(body?.name),
      email = normalizeEmail(body?.email),
      role = body?.role as Role,
      password = body?.password;
    const errors: Record<string, string> = {};
    if (!name) errors.name = "Informe o nome.";
    else if (name.length > 200) errors.name = "Use até 200 caracteres.";
    const emailProblem = emailError(email);
    if (emailProblem) errors.email = emailProblem;
    if (!ROLES.includes(role)) errors.role = "Selecione um perfil.";
    if (creating || (password !== undefined && password !== "")) {
      const problem = passwordError(password);
      if (problem) errors.password = problem;
    }
    if (body?.active !== undefined && typeof body.active !== "boolean")
      errors.active = "Situação inválida.";
    const ids: unknown[] = Array.isArray(body?.institutionIds)
      ? body.institutionIds
      : [];
    const institutionIds = [
      ...new Set(ids.filter((v) => typeof v === "string")),
    ] as string[];
    // For the general manager, links only set the default search; access stays unrestricted.
    const linked = institutionIds;
    if (ROLES.includes(role) && !isManager(role) && !linked.length)
      errors.institutionIds = "Vincule pelo menos uma instituição.";
    if (linked.length) {
      const found = await this.db.institutionCount(linked);
      if (found !== linked.length)
        errors.institutionIds = "Uma das instituições selecionadas não existe.";
    }
    invalid(errors);
    return {
      name,
      email,
      role,
      institutionIds: linked,
      password: typeof password === "string" && password ? password : null,
      active: body?.active as boolean | undefined,
    };
  }
  private async emailAvailable(email: string, id: string | null) {
    const clash = await this.db.userByEmail(email);
    if (clash && clash.id !== id)
      throw new ConflictException({
        message: "Já existe um usuário com este e-mail.",
        fieldErrors: { email: "E-mail já cadastrado." },
      });
  }
  async createUser(body: Data) {
    const input = await this.userInput(body, true);
    await this.emailAvailable(input.email, null);
    const user = await this.db.saveUser(
      null,
      {
        name: input.name,
        email: input.email,
        role: input.role,
        active: input.active ?? true,
        passwordHash: await hashPassword(input.password!),
      },
      input.institutionIds,
    );
    return presentUser(user);
  }
  async updateUser(viewer: Viewer, id: string, body: Data) {
    const current = await this.db.user(id);
    if (!current) throw new NotFoundException("Usuário não encontrado.");
    const input = await this.userInput(body, false);
    await this.emailAvailable(input.email, id);
    const active = input.active ?? current.active;
    if (id === viewer.id && !active)
      throw new BadRequestException("Você não pode desativar a própria conta.");
    const losesManager =
      isManager(current.role) &&
      current.active &&
      (!isManager(input.role) || !active);
    if (losesManager && (await this.db.otherManagers(id)) === 0)
      throw new BadRequestException(
        "O sistema precisa de pelo menos um gestor geral ativo. Promova outro usuário antes desta alteração.",
      );
    const passwordHash = input.password
      ? await hashPassword(input.password)
      : undefined;
    const user = await this.db.transaction(async (repo) => {
      await repo.lockUsers();
      if (losesManager && (await repo.otherManagers(id)) === 0)
        throw new BadRequestException(
          "O sistema precisa de pelo menos um gestor geral ativo.",
        );
      return repo.saveUser(
        id,
        {
          name: input.name,
          email: input.email,
          role: input.role,
          active,
          ...(passwordHash ? { passwordHash } : {}),
        },
        input.institutionIds,
        passwordHash || !active
          ? id === viewer.id
            ? viewer.sessionId
            : null
          : false,
      );
    });
    return presentUser(user);
  }
}
