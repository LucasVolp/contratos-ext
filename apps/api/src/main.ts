import { createApplication } from "./app";
async function main() {
  const app = await createApplication();
  await app.listen(Number(process.env.PORT || 4100), "0.0.0.0");
  console.log(
    `API disponível em http://localhost:${process.env.PORT || 4100}/api`,
  );
}
main().catch((error) => {
  console.error("Falha ao iniciar API:", error);
  process.exitCode = 1;
});
