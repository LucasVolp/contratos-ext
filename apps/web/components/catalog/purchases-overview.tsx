"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { compactCurrency, currency } from "@/lib/api";
import type { CatalogPage } from "@/lib/catalog-api";
type Stats = CatalogPage<unknown>["stats"];
/**
 * Phase 1 in three short readings: how many pregões, what the dispute saved over the estimate,
 * and how many register prices and therefore lead to phase 2 (atas).
 */
export function PurchasesOverview({ stats }: { stats: Stats | null }) {
  const homologated = stats?.homologated;
  const estimated = Number(homologated?.estimatedValue ?? 0),
    awarded = Number(homologated?.awardedValue ?? 0);
  const comparable = !!homologated?.count && estimated > 0;
  const gap = estimated - awarded;
  const ratio = comparable ? Math.min(awarded / estimated, 1) : 0;
  const percent = comparable ? Math.round((Math.abs(gap) / estimated) * 100) : 0;
  const over = comparable && gap < 0;
  return (
    <section className="phase-summary" aria-label="Resumo dos pregões">
      <div className="phase-summary-count">
        <strong>{stats ? stats.count.toLocaleString("pt-BR") : "—"}</strong>
        <span>{stats?.count === 1 ? "pregão" : "pregões"}</span>
      </div>
      <div className="phase-summary-savings">
        <span className="phase-summary-label">
          {over ? "Acima do estimado" : "Economia na disputa"}
        </span>
        {comparable ? (
          <>
            <p className="phase-summary-figure">
              <strong className={over ? "over" : ""}>
                {over ? "+" : "−"}
                {percent}%
              </strong>
              <span title={currency(Math.abs(gap).toFixed(2))}>
                {compactCurrency(Math.abs(gap))}{" "}
                {over ? "a mais" : "economizados"}
              </span>
            </p>
            <div
              className="phase-summary-bar"
              role="img"
              aria-label={`Estimado ${currency(homologated!.estimatedValue)}; homologado ${currency(homologated!.awardedValue)}`}
            >
              <i style={{ width: `${ratio * 100}%` }} />
            </div>
            <small>
              <span title={currency(homologated!.estimatedValue)}>
                {compactCurrency(estimated)} estimados
              </span>
              <span aria-hidden="true">→</span>
              <span title={currency(homologated!.awardedValue)}>
                {compactCurrency(awarded)} homologados
              </span>
              <span className="muted">
                · {homologated!.count} de {stats!.count}
              </span>
            </small>
          </>
        ) : (
          <p className="phase-summary-empty">
            {stats ? "Nenhum pregão homologado nesta seleção." : "—"}
          </p>
        )}
      </div>
      <div className="phase-summary-next">
        <span className="phase-summary-label">Seguem para ata</span>
        <p className="phase-summary-figure">
          <strong>{stats?.srpCount ?? "—"}</strong>
          <span>com registro de preços</span>
        </p>
        <Link href="/atas/publicadas">
          Fase 2 · Atas <ArrowRight size={13} />
        </Link>
      </div>
    </section>
  );
}
