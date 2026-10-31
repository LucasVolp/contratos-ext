import { BadRequestException, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
Decimal.set({ precision: 60 });
export type Data = Record<string, any>;
export function date(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException(`Data inválida em ${field}; use AAAA-MM-DD.`);
  return value;
}
export function decimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{1,18}(\.\d{1,6})?$/.test(value))
    throw new BadRequestException(
      `${field}: informe decimal não negativo, com até 18 inteiros e 6 casas decimais.`,
    );
  return value;
}
function text(body: Data, key: string, required = false): string {
  const value = body[key] ?? "";
  if (
    typeof value !== "string" ||
    value.length > 20000 ||
    (required && !value.trim())
  )
    throw new BadRequestException(
      `${key}: texto ${required ? "obrigatório" : "inválido"}.`,
    );
  return value.trim();
}
function dates(body: Data, keys = ["startDate", "endDate"]): Data {
  const result: Data = {};
  for (const key of keys) result[key] = date(body[key], key);
  if (result.startDate && result.endDate && result.startDate > result.endDate)
    throw new BadRequestException(
      "O início da vigência deve ser anterior ou igual ao fim.",
    );
  return result;
}
export function validateContract(body: Data): Data {
  if (!body || Array.isArray(body) || typeof body !== "object")
    throw new BadRequestException("Informe os dados do contrato.");
  const result: Data = {};
  for (const key of [
    "number",
    "object",
    "supplierName",
    "supplierDocument",
    "uasg",
  ])
    result[key] = text(body, key, true);
  result.unitName = text(body, "unitName");
  Object.assign(result, dates(body));
  for (const key of ["initialValue", "globalValue"])
    result[key] = decimal(body[key], key);
  return result;
}
export const recordStrings = [
  "number",
  "processNumber",
  "purchaseNumber",
  "object",
  "uasg",
  "organizationName",
  "organizationDocument",
  "organizationStreet",
  "organizationNumber",
  "organizationCity",
  "organizationState",
  "authorityName",
  "authorityRole",
  "authorityRegistration",
  "ordinanceNumber",
  "supplierName",
  "supplierDocument",
  "supplierRepresentative",
];
export function validateRecord(body: Data): Data {
  if (!body || Array.isArray(body) || typeof body !== "object")
    throw new BadRequestException("Informe os dados da ata.");
  const result: Data = {};
  for (const key of recordStrings)
    result[key] = text(body, key, ["number", "object", "uasg"].includes(key));
  Object.assign(
    result,
    dates(body, [
      "startDate",
      "endDate",
      "ordinanceDate",
      "ordinancePublicationDate",
    ]),
  );
  result.modality = body.modality ?? "PREGAO";
  if (!["PREGAO", "DISPENSA"].includes(result.modality))
    throw new BadRequestException("Modalidade inválida.");
  result.purchaseYear = body.purchaseYear ?? null;
  if (
    result.purchaseYear !== null &&
    (!Number.isInteger(result.purchaseYear) ||
      result.purchaseYear < 1900 ||
      result.purchaseYear > 2200)
  )
    throw new BadRequestException("Ano da compra inválido.");
  result.renewable = body.renewable ?? false;
  if (typeof result.renewable !== "boolean")
    throw new BadRequestException("renewable deve ser booleano.");
  if (body.items !== undefined && !Array.isArray(body.items))
    throw new BadRequestException("Itens devem ser uma lista.");
  const seen = new Set<number>();
  result.items = (body.items ?? []).map((item: Data) => {
    if (!item || !Number.isInteger(item.number) || item.number < 1)
      throw new BadRequestException(
        "Número do item deve ser inteiro positivo.",
      );
    if (seen.has(item.number))
      throw new BadRequestException("Número de item deve ser único na ata.");
    seen.add(item.number);
    const r: Data = { number: item.number };
    for (const key of ["description", "brand", "model", "unit", "warranty"])
      r[key] = text(item, key);
    for (const key of ["quantity", "minimumQuantity", "unitPrice"])
      r[key] = decimal(item[key] ?? "0", key);
    if (new Decimal(r.minimumQuantity).gt(r.quantity))
      throw new BadRequestException(
        "Quantidade mínima não pode superar a quantidade.",
      );
    return r;
  });
  return result;
}
export function contractStatus(record: Data, now = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  if (!record.startDate || !record.endDate) return "UNKNOWN";
  if (record.startDate > today) return "UPCOMING";
  if (record.endDate < today) return "EXPIRED";
  const boundary = new Date(`${today}T00:00:00Z`);
  boundary.setUTCDate(boundary.getUTCDate() + 30);
  return record.endDate <= boundary.toISOString().slice(0, 10)
    ? "EXPIRING"
    : "ACTIVE";
}
export function overlaps(record: Data, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  return (
    !!record.startDate &&
    !!record.endDate &&
    (!to || record.startDate <= to) &&
    (!from || record.endDate >= from)
  );
}
export function recordTotal(record: Data): string {
  return (record.items ?? [])
    .reduce(
      (sum: Decimal, item: Data) =>
        sum.plus(
          new Decimal(item.quantity.toString()).mul(item.unitPrice.toString()),
        ),
      new Decimal(0),
    )
    .toFixed();
}
export function readiness(
  record: Data,
  itemId?: string,
): { ready: boolean; missingFields: string[] } {
  const required = [
    "number",
    "processNumber",
    "purchaseNumber",
    "object",
    "organizationName",
    "organizationDocument",
    "organizationStreet",
    "organizationCity",
    "organizationState",
    "authorityName",
    "authorityRole",
    "supplierName",
    "supplierDocument",
  ];
  const missingFields = required.filter((key) => !record[key]?.trim());
  const items = itemId
    ? (record.items ?? []).filter((item: Data) => item.id === itemId)
    : (record.items ?? []);
  if (itemId && !items.length)
    throw new NotFoundException("Item não encontrado nesta ata.");
  if (!items.length) missingFields.push("items");
  for (const item of items) {
    for (const key of ["description", "unit"])
      if (!item[key]?.trim()) missingFields.push(`items.${item.number}.${key}`);
    for (const key of ["quantity", "unitPrice"])
      if (!new Decimal(item[key].toString()).gt(0))
        missingFields.push(`items.${item.number}.${key}`);
  }
  return { ready: !missingFields.length, missingFields };
}
export function pagination(query: Data) {
  const page = Number(query.page ?? 1),
    limit = Number(query.limit ?? 12);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new BadRequestException(
      "Paginação inválida: page >= 1 e limit entre 1 e 100.",
    );
  return { page, limit };
}
export function importRange(body: Data) {
  const from = date(body?.from, "from"),
    to = date(body?.to, "to");
  if (!from || !to || from > to)
    throw new BadRequestException(
      "Informe período inicial e final válido para importar.",
    );
  return { from, to, uasg: text(body, "uasg", true) };
}
