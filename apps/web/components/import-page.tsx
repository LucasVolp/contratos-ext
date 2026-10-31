"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ExternalLink } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { ErrorState, Field, PageHead } from "./ui";
export function ImportPage({ records = false }: { records?: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({
      uasg: "",
      number: "",
      from: "",
      to: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      created: number;
      updated: number;
      total: number;
    } | null>(null);
  const router = useRouter();
  const root = records ? "/atas" : "/contratos";
  function change(k: string, v: string) {
    setValues((old) => ({ ...old, [k]: v }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const body = {
        uasg: values.uasg,
        from: values.from,
        to: values.to,
        ...(records ? { number: values.number } : {}),
      };
      if (records) {
        const data = await api<{ id: string }>("/records/import", {
          method: "POST",
          body: JSON.stringify(body),
        });
        router.push(`/atas/${data.id}/editar`);
      } else {
        setResult(
          await api("/contracts/import", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        section={records ? "Atas & documentos" : "Contratos"}
        title={records ? "Importar ata" : "Importar contratos"}
        description="Traga os registros públicos do Compras.gov.br para o seu arquivo."
        back={root}
      />
      <div className="import-layout">
        <form className="import-form" onSubmit={submit}>
          <div className="eyebrow">CONSULTA À FONTE PÚBLICA</div>
          <h2>Encontre os registros da unidade.</h2>
          <div className="form-grid">
            <Field
              name="uasg"
              label="UASG"
              value={values.uasg}
              onChange={change}
              required
            />
            {records && (
              <Field
                name="number"
                label="Número da ata"
                value={values.number}
                onChange={change}
                required
              />
            )}
            <Field
              name="from"
              label="Data inicial da consulta"
              value={values.from}
              onChange={change}
              type="date"
              required
            />
            <Field
              name="to"
              label="Data final da consulta"
              value={values.to}
              onChange={change}
              type="date"
              required
            />
          </div>
          <div aria-live="polite">
            {error && <ErrorState message={error} />}{" "}
            {result && (
              <div className="success-state">
                <h3>Importação concluída</h3>
                <p>
                  {result.created} criados · {result.updated} atualizados ·{" "}
                  {result.total} consultados
                </p>
                <Link href="/contratos">Ver contratos →</Link>
              </div>
            )}
          </div>
          <button type="submit" disabled={busy} className="button">
            <ArrowDownToLine size={16} />
            {busy
              ? "Consultando registros…"
              : records
                ? "Importar ata"
                : "Importar contratos"}
          </button>
        </form>
        <aside className="import-note">
          <ExternalLink size={25} strokeWidth={1} />
          <h2>
            Informação pública.
            <br />
            Trabalho organizado.
          </h2>
          <p>
            Os dados vêm do Compras.gov.br. A disponibilidade depende da fonte
            pública e do período informado.
          </p>
          <p>
            {records
              ? "Após a importação, revise e complete os dados antes de gerar os documentos."
              : "Registros já existentes na unidade são atualizados sem duplicar os contratos."}
          </p>
        </aside>
      </div>
    </>
  );
}
