"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChevronRight, Landmark } from "lucide-react";
import { SessionProvider, useSession } from "@/lib/session";
import { Loading } from "./ui";
import { ThemePicker } from "./theme-picker";
import { WorkspaceNavigation } from "./workspace-navigation";
import { ImpersonationBanner, WorkspaceAccount } from "./workspace-account";

const sections = [
  ["/atas/publicadas", "Atas publicadas"],
  ["/atas", "Documentos para assinatura"],
  ["/contratos", "Contratos"],
  ["/pregoes", "Pregões"],
  ["/financeiro", "Financeiro"],
  ["/administracao", "Administração"],
  ["/conta", "Minha conta"],
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/login")
    return (
      <>
        <div className="login-appearance">
          <ThemePicker />
        </div>
        {children}
      </>
    );
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
  const { viewer } = useSession();
  const section =
    sections.find(([prefix]) => path.startsWith(prefix))?.[1] ||
    "Área de trabalho";
  const institution = viewer.allInstitutions
    ? "Todas as instituições"
    : viewer.institutions.length === 1
      ? viewer.institutions[0].name
      : `${viewer.institutions.length} instituições vinculadas`;
  return (
    <>
      <a className="skip" href="#conteudo">
        Ir para o conteúdo
      </a>
      <aside className="sidebar">
        <Link href="/pregoes" className="workspace-brand">
          <span className="brand-symbol">
            <Landmark size={21} aria-hidden="true" />
          </span>
          <span>
            contratos<small>EXT</small>
          </span>
        </Link>
        <div className="workspace-institution">
          <Building2 size={17} aria-hidden="true" />
          <div>
            <strong>{institution}</strong>
            <span>Área de trabalho institucional</span>
          </div>
        </div>
        <WorkspaceNavigation
          path={path}
          manager={viewer.role === "GESTOR_GERAL"}
        />
        <WorkspaceAccount />
      </aside>
      <div className="workspace-content">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb">
            <span>Área de trabalho</span>
            <ChevronRight size={13} aria-hidden="true" />
            <strong>{section}</strong>
          </div>
          <ThemePicker />
        </header>
        <main id="conteudo" tabIndex={-1}>
          {viewer.impersonator && <ImpersonationBanner />}
          {!viewer.allInstitutions && !viewer.institutions.length && (
            <div className="notice-banner" role="status">
              Sua conta ainda não está vinculada a nenhuma instituição. Peça ao
              gestor geral para vinculá-la e liberar os registros.
            </div>
          )}
          {children}
        </main>
      </div>
    </>
  );
}
