"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { maskDocument, validateFilters } from "@contracts/validation";
import { currency, date } from "@/lib/api";
import {
  freshnessLine,
  listContracts,
  vigency,
  type ContractPage,
  type ContractSummary,
} from "@/lib/contracts-api";
import { useReach } from "@/lib/session";
import {
  Empty,
  ErrorState,
  Loading,
  PageBar,
  Pager,
  ReachContext,
  Status,
} from "../ui";
import { ContractsOverview } from "../contracts-overview";
import {
  ContractFilters,
  noContractFilters,
  type ContractFilterValues,
} from "./contract-filters";
import { SyncNotice } from "./sync-notice";

/** Contracts of the daily Contratos.gov.br replica in the viewer's reach; read-only. */
export function ContractList() {
  const [filters, setFilters] = useState(noContractFilters),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [data, setData] = useState<ContractPage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const reach = useReach();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const errors = validateFilters(filters);
      if (Object.keys(errors).length) {
        setError(Object.values(errors).join(" · "));
        setLoading(false);
        return;
      }
      const query = new URLSearchParams({
        ...filters,
        page: String(page),
        limit: "12",
        ...(reach.uasgs ? { uasgs: reach.uasgs } : {}),
      });
      listContracts(query, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setData(value);
        })
        .catch((e: Error) => {
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
  }, [filters, page, reload, reach.uasgs]);
  function change(name: keyof ContractFilterValues, value: string) {
    setFilters((old) => ({ ...old, [name]: value }));
    setPage(1);
  }
  function clear() {
    setFilters(noContractFilters);
    setPage(1);
  }
  const filtered = Object.values(filters).some(Boolean);
  const firstLoad = !!data && !data.sync.lastCompletedAt && !data.data.length;
  return (
    <>
      <PageBar context={<ReachContext reach={reach} onChange={() => setPage(1)} />} />
      {data && <SyncNotice sync={data.sync} showLine={!firstLoad} />}
      <ContractsOverview stats={data?.stats ?? null} />
      <section className="registry">
        <ContractFilters values={filters} onChange={change} onClear={clear} />
        <div aria-live="polite">
          {error && (
            <ErrorState message={error} retry={() => setReload((n) => n + 1)} />
          )}
          {loading ? (
            <Loading />
          ) : !data ? null : firstLoad ? (
            <Empty
              kind="contrato"
              title={data.sync.running ? "Contratos em atualização" : "Contratos ainda não carregados"}
              description={freshnessLine(data.sync)}
            />
          ) : !data.data.length ? (
            <Empty
              kind="contrato"
              title={
                filtered
                  ? "Nenhum contrato corresponde aos filtros."
                  : "Nenhum contrato encontrado."
              }
              description={
                filtered
                  ? "Ajuste a busca ou limpe os filtros para ver todos os contratos."
                  : "O Contratos.gov.br não informa contratos para as UASGs desta abrangência."
              }
              action={
                filtered && (
                  <Button type="button" className="button secondary" onClick={clear}>
                    Limpar filtros
                  </Button>
                )
              }
            />
          ) : (
            <ContractTable rows={data.data} />
          )}
        </div>
        {data && (
          <Pager page={page} total={data.total} limit={data.limit} onChange={setPage} />
        )}
      </section>
    </>
  );
}

function initials(name: string | null) {
  return String(name || "—")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function ContractTable({ rows }: { rows: ContractSummary[] }) {
  return (
    <div className="table-scroll">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contrato / objeto</TableHead>
            <TableHead>Fornecedor</TableHead>
            <TableHead>Vigência</TableHead>
            <TableHead>Valor global</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>
              <span className="sr-only">Abrir</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((entry) => {
            const href = `/contratos/${entry.externalId}`;
            return (
              <TableRow key={entry.externalId}>
                <TableCell>
                  <Link className="record-number" href={href}>
                    {entry.number}
                  </Link>
                  <div className="object-summary">
                    {entry.object || "Objeto não informado"}
                  </div>
                  <span className="tiny-label">UASG {entry.uasg}</span>
                </TableCell>
                <TableCell>
                  <div className="supplier">
                    <span className="initials" aria-hidden="true">
                      {initials(entry.supplierName)}
                    </span>
                    <div>
                      {entry.supplierName || "Não informado"}
                      <small>
                        {entry.supplierDocument
                          ? maskDocument(entry.supplierDocument)
                          : "Documento não informado"}
                      </small>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {entry.startDate || entry.endDate ? (
                    <>
                      <span>{date(entry.startDate)}</span>
                      <small className="date-end">até {date(entry.endDate)}</small>
                    </>
                  ) : (
                    vigency(null, null)
                  )}
                </TableCell>
                <TableCell className="amount">{currency(entry.globalValue)}</TableCell>
                <TableCell>
                  <div className="row-badges">
                    <Status status={entry.status} />
                    {entry.guaranteeBeforeEnd && (
                      <Badge variant="outline" className="fact-warning">
                        Garantia vence antes
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Link className="row-arrow" aria-label={`Abrir ${entry.number}`} href={href}>
                    <ArrowUpRight size={18} />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
