"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function AdminTabs() {
  const path = usePathname();
  return (
    <nav className="catalog-tabs" aria-label="Administração">
      <Link
        href="/administracao/usuarios"
        aria-current={path.endsWith("/usuarios") ? "page" : undefined}
      >
        Usuários
      </Link>
      <Link
        href="/administracao/instituicoes"
        aria-current={path.endsWith("/instituicoes") ? "page" : undefined}
      >
        Instituições
      </Link>
    </nav>
  );
}
