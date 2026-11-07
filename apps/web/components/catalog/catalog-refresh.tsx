"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  validateFields,
  FieldErrors,
  blurFieldErrors,
} from "@contracts/validation";
import { api, ApiError, validationSummary } from "@/lib/api";
import { Reach, useSession } from "@/lib/session";
import { ErrorState, Field, FormValidation, focusInvalid } from "../ui";
type ReachResult = {
  from: string;
  to: string;
  created: number;
  updated: number;
  total: number;
  incomplete: number;
  failed: number;
  results: Array<{
    uasg: string;
    name: string | null;
    created: number;
    updated: number;
    total: number;
    incomplete: number;
    error: string | null;
  }>;
};
const isoDay = (offset = 0) => {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return day.toLocaleDateString("sv-SE");
};
/** Describes which UASGs a refresh reaches, matching the reach used by the listing. */
function useReachLabel(reach: Reach) {
  const { viewer } = useSession();
  const { selected } = reach;
  if (selected?.uasgs)
    return `${selected.name} (${selected.uasgs.length} ${selected.uasgs.length === 1 ? "UASG" : "UASGs"})`;
  if (viewer.allInstitutions) return "todas as instituições cadastradas";
  return viewer.institutions.length === 1
    ? `${viewer.institutions[0].name} (UASG ${viewer.institutions[0].uasg})`
    : `suas ${viewer.institutions.length} instituições`;
}
export function CatalogRefresh({
  records = false,
  reach,
  onDone,
}: {
  records?: boolean;
  reach: Reach;
  onDone: () => void;
}) {
  // Twelve months by default: units such as IFMS publish few pregões, mostly through the rectorate.
  const [values, setValues] = useState({ from: isoDay(-365), to: isoDay() }),
    [errors, setErrors] = useState<FieldErrors>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<ReachResult | null>(null);
  const label = useReachLabel(reach);
  function validate() {
    const next = validateFields({ ...values, uasg: "000001" }, "import");
    delete next.uasg;
    if (!records && values.from && values.to) {
      const days = (Date.parse(values.to) - Date.parse(values.from)) / 86400000;
      if (days + 1 > 366) next.to = "Use um intervalo de até 366 dias.";
    }
    return next;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
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
      const value = await api<ReachResult>(
        `/${records ? "public-records" : "purchases"}/sync-reach`,
        {
          method: "POST",
          body: JSON.stringify({
            ...values,
            ...(reach.uasgs ? { uasgs: reach.uasgs } : {}),
          }),
        },
      );
      setResult(value);
      onDone();
    } catch (e) {
      const fieldErrors = e instanceof ApiError ? e.fieldErrors : {};
      setErrors(fieldErrors);
      focusInvalid(fieldErrors);
      setError(
        Object.keys(fieldErrors).length
          ? validationSummary(fieldErrors)
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  const change = (k: string, v: string) =>
    setValues((old) => ({ ...old, [k]: v }));
  return (
    <FormValidation.Provider
      value={{
        errors,
        onBlur: (name) =>
          setErrors((old) => blurFieldErrors(old, validate(), name)),
      }}
    >
      <form
        className="catalog-refresh"
        onSubmit={submit}
        noValidate
        aria-label="Atualizar do Compras.gov"
      >
        <div className="catalog-refresh-intro">
          <div className="eyebrow">COMPRAS.GOV.BR</div>
          <h2>Atualizar {records ? "atas publicadas" : "pregões"}</h2>
          <p>
            Consulta {label} na fonte pública, pelo período de{" "}
            {records ? "início da vigência da ata" : "publicação da compra"}
            {records ? "" : " (até 366 dias)"}. Registros salvos antes são
            preservados.
          </p>
        </div>
        <div className="catalog-refresh-fields">
          <Field
            name="from"
            label="De"
            type="date"
            required
            value={values.from}
            onChange={change}
          />
          <Field
            name="to"
            label="Até"
            type="date"
            required
            value={values.to}
            onChange={change}
          />
          <button className="button" type="submit" disabled={busy}>
            <RefreshCw size={16} className={busy ? "spin" : ""} />
            {busy ? "Consultando…" : "Atualizar agora"}
          </button>
        </div>
        <div aria-live="polite" className="catalog-refresh-result">
          {error && <ErrorState message={error} />}
          {result && (
            <div
              className={
                result.failed ? "error-state partial" : "success-state compact"
              }
              role={result.failed ? "alert" : undefined}
            >
              <p>
                <strong>
                  {result.failed
                    ? `Atualização parcial: ${result.failed} de ${result.results.length} UASGs não responderam.`
                    : `Atualização concluída em ${result.results.length} ${result.results.length === 1 ? "UASG" : "UASGs"}.`}
                </strong>{" "}
                {result.created} novos · {result.updated} atualizados ·{" "}
                {result.total} consultados.
                {result.incomplete > 0 &&
                  ` ${result.incomplete} ${result.incomplete === 1 ? "ata veio" : "atas vieram"} sem identificador oficial na fonte e não ${result.incomplete === 1 ? "foi salva" : "foram salvas"}.`}
              </p>
              <details open={result.failed > 0}>
                <summary>Resultado por UASG</summary>
                <ul>
                  {result.results.map((row) => (
                    <li key={row.uasg} className={row.error ? "danger" : ""}>
                      <span>
                        {row.name ?? "UASG"} · {row.uasg}
                      </span>
                      <small>
                        {row.error ??
                          `${row.created} novos · ${row.updated} atualizados${row.incomplete ? ` · ${row.incomplete} sem identificador` : ""}`}
                      </small>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </div>
      </form>
    </FormValidation.Provider>
  );
}
