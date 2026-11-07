"use client";
import { useState } from "react";
import { Download, Search } from "lucide-react";
import { api, ApiError, validationSummary } from "@/lib/api";
import { ErrorState, FormValidation, focusInvalid } from "../ui";
const UFS =
  "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(
    " ",
  );
type Unit = {
  uasg: string;
  name: string;
  city: string;
  uf: string;
  registered: boolean;
  organization: string | null;
};
type Organ = { document: string | null; name: string | null; units: Unit[] };
/** Finds a public body in Compras.gov (by UASG, CNPJ or name + UF) and registers its UASGs. */
export function PublicImport({ onImported }: { onImported: (message: string) => void }) {
  const [query, setQuery] = useState({ q: "", uf: "" }),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<{ organs: Organ[]; truncated: boolean } | null>(
      null,
    );
  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setErrors({});
    setResult(null);
    try {
      setResult(
        await api(`/institutions/public?${new URLSearchParams(query)}`),
      );
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
  return (
    <section className="public-import" aria-label="Adicionar do Compras.gov">
      <FormValidation.Provider value={{ errors }}>
        <form onSubmit={search} noValidate className="public-import-search">
          <div className="public-import-intro">
            <div className="eyebrow">COMPRAS.GOV.BR</div>
            <h2>Adicionar instituições de outro órgão</h2>
            <p>
              Informe uma UASG (ex.: 158349, reitoria do IFSP), o CNPJ do órgão
              ou parte do nome com a UF. Todas as UASGs ativas do órgão
              aparecem para cadastro.
            </p>
          </div>
          <div className="field">
            <label htmlFor="q">UASG, CNPJ ou nome</label>
            <input
              id="q"
              name="q"
              value={query.q}
              aria-invalid={!!errors.q}
              onChange={(e) => setQuery((old) => ({ ...old, q: e.target.value }))}
            />
            {errors.q && (
              <small className="field-error" role="alert">
                {errors.q}
              </small>
            )}
          </div>
          <div className="field">
            <label htmlFor="uf">
              UF <span>para busca por nome</span>
            </label>
            <select
              id="uf"
              name="uf"
              value={query.uf}
              aria-invalid={!!errors.uf}
              onChange={(e) => setQuery((old) => ({ ...old, uf: e.target.value }))}
            >
              <option value="">—</option>
              {UFS.map((uf) => (
                <option key={uf}>{uf}</option>
              ))}
            </select>
            {errors.uf && (
              <small className="field-error" role="alert">
                {errors.uf}
              </small>
            )}
          </div>
          <button type="submit" className="button" disabled={busy}>
            <Search size={16} />
            {busy ? "Buscando…" : "Buscar"}
          </button>
        </form>
      </FormValidation.Provider>
      <div aria-live="polite">
        {error && <ErrorState message={error} />}
        {result && !result.organs.length && (
          <p className="muted">Nenhuma UASG ativa encontrada.</p>
        )}
        {result?.organs.map((organ) => (
          <OrganCard
            key={organ.document ?? organ.units[0].uasg}
            organ={organ}
            onImported={onImported}
          />
        ))}
        {result?.truncated && (
          <p className="muted">
            Mostrando os 10 primeiros órgãos. Refine o nome para ver outros.
          </p>
        )}
      </div>
    </section>
  );
}
function OrganCard({
  organ,
  onImported,
}: {
  organ: Organ;
  onImported: (message: string) => void;
}) {
  const fresh = organ.units.filter((u) => !u.registered);
  const [selected, setSelected] = useState(() => new Set(fresh.map((u) => u.uasg))),
    [organization, setOrganization] = useState(
      organ.units.find((u) => u.organization)?.organization ?? "",
    ),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const toggle = (uasg: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(uasg)) next.delete(uasg);
      else next.add(uasg);
      return next;
    });
  async function register() {
    setBusy(true);
    setError("");
    try {
      const value = await api<{ created: number; existing: number; organization: string }>(
        "/institutions/import",
        {
          method: "POST",
          body: JSON.stringify({
            organization,
            units: organ.units
              .filter((u) => selected.has(u.uasg))
              .map(({ uasg, name }) => ({ uasg, name })),
          }),
        },
      );
      setDone(true);
      onImported(
        `${value.organization}: ${value.created} UASGs cadastradas${value.existing ? `, ${value.existing} já existiam` : ""}. Escolha “${value.organization}” na abrangência de Pregões para atualizar.`,
      );
    } catch (e) {
      const fieldErrors = e instanceof ApiError ? e.fieldErrors : {};
      setErrors(fieldErrors);
      setError(
        Object.keys(fieldErrors).length
          ? validationSummary(fieldErrors)
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="organ-card">
      <header>
        <strong>{organ.name ?? organ.units[0].name}</strong>
        <small>
          {organ.document ? `CNPJ ${organ.document} · ` : ""}
          {organ.units.length} UASGs ativas
          {organ.units.length > fresh.length &&
            ` · ${organ.units.length - fresh.length} já cadastradas`}
        </small>
      </header>
      <ul>
        {organ.units.map((unit) => (
          <li key={unit.uasg}>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={unit.registered || done}
                checked={unit.registered || selected.has(unit.uasg)}
                onChange={() => toggle(unit.uasg)}
              />
              <span>
                {unit.name}
                <small>
                  UASG {unit.uasg} · {unit.city}/{unit.uf}
                  {unit.registered && " · já cadastrada"}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {!done && fresh.length > 0 && (
        <FormValidation.Provider value={{ errors }}>
          <div className="organ-card-actions">
            <div className="field">
              <label htmlFor={`org-${organ.document}`}>Sigla da organização</label>
              <input
                id={`org-${organ.document}`}
                value={organization}
                placeholder="Ex.: IFSP"
                aria-invalid={!!errors.organization}
                onChange={(e) => setOrganization(e.target.value.toUpperCase())}
              />
              {errors.organization && (
                <small className="field-error" role="alert">
                  {errors.organization}
                </small>
              )}
            </div>
            <button
              type="button"
              className="button"
              disabled={busy || !selected.size}
              onClick={register}
            >
              <Download size={16} />
              {busy ? "Cadastrando…" : `Cadastrar ${selected.size} UASGs`}
            </button>
          </div>
          {error && <ErrorState message={error} />}
        </FormValidation.Provider>
      )}
    </article>
  );
}
