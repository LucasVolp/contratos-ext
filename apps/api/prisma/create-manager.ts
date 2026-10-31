import "../src/env";
import { Database } from "../src/database";
import { AuthService } from "../src/auth/service";
// Creates a general manager, or restores access (new password, active, manager role) for an existing e-mail.
const db = new Database();
const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
new AuthService(db)
  .ensureManager({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME })
  .then((user) => console.log(`Gestor geral pronto: ${user!.email}`))
  .catch((error) => {
    console.error(
      `Não foi possível criar o gestor geral: ${error instanceof Error ? error.message : error}. Defina ADMIN_EMAIL e ADMIN_PASSWORD.`,
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
