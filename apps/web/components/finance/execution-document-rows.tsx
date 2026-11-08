"use client";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight } from "lucide-react";
import { ErrorState, Loading, Pager } from "@/components/ui";
import { financePath } from "@/lib/finance-api";
import type { Page } from "@/lib/finance-types";
import { natureCode } from "@/lib/finance-presentation";
import { FinanceTable, type Column, type FinancialRow } from "./shared";
import { useFinanceQuery } from "./use-finance-query";
import { FinanceContent } from "./finance-content";
const pageNumber = (value: string | null) =>
  /^\d{1,6}$/.test(value || "") && Number(value) > 0 ? Number(value) : 1;
type Change = (values: Record<string, string>) => void;
const sections = [
  {
    key: "items",
    label: "Itens do empenho",
    amount: "currentValue",
    amountLabel: "Valor atual do item",
  },
  {
    key: "liquidations",
    label: "Liquidações",
    amount: "liquidatedValue",
    amountLabel: "Liquidado no vínculo",
  },
  {
    key: "payments",
    label: "Pagamentos",
    amount: "paidValue",
    amountLabel: "Pago no vínculo",
  },
];

export function ExecutionDocumentRows({
  id,
  label,
  params,
  onChange,
  revision,
}: {
  id: string;
  label: string;
  params: URLSearchParams;
  onChange: Change;
  revision: number;
}) {
  const section =
    sections.find((item) => item.key === params.get("sourceKind")) ||
    sections[0];
  const page = pageNumber(params.get("sourcePage"));
  const result = useFinanceQuery<Page<FinancialRow>>(
    financePath(`commitments/${encodeURIComponent(id)}/${section.key}`, "", {
      page: String(page),
      limit: "5",
    }),
    undefined,
    revision,
    `commitments/${id}/${section.key}`,
  );
  const columns: Column[] = [
    { key: "subelement", label: "Subelemento" },
    { key: "subitemDescription", label: "Descrição do subelemento" },
    ...(section.key === "items"
      ? [{ key: "description", label: "Descrição do item" }]
      : [
          { key: "documentCode", label: "Documento de origem" },
          { key: "emissionDate", label: "Emissão", date: true },
        ]),
    { key: section.amount, label: section.amountLabel, money: true },
    { key: "updatedAt", label: "Importação", date: true },
  ];
  const rows = (result.data?.data || []).map((row) => {
    const nature = String(row.expenseNature || "");
    const subitem = String(row.subitemCode || "");
    const subelement = /^\d{8}$/.test(nature)
      ? `${natureCode(nature.slice(0, 6))}.${nature.slice(6)}`
      : /^\d{6}$/.test(nature) && /^\d{2}$/.test(subitem)
        ? `${natureCode(nature)}.${subitem}`
        : subitem || null;
    return { ...row, subelement };
  });
  return (
    <div className="execution-document-detail" aria-live="polite">
      <h3>{label}</h3>
      <div
        className="execution-document-modes"
        role="group"
        aria-label="Origem dos subelementos"
      >
        {sections.map((item) => (
          <Button
            type="button"
            variant="outline"
            key={item.key}
            aria-pressed={item.key === section.key}
            onClick={() => onChange({ sourceKind: item.key, sourcePage: "" })}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <p className="execution-chart-note">
        Todos os registros do documento selecionado. Cada linha mantém sua
        classificação de origem; seus valores não são somados ao total mensal do
        elemento.
      </p>
      {result.error ? (
        <ErrorState message={result.error.message} retry={result.retry} />
      ) : null}
      <FinanceContent identity={section.key} busy={result.loading}>
        {!result.data ? (
          !result.error ? (
            <Loading />
          ) : null
        ) : (
          <>
            {rows.length ? (
              <>
                <p className="execution-table-hint">
                  <ArrowLeftRight size={14} aria-hidden="true" /> Role a tabela
                  para o lado para ver todas as colunas.
                </p>
                <FinanceTable
                  rows={rows}
                  columns={columns}
                  caption="Subelementos do documento"
                />
              </>
            ) : (
              <p className="execution-data-note">
                Nenhum registro disponível nesta coleção do documento. Isso não
                confirma a ausência de execução no subelemento.
              </p>
            )}
            <Pager
              page={result.data.page}
              total={result.data.total}
              limit={result.data.limit}
              onChange={(value) => onChange({ sourcePage: String(value) })}
            />
            <p className="execution-chart-note">
              Fonte: Portal da Transparência · documentos diários. Consulta:{" "}
              {result.loadedAt
                ? new Date(result.loadedAt).toLocaleString("pt-BR")
                : "Não consultado"}
              .
            </p>
          </>
        )}
      </FinanceContent>
    </div>
  );
}
