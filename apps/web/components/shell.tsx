"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Files, FileText, ListChecks } from "lucide-react";
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
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
        </nav>
        <div className="sidebar-footer">
          <span className="live-dot" /> Seu arquivo de trabalho
          <br />
          <small>CONTRACTS EXT · V1.0</small>
        </div>
      </aside>
      <main id="conteudo">{children}</main>
    </>
  );
}
