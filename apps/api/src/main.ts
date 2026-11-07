import { AuthRepository } from "./auth/repository";
import { AuthService } from "./auth/service";
import { createApplication } from "./app";
async function main() {
  const app = await createApplication();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      app.close().catch((error) => {
        console.error("Falha ao encerrar API:", error);
        process.exitCode = 1;
      });
    });
  }
  try {
    const auth = new AuthService(new AuthRepository(app.db));
    const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
    if (ADMIN_EMAIL && ADMIN_PASSWORD)
      await auth.ensureManager(
        { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME },
        true,
      );
    else if (!(await auth.db.userCount()))
      console.warn(
        "Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_PASSWORD para criar o gestor geral inicial.",
      );
    const address = await app.listen({
      port: Number(process.env.PORT || 4100),
      host: "0.0.0.0",
    });
    console.log(`API disponível em ${address}/api`);
  } catch (error) {
    await app.close();
    throw error;
  }
}
main().catch((error) => {
  console.error("Falha ao iniciar API:", error);
  process.exitCode = 1;
});
