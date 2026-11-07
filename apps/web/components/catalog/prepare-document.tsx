"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { PublicRecordDetail, document, known, stamp } from "@/lib/catalog-api";
import { ErrorState, Loading, PageHead } from "../ui";
export function PrepareDocument({ id }: { id: string }) {
  return <PrepareDocumentContent key={id} id={id} />;
}
function PrepareDocumentContent({ id }: { id: string }) {
  const [data, setData] = useState<PublicRecordDetail | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [selected, setSelected] = useState(""),
    [selectionError, setSelectionError] = useState(""),
    [actionError, setActionError] = useState(""),
    [metadataError, setMetadataError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
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
        setMetadataError(result.errors.details || "");
      } catch (e) {
        if (!c.signal.aborted) {
          if (cached) setMetadataError((e as Error).message);
          else setError((e as Error).message);
        }
      } finally {
        if (!c.signal.aborted) setUpdating(false);
      }
    }
    void load();
    return () => c.abort();
    // The keyed page owns one request lifecycle per record and explicit retry.
  }, [id, reload]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (updating || busy) return;
    if (!selected) {
      setSelectionError("Selecione o fornecedor para preparar o documento.");
      window.document.getElementById("supplierDocument")?.focus();
      return;
    }
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted) return;
    setBusy(true);
    setActionError("");
    setSelectionError("");
    try {
      const draft = await api<{ id: string; created: boolean }>(
        `/public-records/${id}/draft`,
        {
          method: "POST",
          signal,
          body: JSON.stringify({ supplierDocument: selected }),
        },
      );
      if (signal.aborted) return;
      router.push(`/atas/${draft.id}/editar`);
    } catch (e) {
      if (signal.aborted) return;
      setActionError((e as Error).message);
      if (e instanceof ApiError)
        setSelectionError(e.fieldErrors.supplierDocument || "");
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
        title="Preparar documento"
        description="Escolha o fornecedor e continue o preenchimento no editor."
        back={`/atas/publicadas/${id}`}
      />
      <div className="import-layout">
        <form className="import-form" onSubmit={submit} noValidate>
          <div className="eyebrow">ATA OFICIAL · {data.number}</div>
          <h2>{known(data.object)}</h2>
          <p className="catalog-form-intro">
            Os dados públicos disponíveis serão preenchidos no documento. Revise
            e complemente as informações no editor antes de exportar.
          </p>
          <div className="field">
            <label htmlFor="supplierDocument">Fornecedor</label>
            <select
              id="supplierDocument"
              name="supplierDocument"
              required
              disabled={updating || busy}
              value={selected}
              aria-invalid={!!selectionError}
              aria-describedby={
                selectionError
                  ? "supplierDocument-error"
                  : "supplierDocument-hint"
              }
              onChange={(e) => {
                setSelected(e.target.value);
                setSelectionError("");
              }}
            >
              <option value="">Selecione um fornecedor</option>
              {data.suppliers.map((supplier, i) => (
                <option
                  key={`${supplier.document}-${i}`}
                  value={supplier.document}
                >
                  {known(supplier.name)} · {document(supplier.document)}
                </option>
              ))}
            </select>
            <small className="field-hint" id="supplierDocument-hint">
              A seleção é obrigatória, mesmo quando há um único fornecedor.
            </small>
            {selectionError && (
              <small
                id="supplierDocument-error"
                className="field-error"
                role="alert"
              >
                {selectionError}
              </small>
            )}
          </div>
          {!data.detailsSyncedAt && (
            <p className="catalog-notice">
              Os fornecedores serão carregados automaticamente antes de preparar o documento.
            </p>
          )}
          {data.detailsSyncedAt && !data.suppliers.length && !updating && !metadataError && (
            <p className="catalog-notice">
              A última consulta não informou fornecedores. Atualize os detalhes
              na ficha da ata para tentar novamente.
            </p>
          )}
          <div aria-live="polite">
            {updating && <p className="catalog-notice" role="status">Atualizando fornecedores automaticamente…</p>}
            {metadataError && <ErrorState message={metadataError} retry={() => { setUpdating(true); setReload((n) => n + 1); }} />}
            {actionError && (
              <ErrorState
                message={actionError}
                retry={() => {
                  void submit({ preventDefault() {} } as React.FormEvent);
                }}
              />
            )}
          </div>
          <button
            type="submit"
            className="button"
            disabled={busy || updating || !data.detailsSyncedAt || !data.suppliers.length}
          >
            {busy ? "Preparando…" : "Preparar documento"}
          </button>
        </form>
        <aside className="import-note">
          <h2>
            Um documento
            <br />
            por fornecedor.
          </h2>
          <p>
            O documento mantém o número oficial da ata e inclui os itens do
            fornecedor selecionado.
          </p>
          <p>
            Se você já preparou este documento, ele será reaberto com o
            preenchimento local preservado.
          </p>
          <p>Detalhes salvos em {stamp(data.detailsSyncedAt)}.</p>
        </aside>
      </div>
    </>
  );
}
