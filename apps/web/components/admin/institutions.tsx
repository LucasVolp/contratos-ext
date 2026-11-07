"use client";
import { useEffect, useMemo, useState } from "react";
import { CloudDownload, Pencil, Plus, Save, Search } from "lucide-react";
import { api, ApiError, validationSummary } from "@/lib/api";
import {
  ErrorState,
  Field,
  FormValidation,
  Loading,
  PageBar,
  focusInvalid,
} from "../ui";
import { AdminTabs } from "./tabs";
import { PublicImport } from "./public-import";
type Institution = {
  id: string;
  name: string;
  uasg: string;
  organization: string;
  usersCount: number;
};
type Draft = { id: string | null; name: string; uasg: string; organization: string };
export function InstitutionsAdmin() {
  const [rows, setRows] = useState<Institution[] | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [draft, setDraft] = useState<Draft | null>(null),
    [formKey, setFormKey] = useState(0),
    [message, setMessage] = useState(""),
    [filter, setFilter] = useState(""),
    [importing, setImporting] = useState(false);
  useEffect(() => {
    api<Institution[]>("/institutions")
      .then((value) => {
        setRows(value);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [reload]);
  const visible = useMemo(() => {
    const term = filter
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return (rows ?? []).filter((row) =>
      `${row.name} ${row.uasg} ${row.organization}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .includes(term),
    );
  }, [rows, filter]);
  return (
    <>
      <PageBar context={<AdminTabs />}>
        <button
          type="button"
          className="button secondary"
          aria-expanded={importing}
          onClick={() => {
            setMessage("");
            setImporting((open) => !open);
          }}
        >
          <CloudDownload size={17} />
          Adicionar do Compras.gov
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            setMessage("");
            setFormKey((n) => n + 1);
            setDraft({ id: null, name: "", uasg: "", organization: "" });
          }}
        >
          <Plus size={17} />
          Nova instituição
        </button>
      </PageBar>
      {importing && (
        <PublicImport
          onImported={(text) => {
            setMessage(text);
            setReload((n) => n + 1);
          }}
        />
      )}
      {draft && (
        <InstitutionForm
          key={formKey}
          draft={draft}
          onCancel={() => setDraft(null)}
          onSaved={(row, created) => {
            setDraft(null);
            setMessage(
              `${row.name} (UASG ${row.uasg}) ${created ? "cadastrada" : "atualizada"}.`,
            );
            setReload((n) => n + 1);
          }}
        />
      )}
      <div aria-live="polite">
        {message && (
          <div className="success-state compact">
            <p>{message}</p>
          </div>
        )}
      </div>
      <section className="registry admin-list">
        <div className="filters">
          <label className="search-field">
            <Search size={16} />
            <span className="sr-only">Filtrar instituições</span>
            <input
              type="search"
              placeholder="Filtrar por nome ou UASG"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
        </div>
        {error ? (
          <ErrorState message={error} retry={() => setReload((n) => n + 1)} />
        ) : !rows ? (
          <Loading />
        ) : !visible.length ? (
          <p className="admin-empty muted">
            {rows.length
              ? "Nenhuma instituição corresponde ao filtro."
              : "Nenhuma instituição cadastrada. Use “Nova instituição” ou rode pnpm db:seed:institutions."}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Instituição</th>
                  <th>Organização</th>
                  <th>UASG</th>
                  <th>Usuários vinculados</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>{row.organization || "—"}</td>
                    <td>{row.uasg}</td>
                    <td>{row.usersCount}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="button secondary"
                        aria-label={`Editar ${row.name}`}
                        onClick={() => {
                          setMessage("");
                          setFormKey((n) => n + 1);
            setDraft({
                            id: row.id,
                            name: row.name,
                            uasg: row.uasg,
                            organization: row.organization,
                          });
                        }}
                      >
                        <Pencil size={14} />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
function InstitutionForm({
  draft,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  onCancel: () => void;
  onSaved: (row: Institution, created: boolean) => void;
}) {
  const [values, setValues] = useState(draft),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  // The parent remounts this form per draft (key), so state starts fresh each time.
  useEffect(() => {
    document.getElementById("name")?.focus();
  }, []);
  const change = (name: string, value: string) =>
    setValues((old) => ({ ...old, [name]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const row = await api<Institution>(
        values.id ? `/institutions/${values.id}` : "/institutions",
        {
          method: values.id ? "PUT" : "POST",
          body: JSON.stringify({
            name: values.name,
            uasg: values.uasg,
            organization: values.organization,
          }),
        },
      );
      onSaved(row, !values.id);
    } catch (e) {
      const fieldErrors = e instanceof ApiError ? e.fieldErrors : {};
      setErrors(fieldErrors);
      setError(
        Object.keys(fieldErrors).length
          ? validationSummary({ ...fieldErrors })
          : (e as Error).message,
      );
      focusInvalid(fieldErrors);
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormValidation.Provider value={{ errors }}>
      <form className="admin-form" onSubmit={submit} noValidate>
        <section className="form-section">
          <div className="form-section-title">
            <span>{values.id ? "↺" : "+"}</span>
            <div>
              <h2>{values.id ? "Editar instituição" : "Nova instituição"}</h2>
              <p>
                Ex.: Instituto Federal de Mato Grosso do Sul - Campus Três
                Lagoas, UASG 158454.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <Field
              name="name"
              label="Nome da instituição"
              value={values.name}
              onChange={change}
              required
              wide
            />
            <Field
              name="organization"
              label="Organização (sigla)"
              value={values.organization}
              onChange={change}
              hint="Ex.: IFMS. Agrupa reitoria e campi para a busca padrão."
            />
            <Field
              name="uasg"
              label="UASG"
              value={values.uasg}
              onChange={change}
              required
              hint={
                values.id
                  ? "Alterar a UASG muda imediatamente o que os usuários vinculados enxergam."
                  : undefined
              }
            />
          </div>
          <div className="admin-form-actions">
            <div aria-live="polite">{error && <ErrorState message={error} />}</div>
            <div>
              <button
                type="button"
                className="button secondary"
                onClick={onCancel}
              >
                Cancelar
              </button>
              <button type="submit" className="button" disabled={busy}>
                <Save size={16} />
                {busy ? "Salvando…" : "Salvar instituição"}
              </button>
            </div>
          </div>
        </section>
      </form>
    </FormValidation.Provider>
  );
}
