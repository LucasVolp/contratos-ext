"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Plus,
  Search,
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
  PageHead,
  Pager,
  Status,
  Field,
} from "./ui";
import { validateFilters } from "@contracts/validation";
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
  }, [search, status, uasg, from, to, page, reload, records]);
  function filter(setter: (s: string) => void, value: string) {
    setter(value);
    setPage(1);
  }
  return (
    <>
      <PageHead
        section={records ? "Atas & documentos" : "Contratos"}
        title={records ? "Atas & documentos" : "Contratos"}
        description={
          records
            ? "Da organização dos itens ao documento pronto para assinar."
            : "Acompanhe os compromissos e os próximos passos da sua unidade."
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
      </PageHead>
      <section className="stats-strip" aria-label="Resumo dos registros">
        <div>
          <span>{records ? "ATAS NO ARQUIVO" : "CONTRATOS ENCONTRADOS"}</span>
          <strong>
            {data?.stats.count ?? "—"}
            <small>registros</small>
          </strong>
        </div>
        <div>
          <span>VALOR TOTAL</span>
          <strong className="money">
            {data ? currency(data.stats.totalValue) : "—"}
          </strong>
        </div>
        <div>
          <span>{records ? "DOCUMENTOS GERADOS" : "ATENÇÃO À VIGÊNCIA"}</span>
          <strong>
            {data
              ? records
                ? data.stats.exportsCount
                : data.stats.expiringCount
              : "—"}
            <small>{records ? "exportações" : "vencem em até 30 dias"}</small>
          </strong>
        </div>
      </section>
      <section className="registry">
        <div className="registry-top">
          <div>
            <span className="eyebrow">
              {records ? "SEU ACERVO" : "VISÃO GERAL"}
            </span>
            <h2>{records ? "Registro de atas" : "Todos os contratos"}</h2>
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
              aria-label={records ? "Buscar atas" : "Buscar contratos"}
              placeholder={
                records
                  ? "Buscar número, objeto ou fornecedor…"
                  : "Buscar número, objeto ou fornecedor…"
              }
              value={search}
              onChange={(e) => filter(setSearch, e.target.value)}
            />
          </div>
          {!records && (
            <>
              <select
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
              <table>
                <thead>
                  <tr>
                    <th>{records ? "Ata / objeto" : "Contrato / objeto"}</th>
                    <th>Fornecedor</th>
                    <th>{records ? "Itens" : "Vigência"}</th>
                    <th>Valor {records ? "total" : "global"}</th>
                    {!records && <th>Situação</th>}
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
                        <div className="object-summary">{entry.object}</div>
                        <span className="tiny-label">UASG {entry.uasg}</span>
                      </td>
                      <td>
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
                      </td>
                      <td>
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
                      </td>
                      <td className="amount">
                        {currency(
                          records
                            ? (entry as RecordData).totalValue
                            : (entry as Contract).globalValue,
                        )}
                      </td>
                      {!records && (
                        <td>
                          <Status status={String(entry.status)} />
                        </td>
                      )}
                      <td>
                        <Link
                          className="row-arrow"
                          aria-label={`Abrir ${entry.number}`}
                          href={`${root}/${entry.id}`}
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
      <div className="page-footnote">
        CONTRACTS EXT <span>Um lugar para cada compromisso.</span>
      </div>
    </>
  );
}
