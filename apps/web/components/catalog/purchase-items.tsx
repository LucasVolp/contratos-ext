"use client";
import {
  Table,
  TableCaption,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";

import { SearchField } from "@/components/ui/search-field";
import { Label } from "@/components/ui/label";

import { useRef, useState } from "react";
import { currency, date } from "@/lib/api";
import { PurchaseItem, known, quantity, document } from "@/lib/catalog-api";
import { Pager } from "../ui";
export function PurchaseItems({
  items,
  detailsSyncedAt,
  updating = false,
  error = false,
}: {
  items: PurchaseItem[];
  detailsSyncedAt: string | null;
  updating?: boolean;
  error?: boolean;
}) {
  const [page, setPage] = useState(1),
    [size, setSize] = useState(5),
    [search, setSearch] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const query = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = items.filter((item) =>
    [
      item.number,
      item.description,
      ...item.results.flatMap((result) => [
        result.supplierName,
        result.supplierDocument,
      ]),
    ].some((value) => value?.toLocaleLowerCase("pt-BR").includes(query)),
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / size)),
  );
  const visible = filtered.slice((currentPage - 1) * size, currentPage * size);
  function changePage(next: number) {
    setPage(next);
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }
  return (
    <section className="detail-section purchase-items">
      <div className="section-heading">
        <h2 ref={heading} tabIndex={-1}>
          Itens e resultados
        </h2>
        <span className="tiny-label">
          {detailsSyncedAt ? `${items.length} ITENS SALVOS` : "NÃO CONSULTADO"}
        </span>
      </div>
      {!detailsSyncedAt && (
        <p className="catalog-notice">
          Os detalhes serão carregados automaticamente. Se a consulta falhar,
          tente atualizar os detalhes novamente.
        </p>
      )}
      {detailsSyncedAt && !items.length && !updating && !error && (
        <p className="muted">
          Nenhum item informado na última consulta bem sucedida.
        </p>
      )}
      {detailsSyncedAt && items.length > 0 && (
        <>
          <div className="purchase-item-controls">
            <SearchField
              id="purchase-items-search"
              label="Buscar itens do pregão"
              placeholder="Número, descrição ou fornecedor…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            <Label htmlFor="purchase-items-size">
              Itens por página
              <select
                id="purchase-items-size"
                value={size}
                onChange={(event) => {
                  setSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {[5, 10, 25].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Label>
          </div>
          {filtered.length > 0 ? (
            <nav aria-label="Paginação dos itens">
              <Pager
                page={currentPage}
                total={filtered.length}
                limit={size}
                onChange={changePage}
              />
            </nav>
          ) : (
            <p className="catalog-notice" role="status">
              Nenhum item corresponde à busca. Tente outro número, descrição ou
              fornecedor.
            </p>
          )}
        </>
      )}
      {visible.map((item, index) => (
        <article
          className="catalog-purchase-item"
          key={`${item.externalId}-${index}`}
        >
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                ITEM {item.number} · {known(item.status)}
              </div>
              <h3>{known(item.description)}</h3>
            </div>
          </div>
          <dl className="catalog-item-facts">
            <div>
              <dt>Unidade</dt>
              <dd>{known(item.unit)}</dd>
            </div>
            <div>
              <dt>Quantidade</dt>
              <dd>{quantity(item.quantity)}</dd>
            </div>
            <div>
              <dt>Preço estimado</dt>
              <dd>{currency(item.estimatedUnitPrice)}</dd>
            </div>
            <div>
              <dt>Total estimado</dt>
              <dd>{currency(item.estimatedTotal)}</dd>
            </div>
          </dl>
          {!item.results.length ? (
            <p className="muted">
              Nenhum resultado informado na consulta salva.
            </p>
          ) : (
            <div className="table-scroll">
              <Table className="result-table">
                <TableCaption>
                  Resultados informados para o item {item.number}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Quantidade</TableHead>
                    <TableHead>Preço unitário</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Resultado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.results.map((result, i) => (
                    <TableRow
                      key={`${result.externalId}-${i}`}
                      className={result.cancelled ? "cancelled-result" : ""}
                    >
                      <TableCell>
                        <strong>{known(result.supplierName)}</strong>
                        <small className="date-end">
                          {document(result.supplierDocument)}
                        </small>
                      </TableCell>
                      <TableCell>{quantity(result.quantity)}</TableCell>
                      <TableCell className="amount">
                        {currency(result.unitPrice)}
                      </TableCell>
                      <TableCell className="amount">
                        {currency(result.totalValue)}
                      </TableCell>
                      <TableCell>
                        {result.cancelled ? (
                          <>
                            <span className="status expired">
                              <i />
                              Cancelado
                            </span>
                            <small className="date-end">
                              {date(result.cancelledAt)}
                            </small>
                          </>
                        ) : (
                          <>
                            <span>{known(result.status)}</span>
                            <small className="date-end">
                              Resultado informado · {date(result.resultDate)}
                            </small>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </article>
      ))}
      {filtered.length > size && (
        <nav aria-label="Paginação dos itens ao final">
          <Pager
            page={currentPage}
            total={filtered.length}
            limit={size}
            onChange={changePage}
          />
        </nav>
      )}
    </section>
  );
}
