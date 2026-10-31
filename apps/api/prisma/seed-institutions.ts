import "../src/env";
import { Database } from "../src/database";
import { seedInstitutions } from "./institutions";
const db = new Database();
seedInstitutions(db)
  .then(({ created, total }) =>
    console.log(
      `Instituições de ensino de MS: ${created} criadas, ${total - created} já existentes preservadas.`,
    ),
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
