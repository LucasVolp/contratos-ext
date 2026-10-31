"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { compactCurrency, currency } from "@/lib/api";
import type { CatalogPage } from "@/lib/catalog-api";
import { SegmentBar } from "../phase-summary";
type Stats = CatalogPage<unknown>["stats"];
/**
 * Phase 2, official side: an ata only serves while in force, so vigency leads; the bridge counts
 * atas that already have a document being prepared for signature.
 */
export function PublishedAtasOverview({ stats }: { stats: Stats | null }) {
  const vigency = stats?.vigency;
  const steady = vigency ? vigency.active - vigency.expiring : 0;
  const other = stats && vigency ? stats.count - vigency.active - vigency.ended : 0;
  return (
    <section className="phase-summary" aria-label="Resumo das atas publicadas">
      <div className="phase-summary-count">
        <strong>{stats ? stats.count.toLocaleString("pt-BR") : "—"}</strong>
        <span>{stats?.count === 1 ? "ata" : "atas"}</span>
      </div>
      <div className="phase-summary-savings">
        {/* What needs action is what expires soon: a new pregão must be ready before then. */}
        <span className="phase-summary-label">Vencem em 90 dias</span>
        {vigency && stats!.count > 0 ? (
          <>
            <p className="phase-summary-figure">
              <strong className={vigency.expiring ? "warn" : ""}>
                {vigency.expiring.toLocaleString("pt-BR")}
              </strong>
              <span title={currency(vigency.activeValue)}>
                de {vigency.active.toLocaleString("pt-BR")}{" "}
                {vigency.active === 1 ? "vigente" : "vigentes"} ·{" "}
                {compactCurrency(vigency.activeValue ?? 0)} registrados
              </span>
            </p>
            <SegmentBar
              label={`${steady} em vigor, ${vigency.expiring} vencem em 90 dias, ${vigency.ended} encerradas`}
              segments={[
                { value: steady, tone: "done" },
                { value: vigency.expiring, tone: "warn" },
                { value: vigency.ended, tone: "off" },
                { value: other, tone: "rest" },
              ]}
            />
            <small>
              <span className="legend done">{steady} em vigor</span>
              <span className="legend warn">
                {vigency.expiring} vencem em 90 dias
              </span>
              {vigency.ended > 0 && (
                <span className="legend off">{vigency.ended} encerradas</span>
              )}
              {other > 0 && (
                <span className="legend rest">{other} a iniciar ou sem data</span>
              )}
            </small>
          </>
        ) : (
          <p className="phase-summary-empty">{stats ? "Nenhuma ata nesta seleção." : "—"}</p>
        )}
      </div>
      <div className="phase-summary-next">
        <span className="phase-summary-label">Com documento</span>
        <p className="phase-summary-figure">
          <strong>{stats?.withDocuments ?? "—"}</strong>
          <span>em preparo para assinatura</span>
        </p>
        <Link href="/atas">
          Documentos para assinatura <ArrowRight size={13} />
        </Link>
      </div>
    </section>
  );
}
