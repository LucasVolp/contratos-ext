import { BadRequestException } from "../errors";
import { validateFilters } from "@contracts/validation";
import { importRange } from "../domain";
import { Raw } from "./types";
export const asJson = (value: unknown): unknown =>
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
