"use client";
import type { Page } from "@/lib/finance-types";
import { ErrorState } from "@/components/ui";
import {
  type Column,
  type FinancialRow,
  FinanceTable,
  FinancePager,
  FinanceEmpty,
  RequestState,
  useFinance,
} from "./shared";
const amount = (key: string, label: string): Column => ({
  key,
  label,
  money: true,
});
const documentColumns: Column[] = [
  { key: "documentCode", label: "Documento" },
  { key: "emissionDate", label: "Emissão", date: true },
  { key: "favoredName", label: "Favorecido" },
  { key: "expenseNature", label: "Natureza" },
  { key: "subitemCode", label: "Subitem" },
  { key: "subitemDescription", label: "Descrição do subitem" },
];
export const childSections: {
  key: string;
  title: string;
  columns: Column[];
}[] = [
  {
    key: "items",
    title: "Itens",
    columns: [
      { key: "sequential", label: "Sequência" },
      { key: "expenseNature", label: "Natureza" },
      { key: "subitemCode", label: "Subitem" },
      { key: "description", label: "Descrição" },
      { key: "quantity", label: "Quantidade" },
      amount("unitPrice", "Preço unitário"),
      amount("currentValue", "Valor atual"),
      amount("currentPrice", "Preço atual"),
      amount("totalValue", "Valor total"),
    ],
  },
  {
    key: "history",
    title: "Histórico dos itens",
    columns: [
      { key: "itemSequential", label: "Item" },
      { key: "operationDate", label: "Data", date: true },
      { key: "operationType", label: "Operação" },
      { key: "quantity", label: "Quantidade" },
      amount("unitPrice", "Preço unitário"),
      amount("totalValue", "Valor total"),
    ],
  },
  {
    key: "liquidations",
    title: "Liquidações",
    columns: [
      ...documentColumns,
      amount("liquidatedValue", "Liquidado"),
      amount("priorYearMovementValue", "Movimento de RP"),
      amount("registeredPayablesValue", "RP inscritos"),
      amount("canceledPayablesValue", "RP cancelados"),
    ],
  },
  {
    key: "payments",
    title: "Pagamentos",
    columns: [
      ...documentColumns,
      { key: "processNumber", label: "Processo" },
      amount("paidValue", "Pago"),
      amount("priorYearPaidValue", "RP pagos"),
      amount("registeredPayablesValue", "RP inscritos"),
      amount("canceledPayablesValue", "RP cancelados"),
    ],
  },
];
export function CommitmentCollection({
  id,
  section,
  query,
}: {
  id: string;
  section: (typeof childSections)[number];
  query: string;
}) {
  const params = new URLSearchParams(query);
  const pageKey = `${section.key}Page`;
  const page = params.get(pageKey) || "1";
  const { data, error, retry } = useFinance<Page<FinancialRow>>(
    `commitments/${encodeURIComponent(id)}/${section.key}?page=${encodeURIComponent(page)}&limit=20`,
  );
  return (
    <section className="registry finance-child" aria-label={section.title}>
      <div className="registry-top">
        <h2>{section.title}</h2>
        {data && <span>{data.total} registros</span>}
      </div>
      {error && <ErrorState message={error.message} retry={retry} />}
      {!data ? (
        !error && <RequestState retry={retry} />
      ) : (
        <>
          {data.data.length ? (
            <FinanceTable
              rows={data.data}
              columns={section.columns}
              caption={section.title}
            />
          ) : (
            <FinanceEmpty />
          )}
          <FinancePager result={data} query={query} pageKey={pageKey} />
        </>
      )}
    </section>
  );
}
