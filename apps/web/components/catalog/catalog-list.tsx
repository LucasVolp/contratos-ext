"use client";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";

import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw } from "lucide-react";
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
  PageBar,
  Pager,
  ReachContext,
} from "../ui";
import { CatalogTabs } from "./catalog-tabs";
import { CatalogRefresh } from "./catalog-refresh";
import { PurchasesOverview } from "./purchases-overview";
import { PublishedAtasOverview } from "./published-atas-overview";
import { useReach } from "@/lib/session";
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
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false);
  const root = records ? "/atas/publicadas" : "/pregoes";
  const reach = useReach();
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api<CatalogPage<PurchaseSummary | PublicRecordSummary>>(
        `/${records ? "public-records" : "purchases"}?${new URLSearchParams({ ...applied, ...(reach.uasgs ? { uasgs: reach.uasgs } : {}), search, page: String(page), limit: "12" })}`,
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
  }, [records, applied, search, page, reload, reach.uasgs]);
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
      <PageBar
        context={
          <>
            {records && <CatalogTabs published />}
            <ReachContext reach={reach} onChange={() => setPage(1)} />
          </>
        }
      >
        <Button
          type="button"
          className="button"
          aria-expanded={refreshing}
          onClick={() => setRefreshing((open) => !open)}
        >
          <RefreshCw size={16} />
          Atualizar do Compras.gov
        </Button>
      </PageBar>
      {refreshing && (
        <CatalogRefresh
          records={records}
          reach={reach}
          onDone={() => {
            setPage(1);
            setReload((n) => n + 1);
          }}
        />
      )}
      {records ? (
        <PublishedAtasOverview stats={data?.stats ?? null} />
      ) : (
        <PurchasesOverview stats={data?.stats ?? null} />
      )}
      <section className="registry">
        <div className="filters">
          <SearchField
            id="catalog-search"
            label={records ? "Buscar atas publicadas" : "Buscar pregões"}
            placeholder="Buscar número, objeto ou organização…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
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
            <Button className="button secondary" type="submit">
              Aplicar filtros
            </Button>
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
              <h2>Nenhum registro salvo nesta abrangência.</h2>
              <p>
                A lista mostra o que já foi trazido do Compras.gov. Atualize
                pelo período desejado ou ajuste os filtros.
              </p>
              {!refreshing && (
                <Button
                  type="button"
                  className="button"
                  onClick={() => {
                    setRefreshing(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <RefreshCw size={16} />
                  Atualizar do Compras.gov
                </Button>
              )}
            </div>
          ) : (
            <div className="table-scroll">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {records ? "Ata / objeto" : "Pregão / objeto"}
                    </TableHead>
                    <TableHead>Organização</TableHead>
                    <TableHead>
                      {records ? "Vigência / compra" : "Publicação / SRP"}
                    </TableHead>
                    <TableHead>
                      Valor {records ? "total" : "estimado"}
                    </TableHead>
                    <TableHead>Última consulta</TableHead>
                    <TableHead>
                      <span className="sr-only">Abrir</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
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
                      </TableCell>
                      <TableCell>
                        {known(entry.organizationName)}
                        <small className="date-end">
                          {known(entry.unitName)}
                        </small>
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell className="amount">
                        {currency(
                          records
                            ? (entry as PublicRecordSummary).totalValue
                            : (entry as PurchaseSummary).estimatedValue,
                        )}
                      </TableCell>
                      <TableCell className="catalog-timestamp">
                        {stamp(entry.lastSyncedAt)}
                      </TableCell>
                      <TableCell>
                        <Link
                          className="row-arrow"
                          href={`${root}/${entry.id}`}
                          aria-label={`Abrir ${entry.number}`}
                        >
                          <ArrowUpRight size={18} />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
        é consultada ao abrir os detalhes e pelas ações de consulta e
        atualização.
      </p>
    </>
  );
}
