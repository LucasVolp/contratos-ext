"use client";
import { useEffect, useRef, useState } from "react";
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
const canonicalItemKey = (key: string) => /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key;
export function PublicRecordDetailPage({ id }: { id: string }) {
  return <PublicRecordDetailPageContent key={id} id={id} />;
}
function PublicRecordDetailPageContent({ id }: { id: string }) {
  const [data, setData] = useState<PublicRecordDetail | null>(null),
    [error, setError] = useState(""),
    [actionError, setActionError] = useState(""),
    [reload, setReload] = useState(0),
    [busy, setBusy] = useState(false),
    [bulkBusy, setBulkBusy] = useState(false),
    [bulkError, setBulkError] = useState("");
  const lifecycle = useRef<AbortController | null>(null);
  const [updating, setUpdating] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    lifecycle.current = c;
    async function load() {
      let cached = false;
      try {
        const value = await api<PublicRecordDetail>(`/public-records/${id}`, { signal: c.signal });
        if (c.signal.aborted) return;
        cached = true;
        setData(value);
        setError("");
      } catch (e) {
        if (!c.signal.aborted) setError((e as Error).message);
      }
      if (c.signal.aborted) return;
      try {
        const result = await api<{ data: PublicRecordDetail; errors: { details?: string; records?: string } }>(
          `/public-records/${id}/ensure-details`,
          { method: "POST", body: "{}", signal: c.signal },
        );
        if (c.signal.aborted) return;
        cached = true;
        setData(result.data);
        setError("");
        setActionError(result.errors.details || "");
      } catch (e) {
        if (!c.signal.aborted) {
          if (cached) setActionError((e as Error).message);
          else setError((e as Error).message);
        }
      } finally {
        if (!c.signal.aborted) setUpdating(false);
      }
      if (!c.signal.aborted && cached) await loadSupplements(false, c.signal);
    }
    void load();
    return () => c.abort();
    // The keyed page owns one request lifecycle per record and explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reload]);
  async function loadSupplements(force: boolean, signal = lifecycle.current?.signal) {
    if (!signal || signal.aborted) return;
    setBulkBusy(true);
    setBulkError("");
    try {
      const result = await api<{ data: PublicRecordDetail; errors: { supplements?: string } }>(
        `/public-records/${id}/supplements/refresh`,
        { method: "POST", body: JSON.stringify({ force }), signal },
      );
      if (!signal.aborted) {
        setData(result.data);
        setBulkError(result.errors.supplements || "");
      }
    } catch (e) {
      if (!signal.aborted) setBulkError((e as Error).message);
    } finally {
      if (!signal.aborted) setBulkBusy(false);
    }
  }
  async function refresh() {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted) return;
    setBusy(true);
    setActionError("");
    try {
      const value = await api<PublicRecordDetail>(`/public-records/${id}/refresh`, { method: "POST", body: "{}", signal });
      if (!signal.aborted) setData(value);
    } catch (e) {
      if (!signal.aborted) setActionError((e as Error).message);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  if (error && !data)
    return <ErrorState message={error} retry={() => setReload((n) => n + 1)} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHead
        title={data.number}
        description="Ata publicada · registro oficial salvo no catálogo"
        back="/atas/publicadas"
      >
        <button className="button secondary" onClick={refresh} disabled={busy || updating || bulkBusy}>
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
        {updating && <p className="catalog-notice" role="status">Atualizando detalhes automaticamente…</p>}
        {bulkBusy && <p className="catalog-notice" role="status">Atualizando participantes e saldos de todos os itens…</p>}
        {bulkError && <ErrorState message={bulkError} retry={() => void loadSupplements(true)} />}
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
              Os fornecedores serão carregados automaticamente. Se a consulta falhar, tente atualizar os detalhes novamente.
            </p>
          )}
          {data.detailsSyncedAt && !data.suppliers.length && !updating && !actionError && (
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
            <div>
              <h2>Itens da ata</h2>
              <button className="button secondary" onClick={() => void loadSupplements(true)} disabled={busy || updating || bulkBusy}>
                <RefreshCw size={15} />
                Atualizar participantes e saldos
              </button>
            </div>
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
              Itens ainda não consultados. A atualização automática consulta a fonte pública; você também pode tentar novamente em “Atualizar detalhes”.
            </p>
          )}
          {data.detailsSyncedAt && !data.items.length && !updating && !actionError && (
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
                data={item.supplement}
                disabled={busy || updating || bulkBusy}
                onUpdate={(supplement) => setData((old) => old ? {
                  ...old,
                  items: old.items.map((entry) => canonicalItemKey(entry.key) === canonicalItemKey(item.key) ? { ...entry, supplement } : entry),
                } : old)}
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
