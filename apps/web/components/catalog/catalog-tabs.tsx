"use client";
import Link from "next/link";
export function CatalogTabs({ published = false }: { published?: boolean }) {
  return (
    <nav className="catalog-tabs" aria-label="Visões de atas">
      <Link
        href="/atas/publicadas"
        aria-current={published ? "page" : undefined}
      >
        Atas publicadas
      </Link>
      <Link href="/atas" aria-current={!published ? "page" : undefined}>
        Documentos para assinatura
      </Link>
    </nav>
  );
}
