"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDownToLine, Check, FileText, Pencil, Trash2 } from "lucide-react";
import {
  api,
  Contract,
  currency,
  date,
  Export,
  fieldLabel,
  RecordData,
} from "@/lib/api";
import { ErrorState, Loading, PageHead, Status } from "./ui";
export function DetailPage({
  id,
  records = false,
}: {
  id: string;
  records?: boolean;
}) {
  const [data, setData] = useState<Contract | RecordData | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [readiness, setReadiness] = useState<{
      ready: boolean;
      missingFields: string[];
    } | null>(null),
    [itemId, setItemId] = useState(""),
    [history, setHistory] = useState<Export[] | null>(null),
    [readinessError, setReadinessError] = useState(""),
    [historyError, setHistoryError] = useState(""),
    [readinessReload, setReadinessReload] = useState(0),
    [historyReload, setHistoryReload] = useState(0),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState("");
  const router = useRouter();
  const resource = records ? "records" : "contracts";
  const root = records ? "/atas" : "/contratos";
  useEffect(() => {
    const c = new AbortController();
    api<Contract | RecordData>(`/${resource}/${id}`, { signal: c.signal })
      .then((v) => {
        setData(v);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id, resource, reload]);
  useEffect(() => {
    if (!records) return;
    const c = new AbortController();
    api<{ ready: boolean; missingFields: string[] }>(
      `/records/${id}/readiness${itemId ? `?itemId=${encodeURIComponent(itemId)}` : ""}`,
      { signal: c.signal },
    )
      .then((v) => {
        if (!c.signal.aborted) {
          setReadiness(v);
          setReadinessError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setReadinessError(e.message);
      });
    return () => c.abort();
  }, [id, records, itemId, reload, readinessReload]);
  useEffect(() => {
    if (!records) return;
    const c = new AbortController();
    api<Export[]>(`/records/${id}/exports`, { signal: c.signal })
      .then((value) => {
        if (!c.signal.aborted) {
          setHistory(value);
          setHistoryError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setHistoryError(e.message);
      });
    return () => c.abort();
  }, [id, records, reload, historyReload]);
  async function remove() {
    if (
      !window.confirm(
        `Excluir ${records ? "a ata" : "o contrato"} ${data?.number}? Esta ação não pode ser desfeita.`,
      )
    )
      return;
    setBusy("delete");
    try {
      await api(`/${resource}/${id}`, { method: "DELETE" });
      router.push(root);
    } catch (e) {
      setActionError((e as Error).message);
      setBusy("");
    }
  }
  async function download(format: string) {
    setBusy(format);
    setActionError("");
    try {
      const response = await fetch(
        `/api/records/${id}/document?format=${format}${itemId ? `&itemId=${encodeURIComponent(itemId)}` : ""}`,
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          Array.isArray(body.message) ? body.message.join(" · ") : body.message,
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = response.headers.get("content-disposition") || "";
      a.download = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
        ? decodeURIComponent(
            disposition.match(/filename\*=UTF-8''([^;]+)/i)![1],
          )
        : disposition.match(/filename="?([^";]+)"?/i)?.[1] ||
          `ata-${data?.number}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReload((n) => n + 1);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (error)
    return <ErrorState message={error} retry={() => setReload(reload + 1)} />;
  if (!data) return <Loading />;
  const record = data as RecordData;
  return (
    <>
      <PageHead
        title={data.number}
        description={
          records ? "Ata de registro de preços" : "Ficha do contrato"
        }
        back={root}
      >
        <Link className="button secondary" href={`${root}/${id}/editar`}>
          <Pencil size={16} />
          Editar {records ? "ata" : "contrato"}
        </Link>
        <button
          className="icon-button danger"
          aria-label={`Excluir ${records ? "ata" : "contrato"}`}
          disabled={!!busy}
          onClick={remove}
        >
          <Trash2 size={17} />
        </button>
      </PageHead>
      <div className={`detail-layout ${records ? "" : "single"}`}>
        <div>
          <section className="detail-section">
            <div className="section-heading">
              <span className="eyebrow">
                {records ? "DOCUMENTO" : "COMPROMISSO"}
              </span>
              {records ? (
                <span
                  className={`status ${readiness?.ready ? "active" : "expiring"}`}
                >
                  <i />
                  {readinessError
                    ? "Verificação indisponível"
                    : readiness === null
                      ? "Verificando preenchimento"
                      : readiness.ready
                        ? "Pronta para exportar"
                        : "Preenchimento pendente"}
                </span>
              ) : (
                <Status status={String(data.status)} />
              )}
            </div>
            <h2 className="object-title">{data.object}</h2>
            <dl className="metadata">
              <div>
                <dt>UASG</dt>
                <dd>{data.uasg}</dd>
              </div>
              <div>
                <dt>Vigência</dt>
                <dd>
                  {date(data.startDate)} — {date(data.endDate)}
                </dd>
              </div>
              {records ? (
                <>
                  <div>
                    <dt>Processo</dt>
                    <dd>{String(record.processNumber || "Não informado")}</dd>
                  </div>
                  <div>
                    <dt>Compra</dt>
                    <dd>
                      {String(record.purchaseNumber || "Não informada")}{" "}
                      {record.purchaseYear &&
                      !/\/\s*\d{4}$/.test(String(record.purchaseNumber))
                        ? `/ ${record.purchaseYear}`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Modalidade</dt>
                    <dd>
                      {record.modality === "DISPENSA" ? "Dispensa" : "Pregão"}
                    </dd>
                  </div>
                  <div>
                    <dt>Prorrogável</dt>
                    <dd>{record.renewable ? "Sim" : "Não"}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>Unidade</dt>
                    <dd>{String(data.unitName || "Não informada")}</dd>
                  </div>
                  <div>
                    <dt>Origem</dt>
                    <dd>
                      {data.source === "COMPRAS_GOV"
                        ? "Compras.gov.br"
                        : "Cadastro manual"}
                    </dd>
                  </div>
                  {data.source === "COMPRAS_GOV" && (
                    <div>
                      <dt>Última importação</dt>
                      <dd>
                        {data.lastSyncedAt
                          ? new Date(String(data.lastSyncedAt)).toLocaleString(
                              "pt-BR",
                            )
                          : "Não informada"}
                      </dd>
                    </div>
                  )}
                </>
              )}
            </dl>
          </section>
          <section className="detail-section">
            <div className="eyebrow">FORNECEDOR</div>
            <h2>{String(data.supplierName || "Não informado")}</h2>
            <p className="muted">
              {String(data.supplierDocument || "Documento não informado")}
            </p>
            {records && <p>{String(record.supplierRepresentative || "")}</p>}
          </section>
          {records ? (
            <>
              <section className="detail-section">
                <div className="eyebrow">ORGANIZAÇÃO & SIGNATÁRIO</div>
                <h2>
                  {String(
                    record.organizationName || "Organização não informada",
                  )}
                </h2>
                <p>
                  {[
                    record.organizationStreet,
                    record.organizationNumber,
                    record.organizationCity,
                    record.organizationState,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Endereço não informado"}
                </p>
                <dl className="metadata">
                  <div>
                    <dt>CNPJ</dt>
                    <dd>
                      {String(record.organizationDocument || "Não informado")}
                    </dd>
                  </div>
                  <div>
                    <dt>Signatário</dt>
                    <dd>
                      {String(record.authorityName || "Não informado")}
                      <small>{String(record.authorityRole || "")}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Matrícula</dt>
                    <dd>
                      {String(record.authorityRegistration || "Não informada")}
                    </dd>
                  </div>
                  <div>
                    <dt>Portaria</dt>
                    <dd>
                      {String(record.ordinanceNumber || "Não informada")}
                      <small>{date(record.ordinanceDate)}</small>
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="detail-section">
                <div className="section-heading">
                  <h2>Itens registrados</h2>
                  <span className="tiny-label">
                    {record.items.length} ITENS
                  </span>
                </div>
                <div className="item-list">
                  {record.items.map((item) => (
                    <article className="item-row" key={item.id || item.number}>
                      <span className="item-index">
                        {String(item.number).padStart(2, "0")}
                      </span>
                      <div>
                        <h3>{item.description || "Item sem descrição"}</h3>
                        <p>
                          {[item.brand, item.model, item.unit]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <small>
                          Quantidade: {item.quantity} · Mínima:{" "}
                          {item.minimumQuantity} · Garantia:{" "}
                          {item.warranty || "Não informada"}
                        </small>
                      </div>
                      <strong>
                        {currency(item.unitPrice)}
                        <small>por {item.unit || "unidade"}</small>
                      </strong>
                    </article>
                  ))}
                </div>
                <div className="total-line">
                  <span>Valor total da ata</span>
                  <strong>{currency(record.totalValue)}</strong>
                </div>
              </section>
            </>
          ) : (
            <section className="value-summary">
              <div>
                <span>VALOR INICIAL</span>
                <strong>{currency(data.initialValue)}</strong>
              </div>
              <div>
                <span>VALOR GLOBAL</span>
                <strong>{currency(data.globalValue)}</strong>
              </div>
            </section>
          )}
        </div>
        {records && (
          <aside className="document-panel">
            <div className="document-glyph">
              <FileText size={35} strokeWidth={1} />
              <span>ARP</span>
            </div>
            <div className="eyebrow">DOCUMENTO FINAL</div>
            <h2>Seu documento, bem preparado.</h2>
            <p>Selecione o conteúdo e baixe no formato que precisa.</p>
            <label htmlFor="export-scope">Conteúdo do documento</label>
            <select
              id="export-scope"
              value={itemId}
              onChange={(e) => {
                setReadiness(null);
                setReadinessError("");
                setItemId(e.target.value);
                setActionError("");
              }}
            >
              <option value="">Ata completa</option>
              {record.items
                .filter((i) => i.id)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    Item {i.number} — {i.description.slice(0, 40)}
                  </option>
                ))}
            </select>
            <button
              className="button"
              onClick={() => download("docx")}
              disabled={!!busy || !readiness?.ready}
            >
              <ArrowDownToLine size={16} />
              {busy === "docx" ? "Preparando…" : "Baixar DOCX"}
            </button>
            <button
              className="button secondary"
              onClick={() => download("pdf")}
              disabled={!!busy || !readiness?.ready}
            >
              <ArrowDownToLine size={16} />
              {busy === "pdf" ? "Preparando…" : "Baixar PDF"}
            </button>
            <div aria-live="polite">
              {actionError && <ErrorState message={actionError} />}{" "}
              {readinessError && (
                <ErrorState
                  message={readinessError}
                  retry={() => {
                    setReadinessError("");
                    setReadiness(null);
                    setReadinessReload((n) => n + 1);
                  }}
                />
              )}
              {readiness && !readiness.ready && (
                <div className="pending">
                  <strong>Antes de exportar</strong>
                  <p>Complete estes dados na edição da ata:</p>
                  <ul>
                    {readiness.missingFields.map((f) => (
                      <li key={f}>{fieldLabel(f)}</li>
                    ))}
                  </ul>
                  <Link href={`/atas/${id}/editar`}>
                    Completar preenchimento →
                  </Link>
                </div>
              )}
              {readiness?.ready && (
                <p className="ready-note">
                  <Check size={14} /> Dados obrigatórios preenchidos
                </p>
              )}
            </div>
            <div className="export-history">
              <h3>Histórico de documentos</h3>
              {historyError ? (
                <ErrorState
                  message={historyError}
                  retry={() => {
                    setHistoryError("");
                    setHistory(null);
                    setHistoryReload((n) => n + 1);
                  }}
                />
              ) : history === null ? (
                <p role="status">Carregando histórico…</p>
              ) : !history.length ? (
                <p>Nenhum documento gerado ainda.</p>
              ) : (
                history.map((e) => (
                  <div key={e.id}>
                    <span>
                      {e.format.toUpperCase()}
                      {e.itemNumber
                        ? ` · Item ${e.itemNumber}`
                        : " · Ata completa"}
                    </span>
                    <small>
                      {new Date(e.createdAt).toLocaleString("pt-BR")}
                    </small>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>
      {!records && actionError && <ErrorState message={actionError} />}
    </>
  );
}
