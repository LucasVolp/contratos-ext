"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, FilePenLine } from "lucide-react";
import { api, currency, date } from "@/lib/api";
import {
  PublicRecordDetail,
  known,
  quantity,
  document,
  stamp,
  purchaseNumber,
} from "@/lib/catalog-api";
import { ErrorState, Loading, PageHead } from "../ui";
import { CatalogTabs } from "./catalog-tabs";
import { ItemSupplementPanel } from "./item-supplement";
export function PublicRecordDetailPage({ id }: { id: string }) {
  const [data, setData] = useState<PublicRecordDetail | null>(null),
    [error, setError] = useState(""),
    [actionError, setActionError] = useState(""),
    [reload, setReload] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    api<PublicRecordDetail>(`/public-records/${id}`, { signal: c.signal })
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
    setBusy(true);
    setActionError("");
    try {
      setData(
        await api(`/public-records/${id}/refresh`, {
          method: "POST",
          body: "{}",
        }),
      );
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error && !data)
    return <ErrorState message={error} retry={() => setReload((n) => n + 1)} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHead
        section="Atas & documentos"
        title={data.number}
        description="Ata publicada · registro oficial salvo no catálogo"
        back="/atas/publicadas"
      >
        <button className="button secondary" onClick={refresh} disabled={busy}>
          <RefreshCw size={16} />
          {busy ? "Atualizando…" : "Atualizar detalhes"}
        </button>
        <Link href={`/atas/publicadas/${id}/preparar`} className="button">
          <FilePenLine size={16} />
          Preparar documento
        </Link>
      </PageHead>
      <CatalogTabs published />
      <div aria-live="polite">
        {actionError && <ErrorState message={actionError} retry={refresh} />}
      </div>
      <div className="catalog-detail">
        <section className="detail-section">
          <div className="section-heading">
            <span className="eyebrow">ATA OFICIAL</span>
            <span className="status">
              <i />
              {known(data.situation)}
            </span>
          </div>
          <h2 className="object-title">{known(data.object)}</h2>
          <dl className="metadata">
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
              <dt>Vigência</dt>
              <dd>
                {date(data.startDate)} — {date(data.endDate)}
              </dd>
            </div>
            <div>
              <dt>Valor total informado</dt>
              <dd>{currency(data.totalValue)}</dd>
            </div>
            <div>
              <dt>Processo</dt>
              <dd>{known(data.processNumber)}</dd>
            </div>
            <div>
              <dt>Compra vinculada</dt>
              <dd>
                {data.linkedPurchaseId ? (
                  <Link
                    className="inline-link"
                    href={`/pregoes/${data.linkedPurchaseId}`}
                  >
                    {purchaseNumber(data.purchaseNumber, data.purchaseYear)} →
                  </Link>
                ) : (
                  purchaseNumber(data.purchaseNumber, data.purchaseYear)
                )}
                {!data.linkedPurchaseId && (
                  <small>Compra não salva no catálogo local.</small>
                )}
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
              <dt>Identificador oficial da ata</dt>
              <dd>{data.externalId}</dd>
            </div>
            <div>
              <dt>Última consulta do catálogo</dt>
              <dd>{stamp(data.lastSyncedAt)}</dd>
            </div>
            <div>
              <dt>Detalhes consultados em</dt>
              <dd>{stamp(data.detailsSyncedAt)}</dd>
            </div>
          </dl>
        </section>
        <section className="detail-section">
          <div className="section-heading">
            <h2>Fornecedores informados</h2>
            <span className="tiny-label">
              {data.detailsSyncedAt
                ? `${data.suppliers.length} FORNECEDORES SALVOS`
                : "NÃO CONSULTADO"}
            </span>
          </div>
          {!data.detailsSyncedAt && (
            <p className="catalog-notice">
              Consulte os detalhes para obter os fornecedores disponíveis.
            </p>
          )}
          {data.detailsSyncedAt && !data.suppliers.length && (
            <p className="muted">
              Nenhum fornecedor informado na última consulta salva.
            </p>
          )}
          <div className="catalog-suppliers">
            {data.suppliers.map((supplier, i) => (
              <div key={`${supplier.document}-${i}`}>
                <strong>{known(supplier.name)}</strong>
                <span>{document(supplier.document)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="detail-section">
          <div className="section-heading">
            <h2>Itens da ata</h2>
            <span className="tiny-label">
              {!data.detailsSyncedAt
                ? "NÃO CONSULTADO"
                : data.itemsCount === null
                  ? "QUANTIDADE NÃO INFORMADA"
                  : `${data.itemsCount} ITENS INFORMADOS`}
            </span>
          </div>
          {!data.detailsSyncedAt && (
            <p className="catalog-notice">
              Itens ainda não consultados. Use “Atualizar detalhes” para
              consultar a fonte pública.
            </p>
          )}
          {data.detailsSyncedAt && !data.items.length && (
            <p className="muted">
              Nenhum item informado na última consulta salva.
            </p>
          )}
          {data.items.map((item, index) => (
            <article
              className="catalog-public-item"
              key={`${item.key}-${item.supplierDocument}-${index}`}
            >
              <div className="section-heading">
                <div>
                  <div className="eyebrow">ITEM {item.number}</div>
                  <h3>{known(item.description)}</h3>
                  <p className="catalog-section-caption">
                    {[item.brand, item.model].filter(Boolean).join(" · ") ||
                      "Marca / modelo não informados"}
                  </p>
                </div>
              </div>
              <dl className="catalog-item-facts">
                <div>
                  <dt>Fornecedor</dt>
                  <dd>
                    {known(item.supplierName)}
                    <small>{document(item.supplierDocument)}</small>
                  </dd>
                </div>
                <div>
                  <dt>Quantidade / unidade</dt>
                  <dd>
                    {quantity(item.quantity)} · {known(item.unit)}
                  </dd>
                </div>
                <div>
                  <dt>Preço unitário</dt>
                  <dd>{currency(item.unitPrice)}</dd>
                </div>
                <div>
                  <dt>Total informado</dt>
                  <dd>{currency(item.totalValue)}</dd>
                </div>
              </dl>
              <ItemSupplementPanel
                recordId={id}
                itemKey={item.key}
                initial={item.supplement}
              />
            </article>
          ))}
        </section>
        <p className="catalog-footnote">
          Fonte: Compras.gov.br. A consulta mantém o registro oficial separado
          dos documentos locais. Campos indisponíveis permanecem identificados.
        </p>
      </div>
    </>
  );
}
