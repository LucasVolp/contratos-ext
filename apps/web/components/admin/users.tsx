"use client";
import { useEffect, useMemo, useState } from "react";
import { LogIn, Pencil, Plus, Save, Search } from "lucide-react";
import { api, ApiError, validationSummary } from "@/lib/api";
import {
  Institution,
  Role,
  roleDescriptions,
  roleLabels,
  useSession,
} from "@/lib/session";
import {
  ErrorState,
  Field,
  FormValidation,
  Loading,
  PageHead,
  focusInvalid,
} from "../ui";
import { AdminTabs } from "./tabs";
type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  active: boolean;
  institutions: Institution[];
};
type Draft = {
  id: string | null;
  name: string;
  email: string;
  role: Role;
  password: string;
  active: boolean;
  institutionIds: string[];
};
const blank: Draft = {
  id: null,
  name: "",
  email: "",
  role: "USUARIO",
  password: "",
  active: true,
  institutionIds: [],
};
export function UsersAdmin() {
  const { viewer } = useSession();
  const [users, setUsers] = useState<User[] | null>(null),
    [institutions, setInstitutions] = useState<Institution[]>([]),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [draft, setDraft] = useState<Draft | null>(null),
    [formKey, setFormKey] = useState(0),
    [message, setMessage] = useState("");
  useEffect(() => {
    Promise.all([
      api<User[]>("/users"),
      api<Institution[]>("/institutions"),
    ])
      .then(([u, i]) => {
        setUsers(u);
        setInstitutions(i);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [reload]);
  async function impersonate(user: User) {
    try {
      await api(`/auth/impersonate/${user.id}`, { method: "POST" });
      window.location.assign("/contratos");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageHead
        section="Administração"
        title="Usuários"
        description="Perfis, instituições de cada pessoa e acesso para conferir o que cada conta enxerga."
      >
        <button
          type="button"
          className="button"
          onClick={() => {
            setMessage("");
            setFormKey((n) => n + 1);
            setDraft({ ...blank });
          }}
        >
          <Plus size={17} />
          Novo usuário
        </button>
      </PageHead>
      <AdminTabs />
      {draft && (
        <UserForm
          key={formKey}
          draft={draft}
          institutions={institutions}
          self={draft.id === viewer.id}
          onCancel={() => setDraft(null)}
          onSaved={(user, created) => {
            setDraft(null);
            setMessage(
              created
                ? `${user.name} foi cadastrado.`
                : `Alterações de ${user.name} salvas.`,
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
        {error ? (
          <ErrorState message={error} retry={() => setReload((n) => n + 1)} />
        ) : !users ? (
          <Loading />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nome / e-mail</th>
                  <th>Perfil</th>
                  <th>Instituições</th>
                  <th>Situação</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.active ? "" : "inactive"}>
                    <td>
                      <strong>{user.name}</strong>
                      <span className="tiny-label">{user.email}</span>
                    </td>
                    <td>{user.roleLabel}</td>
                    <td className="institution-cell">
                      {user.role === "GESTOR_GERAL"
                        ? "Todas"
                        : user.institutions.map((i) => (
                            <span key={i.id} title={i.name}>
                              {i.name} <small>UASG {i.uasg}</small>
                            </span>
                          ))}
                    </td>
                    <td>
                      <span
                        className={`status ${user.active ? "active" : "expired"}`}
                      >
                        <i />
                        {user.active ? "Ativo" : "Desativado"}
                      </span>
                    </td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="button secondary"
                        aria-label={`Editar ${user.name}`}
                        onClick={() => {
                          setMessage("");
                          setFormKey((n) => n + 1);
            setDraft({
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            role: user.role,
                            password: "",
                            active: user.active,
                            institutionIds: user.institutions.map((i) => i.id),
                          });
                        }}
                      >
                        <Pencil size={14} />
                        Editar
                      </button>
                      {user.id !== viewer.id && user.active && (
                        <button
                          type="button"
                          className="button secondary"
                          aria-label={`Entrar como ${user.name}`}
                          onClick={() => impersonate(user)}
                        >
                          <LogIn size={14} />
                          Entrar como
                        </button>
                      )}
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
function UserForm({
  draft,
  institutions,
  self,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  institutions: Institution[];
  self: boolean;
  onCancel: () => void;
  onSaved: (user: User, created: boolean) => void;
}) {
  const [values, setValues] = useState(draft),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("");
  // The parent remounts this form per draft (key), so state starts fresh each time.
  useEffect(() => {
    document.getElementById("name")?.focus();
  }, []);
  const manager = values.role === "GESTOR_GERAL";
  const visible = useMemo(() => {
    const term = filter
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return institutions.filter((i) =>
      `${i.name} ${i.uasg}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .includes(term),
    );
  }, [filter, institutions]);
  const change = (name: string, value: string) =>
    setValues((old) => ({ ...old, [name]: value }));
  function toggle(id: string) {
    setValues((old) => ({
      ...old,
      institutionIds: old.institutionIds.includes(id)
        ? old.institutionIds.filter((x) => x !== id)
        : [...old.institutionIds, id],
    }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id, password, ...rest } = values;
      const body = { ...rest, ...(password ? { password } : {}) };
      const user = await api<User>(id ? `/users/${id}` : "/users", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      onSaved(user, !id);
    } catch (e) {
      const fieldErrors = e instanceof ApiError ? e.fieldErrors : {};
      setErrors(fieldErrors);
      setError(
        Object.keys(fieldErrors).length
          ? validationSummary(fieldErrors)
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
              <h2>{values.id ? "Editar usuário" : "Novo usuário"}</h2>
              <p>{roleDescriptions[values.role]}</p>
            </div>
          </div>
          <div className="form-grid">
            <Field
              name="name"
              label="Nome"
              value={values.name}
              onChange={change}
              required
            />
            <Field
              name="email"
              label="E-mail"
              type="email"
              value={values.email}
              onChange={change}
              required
            />
            <div className="field">
              <label htmlFor="role">Perfil</label>
              <select
                id="role"
                name="role"
                value={values.role}
                aria-invalid={!!errors.role}
                onChange={(e) => change("role", e.target.value)}
              >
                {(Object.keys(roleLabels) as Role[]).map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
              {errors.role && (
                <small className="field-error" role="alert">
                  {errors.role}
                </small>
              )}
            </div>
            <Field
              name="password"
              label={values.id ? "Nova senha" : "Senha inicial"}
              type="password"
              value={values.password}
              onChange={change}
              required={!values.id}
              hint={
                values.id
                  ? "Deixe em branco para manter. Ao trocar, as sessões abertas desta conta são encerradas."
                  : "Pelo menos 8 caracteres. Repasse à pessoa por um canal seguro."
              }
            />
            {values.id && (
              <label className="checkbox wide">
                <input
                  type="checkbox"
                  checked={values.active}
                  disabled={self}
                  onChange={(e) =>
                    setValues((old) => ({ ...old, active: e.target.checked }))
                  }
                />
                Conta ativa
                {self && <small className="muted"> (não é possível desativar a própria conta)</small>}
              </label>
            )}
            <fieldset className="field wide institution-picker">
              <legend>Instituições</legend>
              {
                <>
                  <div className="search-field">
                    <Search size={15} />
                    <input
                      type="search"
                      aria-label="Filtrar instituições"
                      placeholder="Filtrar por nome ou UASG"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </div>
                  <small className="field-hint">
                    {values.institutionIds.length} selecionada(s).{" "}
                    {manager
                      ? "O gestor geral acessa todas as instituições; as marcadas definem a busca padrão, que abrange a organização inteira (ex.: Reitoria do IFMS → todo o IFMS)."
                      : "A pessoa só verá registros das UASGs marcadas."}
                  </small>
                  <ul id="institutionIds" tabIndex={-1}>
                    {visible.map((institution) => (
                      <li key={institution.id}>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={values.institutionIds.includes(
                              institution.id,
                            )}
                            onChange={() => toggle(institution.id)}
                          />
                          <span>
                            {institution.name}
                            <small>UASG {institution.uasg}</small>
                          </span>
                        </label>
                      </li>
                    ))}
                    {!visible.length && (
                      <li className="muted">Nenhuma instituição encontrada.</li>
                    )}
                  </ul>
                  {errors.institutionIds && (
                    <small className="field-error" role="alert">
                      {errors.institutionIds}
                    </small>
                  )}
                </>
              }
            </fieldset>
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
                {busy ? "Salvando…" : "Salvar usuário"}
              </button>
            </div>
          </div>
        </section>
      </form>
    </FormValidation.Provider>
  );
}
