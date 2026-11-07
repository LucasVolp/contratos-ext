"use client";
import { useSearchParams } from "next/navigation";
import { PageHead } from "@/components/ui";
import type { CommitmentDetail, Page } from "@/lib/finance-types";
import {
  Column,
  FinancialRow,
  FinanceTabs,
  FinanceTable,
  FinancePager,
  FinanceEmpty,
  Metrics,
  RequestState,
  calendar,
  display,
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
const childSections: { key: string; title: string; columns: Column[] }[] = [
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
export function CommitmentPage({ id }: { id: string }) {
  const query = useSearchParams().toString();
  const params = new URLSearchParams(query);
  const returnTo = params.get("returnTo") || "";
  const back =
    returnTo === "/financeiro/empenhos" ||
    returnTo.startsWith("/financeiro/empenhos?")
      ? returnTo
      : "/financeiro/empenhos";
  const { data, error, retry } = useFinance<CommitmentDetail>(
    `commitments/${encodeURIComponent(id)}`,
  );
  return (
    <div className="finance-page">
      <PageHead
        section="Financeiro"
        title={data?.resumedCode || data?.documentCode || "Detalhe do empenho"}
        back={back}
        description="Itens e movimentos vinculados ao documento."
      />
      <FinanceTabs
        active="commitments"
        query={
          data
            ? `managementCode=${data.managementCode || ""}&fiscalYear=${data.fiscalYear || ""}`
            : ""
        }
      />
      {!data ? (
        <RequestState error={error} retry={retry} />
      ) : (
        <>
          {!data.headerAvailable && (
            <p className="finance-note finance-warning" role="status">
              Este empenho aparece como referência em outros documentos. A
              identificação completa ainda não está disponível; datas e
              favorecido podem não estar informados.
            </p>
          )}
          <dl className="finance-metadata">
            {[
              ["Documento", data.documentCode],
              ["Exercício", data.fiscalYear],
              ["Órgão / gestão", data.managementCode],
              ["Unidade gestora", data.managementUnitCode],
              ["Unidade", data.unitName],
              ["Emissão", calendar(data.emissionDate)],
              ["Favorecido", data.favoredName],
              ["Código do favorecido", data.favoredCode],
              ["Processo", data.processNumber],
              ["Natureza", data.expenseNature],
              ["Tipo", data.header?.type],
              ["Plano orçamentário", data.header?.budgetPlanCode],
              ["Descrição do plano", data.header?.budgetPlanName],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>{display(value)}</dd>
              </div>
            ))}
          </dl>
          {data.header?.observation && (
            <p className="finance-note">{data.header.observation}</p>
          )}
          <Metrics
            values={data}
            columns={[
              amount("committedValue", "Empenhado · itens atuais"),
              amount("liquidatedValue", "Liquidado"),
              amount("paidValue", "Pago"),
            ]}
          />
          <Metrics
            values={data}
            columns={[
              amount(
                "liquidationPriorYearMovementValue",
                "Movimento de RP em liquidações",
              ),
              amount("priorYearPaidValue", "Restos a pagar pagos"),
            ]}
          />
          <p className="finance-note">
            Valores correntes e restos a pagar são apresentados separadamente. O
            valor empenhado depende dos itens disponíveis. As linhas abaixo
            representam vínculos e podem incluir mais de uma linha por
            documento.
          </p>
          {childSections.map((section) => (
            <ChildSection
              key={section.key}
              id={id}
              section={section}
              query={query}
            />
          ))}
        </>
      )}
    </div>
  );
}
function ChildSection({
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
      {!data ? (
        <RequestState error={error} retry={retry} />
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
