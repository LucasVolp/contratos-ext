"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHead } from "@/components/ui";
import type { Page } from "@/lib/finance-types";
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
  useFinance,
} from "./shared";

type Mode = "commitments" | "execution" | "budgets";
type Input = {
  key: string;
  label: string;
  pattern?: string;
  required?: boolean;
  type?: string;
  min?: number;
  max?: number;
  hint?: string;
};
const flow: Column[] = [
  { key: "committedValue", label: "Empenhado", money: true },
  { key: "liquidatedValue", label: "Liquidado", money: true },
  { key: "paidValue", label: "Pago", money: true },
];
const prior: Column[] = [
  {
    key: "registeredPayablesValue",
    label: "Restos a pagar inscritos",
    money: true,
  },
  {
    key: "canceledPayablesValue",
    label: "Restos a pagar cancelados",
    money: true,
  },
  { key: "priorYearPaidValue", label: "Restos a pagar pagos", money: true },
];
const budget: Column[] = [
  { key: "initialBudget", label: "Orçamento inicial", money: true },
  { key: "updatedBudget", label: "Orçamento atualizado", money: true },
  { key: "committedBudget", label: "Orçamento empenhado", money: true },
  { key: "executedBudget", label: "Orçamento executado", money: true },
];
const year: Input = {
  key: "fiscalYear",
  label: "Exercício",
  type: "number",
  min: 1900,
  max: 9999,
};
const action: Input = {
  key: "actionCode",
  label: "Ação orçamentária",
  pattern: "[A-Za-z0-9]{1,20}",
};
const config = {
  commitments: {
    title: "Empenhos",
    description:
      "Consulte documentos, favorecidos e movimentos por unidade e natureza de despesa.",
    fields: [
      {
        key: "managementCode",
        label: "Órgão / gestão",
        pattern: "[0-9]{5}",
        required: true,
        hint: "Código de 5 dígitos",
      },
      year,
      {
        key: "managementUnitCode",
        label: "Unidade gestora",
        pattern: "[0-9]{6}",
        hint: "Código de 6 dígitos",
      },
      {
        key: "expenseNature",
        label: "Natureza de despesa",
        pattern: "[0-9]{6}([0-9]{2})?",
        hint: "6 ou 8 dígitos",
      },
      { key: "search", label: "Buscar documento, favorecido ou processo" },
      { key: "favoredCode", label: "Código do favorecido" },
      { key: "from", label: "Emissão a partir de", type: "date" },
      { key: "to", label: "Emissão até", type: "date" },
    ] as Input[],
    columns: [
      {
        key: "documentCode",
        label: "Empenho",
        link: (r: FinancialRow) => `/financeiro/empenhos/${r.id}`,
      },
      { key: "emissionDate", label: "Emissão", date: true },
      { key: "unitName", label: "Unidade" },
      { key: "managementUnitCode", label: "UG" },
      { key: "favoredName", label: "Favorecido" },
      { key: "expenseNature", label: "Natureza" },
      ...flow,
      { key: "priorYearPaidValue", label: "RP pagos", money: true },
      { key: "headerAvailable", label: "Identificação completa" },
    ] as Column[],
  },
  execution: {
    title: "Execução mensal",
    description:
      "Acompanhe os valores do período por unidade e natureza de despesa.",
    fields: [
      {
        key: "managementCode",
        label: "Órgão / gestão",
        pattern: "[0-9]{5}",
        required: true,
        hint: "Código de 5 dígitos",
      },
      { ...year, required: true },
      {
        key: "managementUnitCode",
        label: "Unidade gestora",
        pattern: "[0-9]{6}",
        hint: "Código de 6 dígitos",
      },
      {
        key: "expenseNature",
        label: "Natureza de despesa",
        pattern: "[0-9]{6}",
        hint: "6 dígitos",
      },
      action,
      {
        key: "fromMonth",
        label: "Mês inicial",
        type: "number",
        min: 1,
        max: 12,
      },
      { key: "toMonth", label: "Mês final", type: "number", min: 1, max: 12 },
    ] as Input[],
    columns: [
      { key: "unitName", label: "Unidade" },
      { key: "managementUnitCode", label: "UG" },
      { key: "expenseNature", label: "Natureza" },
      { key: "economicCategoryCode", label: "Categoria" },
      { key: "expenseGroupCode", label: "Grupo" },
      { key: "applicationModalityCode", label: "Modalidade" },
      { key: "expenseElementCode", label: "Elemento" },
      { key: "expenseElementName", label: "Descrição do elemento" },
      ...flow,
      ...prior,
      { key: "observedMonthCount", label: "Meses observados" },
    ] as Column[],
  },
  budgets: {
    title: "LOA institucional",
    description:
      "Consulte o orçamento anual por órgão, unidade orçamentária e ação.",
    fields: [
      {
        key: "subordinateAgencyCode",
        label: "Órgão subordinado",
        pattern: "[0-9]{5}",
        required: true,
        hint: "Código de 5 dígitos",
      },
      { ...year, required: true },
      {
        key: "budgetaryUnitCode",
        label: "Unidade orçamentária",
        pattern: "[0-9]{5}",
        hint: "Código de 5 dígitos",
      },
      action,
      {
        key: "economicCategoryCode",
        label: "Categoria econômica",
        pattern: "[0-9]",
      },
      { key: "expenseGroupCode", label: "Grupo de despesa", pattern: "[0-9]" },
      {
        key: "expenseElementCode",
        label: "Elemento de despesa",
        pattern: "[0-9]{2}",
        hint: "2 dígitos, incluindo zero inicial",
      },
    ] as Input[],
    columns: [
      { key: "subordinateAgencyName", label: "Órgão" },
      { key: "budgetaryUnitCode", label: "UO" },
      { key: "budgetaryUnitName", label: "Unidade orçamentária" },
      { key: "actionCode", label: "Ação" },
      { key: "actionName", label: "Descrição da ação" },
      { key: "economicCategoryCode", label: "Categoria" },
      { key: "expenseGroupCode", label: "Grupo" },
      { key: "expenseElementCode", label: "Elemento" },
      { key: "expenseElementName", label: "Descrição do elemento" },
      ...budget,
    ] as Column[],
  },
};
export function FinancePage({ mode }: { mode: Mode }) {
  const router = useRouter();
  const search = useSearchParams();
  const query = search.toString();
  const settings = config[mode];
  const ready = settings.fields
    .filter((f) => f.required)
    .every((f) => search.get(f.key));
  const { data, error, retry } = useFinance<
    Page<FinancialRow> & { summary?: FinancialRow }
  >(ready ? `${mode}?${query}` : null);
  const scopeKey =
    mode === "budgets" ? "subordinateAgencyCode" : "managementCode";
  return (
    <div className="finance-page">
      <PageHead
        section="Financeiro"
        title={settings.title}
        description={settings.description}
      />
      <FinanceTabs active={mode} query={query} />
      <form
        key={mode + query}
        className="finance-filters"
        method="get"
        onSubmit={(event) => {
          event.preventDefault();
          const q = new URLSearchParams();
          new FormData(event.currentTarget).forEach((value, key) => {
            const text = String(value).trim();
            if (text) q.set(key, text);
          });
          router.push(`?${q}`);
        }}
      >
        <div className="finance-filter-grid">
          {settings.fields.map((f) => (
            <div className="finance-filter-field" key={f.key}>
              <label htmlFor={`finance-${f.key}`}>
                {f.label}
                {f.required ? " *" : ""}
              </label>
              <input
                id={`finance-${f.key}`}
                name={f.key}
                type={f.type || "text"}
                pattern={f.pattern}
                min={f.min}
                max={f.max}
                required={f.required}
                defaultValue={search.get(f.key) || ""}
                aria-describedby={f.hint ? `hint-${f.key}` : undefined}
              />
              {f.hint && <small id={`hint-${f.key}`}>{f.hint}</small>}
            </div>
          ))}
        </div>
        <div className="finance-filter-actions">
          <button className="button" type="submit">
            Consultar
          </button>
          <a
            className="button secondary"
            href={
              mode === "budgets"
                ? "/financeiro/loa"
                : mode === "execution"
                  ? "/financeiro/execucao"
                  : "/financeiro/empenhos"
            }
          >
            Limpar filtros
          </a>
          <small>* Obrigatório</small>
        </div>
      </form>
      <p className="finance-note">
        {mode === "commitments"
          ? "O filtro de natureza seleciona empenhos completos; os valores incluem todos os seus itens e movimentos. Restos a pagar são apresentados separadamente. Referências sem identificação completa podem não ter data ou favorecido."
          : mode === "execution"
            ? "Valores exclusivos da execução mensal. Os meses observados indicam presença de registros, sem garantir cobertura completa do período. Restos a pagar são apresentados separadamente."
            : "A LOA não identifica campus nem modalidade de aplicação. A classificação por categoria, grupo e elemento não representa uma natureza de despesa completa."}
      </p>
      {!ready ? (
        <div className="empty">
          <h2>Escolha o recorte da consulta.</h2>
          <p>
            Informe{" "}
            {mode === "budgets"
              ? "o órgão subordinado e o exercício"
              : "o órgão / gestão"}
            {mode === "execution" ? " e o exercício" : ""} para visualizar os
            dados.
          </p>
          <UnitDirectory scopeKey={scopeKey} />
        </div>
      ) : !data ? (
        <RequestState error={error} retry={retry} />
      ) : (
        <>
          {data.summary && (
            <>
              <p className="finance-note">
                Totais de todos os registros filtrados, incluindo outras
                páginas.
              </p>
              <Metrics
                values={data.summary}
                columns={mode === "budgets" ? budget : flow}
              />
              {mode === "execution" && (
                <Metrics values={data.summary} columns={prior} />
              )}
              <p className="finance-note">
                {data.summary.sourceRowCount} registros de origem
                {mode === "execution"
                  ? ` · ${data.summary.observedMonthCount} meses observados · ${calendar(data.summary.firstMonth)} a ${calendar(data.summary.lastMonth)}`
                  : ""}{" "}
                · Última importação: {calendar(data.summary.lastImportedAt)}
              </p>
            </>
          )}
          <section className="registry" aria-label="Resultados da consulta">
            <div className="registry-top">
              <h2>
                {data.total}{" "}
                {mode === "commitments"
                  ? data.total === 1
                    ? "empenho"
                    : "empenhos"
                  : data.total === 1
                    ? "agrupamento"
                    : "agrupamentos"}
              </h2>
            </div>
            {data.data.length ? (
              <FinanceTable
                rows={data.data.map((r) => ({
                  ...r,
                  headerAvailable:
                    r.headerAvailable === undefined
                      ? null
                      : r.headerAvailable
                        ? "Sim"
                        : "Não — referência vinculada",
                }))}
                columns={settings.columns.map((c) =>
                  c.link
                    ? {
                        ...c,
                        link: (r) =>
                          `${c.link!(r)}?returnTo=${encodeURIComponent(`/financeiro/empenhos?${query}`)}`,
                      }
                    : c,
                )}
                caption={settings.title}
              />
            ) : (
              <FinanceEmpty />
            )}
            <FinancePager result={data} query={query} />
          </section>
        </>
      )}
    </div>
  );
}
function UnitDirectory({ scopeKey }: { scopeKey: string }) {
  const { data, error, retry } = useFinance<
    Page<{
      managementCode: string;
      code: string;
      name: string | null;
      managementName: string | null;
    }>
  >("units?limit=100");
  if (error) return <RequestState error={error} retry={retry} />;
  const agencies = [
    ...new Map((data?.data || []).map((u) => [u.managementCode, u])).values(),
  ];
  return (
    <>
      {agencies.length > 0 && (
        <details className="finance-directory">
          <summary>Órgãos nas unidades disponíveis</summary>
          <ul>
            {agencies.map((u) => (
              <li key={u.managementCode}>
                {u.managementCode} — {u.managementName || "Nome não informado"}
              </li>
            ))}
          </ul>
          <p>
            Use o código no campo{" "}
            {scopeKey === "subordinateAgencyCode"
              ? "Órgão subordinado"
              : "Órgão / gestão"}
            . Esta relação considera as primeiras 100 unidades e pode não
            incluir todos os órgãos da LOA.
          </p>
        </details>
      )}
    </>
  );
}
