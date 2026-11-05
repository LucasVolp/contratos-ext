import { isDate } from "@contracts/validation";
import { BadRequestException } from "../errors";
import { CommitmentFilters, FinanceQuery, Pagination, UnitFilters } from "./types";

function invalid(field: string, message: string): never {
  throw new BadRequestException({ message, fieldErrors: { [field]: message } });
}
function known(query: FinanceQuery, fields: string[]) {
  for (const key of Object.keys(query)) {
    if (!fields.includes(key)) invalid(key, `Parâmetro de consulta desconhecido: ${key}.`);
  }
}
function text(query: FinanceQuery, name: string, maximum = 200) {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    invalid(name, `Valor inválido para ${name}.`);
  }
  return value.trim();
}
function code(query: FinanceQuery, name: string, pattern: RegExp) {
  const value = text(query, name);
  if (value !== undefined && !pattern.test(value)) invalid(name, `Código inválido para ${name}.`);
  return value;
}
function positive(query: FinanceQuery, name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  const value = text(query, name);
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) invalid(name, `Informe um inteiro positivo para ${name}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) invalid(name, `Valor fora do limite para ${name}.`);
  return number;
}
function pagination(query: FinanceQuery): Pagination {
  const page = positive(query, "page", 1);
  const limit = positive(query, "limit", 20, 100);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) invalid("page", "Página fora do limite.");
  return { page, limit, offset };
}
export function commitmentId(value: string): string {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    invalid("commitmentId", "Identificador de empenho inválido.");
  }
  return value;
}
export function commitmentFilters(query: FinanceQuery): CommitmentFilters {
  known(query, ["managementCode", "managementUnitCode", "fiscalYear", "expenseNature", "favoredCode", "search", "from", "to", "page", "limit"]);
  const managementCode = code(query, "managementCode", /^[0-9]{5}$/);
  if (!managementCode) invalid("managementCode", "Informe o código da gestão.");
  const year = code(query, "fiscalYear", /^[0-9]{4}$/);
  if (year && (Number(year) < 1900 || Number(year) > 9999)) invalid("fiscalYear", "Exercício inválido.");
  const from = text(query, "from");
  const to = text(query, "to");
  for (const [field, value] of [["from", from], ["to", to]] as const) {
    if (value !== undefined && !isDate(value)) invalid(field, "Data inválida; use AAAA-MM-DD.");
  }
  if (from && to && from > to) invalid("to", "A data final deve ser posterior ou igual à inicial.");
  return {
    ...pagination(query), managementCode,
    managementUnitCode: code(query, "managementUnitCode", /^[0-9]{6}$/),
    fiscalYear: year ? Number(year) : undefined,
    expenseNature: code(query, "expenseNature", /^(?:[0-9]{6}|[0-9]{8})$/),
    favoredCode: text(query, "favoredCode", 100), search: text(query, "search"), from, to,
  };
}
export function unitFilters(query: FinanceQuery): UnitFilters {
  known(query, ["managementCode", "search", "page", "limit"]);
  return { ...pagination(query), managementCode: code(query, "managementCode", /^[0-9]{5}$/), search: text(query, "search") };
}
export function collectionFilters(query: FinanceQuery, history = false) {
  known(query, history ? ["page", "limit", "itemSequential"] : ["page", "limit"]);
  return { ...pagination(query), itemSequential: history && query.itemSequential !== undefined ? positive(query, "itemSequential", 1, 2147483647) : undefined };
}
export function detailFilters(query: FinanceQuery) { known(query, []); }
