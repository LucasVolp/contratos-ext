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
