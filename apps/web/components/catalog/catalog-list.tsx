"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, ArrowUpRight, RefreshCw } from "lucide-react";
import { validateFilters, FieldErrors } from "@contracts/validation";
import { api, ApiError, currency, date, validationSummary } from "@/lib/api";
import {
  CatalogPage,
  PurchaseSummary,
  PublicRecordSummary,
  known,
  purchaseNumber,
  stamp,
} from "@/lib/catalog-api";
import {
  ErrorState,
  Field,
  FormValidation,
  focusInvalid,
  Loading,
  PageHead,
  Pager,
} from "../ui";
import { CatalogTabs } from "./catalog-tabs";
export function CatalogList({ records = false }: { records?: boolean }) {
  const [search, setSearch] = useState(""),
    [filters, setFilters] = useState({ uasg: "", from: "", to: "" }),
    [applied, setApplied] = useState({ uasg: "", from: "", to: "" }),
    [errors, setErrors] = useState<FieldErrors>({}),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [data, setData] = useState<CatalogPage<
      PurchaseSummary | PublicRecordSummary
    > | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const root = records ? "/atas/publicadas" : "/pregoes";
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api<CatalogPage<PurchaseSummary | PublicRecordSummary>>(
        `/${records ? "public-records" : "purchases"}?${new URLSearchParams({ ...applied, search, page: String(page), limit: "12" })}`,
        { signal: c.signal },
      )
        .then((v) => {
          if (!c.signal.aborted) {
            setData(v);
            setError("");
          }
        })
        .catch((e) => {
          if (!c.signal.aborted) {
            setError(e.message);
            if (e instanceof ApiError) {
              setErrors(e.fieldErrors);
              if (Object.keys(e.fieldErrors).length)
                focusInvalid(e.fieldErrors);
            }
          }
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [records, applied, search, page, reload]);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = validateFilters(filters);
    setErrors(next);
    if (Object.keys(next).length) {
      focusInvalid(next);
      return;
    }
    setApplied({ ...filters });
    setPage(1);
  }
  return (
    <>
      <PageHead
        section={records ? "Atas & documentos" : "Pregões"}
        title={records ? "Atas publicadas" : "Pregões"}
        description={
          records
            ? "Consulte o acervo público salvo e prepare documentos por fornecedor."
            : "Processos, resultados e atas em uma visão de trabalho."
        }
      >
        <Link className="button" href={`${root}/consultar`}>
          <RefreshCw size={16} />
          {records ? "Consultar atas" : "Consultar pregões"}
        </Link>
      </PageHead>
      {records && <CatalogTabs published />}
      <section className="stats-strip">
        <div>
          <span>{records ? "ATAS SALVAS" : "PREGÕES SALVOS"}</span>
          <strong>
            {data?.stats.count ?? "—"}
            <small>registros</small>
          </strong>
        </div>
        <div>
          <span>
            {records ? "VALOR CONHECIDO" : "VALOR ESTIMADO CONHECIDO"}
          </span>
          <strong className="money">
            {data
              ? currency(
                  records ? data.stats.totalValue : data.stats.estimatedValue,
                )
              : "—"}
          </strong>
        </div>
        <div>
          <span>{records ? "FONTE DOS REGISTROS" : "REGISTRO DE PREÇOS"}</span>
          {records ? (
            <p className="stat-source">Compras.gov.br</p>
          ) : (
            <strong>
              {data?.stats.srpCount ?? "—"}
              <small>com SRP confirmado</small>
            </strong>
          )}
        </div>
      </section>
      <section className="registry">
        <div className="registry-top">
          <div>
            <div className="eyebrow">CATÁLOGO PÚBLICO · ARQUIVO LOCAL</div>
            <h2>{records ? "Atas disponíveis" : "Processos disponíveis"}</h2>
          </div>
          <span className="archive-note">
            {data
              ? `${data.total} registros encontrados`
              : "Consulta ao arquivo"}
          </span>
        </div>
        <div className="filters">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label={records ? "Buscar atas publicadas" : "Buscar pregões"}
              placeholder="Buscar número, objeto ou organização…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <FormValidation.Provider
          value={{
            errors,
            onBlur: (name) => {
              const next = validateFilters(filters);
              setErrors((old) => {
                const result = { ...old };
                for (const k of ["from", "to"].includes(name)
                  ? ["from", "to"]
                  : [name]) {
                  if (next[k]) result[k] = next[k];
                  else delete result[k];
                }
                return result;
              });
            },
          }}
        >
          <form className="catalog-filter-form" onSubmit={submit} noValidate>
            <Field
              name="uasg"
              label="UASG"
              value={filters.uasg}
              onChange={(k, v) => setFilters((old) => ({ ...old, [k]: v }))}
            />
            <Field
              name="from"
              label={
                records ? "Vigência a partir de" : "Publicação a partir de"
              }
              type="date"
              value={filters.from}
              onChange={(k, v) => setFilters((old) => ({ ...old, [k]: v }))}
            />
            <Field
              name="to"
              label={records ? "Vigência até" : "Publicação até"}
              type="date"
              value={filters.to}
              onChange={(k, v) => setFilters((old) => ({ ...old, [k]: v }))}
            />
            <button className="button secondary" type="submit">
              Aplicar filtros
            </button>
          </form>
          {Object.keys(errors).length > 0 && (
            <div className="catalog-inline-error" role="alert">
              {validationSummary(errors)}
            </div>
          )}
        </FormValidation.Provider>
        <div aria-live="polite">
          {error ? (
            <ErrorState message={error} retry={() => setReload((n) => n + 1)} />
          ) : loading ? (
            <Loading />
          ) : !data?.data.length ? (
            <div className="empty">
              <h2>Seu catálogo começa com uma consulta.</h2>
              <p>
                Consulte a fonte pública ou ajuste os filtros para encontrar
                registros salvos.
              </p>
              <Link className="button" href={`${root}/consultar`}>
                {records ? "Consultar atas" : "Consultar pregões"}
              </Link>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{records ? "Ata / objeto" : "Pregão / objeto"}</th>
                    <th>Organização</th>
                    <th>
                      {records ? "Vigência / compra" : "Publicação / SRP"}
                    </th>
                    <th>Valor {records ? "total" : "estimado"}</th>
                    <th>Última consulta</th>
                    <th>
                      <span className="sr-only">Abrir</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <Link
                          className="record-number"
                          href={`${root}/${entry.id}`}
                        >
                          {entry.number}
                        </Link>
                        <div className="object-summary">
                          {known(entry.object)}
                        </div>
                        <span className="tiny-label">UASG {entry.uasg}</span>
                      </td>
                      <td>
                        {known(entry.organizationName)}
                        <small className="date-end">
                          {known(entry.unitName)}
                        </small>
                      </td>
                      <td>
                        {records ? (
                          <>
                            {date((entry as PublicRecordSummary).startDate)}
                            <small className="date-end">
                              até {date((entry as PublicRecordSummary).endDate)}
                            </small>
                            <small className="date-end">
                              Compra{" "}
                              {purchaseNumber(
                                (entry as PublicRecordSummary).purchaseNumber,
                                (entry as PublicRecordSummary).purchaseYear,
                              )}
                            </small>
                          </>
                        ) : (
                          <>
                            {date((entry as PurchaseSummary).publishedAt)}
                            <small className="date-end">
                              SRP:{" "}
                              {(entry as PurchaseSummary).srp === null
                                ? "Não informado"
                                : (entry as PurchaseSummary).srp
                                  ? "Sim"
                                  : "Não"}
                            </small>
                          </>
                        )}
                      </td>
                      <td className="amount">
                        {currency(
                          records
                            ? (entry as PublicRecordSummary).totalValue
                            : (entry as PurchaseSummary).estimatedValue,
                        )}
                      </td>
                      <td className="catalog-timestamp">
                        {stamp(entry.lastSyncedAt)}
                      </td>
                      <td>
                        <Link
                          className="row-arrow"
                          href={`${root}/${entry.id}`}
                          aria-label={`Abrir ${entry.number}`}
                        >
                          <ArrowUpRight size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {data && !error && (
          <Pager
            page={page}
            total={data.total}
            limit={data.limit}
            onChange={setPage}
          />
        )}
      </section>
      <p className="catalog-footnote">
        As buscas acima consultam apenas os registros já salvos. A fonte pública
        é consultada ao abrir os detalhes e pelas ações de consulta e atualização.
      </p>
    </>
  );
}
