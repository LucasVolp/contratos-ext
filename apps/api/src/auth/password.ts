import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
const KEY_LENGTH = 64;
const COST = 16384,
  BLOCK = 8,
  PARALLEL = 1;
function derive(password: string, salt: Buffer, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
// Format: scrypt$N$r$p$salt$hash (base64url). Parameters travel with the hash so they can be raised later.
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST, BLOCK, PARALLEL);
  return [
    "scrypt",
    COST,
    BLOCK,
    PARALLEL,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}
export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const key = await derive(
      password,
      Buffer.from(salt, "base64url"),
      Number(n),
      Number(r),
      Number(p),
    );
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
export const MIN_PASSWORD_LENGTH = 8;
export function passwordError(password: unknown) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH)
    return `Use uma senha com pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password.length > 200) return "Use uma senha com até 200 caracteres.";
  return null;
}
