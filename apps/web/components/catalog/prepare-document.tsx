"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { PublicRecordDetail, document, known, stamp } from "@/lib/catalog-api";
import { ErrorState, Loading, PageHead } from "../ui";
export function PrepareDocument({ id }: { id: string }) {
  const [data, setData] = useState<PublicRecordDetail | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [selected, setSelected] = useState(""),
    [selectionError, setSelectionError] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
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
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setSelectionError("Selecione o fornecedor para preparar o documento.");
      window.document.getElementById("supplierDocument")?.focus();
      return;
    }
    setBusy(true);
    setActionError("");
    setSelectionError("");
    try {
      const draft = await api<{ id: string; created: boolean }>(
        `/public-records/${id}/draft`,
        {
          method: "POST",
          body: JSON.stringify({ supplierDocument: selected }),
        },
      );
      router.push(`/atas/${draft.id}/editar`);
    } catch (e) {
      setActionError((e as Error).message);
      if (e instanceof ApiError)
        setSelectionError(e.fieldErrors.supplierDocument || "");
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return <ErrorState message={error} retry={() => setReload((n) => n + 1)} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHead
        section="Atas & documentos"
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
              Atualize os detalhes da ata para carregar os fornecedores antes de
              preparar um documento.
            </p>
          )}
          {data.detailsSyncedAt && !data.suppliers.length && (
            <p className="catalog-notice">
              A última consulta não informou fornecedores. Atualize os detalhes
              na ficha da ata para tentar novamente.
            </p>
          )}
          <div aria-live="polite">
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
            disabled={busy || !data.detailsSyncedAt || !data.suppliers.length}
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
