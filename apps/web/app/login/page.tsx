"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LogIn, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  forgetAccount,
  rememberAccount,
  RecentAccount,
  useRecentAccounts,
  Viewer,
} from "@/lib/session";
import { ErrorState, Field, FormValidation } from "@/components/ui";
function safeNext(value: string | null) {
  // Only same-site paths: an external URL here would turn login into an open redirect.
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/contratos";
}
function LoginForm() {
  const params = useSearchParams();
  const switching = params.get("trocar") === "1";
  const [values, setValues] = useState({ email: "", password: "" }),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const recent = useRecentAccounts();
  const change = (name: string, value: string) =>
    setValues((old) => ({ ...old, [name]: value }));
  function choose(account: RecentAccount) {
    setValues({ email: account.email, password: "" });
    setErrors({});
    setError("");
    requestAnimationFrame(() => document.getElementById("password")?.focus());
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!values.email.trim()) local.email = "Informe o e-mail.";
    if (!values.password) local.password = "Informe a senha.";
    setErrors(local);
    if (Object.keys(local).length) {
      setError("");
      document.getElementById(Object.keys(local)[0])?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const viewer = await api<Viewer>("/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      rememberAccount({ email: viewer.email, name: viewer.name });
      window.location.assign(safeNext(params.get("next")));
    } catch (e) {
      setBusy(false);
      setValues((old) => ({ ...old, password: "" }));
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      setError((e as Error).message);
      document.getElementById("password")?.focus();
    }
  }
  return (
    <main id="conteudo" className="login-page">
      <section className="login-intro">
        <div className="brand">
          contratos<span>EXT</span>
        </div>
        <h1>
          {switching ? "Entre com outra conta." : "Seu arquivo de trabalho."}
        </h1>
        <p>
          Contratos, pregões e atas da sua instituição. Cada perfil vê
          somente as instituições a que está vinculado.
        </p>
      </section>
      <FormValidation.Provider value={{ errors }}>
        <form className="login-form" onSubmit={submit} noValidate>
          <div className="eyebrow">ACESSO</div>
          <h2>Entrar</h2>
          {recent.length > 0 && (
            <div className="recent-accounts">
              <span>Contas usadas neste navegador</span>
              <ul>
                {recent.map((account) => (
                  <li key={account.email}>
                    <button
                      type="button"
                      className={
                        values.email === account.email ? "selected" : ""
                      }
                      onClick={() => choose(account)}
                    >
                      <strong>{account.name}</strong>
                      <small>{account.email}</small>
                    </button>
                    <button
                      type="button"
                      className="forget"
                      aria-label={`Esquecer ${account.email} neste navegador`}
                      onClick={() => forgetAccount(account.email)}
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field
            name="email"
            label="E-mail"
            type="email"
            value={values.email}
            onChange={change}
            required
            wide
          />
          <Field
            name="password"
            label="Senha"
            type="password"
            value={values.password}
            onChange={change}
            required
            wide
          />
          <div aria-live="polite">{error && <ErrorState message={error} />}</div>
          <button type="submit" className="button" disabled={busy}>
            <LogIn size={16} />
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </FormValidation.Provider>
    </main>
  );
}
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
