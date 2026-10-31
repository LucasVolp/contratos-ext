export type FieldErrors = Record<string, string>;
export function normalizeDocument(value: unknown): string;
export function isCPF(value: unknown): boolean;
export function isCNPJ(value: unknown): boolean;
export function isUASG(value: unknown): boolean;
export function isUF(value: unknown): boolean;
export function isDate(value: unknown): boolean;
export function parseDecimal(value: unknown): string | null;
export function formatDecimal(value: unknown, currency?: boolean): string;
export function maskDocument(value: unknown, cnpjOnly?: boolean): string;
export function validateFields(
  body: Record<string, any>,
  kind?: "record" | "contract" | "import",
): FieldErrors;
export function validateFilters(body: Record<string, any>): FieldErrors;
export function blurFieldErrors(
  previous: FieldErrors,
  current: FieldErrors,
  name: string,
): FieldErrors;
