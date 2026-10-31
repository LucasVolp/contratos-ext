import { BadRequestException } from "@nestjs/common";
import { validateFilters } from "@contracts/validation";
import { Prisma } from "../generated/prisma/client";
import { importRange } from "../domain";
import { Raw } from "./types";
export const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
export const plain = <T = Raw>(value: unknown): T =>
  JSON.parse(JSON.stringify(value));
export function filters(query: Raw) {
  const errors = validateFilters(query);
  if (Object.keys(errors).length)
    throw new BadRequestException({
      message: Object.values(errors).join(" · "),
      fieldErrors: errors,
    });
}
export function syncRange(body: Raw, maxDays?: number) {
  const range = importRange(body);
  if (
    maxDays &&
    (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1 > maxDays
  )
    throw new BadRequestException({
      message: `Use um intervalo de até ${maxDays} dias.`,
      fieldErrors: { to: `O intervalo máximo é de ${maxDays} dias.` },
    });
  return range;
}
export function linkedWhere(purchase: {
  externalId: string;
  pncpId: string | null;
}): Prisma.PublicRecordWhereInput {
  return purchase.pncpId
    ? {
        OR: [
          { purchaseExternalId: purchase.externalId },
          { purchaseExternalId: null, purchasePncpId: purchase.pncpId },
        ],
      }
    : { purchaseExternalId: purchase.externalId };
}
