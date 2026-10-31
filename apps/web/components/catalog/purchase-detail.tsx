"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { api, ApiError, currency, date } from "@/lib/api";
import {
  PurchaseDetail,
  RecordsLookup,
  PublicRecordSummary,
  known,
  document,
  stamp,
  purchaseNumber,
} from "@/lib/catalog-api";
import { ErrorState, Loading, PageHead } from "../ui";
import { PurchaseItems } from "./purchase-items";
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
      const value = await api<{
        records: PublicRecordSummary[];
        recordsLookup?: RecordsLookup;
      }>(`/purchases/${id}/records/refresh`, { method: "POST", body: "{}" });
      setData((old) =>
        old
          ? {
              ...old,
              linkedRecords: value.records,
              recordsLookup: value.recordsLookup ?? null,
              recordsSyncedAt: new Date().toISOString(),
            }
          : old,
      );
    } catch (e) {
      setLinkedError(
        e instanceof ApiError && e.status > 0 && e.status < 500
          ? e.message
          : "Não conseguimos concluir a consulta no Compras.gov.br. Tente novamente em instantes. As atas já salvas continuam disponíveis.",
      );
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
        <PurchaseItems
          key={`${id}:${data.detailsSyncedAt}`}
          items={data.items}
          detailsSyncedAt={data.detailsSyncedAt}
        />
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
          {data.srp === true && !data.recordsSyncedAt && !linkedError && (
            <p className="catalog-notice">
              Atas vinculadas ainda não consultadas.
            </p>
          )}
          {linkedError && (
            <ErrorState
              title="Não foi possível consultar as atas deste pregão"
              message={linkedError}
              retry={linked}
            />
          )}
          {!!data.recordsLookup?.incompleteRecords.length && (
            <div className="catalog-notice" role="status">
              <strong>
                Consulta parcial: {data.recordsLookup.incompleteRecords.length}{" "}
                {data.recordsLookup.incompleteRecords.length === 1
                  ? "ata sem identificador PNCP"
                  : "atas sem identificador PNCP"}
              </strong>
              <p>
                O Compras.gov.br retornou registros incompletos. Somente as atas
                identificadas podem ser abertas. Consulte novamente mais tarde
                para verificar atualizações.
              </p>
              <p>
                Números informados:{" "}
                {data.recordsLookup.incompleteRecords
                  .map((record) => record.number || "Não informado")
                  .join(", ")}
                .
              </p>
            </div>
          )}
          {data.recordsSyncedAt &&
            !data.linkedRecords.length &&
            !data.recordsLookup?.incompleteRecords.length &&
            !linkedError && (
              <div className="catalog-notice" role="status">
                <strong>
                  Nenhuma ata publicada encontrada para este pregão.
                </strong>
                <p>
                  A última consulta ao Compras.gov.br não retornou atas
                  vinculadas. Novas publicações podem aparecer em consultas
                  futuras; você pode consultar novamente mais tarde.
                </p>
              </div>
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
