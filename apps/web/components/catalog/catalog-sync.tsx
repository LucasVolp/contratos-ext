"use client";
import { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import {
  validateFields,
  FieldErrors,
  blurFieldErrors,
} from "@contracts/validation";
import { api, ApiError, validationSummary } from "@/lib/api";
import {
  ErrorState,
  Field,
  FormValidation,
  focusInvalid,
  PageHead,
} from "../ui";
export function CatalogSync({ records = false }: { records?: boolean }) {
  const [values, setValues] = useState({ uasg: "", from: "", to: "" }),
    [errors, setErrors] = useState<FieldErrors>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<{
      created: number;
      updated: number;
      total: number;
    } | null>(null);
  const root = records ? "/atas/publicadas" : "/pregoes";
  function validate() {
    const next = validateFields(values, "import");
    if (values.from && values.to) {
      const days = (Date.parse(values.to) - Date.parse(values.from)) / 86400000;
      if (days + 1 > 366) next.to = "Use um intervalo de até 366 dias.";
    }
    return next;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) {
      setError(validationSummary(next));
      focusInvalid(next);
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await api(`/${records ? "public-records" : "purchases"}/sync`, {
          method: "POST",
          body: JSON.stringify(values),
        }),
      );
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        focusInvalid(e.fieldErrors);
      }
      setError(
        e instanceof ApiError && Object.keys(e.fieldErrors).length
          ? validationSummary(e.fieldErrors)
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        section={records ? "Atas & documentos" : "Pregões"}
        title={records ? "Consultar atas" : "Consultar pregões"}
        description="Uma consulta explícita à fonte pública, salva no seu arquivo de trabalho."
        back={root}
      />
      <div className="import-layout">
        <FormValidation.Provider
          value={{
            errors,
            onBlur: (name) =>
              setErrors((old) => blurFieldErrors(old, validate(), name)),
          }}
        >
          <form className="import-form" onSubmit={submit} noValidate>
            <div className="eyebrow">COMPRAS.GOV.BR</div>
            <h2>
              {records
                ? "Atas por início da vigência."
                : "Pregões por data de publicação."}
            </h2>
            <p className="catalog-form-intro">
              {records
                ? "O período seleciona a data de início da vigência da ata na fonte pública."
                : "O período seleciona a publicação da compra na fonte pública."}{" "}
              Use um intervalo de até 366 dias.
            </p>
            <div className="form-grid">
              <Field
                name="uasg"
                label="UASG"
                required
                value={values.uasg}
                onChange={(k, v) => setValues((old) => ({ ...old, [k]: v }))}
              />
              <Field
                name="from"
                label="Data inicial da consulta"
                required
                type="date"
                value={values.from}
                onChange={(k, v) => setValues((old) => ({ ...old, [k]: v }))}
              />
              <Field
                name="to"
                label="Data final da consulta"
                required
                type="date"
                value={values.to}
                onChange={(k, v) => setValues((old) => ({ ...old, [k]: v }))}
              />
            </div>
            <div aria-live="polite">
              {error && (
                <ErrorState
                  message={error}
                  retry={() => {
                    void submit({ preventDefault() {} } as React.FormEvent);
                  }}
                />
              )}
              {result && (
                <div className="success-state">
                  <h3>Consulta concluída</h3>
                  <p>
                    {result.created} criados · {result.updated} atualizados ·{" "}
                    {result.total} consultados
                  </p>
                  <Link href={root}>
                    Ver {records ? "atas publicadas" : "pregões"} →
                  </Link>
                </div>
              )}
            </div>
            <button className="button" type="submit" disabled={busy}>
              <RefreshCw size={16} />
              {busy
                ? "Consultando…"
                : records
                  ? "Consultar atas"
                  : "Consultar pregões"}
            </button>
          </form>
        </FormValidation.Provider>
        <aside className="import-note">
          <h2>
            Da fonte pública
            <br />
            ao seu arquivo.
          </h2>
          <p>
            Os registros de outras consultas são preservados. Em caso de
            indisponibilidade, a última consulta salva permanece disponível.
          </p>
          <p>
            Consultar atas publicadas não modifica os seus documentos locais.
            Você escolhe quando preparar um documento por fornecedor.
          </p>
        </aside>
      </div>
    </>
  );
}
