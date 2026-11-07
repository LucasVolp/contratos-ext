import { api, date, type PageData } from "@/lib/api";
import type { SourcePartState } from "@/lib/contract-source-api";

/** A contract as listed from the Contratos.gov.br daily replica; decimals and dates are text. */
export type ContractSummary = {
  externalId: string;
  number: string;
  object: string | null;
  supplierName: string | null;
  /** CPFs arrive already masked by the API; CNPJs arrive as digits. */
  supplierDocument: string | null;
  uasg: string;
  unitName: string;
  startDate: string | null;
  endDate: string | null;
  globalValue: string | null;
  status: string;
};
export type ContractDetail = ContractSummary & {
  originUnitCode: string | null;
  typeName: string | null;
  category: string | null;
  processNumber: string | null;
  modality: string | null;
  sourceStatus: string | null;
  signatureDate: string | null;
  initialValue: string | null;
  accumulatedValue: string | null;
  installmentCount: number | null;
  capturedAt: string;
  normalizedAt: string;
};
export type ContractNotes = {
  text: string;
  updatedAt: string | null;
  updatedBy: string | null;
};
export type StaleUnit = { uasg: string; name: string; lastGoodAt: string | null };
/** Freshness of the daily replica for the units in view. */
export type SyncState = {
  lastCompletedAt: string | null;
  running: boolean;
  staleUnits: StaleUnit[];
};
export type ContractPage = PageData<ContractSummary> & { sync: SyncState };
export type ContractRecord = {
  contract: ContractDetail;
  parts: SourcePartState[];
  notes: ContractNotes;
};

export const NOTES_LIMIT = 10000;
export const NOTES_TOO_LONG =
  "As observações internas podem ter no máximo 10.000 caracteres.";
export const FIRST_LOAD =
  "A primeira atualização dos contratos está em andamento. Os contratos aparecem conforme cada UASG é concluída.";

export const listContracts = (query: URLSearchParams, signal?: AbortSignal) =>
  api<ContractPage>(`/contracts?${query}`, { signal });

export const getContract = (externalId: string, signal?: AbortSignal) =>
  api<ContractRecord>(`/contracts/${externalId}`, { signal });

export const saveContractNotes = (externalId: string, notes: string) =>
  api<ContractNotes>(`/contracts/${externalId}/notes`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });

/** Counts code points of the trimmed text, as the API does. */
export const notesTooLong = (text: string) =>
  [...text.trim()].length > NOTES_LIMIT;

const stampFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** "dd/mm/aaaa hh:mm" in Brasília time, the reference of the daily schedule. */
export function dateTime(value: string) {
  const parts = Object.fromEntries(
    stampFormat.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** Source and time of the last completed daily run, or the first-load notice. */
export function freshnessLine(sync: SyncState) {
  return sync.lastCompletedAt
    ? `Dados do Contratos.gov.br · atualizados em ${dateTime(sync.lastCompletedAt)}`
    : FIRST_LOAD;
}

/** Names a unit whose listing failed in the last run, so freshness is never overstated. */
export function staleUnitLine(unit: StaleUnit) {
  return `Não foi possível atualizar ${unit.name} (${unit.uasg}) na última execução. ${
    unit.lastGoodAt ? `Dados de ${dateTime(unit.lastGoodAt)}.` : "Ainda sem dados."
  }`;
}

export function vigency(startDate: string | null, endDate: string | null) {
  return startDate || endDate
    ? `${date(startDate)} a ${date(endDate)}`
    : "Vigência não informada";
}
