"use client";
import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { currency, date } from "@/lib/api";
import { PurchaseItem, known, quantity, document } from "@/lib/catalog-api";
import { Pager } from "../ui";
export function PurchaseItems({
  items,
  detailsSyncedAt,
}: {
  items: PurchaseItem[];
  detailsSyncedAt: string | null;
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
          Detalhes ainda não consultados. Use “Atualizar detalhes” para
          consultar a fonte pública.
        </p>
      )}
      {detailsSyncedAt && !items.length && (
        <p className="muted">
          Nenhum item informado na última consulta bem sucedida.
        </p>
      )}
      {detailsSyncedAt && items.length > 0 && (
        <>
          <div className="purchase-item-controls">
            <div className="search-field">
              <Search size={18} />
              <input
                aria-label="Buscar itens do pregão"
                placeholder="Número, descrição ou fornecedor…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <label htmlFor="purchase-items-size">
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
            </label>
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
              <table className="result-table">
                <caption>
                  Resultados informados para o item {item.number}
                </caption>
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>Quantidade</th>
                    <th>Preço unitário</th>
                    <th>Total</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {item.results.map((result, i) => (
                    <tr
                      key={`${result.externalId}-${i}`}
                      className={result.cancelled ? "cancelled-result" : ""}
                    >
                      <td>
                        <strong>{known(result.supplierName)}</strong>
                        <small className="date-end">
                          {document(result.supplierDocument)}
                        </small>
                      </td>
                      <td>{quantity(result.quantity)}</td>
                      <td className="amount">{currency(result.unitPrice)}</td>
                      <td className="amount">{currency(result.totalValue)}</td>
                      <td>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
