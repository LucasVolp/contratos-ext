"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { api, currency, date } from "@/lib/api";
import {
  PurchaseDetail,
  PublicRecordSummary,
  known,
  quantity,
  document,
  stamp,
  purchaseNumber,
} from "@/lib/catalog-api";
import { ErrorState, Loading, PageHead } from "../ui";
export function PurchaseDetailPage({ id }: { id: string }) {
  const [data, setData] = useState<PurchaseDetail | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [actionError, setActionError] = useState(""),
    [linkedError, setLinkedError] = useState(""),
    [busy, setBusy] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api<PurchaseDetail>(`/purchases/${id}`, { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) {
          setData(v);
          setError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id, reload]);
  async function refresh() {
    setBusy("details");
    setActionError("");
    try {
      setData(
        await api(`/purchases/${id}/refresh`, { method: "POST", body: "{}" }),
      );
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function linked() {
    setBusy("records");
    setLinkedError("");
    try {
      const value = await api<{ records: PublicRecordSummary[] }>(
        `/purchases/${id}/records/refresh`,
        { method: "POST", body: "{}" },
      );
      setData((old) =>
        old
          ? {
              ...old,
              linkedRecords: value.records,
              recordsSyncedAt: new Date().toISOString(),
            }
          : old,
      );
    } catch (e) {
      setLinkedError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (error && !data)
    return <ErrorState message={error} retry={() => setReload((n) => n + 1)} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHead
        section="Pregões"
        title={purchaseNumber(data.number, data.year)}
        description="Fonte: Compras.gov.br · dados salvos no arquivo local"
        back="/pregoes"
      >
        <button
          className="button secondary"
          onClick={refresh}
          disabled={!!busy}
        >
          <RefreshCw size={16} />
          {busy === "details" ? "Atualizando…" : "Atualizar detalhes"}
        </button>
      </PageHead>
      <div aria-live="polite">
        {actionError && <ErrorState message={actionError} retry={refresh} />}
      </div>
      <div className="catalog-detail">
        <section className="detail-section">
          <div className="section-heading">
            <span className="eyebrow">PREGÃO · {known(data.status)}</span>
            <span className="status">
              <i />
              SRP:{" "}
              {data.srp === null ? "Não informado" : data.srp ? "Sim" : "Não"}
            </span>
          </div>
          <h2 className="object-title">{known(data.object)}</h2>
          <dl className="metadata">
            <div>
              <dt>Processo</dt>
              <dd>{known(data.processNumber)}</dd>
            </div>
            <div>
              <dt>Organização</dt>
              <dd>
                {known(data.organizationName)}
                <small>{document(data.organizationDocument)}</small>
              </dd>
            </div>
            <div>
              <dt>Unidade / UASG</dt>
              <dd>
                {known(data.unitName)}
                <small>{data.uasg}</small>
              </dd>
            </div>
            <div>
              <dt>Local</dt>
              <dd>
                {[data.city, data.state].filter(Boolean).join(" / ") ||
                  "Não informado"}
              </dd>
            </div>
            <div>
              <dt>Publicação</dt>
              <dd>{date(data.publishedAt)}</dd>
            </div>
            <div>
              <dt>Abertura</dt>
              <dd>{date(data.openingAt)}</dd>
            </div>
            <div>
              <dt>Encerramento</dt>
              <dd>{date(data.closingAt)}</dd>
            </div>
            <div>
              <dt>Valor estimado</dt>
              <dd>{currency(data.estimatedValue)}</dd>
            </div>
            <div>
              <dt>Valor adjudicado informado</dt>
              <dd>{currency(data.awardedValue)}</dd>
            </div>
            <div>
              <dt>Última consulta do catálogo</dt>
              <dd>{stamp(data.lastSyncedAt)}</dd>
            </div>
            <div>
              <dt>Detalhes consultados em</dt>
              <dd>{stamp(data.detailsSyncedAt)}</dd>
            </div>
            <div>
              <dt>Identificador PNCP</dt>
              <dd>{known(data.pncpId)}</dd>
            </div>
          </dl>
        </section>
        <section className="detail-section">
          <div className="section-heading">
            <h2>Itens e resultados</h2>
            <span className="tiny-label">
              {data.detailsSyncedAt
                ? `${data.items.length} ITENS SALVOS`
                : "NÃO CONSULTADO"}
            </span>
          </div>
          {!data.detailsSyncedAt && (
            <p className="catalog-notice">
              Detalhes ainda não consultados. Use “Atualizar detalhes” para
              consultar a fonte pública.
            </p>
          )}
          {data.detailsSyncedAt && !data.items.length && (
            <p className="muted">
              Nenhum item informado na última consulta bem sucedida.
            </p>
          )}
          {data.items.map((item, index) => (
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
                          <td className="amount">
                            {currency(result.unitPrice)}
                          </td>
                          <td className="amount">
                            {currency(result.totalValue)}
                          </td>
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
                                  Resultado informado ·{" "}
                                  {date(result.resultDate)}
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
        </section>
        <section className="detail-section">
          <div className="section-heading">
            <div>
              <h2>Atas vinculadas</h2>
              <p className="catalog-section-caption">
                Última consulta bem sucedida: {stamp(data.recordsSyncedAt)}
              </p>
            </div>
            {data.srp === true && (
              <button
                className="button secondary"
                onClick={linked}
                disabled={!!busy}
              >
                <RefreshCw size={15} />
                {busy === "records"
                  ? "Consultando…"
                  : "Consultar atas vinculadas"}
              </button>
            )}
          </div>
          {data.srp !== true && (
            <p className="catalog-notice">
              {data.srp === false
                ? "Este pregão não utiliza registro de preços."
                : "O registro de preços não foi confirmado pela fonte pública."}{" "}
              A consulta de atas vinculadas exige SRP confirmado.
            </p>
          )}
          {data.srp === true && !data.recordsSyncedAt && (
            <p className="catalog-notice">
              Atas vinculadas ainda não consultadas.
            </p>
          )}
          {linkedError && <ErrorState message={linkedError} retry={linked} />}{" "}
          {data.recordsSyncedAt && !data.linkedRecords.length && (
            <p className="muted">
              Nenhuma ata vinculada encontrada na última consulta bem sucedida.
            </p>
          )}
          {data.linkedRecords.length > 0 && (
            <div className="catalog-linked-list">
              {data.linkedRecords.map((record) => (
                <Link href={`/atas/publicadas/${record.id}`} key={record.id}>
                  <strong>{record.number}</strong>
                  <span>{known(record.object)}</span>
                  <small>
                    {date(record.startDate)} — {date(record.endDate)}
                  </small>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
