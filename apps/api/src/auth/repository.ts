import { randomUUID } from "node:crypto";
import { Database, SqlConnection } from "../database";
import { insert, update } from "../repositories/sql";
import type { Role } from "./access";
export interface Institution {
  id: string;
  name: string;
  uasg: string;
  organization: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
  institutions: { institution: Institution }[];
}
const userProjection = `SELECT u.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('institution',to_jsonb(i)) ORDER BY i.name) FROM "UserInstitution" l JOIN "Institution" i ON i.id=l."institutionId" WHERE l."userId"=u.id),'[]'::jsonb) AS institutions FROM "User" u`;
export class AuthRepository {
  constructor(readonly db: Database) {}
  transaction<T>(run: (repository: AuthRepository) => Promise<T>) {
    return this.db.transaction((tx) => run(new AuthRepository(tx)));
  }
  async lockUsers() {
    await this.db.query('LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE');
  }
  async user(id: string) {
    return (
      (
        await this.db.query<AuthUser>(`${userProjection} WHERE u.id=$1::uuid`, [
          id,
        ])
      )[0] ?? null
    );
  }
  async userByEmail(email: string) {
    return (
      (
        await this.db.query<AuthUser>(`${userProjection} WHERE u.email=$1`, [
          email,
        ])
      )[0] ?? null
    );
  }
  users() {
    return this.db.query<AuthUser>(
      `${userProjection} ORDER BY u.active DESC,u.name ASC`,
    );
  }
  async userCount() {
    return (
      await this.db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM "User"',
      )
    )[0].count;
  }
  async institution(id: string) {
    return (
      (
        await this.db.query<Institution>(
          'SELECT * FROM "Institution" WHERE id=$1::uuid',
          [id],
        )
      )[0] ?? null
    );
  }
  async institutionByUasg(uasg: string) {
    return (
      (
        await this.db.query<Institution>(
          'SELECT * FROM "Institution" WHERE uasg=$1',
          [uasg],
        )
      )[0] ?? null
    );
  }
  institutions(ids: string[] | null = null) {
    return this.db.query<Institution & { usersCount: number }>(
      `SELECT i.*, (SELECT count(*)::int FROM "UserInstitution" l WHERE l."institutionId"=i.id) AS "usersCount" FROM "Institution" i ${ids === null ? "" : "WHERE i.id=ANY($1::uuid[])"} ORDER BY name`,
      ids === null ? [] : [ids],
    );
  }
  members(organizations: string[]) {
    return this.db.query<{ uasg: string }>(
      'SELECT uasg FROM "Institution" WHERE organization=ANY($1::text[])',
      [organizations],
    );
  }
  registered(uasgs: string[]) {
    return this.db.query<{ uasg: string; organization: string }>(
      'SELECT uasg,organization FROM "Institution" WHERE uasg=ANY($1::text[])',
      [uasgs],
    );
  }
  async institutionCount(ids: string[]) {
    return (
      await this.db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM "Institution" WHERE id=ANY($1::uuid[])',
        [ids],
      )
    )[0].count;
  }
  saveInstitution(id: string | null, data: Partial<Institution>) {
    const values = { ...data, updatedAt: new Date() };
    return id
      ? update<Institution>(
          this.db,
          "Institution",
          ["name", "uasg", "organization", "updatedAt"],
          id,
          values,
        )
      : insert<Institution>(
          this.db,
          "Institution",
          ["name", "uasg", "organization", "updatedAt"],
          values,
        );
  }
  async session(tokenHash: string) {
    return (
      (
        await this.db.query<{
          id: string;
          expiresAt: Date;
          user: AuthUser;
          impersonator: AuthUser | null;
        }>(
          `SELECT s.id,s."expiresAt", to_jsonb(u) || jsonb_build_object('institutions',COALESCE((SELECT jsonb_agg(jsonb_build_object('institution',to_jsonb(i))) FROM "UserInstitution" l JOIN "Institution" i ON i.id=l."institutionId" WHERE l."userId"=u.id),'[]'::jsonb)) AS "user",CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END AS impersonator FROM "Session" s JOIN "User" u ON u.id=s."userId" LEFT JOIN "User" p ON p.id=s."impersonatorId" WHERE s."tokenHash"=$1`,
          [tokenHash],
        )
      )[0] ?? null
    );
  }
  async expireSessions(now: Date) {
    await this.db.query('DELETE FROM "Session" WHERE "expiresAt"<=$1', [now]);
  }
  async deleteSession(id: string) {
    await this.db.query('DELETE FROM "Session" WHERE id=$1::uuid', [id]);
  }
  async logout(tokenHash: string) {
    await this.db.query('DELETE FROM "Session" WHERE "tokenHash"=$1', [
      tokenHash,
    ]);
  }
  async createSession(tokenHash: string, userId: string, expiresAt: Date) {
    await this.db.query(
      'INSERT INTO "Session" (id,"tokenHash","userId","expiresAt") VALUES ($1,$2,$3,$4)',
      [randomUUID(), tokenHash, userId, expiresAt],
    );
  }
  async switchSession(
    id: string,
    userId: string,
    impersonatorId: string | null,
  ) {
    await this.db.query(
      'UPDATE "Session" SET "userId"=$2::uuid,"impersonatorId"=$3::uuid WHERE id=$1::uuid',
      [id, userId, impersonatorId],
    );
  }
  async revokeSessions(
    userId: string,
    except: string | null,
    db: SqlConnection = this.db,
  ) {
    await db.query(
      'DELETE FROM "Session" WHERE ("userId"=$1::uuid OR "impersonatorId"=$1::uuid) AND ($2::uuid IS NULL OR id<>$2::uuid)',
      [userId, except],
    );
  }
  async changePassword(
    userId: string,
    passwordHash: string,
    sessionId: string,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        'UPDATE "User" SET "passwordHash"=$2,"updatedAt"=now() WHERE id=$1::uuid',
        [userId, passwordHash],
      );
      await this.revokeSessions(userId, sessionId, tx);
    });
  }
  async saveUser(
    id: string | null,
    data: {
      name: string;
      email: string;
      role: Role;
      active: boolean;
      passwordHash?: string;
    },
    institutionIds: string[],
    revokeExcept: string | null | false = false,
  ) {
    return this.db.transaction(async (tx) => {
      const user = id
        ? await update<AuthUser>(
            tx,
            "User",
            ["name", "email", "role", "active", "passwordHash", "updatedAt"],
            id,
            { ...data, updatedAt: new Date() },
          )
        : await insert<AuthUser>(
            tx,
            "User",
            ["name", "email", "role", "active", "passwordHash", "updatedAt"],
            { ...data, updatedAt: new Date() },
          );
      await tx.query('DELETE FROM "UserInstitution" WHERE "userId"=$1::uuid', [
        user.id,
      ]);
      for (const institution of institutionIds)
        await tx.query(
          'INSERT INTO "UserInstitution" ("userId","institutionId") VALUES ($1::uuid,$2::uuid)',
          [user.id, institution],
        );
      if (revokeExcept !== false)
        await this.revokeSessions(user.id, revokeExcept, tx);
      return (await new AuthRepository(tx).user(user.id))!;
    });
  }
  async otherManagers(id: string) {
    return (
      await this.db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "User" WHERE role='GESTOR_GERAL' AND active AND id<>$1::uuid`,
        [id],
      )
    )[0].count;
  }
  async ensureManager(
    email: string,
    name: string,
    passwordHash: string,
    onlyIfEmpty: boolean,
  ) {
    return this.db.transaction(async (tx) => {
      await tx.query('LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE');
      const repo = new AuthRepository(tx);
      if (onlyIfEmpty && (await repo.userCount())) return null;
      const current = await repo.userByEmail(email);
      if (current) {
        await tx.query(
          `UPDATE "User" SET "passwordHash"=$2,role='GESTOR_GERAL',active=true,"updatedAt"=now() WHERE id=$1::uuid`,
          [current.id, passwordHash],
        );
        await repo.revokeSessions(current.id, null);
        return repo.user(current.id);
      }
      return repo.saveUser(
        null,
        { email, name, passwordHash, role: "GESTOR_GERAL", active: true },
        [],
      );
    });
  }
}
