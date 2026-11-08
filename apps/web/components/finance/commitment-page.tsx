"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { maskDocument, isCPF } from "@contracts/validation";
import { PageHead, ErrorState } from "@/components/ui";
import { useSession } from "@/lib/session";
import type { CommitmentDetail } from "@/lib/finance-types";
import { currency, date } from "@/lib/api";
import { FinanceTabs, RequestState, display, useFinance } from "./shared";
import { FinanceContent } from "./finance-content";
import { PanelMetrics } from "./panel-metrics";
import { CommitmentCollection, childSections } from "./commitment-collections";
import { CommitmentContract } from "../contract-commitments/commitment-contract";
export function CommitmentPage({ id }: { id: string }) {
  const { viewer } = useSession();
  const params = useSearchParams();
  const query = params.toString();
  const returnTo = params.get("returnTo") || "";
  const back =
    returnTo === "/financeiro/empenhos" ||
    returnTo.startsWith("/financeiro/empenhos?")
      ? returnTo
      : "/financeiro/empenhos";
  const result = useFinance<CommitmentDetail>(
    `commitments/${encodeURIComponent(id)}`,
  );
  const [active, setActive] = useState("items");
  const section = childSections.find((section) => section.key === active)!;
  const data = result.data;
  function beneficiary(code: string | null) {
    if (!code) return "Não informado";
    const formatted = maskDocument(code);
    return !viewer.allInstitutions && isCPF(code)
      ? `***.${formatted.slice(4, 11)}-**`
      : formatted;
  }
  return (
    <div className="finance-panel">
      <PageHead
        title={data?.resumedCode || data?.documentCode || "Detalhe do empenho"}
        back={back}
        description={
          data
            ? `${data.unitName || "Unidade não informada"} · ${data.favoredName || "Favorecido não informado"}`
            : "Identificação e movimentos do documento."
        }
      />
      <FinanceTabs
        active="commitments"
        query={
          data
            ? new URLSearchParams({
                managementCode: data.managementCode || "",
                fiscalYear: String(data.fiscalYear || ""),
              }).toString()
            : ""
        }
      />
      {result.error && data && (
        <ErrorState message={result.error.message} retry={result.retry} />
      )}
      {!data ? (
        <RequestState error={result.error} retry={result.retry} />
      ) : (
        <>
          {!data.headerAvailable && (
            <p className="finance-note finance-warning" role="status">
              Este empenho aparece como referência em outros documentos. A
              identificação completa ainda não está disponível; datas e
              favorecido podem não estar informados.
            </p>
          )}
          <CommitmentContract commitmentId={id} />
          <PanelMetrics
            metrics={[
              {
                key: "committedValue",
                label: "Empenhado",
                value: data.committedValue,
                hint: "Valor dos itens atuais disponíveis",
                tone: "committed",
              },
              {
                key: "liquidatedValue",
                label: "Liquidado",
                value: data.liquidatedValue,
                hint: "Liquidações vinculadas ao empenho",
                tone: "liquidated",
              },
              {
                key: "paidValue",
                label: "Pago",
                value: data.paidValue,
                hint: "Pagamentos vinculados ao empenho",
                tone: "paid",
              },
            ]}
          />
          <div className="commitment-overview">
            <dl className="finance-metadata">
              {[
                ["Documento", data.documentCode],
                ["Unidade", data.unitName],
                ["Emissão", date(data.emissionDate)],
                ["Favorecido", data.favoredName],
                ["Processo", data.processNumber],
                ["Natureza de despesa", data.expenseNature],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{display(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <details className="commitment-document-details">
            <summary>Identificação completa do documento</summary>
            <dl className="finance-metadata">
              {[
                ["Exercício", data.fiscalYear],
                ["Órgão / gestão", data.managementCode],
                ["Unidade gestora", data.managementUnitCode],
                ["Código do favorecido", beneficiary(data.favoredCode)],
                ["Tipo", data.header?.type],
                ["Plano orçamentário", data.header?.budgetPlanCode],
                ["Descrição do plano", data.header?.budgetPlanName],
                ["Valor original", currency(data.header?.originalValue)],
                [
                  "Valor do documento em reais",
                  currency(data.header?.valueBrl),
                ],
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
          </details>
          <div className="commitment-prior-year">
            <span>
              Movimento de restos a pagar em liquidações{" "}
              <strong>
                {currency(data.liquidationPriorYearMovementValue)}
              </strong>
            </span>
            <span>
              Restos a pagar pagos{" "}
              <strong>{currency(data.priorYearPaidValue)}</strong>
            </span>
          </div>
          <div
            className="commitment-sections"
            role="group"
            aria-label="Dados do empenho"
          >
            {childSections.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={active === item.key}
                aria-controls="commitment-collection"
                onClick={() => setActive(item.key)}
              >
                {item.title}
              </button>
            ))}
          </div>
          <FinanceContent identity={active}>
            <div id="commitment-collection">
              <CommitmentCollection
                key={active}
                id={id}
                section={section}
                query={query}
              />
            </div>
          </FinanceContent>
          <p className="panel-footnote">
            Valores correntes e restos a pagar são apresentados separadamente.
            Cada linha de liquidação ou pagamento representa um vínculo, podendo
            haver mais de uma linha por documento.{" "}
            {data.source === "TRANSPARENCY_PORTAL"
              ? "Fonte: Portal da Transparência."
              : ""}{" "}
            Consulta:{" "}
            {result.loadedAt
              ? new Date(result.loadedAt).toLocaleString("pt-BR")
              : "Não consultado"}
            .
          </p>
        </>
      )}
    </div>
  );
}
