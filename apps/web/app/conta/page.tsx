"use client";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { api, ApiError, validationSummary } from "@/lib/api";
import { institutionLabel, useSession } from "@/lib/session";
import {
  ErrorState,
  Field,
  FormValidation,
  PageHead,
  focusInvalid,
} from "@/components/ui";
export default function AccountPage() {
  const { viewer } = useSession();
  const [values, setValues] = useState({ currentPassword: "", newPassword: "" }),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  const change = (name: string, value: string) =>
    setValues((old) => ({ ...old, [name]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setDone(false);
    try {
      await api("/auth/password", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setValues({ currentPassword: "", newPassword: "" });
      setErrors({});
      setDone(true);
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
    <>
      <PageHead
        title={viewer.name}
        description={`${viewer.roleLabel} · ${viewer.email}`}
      />
      <div className="editor">
        <section className="form-section">
          <div className="form-section-title">
            <span>01</span>
            <div>
              <h2>Alcance</h2>
              <p>Instituições cujos registros você consulta e altera.</p>
            </div>
          </div>
          <div>
            {viewer.allInstitutions ? (
              <p>
                Como gestor geral, você acessa <strong>todas as instituições</strong>{" "}
                e administra usuários.
              </p>
            ) : viewer.institutions.length ? (
              <ul className="account-institutions">
                {viewer.institutions.map((institution) => (
                  <li key={institution.id}>{institutionLabel(institution)}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Nenhuma instituição vinculada. Peça ao gestor geral para vincular
                a sua conta.
              </p>
            )}
          </div>
        </section>
        <FormValidation.Provider value={{ errors }}>
          <form onSubmit={submit} noValidate>
            <section className="form-section">
              <div className="form-section-title">
                <span>02</span>
                <div>
                  <h2>Senha</h2>
                  <p>Ao trocar, as sessões abertas em outros navegadores são encerradas.</p>
                </div>
              </div>
              {viewer.impersonator ? (
                <p className="muted">
                  Você está usando a conta de outra pessoa. Para trocar a senha
                  dela, use Administração → Usuários.
                </p>
              ) : (
                <div className="form-grid">
                  <Field
                    name="currentPassword"
                    label="Senha atual"
                    type="password"
                    value={values.currentPassword}
                    onChange={change}
                    required
                  />
                  <Field
                    name="newPassword"
                    label="Nova senha"
                    type="password"
                    value={values.newPassword}
                    onChange={change}
                    required
                    hint="Pelo menos 8 caracteres."
                  />
                  <div className="wide" aria-live="polite">
                    {error && <ErrorState message={error} />}
                    {done && (
                      <div className="success-state compact">
                        <p>Senha alterada.</p>
                      </div>
                    )}
                  </div>
                  <div className="wide">
                    <button type="submit" className="button" disabled={busy}>
                      <KeyRound size={16} />
                      {busy ? "Salvando…" : "Alterar senha"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </form>
        </FormValidation.Provider>
      </div>
    </>
  );
}
