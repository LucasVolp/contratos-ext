"use client";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";

import { Label } from "@/components/ui/label";
import { SearchField } from "@/components/ui/search-field";

import { CatalogTabs } from "./catalog/catalog-tabs";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import {
  api,
  Contract,
  currency,
  date,
  PageData,
  RecordData,
  statusLabels,
} from "@/lib/api";
import {
  Empty,
  ErrorState,
  Loading,
  PageBar,
  Pager,
  Status,
  Field,
  ReachContext,
} from "./ui";
import { validateFilters } from "@contracts/validation";
import { useReach } from "@/lib/session";
import { DocumentsOverview } from "./documents-overview";
import { ContractsOverview } from "./contracts-overview";
export function ListPage({ records = false }: { records?: boolean }) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [uasg, setUasg] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [data, setData] = useState<PageData<Contract | RecordData> | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [advanced, setAdvanced] = useState(false);
  const root = records ? "/atas" : "/contratos";
  const reach = useReach();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const errors = records ? {} : validateFilters({ uasg, from, to });
      if (Object.keys(errors).length) {
        setError(Object.values(errors).join(" · "));
        setLoading(false);
        return;
      }
      const query = new URLSearchParams({
        search,
        page: String(page),
        limit: "12",
        ...(reach.uasgs ? { uasgs: reach.uasgs } : {}),
        ...(!records ? { status, uasg, from, to } : {}),
      });
      api<PageData<Contract | RecordData>>(
        `${records ? "/records" : "/contracts"}?${query}`,
        { signal: controller.signal },
      )
        .then((value) => {
          if (!controller.signal.aborted) setData(value);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [search, status, uasg, from, to, page, reload, records, reach.uasgs]);
  function filter(setter: (s: string) => void, value: string) {
    setter(value);
    setPage(1);
  }
  return (
    <>
      <PageBar
        context={
          <>
            {records && <CatalogTabs />}
            <ReachContext reach={reach} onChange={() => setPage(1)} />
          </>
        }
      >
        <Link className="button secondary" href={`${root}/importar`}>
          <ArrowDownToLine size={16} />
          Importar
        </Link>
        <Link className="button" href={`${root}/${records ? "nova" : "novo"}`}>
          <Plus size={17} />
          {records ? "Nova ata" : "Novo contrato"}
        </Link>
      </PageBar>
      {records ? (
        <DocumentsOverview stats={data?.stats ?? null} />
      ) : (
        <ContractsOverview stats={data?.stats ?? null} />
      )}
      <section className="registry">
        <div className="filters">
          <SearchField
            id="records-search"
            label={records ? "Buscar atas" : "Buscar contratos"}
            placeholder={
              records
                ? "Buscar número, objeto ou fornecedor…"
                : "Buscar número, objeto ou fornecedor…"
            }
            value={search}
            onChange={(e) => filter(setSearch, e.target.value)}
          />
          {!records && (
            <>
              <div className="filter-field">
                <Label htmlFor="contract-status">Situação</Label>
                <select
                  id="contract-status"
                  aria-label="Filtrar por situação"
                  value={status}
                  onChange={(e) => filter(setStatus, e.target.value)}
                >
                  <option value="">Todas as situações</option>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="filter-toggle"
                aria-expanded={advanced}
                onClick={() => setAdvanced(!advanced)}
              >
                <SlidersHorizontal size={16} />
                Filtros
              </button>
            </>
          )}
        </div>
        {advanced && (
          <div className="advanced-filters">
            <Field
              name="uasg"
              label="UASG"
              value={uasg}
              onChange={(_, value) => filter(setUasg, value)}
              error={validateFilters({ uasg }).uasg}
            />
            <Field
              name="from"
              label="Vigência a partir de"
              type="date"
              value={from}
              onChange={(_, value) => filter(setFrom, value)}
              error={validateFilters({ from, to }).from}
            />
            <Field
              name="to"
              label="Vigência até"
              type="date"
              value={to}
              onChange={(_, value) => filter(setTo, value)}
              error={validateFilters({ from, to }).to}
            />
            <button
              className="text-button"
              onClick={() => {
                setUasg("");
                setFrom("");
                setTo("");
                setStatus("");
                setSearch("");
                setPage(1);
              }}
            >
              Limpar filtros
            </button>
          </div>
        )}
        <div aria-live="polite">
          {error ? (
            <ErrorState message={error} retry={() => setReload(reload + 1)} />
          ) : loading ? (
            <Loading />
          ) : !data?.data.length ? (
            <Empty
              kind={records ? "ata" : "contrato"}
              href={`${root}/${records ? "nova" : "novo"}`}
            />
          ) : (
            <div className="table-scroll">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {records ? "Ata / objeto" : "Contrato / objeto"}
                    </TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>{records ? "Itens" : "Vigência"}</TableHead>
                    <TableHead>Valor {records ? "total" : "global"}</TableHead>
                    {!records && <TableHead>Situação</TableHead>}
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
                        <div className="object-summary">{entry.object}</div>
                        <span className="tiny-label">UASG {entry.uasg}</span>
                      </TableCell>
                      <TableCell>
                        <div className="supplier">
                          <span className="initials">
                            {String(entry.supplierName || "—")
                              .split(" ")
                              .slice(0, 2)
                              .map((p) => p[0])
                              .join("")}
                          </span>
                          <div>
                            {String(entry.supplierName || "Não informado")}
                            <small>
                              {String(entry.supplierDocument || "")}
                            </small>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {records ? (
                          `${(entry as RecordData).items?.length ?? 0} itens`
                        ) : (
                          <>
                            <span>{date(entry.startDate)}</span>
                            <small className="date-end">
                              até {date(entry.endDate)}
                            </small>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="amount">
                        {currency(
                          records
                            ? (entry as RecordData).totalValue
                            : (entry as Contract).globalValue,
                        )}
                      </TableCell>
                      {!records && (
                        <TableCell>
                          <Status status={String(entry.status)} />
                        </TableCell>
                      )}
                      <TableCell>
                        <Link
                          className="row-arrow"
                          aria-label={`Abrir ${entry.number}`}
                          href={`${root}/${entry.id}`}
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
      <div className="page-footnote">
        CONTRACTS EXT <span>Um lugar para cada compromisso.</span>
      </div>
    </>
  );
}
