import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Database } from "./database";
export async function migrate(
  db: Database,
  directory = resolve(__dirname, "../migrations"),
) {
  const files = (await readdir(directory))
    .filter((name) => /^\d+_[\w-]+\.sql$/.test(name))
    .sort();
  await db.transaction(async (tx) => {
    // Serialize startup migrations across API instances on one connection.
    await tx.query("SELECT pg_advisory_xact_lock(4100, 14133)");
    await tx.query(
      'CREATE TABLE IF NOT EXISTS "_sql_migrations" (name text PRIMARY KEY, checksum text NOT NULL, "appliedAt" timestamptz NOT NULL DEFAULT now())',
    );
    const legacy = (
      await tx.query<{
        exists: boolean;
      }>(`SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS exists`)
    )[0].exists;
    const old = legacy
      ? await tx.query<{
          migration_name: string;
          checksum: string;
          finished_at: Date | null;
          rolled_back_at: Date | null;
        }>(
          'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
        )
      : [];
    const applied = await tx.query<{
      name: string;
      checksum: string;
    }>('SELECT name, checksum FROM "_sql_migrations"');
    if (old.some((row) => !row.finished_at && !row.rolled_back_at))
      throw new Error(
        "Existe migração anterior incompleta. Resolva o histórico antes de iniciar a API.",
      );
    const names = new Set(files.map((file) => file.slice(0, -4)));
    if (
      [
        ...applied.map((row) => row.name),
        ...old
          .filter((row) => row.finished_at && !row.rolled_back_at)
          .map((row) => row.migration_name),
      ].some((name) => !names.has(name))
    )
      throw new Error("O banco contém migrações ausentes nesta versão da API.");
    for (const file of files) {
      const name = file.slice(0, -4),
        sql = await readFile(resolve(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const current = applied.find((row) => row.name === name);
      const previous = old.find(
        (row) =>
          row.migration_name === name && row.finished_at && !row.rolled_back_at,
      );
      if (
        (current && current.checksum !== checksum) ||
        (previous && previous.checksum !== checksum)
      )
        throw new Error(`Migração alterada após aplicação: ${name}`);
      if (current) continue;
      if (!previous) await tx.query(sql);
      await tx.query(
        'INSERT INTO "_sql_migrations" (name, checksum) VALUES ($1,$2)',
        [name, checksum],
      );
    }
  });
}
if (require.main === module) {
  const db = new Database();
  migrate(db)
    .then(() => console.log("Migrações SQL aplicadas."))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
