import { currency } from "@/lib/api";
import type { ContractCommitments } from "@/lib/contract-commitments-api";
import { DataTable, type Column, type DataRow } from "@/components/ui/data-table";

const columns: Column[] = [
  { key: "unitName", label: "Campus" },
  { key: "count", label: "Empenhos" },
  { key: "committed", label: "Empenhado", money: true },
  { key: "liquidated", label: "Liquidado", money: true },
  { key: "paid", label: "Pago", money: true },
  { key: "rpRegistered", label: "RP inscrito", money: true },
  { key: "rpToLiquidate", label: "RP a liquidar", money: true },
  { key: "rpLiquidated", label: "RP liquidado", money: true },
  { key: "rpPaid", label: "RP pago", money: true },
];

/** What the contract provides to each campus (issuing UG), the contract total and its balance. */
export function CampusTotals({ data }: { data: ContractCommitments }) {
  const rows: DataRow[] = [
    ...data.campuses.map((campus) => ({ ...campus, id: campus.unitCode })),
    { ...data.totals, id: "total", unitName: "Total do contrato" },
  ];
  return (
    <>
      <DataTable rows={rows} columns={columns} caption="Tabela: empenhos por campus" />
      <section className="value-summary" aria-label="Saldo do contrato">
        <div>
          <span>SALDO DO CONTRATO</span>
          <strong>{currency(data.balance.remaining)}</strong>
          <small className="muted">
            Valor global informado pelo Contratos.gov.br ({currency(data.balance.globalValue)}) menos o total empenhado.
          </small>
        </div>
      </section>
    </>
  );
}
