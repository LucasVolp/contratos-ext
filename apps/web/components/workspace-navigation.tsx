"use client";
import Link from "next/link";
import {
  FileText,
  Gavel,
  Landmark,
  ScrollText,
  UsersRound,
} from "lucide-react";

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
    hint: "Preços e fornecedores",
    href: "/atas/publicadas",
    match: (path) => path.startsWith("/atas"),
    children: [
      {
        label: "Atas publicadas",
        href: "/atas/publicadas",
        match: publishedAtas,
      },
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

export function WorkspaceNavigation({
  path,
  manager,
}: {
  path: string;
  manager: boolean;
}) {
  const icons = [Gavel, ScrollText, FileText];
  return (
    <>
      <div className="sidebar-label">COMPRAR</div>
      <nav aria-label="Fases da compra">
        <ol className="phases">
          {PHASES.map((phase, index) => {
            const active = phase.match(path);
            const Icon = icons[index];
            return (
              <li key={phase.href} className={active ? "active" : ""}>
                <Link
                  href={phase.href}
                  className={`phase ${active ? "active" : ""}`}
                  aria-current={active && !phase.children ? "page" : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span className="phase-text">
                    <span className="sr-only">Fase {phase.step}: </span>
                    <strong>{phase.label}</strong>
                    <small>{phase.hint}</small>
                  </span>
                </Link>
                {phase.children && (
                  <ul className="phase-links">
                    {phase.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className={child.match(path) ? "active" : ""}
                          aria-current={child.match(path) ? "page" : undefined}
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="sidebar-label">FINANCEIRO</div>
      <nav aria-label="Consultas financeiras">
        <Link
          href="/financeiro"
          className={path.startsWith("/financeiro") ? "active" : ""}
          aria-current={path.startsWith("/financeiro") ? "page" : undefined}
        >
          <Landmark size={18} aria-hidden="true" />
          Financeiro
        </Link>
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
              <UsersRound size={18} aria-hidden="true" />
              Administração
            </Link>
          </nav>
        </>
      )}
    </>
  );
}
