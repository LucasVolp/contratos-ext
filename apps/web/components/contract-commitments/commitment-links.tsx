"use client";
import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DataTable, type Column, type DataRow } from "@/components/ui/data-table";
import {
  committedWithFinance,
  financeStatusLabel,
  type CommitmentLink,
  type ContractCommitments,
} from "@/lib/contract-commitments-api";

const link = (row: DataRow) => row as unknown as CommitmentLink;

const columns: Column[] = [
  {
    key: "number",
    label: "Empenho",
    link: (row) => (link(row).linkable ? `/financeiro/empenhos/${link(row).financeCommitmentId}` : null),
  },
  { key: "unitName", label: "Campus", format: (value, row) => String(value ?? link(row).unitCode) },
  { key: "issueDate", label: "Emissão", date: true },
  { key: "expenseNature", label: "Natureza" },
  { key: "committed", label: "Empenhado", format: (_, row) => committedWithFinance(link(row)) },
  { key: "liquidated", label: "Liquidado", money: true },
  { key: "paid", label: "Pago", money: true },
  { key: "financeStatus", label: "Situação", format: (_, row) => financeStatusLabel(link(row)) },
];

/** The commitments Contratos.gov.br lists for the contract, filterable by campus. */
export function CommitmentLinks({ data }: { data: ContractCommitments }) {
  const id = useId();
  const [unit, setUnit] = useState("");
  const rows = data.commitments
    .filter((c) => !unit || c.unitCode === unit)
    .map((c) => ({ ...c, id: c.transparencyCode }) as unknown as DataRow);
  return (
    <>
      <div className="filter-field">
        <Label htmlFor={id}>Campus</Label>
        <NativeSelect id={id} value={unit} onChange={(e) => setUnit(e.target.value)}>
          <NativeSelectOption value="">Todos os campi</NativeSelectOption>
          {data.campuses.map((campus) => (
            <NativeSelectOption key={campus.unitCode} value={campus.unitCode}>
              {campus.unitName}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <DataTable rows={rows} columns={columns} caption="Tabela: empenhos do contrato" />
    </>
  );
}
