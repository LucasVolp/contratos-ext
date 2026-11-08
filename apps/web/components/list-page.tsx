"use client";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { SearchField } from "@/components/ui/search-field";
import { CatalogTabs } from "./catalog/catalog-tabs";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpRight, Plus } from "lucide-react";
import { api, currency, PageData, RecordData } from "@/lib/api";
import { Empty, ErrorState, Loading, PageBar, Pager, ReachContext } from "./ui";
import { useReach } from "@/lib/session";
import { DocumentsOverview } from "./documents-overview";
/** Atas being prepared for signature (documents), with search and pagination. */
export function ListPage() {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [data, setData] = useState<PageData<RecordData> | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const root = "/atas";
  const reach = useReach();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const query = new URLSearchParams({
        search,
        page: String(page),
        limit: "12",
        ...(reach.uasgs ? { uasgs: reach.uasgs } : {}),
      });
      api<PageData<RecordData>>(`/records?${query}`, {
        signal: controller.signal,
      })
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
  }, [search, page, reload, reach.uasgs]);
  return (
    <>
      <PageBar
        context={
          <>
            <CatalogTabs />
            <ReachContext reach={reach} onChange={() => setPage(1)} />
          </>
        }
      >
        <Link className="button secondary" href={`${root}/importar`}>
          <ArrowDownToLine size={16} />
          Importar
        </Link>
        <Link className="button" href={`${root}/nova`}>
          <Plus size={17} />
          Nova ata
        </Link>
      </PageBar>
      <DocumentsOverview stats={data?.stats ?? null} />
      <section className="registry">
        <div className="filters">
          <SearchField
            id="records-search"
            label="Buscar atas"
            placeholder="Buscar número, objeto ou fornecedor…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div aria-live="polite">
          {error ? (
            <ErrorState message={error} retry={() => setReload(reload + 1)} />
          ) : loading ? (
            <Loading />
          ) : !data?.data.length ? (
            <Empty kind="ata" href={`${root}/nova`} />
          ) : (
            <div className="table-scroll">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ata / objeto</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Itens</TableHead>
                    <TableHead>Valor total</TableHead>
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
                      <TableCell>{`${entry.items?.length ?? 0} itens`}</TableCell>
                      <TableCell className="amount">{currency(entry.totalValue)}</TableCell>
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
