import { createApplication } from "./app";
import { AuthService } from "./auth/service";
async function bootstrapManager(auth: AuthService) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    if (!(await auth.db.user.count()))
      console.warn(
        "Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_PASSWORD para criar o gestor geral inicial.",
      );
    return;
  }
  const user = await auth.ensureManager(
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME },
    true,
  );
  if (user) console.log(`Gestor geral inicial criado: ${user.email}`);
}
async function main() {
  const app = await createApplication();
  await bootstrapManager(app.get(AuthService));
  await app.listen(Number(process.env.PORT || 4100), "0.0.0.0");
  console.log(
    `API disponível em http://localhost:${process.env.PORT || 4100}/api`,
  );
}
main().catch((error) => {
  console.error("Falha ao iniciar API:", error);
  process.exitCode = 1;
});
