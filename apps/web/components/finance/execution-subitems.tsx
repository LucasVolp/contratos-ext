"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty, ErrorState, Loading, Pager } from "@/components/ui";
import { financePath } from "@/lib/finance-api";
import type { CommitmentSummary, Page } from "@/lib/finance-types";
import { ExecutionDocumentRows } from "./execution-document-rows";
import { useFinanceQuery } from "./use-finance-query";

const pageNumber = (value: string | null) =>
  /^\d{1,6}$/.test(value || "") && Number(value) > 0 ? Number(value) : 1;

type Change = (values: Record<string, string>) => void;
export function ExecutionSubitems({
  query,
  urlQuery,
  onChange,
  revision,
}: {
  query: string;
  urlQuery: string;
  onChange: Change;
  revision: number;
}) {
  const params = new URLSearchParams(urlQuery);
  const page = pageNumber(params.get("documentPage"));
  const result = useFinanceQuery<Page<CommitmentSummary>>(
    financePath("commitments", query, { page: String(page), limit: "5" }),
    undefined,
    revision,
  );
  const selected = result.data?.data.find(
    (row) => row.id === params.get("document"),
  );
  return (
    <section
      className="execution-subitems"
      aria-labelledby="execution-subitems-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="execution-subitems-title">Subelementos nos documentos</h2>
          <p>
            Consulte os itens, liquidações e pagamentos de cada empenho deste
            elemento.
          </p>
        </div>
        <Link
          className="button secondary"
          href={`/financeiro/empenhos?${query}`}
        >
          Consultar empenhos deste elemento
        </Link>
      </div>
      <p className="execution-data-note">
        Documentos do exercício e da unidade selecionados, independentemente do
        período mensal do painel. Os registros abaixo ainda não constituem um
        QDD consolidado por subelemento.
      </p>
      {result.error ? (
        <ErrorState message={result.error.message} retry={result.retry} />
      ) : null}
      {!result.data ? (
        !result.error ? (
          <Loading />
        ) : null
      ) : result.data.total === 0 ? (
        <Empty
          kind="documento"
          title="Nenhum empenho disponível para este elemento."
          description="Os registros mensais não asseguram a disponibilidade dos documentos diários. Os totais do elemento permanecem na consulta acima."
          href={`/financeiro/empenhos?${query}`}
          actionLabel="Consultar empenhos"
        />
      ) : (
        <>
          <div
            className="execution-documents"
            role="group"
            aria-label="Empenhos deste elemento"
          >
            {result.data.data.map((row) => (
              <Button
                type="button"
                variant="outline"
                key={row.id}
                aria-label={`Consultar subelementos de ${row.resumedCode || row.documentCode}`}
                aria-pressed={selected?.id === row.id}
                onClick={() =>
                  onChange({ document: row.id, sourcePage: "", sourceKind: "" })
                }
              >
                <strong>{row.resumedCode || row.documentCode}</strong>
                <span>{row.unitName || "Unidade não informada"}</span>
              </Button>
            ))}
          </div>
          <Pager
            page={result.data.page}
            total={result.data.total}
            limit={result.data.limit}
            onChange={(value) =>
              onChange({
                documentPage: String(value),
                document: "",
                sourcePage: "",
              })
            }
          />
          {selected ? (
            <ExecutionDocumentRows
              revision={revision}
              key={`${query}:${selected.id}`}
              id={selected.id}
              label={selected.resumedCode || selected.documentCode}
              params={params}
              onChange={onChange}
            />
          ) : (
            <p className="execution-chart-note" role="status">
              Selecione um empenho para consultar seus subelementos e valores de
              origem.
            </p>
          )}
        </>
      )}
    </section>
  );
}
