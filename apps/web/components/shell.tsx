"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowUpRight,
  Building2,
  Files,
  FileText,
  ListChecks,
  LogOut,
  UserRound,
  UsersRound,
} from "lucide-react";
import { api } from "@/lib/api";
import { institutionLabel, SessionProvider, useSession } from "@/lib/session";
import { Loading } from "./ui";
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  // The login screen renders alone; every other page requires a confirmed session.
  if (path === "/login") return <>{children}</>;
  return (
    <SessionProvider
      fallback={
        <main id="conteudo" className="session-loading">
          <Loading />
        </main>
      }
    >
      <Workspace path={path}>{children}</Workspace>
    </SessionProvider>
  );
}
function Workspace({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}) {
  const { viewer, switchUser } = useSession();
  const manager = viewer.role === "GESTOR_GERAL";
  return (
    <>
      <a className="skip" href="#conteudo">
        Ir para o conteúdo
      </a>
      <aside className="sidebar">
        <Link href="/contratos" className="brand">
          contratos<span>EXT</span>
        </Link>
        <div className="sidebar-label">ÁREA DE TRABALHO</div>
        <nav aria-label="Navegação principal">
          <Link
            className={path.startsWith("/contratos") ? "active" : ""}
            href="/contratos"
          >
            <span className="nav-index">01</span>
            <FileText size={17} />
            Contratos
            <ArrowUpRight size={15} />
          </Link>
          <Link
            className={path.startsWith("/pregoes") ? "active" : ""}
            href="/pregoes"
          >
            <span className="nav-index">02</span>
            <ListChecks size={17} />
            Pregões
            <ArrowUpRight size={15} />
          </Link>
          <Link
            className={path.startsWith("/atas") ? "active" : ""}
            href="/atas"
          >
            <span className="nav-index">03</span>
            <Files size={17} />
            Atas & documentos
            <ArrowUpRight size={15} />
          </Link>
          {manager && (
            <Link
              className={path.startsWith("/administracao") ? "active" : ""}
              href="/administracao/usuarios"
            >
              <span className="nav-index">04</span>
              <UsersRound size={17} />
              Administração
              <ArrowUpRight size={15} />
            </Link>
          )}
        </nav>
        <section className="account" aria-label="Sua conta">
          <div className="account-name">{viewer.name}</div>
          <div className="account-role">{viewer.roleLabel}</div>
          <div className="account-scope">
            <Building2 size={13} />
            <span>
              {viewer.allInstitutions
                ? viewer.defaults
                  ? `Todas as instituições · busca padrão: ${viewer.defaults.label}`
                  : "Todas as instituições"
                : viewer.institutions.length === 1
                  ? institutionLabel(viewer.institutions[0])
                  : viewer.institutions.length
                    ? `${viewer.institutions.length} instituições`
                    : "Nenhuma instituição vinculada"}
            </span>
          </div>
          <div className="account-actions">
            <Link href="/conta">
              <UserRound size={14} />
              Minha conta
            </Link>
            <button type="button" onClick={switchUser}>
              <LogOut size={14} />
              Trocar de usuário
            </button>
          </div>
        </section>
      </aside>
      <main id="conteudo">
        {viewer.impersonator && <ImpersonationBanner />}
        {!viewer.allInstitutions && !viewer.institutions.length && (
          <div className="notice-banner" role="status">
            Sua conta ainda não está vinculada a nenhuma instituição. Peça ao
            gestor geral para vinculá-la e liberar os registros.
          </div>
        )}
        {children}
      </main>
    </>
  );
}
function ImpersonationBanner() {
  const { viewer } = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function back() {
    setBusy(true);
    try {
      await api("/auth/impersonation/stop", { method: "POST" });
      window.location.assign("/administracao/usuarios");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="impersonation-banner" role="status">
      <span>
        Você está usando a conta de <strong>{viewer.name}</strong> (
        {viewer.roleLabel}). Você vê e altera somente o que este perfil
        alcança.
        {error && <em> {error}</em>}
      </span>
      <button type="button" className="button" disabled={busy} onClick={back}>
        Voltar para {viewer.impersonator!.name}
      </button>
    </div>
  );
}
