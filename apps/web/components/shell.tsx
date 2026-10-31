"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Building2, LogOut, UserRound, UsersRound } from "lucide-react";
import { api } from "@/lib/api";
import { institutionLabel, SessionProvider, useSession } from "@/lib/session";
import { Loading } from "./ui";
const publishedAtas = (path: string) => path.startsWith("/atas/publicadas");
/** The procurement phases in order: dispute, registered prices, actual purchase. */
const PHASES: Array<{
  step: number;
  label: string;
  hint: string;
  href: string;
  match: (path: string) => boolean;
  children?: Array<{
    label: string;
    href: string;
    match: (path: string) => boolean;
  }>;
}> = [
  {
    step: 1,
    label: "Pregão",
    hint: "Disputa e vencedores",
    href: "/pregoes",
    match: (path) => path.startsWith("/pregoes"),
  },
  {
    step: 2,
    label: "Ata de registro de preços",
    hint: "Preços registrados por até 1 ano",
    href: "/atas/publicadas",
    match: (path) => path.startsWith("/atas"),
    children: [
      { label: "Atas publicadas", href: "/atas/publicadas", match: publishedAtas },
      {
        label: "Documentos para assinatura",
        href: "/atas",
        match: (path) => path.startsWith("/atas") && !publishedAtas(path),
      },
    ],
  },
  {
    step: 3,
    label: "Contrato",
    hint: "Compra efetiva e vigência",
    href: "/contratos",
    match: (path) => path.startsWith("/contratos"),
  },
];
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
        <Link href="/pregoes" className="brand">
          contratos<span>EXT</span>
        </Link>
        <div className="sidebar-label">COMPRAR</div>
        <nav aria-label="Fases da compra">
          <ol className="phases">
            {PHASES.map((phase) => {
              const active = phase.match(path);
              return (
                <li key={phase.href} className={active ? "active" : ""}>
                  <Link
                    href={phase.href}
                    className={`phase ${active ? "active" : ""}`}
                    aria-current={
                      active && !phase.children ? "page" : undefined
                    }
                  >
                    <span className="phase-step" aria-hidden="true">
                      {phase.step}
                    </span>
                    <span className="phase-text">
                      <span className="sr-only">Fase {phase.step}: </span>
                      <strong>{phase.label}</strong>
                      <small>{phase.hint}</small>
                    </span>
                  </Link>
                  {phase.children && (
                    <ul className="phase-links">
                      {phase.children.map((child) => {
                        const current = child.match(path);
                        return (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              className={current ? "active" : ""}
                              aria-current={current ? "page" : undefined}
                            >
                              {child.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        {manager && (
          <>
            <div className="sidebar-label">GESTÃO</div>
            <nav aria-label="Gestão">
              <Link
                className={path.startsWith("/administracao") ? "active" : ""}
                aria-current={
                  path.startsWith("/administracao") ? "page" : undefined
                }
                href="/administracao/usuarios"
              >
                <UsersRound size={17} />
                Administração
              </Link>
            </nav>
          </>
        )}
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
