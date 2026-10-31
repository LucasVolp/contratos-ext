export type Contract = {
  id: string;
  number: string;
  object: string;
  supplierName: string;
  supplierDocument: string;
  uasg: string;
  unitName: string;
  startDate: string | null;
  endDate: string | null;
  initialValue: string;
  globalValue: string;
  status: string;
  source: string;
  lastSyncedAt?: string;
};
export type Item = {
  id?: string;
  number: number;
  description: string;
  brand: string;
  model: string;
  unit: string;
  quantity: string;
  minimumQuantity: string;
  unitPrice: string;
  warranty: string;
};
export type Export = {
  id: string;
  format: string;
  createdAt: string;
  templateVersion: string;
  itemNumber?: number;
};
export type RecordData = {
  id: string;
  number: string;
  object: string;
  uasg: string;
  items: Item[];
  totalValue: string;
  exports?: Export[];
  [key: string]: unknown;
};
export type PageData<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  stats: {
    count: number;
    totalValue: string;
    expiringCount?: number;
    exportsCount?: number;
  };
};
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("Não foi possível conectar ao servidor. Tente novamente.");
  }
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ message: "Não foi possível concluir a solicitação." }));
    throw new Error(
      Array.isArray(data.message) ? data.message.join(" · ") : data.message,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const currency = (value: unknown) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value || 0),
  );
export const date = (value: unknown) =>
  value
    ? new Date(String(value).slice(0, 10) + "T12:00:00").toLocaleDateString(
        "pt-BR",
      )
    : "Não informada";
export function decimal(value: string) {
  const trimmed = value.trim().replace(/\s/g, "");
  if (trimmed.includes(","))
    return trimmed.replace(/\./g, "").replace(",", ".");
  return trimmed || "0";
}
export const statusLabels: Record<string, string> = {
  ACTIVE: "Em vigor",
  EXPIRING: "Vence em breve",
  EXPIRED: "Encerrado",
  UPCOMING: "A iniciar",
  UNKNOWN: "Sem vigência",
};
export const labels: Record<string, string> = {
  number: "Número",
  object: "Objeto",
  uasg: "UASG",
  processNumber: "Número do processo",
  purchaseNumber: "Número da compra",
  purchaseYear: "Ano da compra",
  organizationName: "Nome da organização",
  organizationDocument: "CNPJ da organização",
  organizationStreet: "Logradouro",
  organizationNumber: "Número do endereço",
  organizationCity: "Cidade",
  organizationState: "UF",
  authorityName: "Nome do signatário",
  authorityRole: "Cargo",
  authorityRegistration: "Matrícula",
  ordinanceNumber: "Número da portaria",
  ordinanceDate: "Data da portaria",
  ordinancePublicationDate: "Publicação da portaria",
  supplierName: "Razão social do fornecedor",
  supplierDocument: "CNPJ / CPF do fornecedor",
  supplierRepresentative: "Representante do fornecedor",
  unitName: "Unidade",
  startDate: "Início da vigência",
  endDate: "Fim da vigência",
  initialValue: "Valor inicial",
  globalValue: "Valor global",
  description: "Descrição",
  unit: "Unidade de fornecimento",
  quantity: "Quantidade",
  unitPrice: "Preço unitário",
  items: "Itens",
};
export function fieldLabel(key: string) {
  return key
    .split(".")
    .map(
      (part) =>
        labels[part] || (/^\d+$/.test(part) ? `item ${Number(part)}` : part),
    )
    .join(" / ");
}
