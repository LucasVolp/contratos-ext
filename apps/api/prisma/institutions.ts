import { PrismaClient } from "../src/generated/prisma/client";
// Active UASGs in MS confirmed in Compras.gov.br (modulo-uasg/1_consultarUasg, siglaUf=MS) on 31/10/2026.
// University hospitals have their own UASGs, mostly under Ebserh, and are left out on purpose.
export const MS_INSTITUTIONS: Array<{
  uasg: string;
  name: string;
  organization: string;
}> = [
  { uasg: "154054", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Sede Campo Grande" },
  { uasg: "154064", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Campus de Aquidauana" },
  { uasg: "151068", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Campus de Chapadão do Sul" },
  { uasg: "154065", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Campus de Corumbá" },
  { uasg: "150161", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Campus de Coxim" },
  { uasg: "151071", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Campus de Naviraí" },
  { uasg: "151069", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Campus de Nova Andradina" },
  { uasg: "150162", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Campus de Paranaíba" },
  { uasg: "151070", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Campus de Ponta Porã" },
  { uasg: "154067", organization: "UFMS", name: "Universidade Federal de Mato Grosso do Sul - Campus de Três Lagoas" },
  { uasg: "154502", organization: "UFGD", name: "Universidade Federal da Grande Dourados - Dourados" },
  { uasg: "457239", organization: "UEMS", name: "Universidade Estadual de Mato Grosso do Sul - Fundação UEMS Dourados" },
  { uasg: "926113", organization: "UEMS", name: "Universidade Estadual de Mato Grosso do Sul - UEMS Dourados" },
  { uasg: "158132", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Reitoria" },
  { uasg: "158448", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Aquidauana" },
  { uasg: "158449", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Campo Grande" },
  { uasg: "158450", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Corumbá" },
  { uasg: "158451", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Coxim" },
  { uasg: "155848", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Dourados" },
  { uasg: "155850", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Jardim" },
  { uasg: "155849", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Naviraí" },
  { uasg: "158452", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Nova Andradina" },
  { uasg: "158453", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Ponta Porã" },
  { uasg: "158454", organization: "IFMS", name: "Instituto Federal de Mato Grosso do Sul - Campus Três Lagoas" },
];
/** Idempotent: creates missing UASGs, keeps edited names and only fills an empty organization. */
export async function seedInstitutions(db: PrismaClient) {
  let created = 0;
  for (const institution of MS_INSTITUTIONS) {
    const existing = await db.institution.findUnique({
      where: { uasg: institution.uasg },
    });
    if (!existing) {
      await db.institution.create({ data: institution });
      created++;
    } else if (!existing.organization)
      await db.institution.update({
        where: { id: existing.id },
        data: { organization: institution.organization },
      });
  }
  return { created, total: MS_INSTITUTIONS.length };
}
