import { api } from "@/lib/api";
import type { Page } from "@/lib/finance-types";
import type { Column, DataRow } from "@/components/ui/data-table";
import { formatSourceQuantity } from "@/lib/decimal-display";
import { dateTime } from "@/lib/contracts-api";

export type SourcePart = "history" | "items" | "invoices" | "guarantees" | "responsibles" | "files";
export type PartStatus = "AVAILABLE" | "NOT_FOUND" | "FAILED" | "MISSING";
export type SourcePartState = {
  part: string;
  status: PartStatus;
  capturedAt: string | null;
  lastAttemptAt: string | null;
  rowCount: number;
};
/** Display order of the parts exposed on the contract screen. */
export const sourceParts: SourcePart[] = ["history", "items", "invoices", "guarantees", "responsibles", "files"];

export const getContractSourcePart = (externalId: string, part: SourcePart, page: number, signal?: AbortSignal) =>
  api<Page<DataRow>>(`/contracts/${externalId}/source/${part}?page=${page}`, { signal });

export const partTitles: Record<SourcePart, string> = {
  history: "Termos e aditivos",
  items: "Itens",
  invoices: "Faturas",
  guarantees: "Garantias",
  responsibles: "Gestores e fiscais",
  files: "Arquivos",
};

const list = (value: unknown) =>
  Array.isArray(value) && value.length ? value.join(", ") : "Não informado";

export const partColumns: Record<SourcePart, Column[]> = {
  history: [
    { key: "number", label: "Número" },
    { key: "typeName", label: "Tipo" },
    { key: "qualifications", label: "Qualificação", format: list },
    { key: "signatureDate", label: "Assinatura", date: true },
    { key: "startDate", label: "Início", date: true },
    { key: "endDate", label: "Fim", date: true },
    { key: "newGlobalValue", label: "Novo valor global", money: true },
    { key: "observation", label: "Observação" },
  ],
  items: [
    { key: "purchaseItemNumber", label: "Item" },
    { key: "catalogItem", label: "Descrição", format: (value, row) => String(value ?? row.description ?? "Não informado") },
    { key: "quantity", label: "Quantidade", format: formatSourceQuantity },
    { key: "unitValue", label: "Valor unitário", money: true },
    { key: "totalValue", label: "Valor total", money: true },
    { key: "startDate", label: "Início", date: true },
  ],
  invoices: [
    { key: "number", label: "Número" },
    { key: "billingInstrument", label: "Instrumento" },
    { key: "issueDate", label: "Emissão", date: true },
    { key: "dueDate", label: "Vencimento", date: true },
    { key: "amount", label: "Valor", money: true },
    { key: "disallowance", label: "Glosa", money: true },
    { key: "netAmount", label: "Valor líquido", money: true },
    { key: "status", label: "Situação" },
  ],
  guarantees: [
    { key: "guaranteeType", label: "Tipo" },
    { key: "amount", label: "Valor", money: true },
    { key: "dueDate", label: "Vencimento", date: true },
  ],
  responsibles: [
    { key: "name", label: "Nome" },
    { key: "maskedDocument", label: "CPF" },
    { key: "role", label: "Função" },
    { key: "ordinance", label: "Portaria" },
    { key: "status", label: "Situação" },
    { key: "startDate", label: "Início", date: true },
    { key: "endDate", label: "Fim", date: true },
  ],
  files: [
    { key: "description", label: "Arquivo", externalLink: (row) => (row.url ?? row.seiLink ?? null) as string | null, linkText: "Abrir arquivo" },
    { key: "fileType", label: "Tipo" },
    { key: "origin", label: "Origem" },
  ],
};

const stamp = (value: string | null) =>
  value ? dateTime(value) : "data não informada";

/** Plain-language freshness of one part, as the source last answered it. */
export function freshness(state: SourcePartState): string {
  switch (state.status) {
    case "AVAILABLE":
      return `Atualizado em ${stamp(state.lastAttemptAt ?? state.capturedAt)}`;
    case "FAILED":
      return state.capturedAt
        ? `A última consulta falhou em ${stamp(state.lastAttemptAt)}; exibindo dados de ${stamp(state.capturedAt)}.`
        : `A última consulta falhou em ${stamp(state.lastAttemptAt)}.`;
    case "NOT_FOUND":
      return "O Contratos.gov.br não possui registros desta parte.";
    default:
      return "Não consultado";
  }
}

/** Whether a part has stored rows worth requesting. */
export const hasRows = (state: SourcePartState) =>
  (state.status === "AVAILABLE" || state.status === "FAILED") && state.rowCount > 0;
