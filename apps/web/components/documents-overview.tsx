"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { compactCurrency, currency, PageData } from "@/lib/api";
import { SegmentBar } from "./phase-summary";
/**
 * Phase 2, local side: documents exist to be signed, so readiness leads; the bridge counts
 * documents already exported, the step before contracting.
 */
export function DocumentsOverview({
  stats,
}: {
  stats: PageData<unknown>["stats"] | null;
}) {
  const ready = stats?.ready ?? 0,
    pending = stats ? stats.count - ready : 0;
  return (
    <section className="phase-summary" aria-label="Resumo dos documentos">
      <div className="phase-summary-count">
        <strong>{stats ? stats.count.toLocaleString("pt-BR") : "—"}</strong>
        <span>{stats?.count === 1 ? "documento" : "documentos"}</span>
      </div>
      <div className="phase-summary-savings">
        <span className="phase-summary-label">Prontos para assinatura</span>
        {stats && stats.count > 0 ? (
          <>
            <p className="phase-summary-figure">
              <strong>
                {ready}
                <em> de {stats.count}</em>
              </strong>
              <span>
                {pending === 0
                  ? "nenhuma pendência"
                  : `${pending} com ${pending === 1 ? "pendência" : "pendências"}`}
              </span>
            </p>
            <SegmentBar
              label={`${ready} prontos, ${pending} com pendências`}
              segments={[
                { value: ready, tone: "done" },
                { value: pending, tone: "rest" },
              ]}
            />
            <small>
              <span title={currency(stats.totalValue)}>
                {compactCurrency(stats.totalValue)} em itens
              </span>
              <span className="muted">
                · {stats.exportsCount ?? 0}{" "}
                {stats.exportsCount === 1 ? "exportação" : "exportações"} no histórico
              </span>
            </small>
          </>
        ) : (
          <p className="phase-summary-empty">
            {stats ? "Nenhum documento nesta seleção." : "—"}
          </p>
        )}
      </div>
      <div className="phase-summary-next">
        <span className="phase-summary-label">Exportados</span>
        <p className="phase-summary-figure">
          <strong>{stats?.exported ?? "—"}</strong>
          <span>em Word ou PDF</span>
        </p>
        <Link href="/contratos">
          Fase 3 · Contratos <ArrowRight size={13} />
        </Link>
      </div>
    </section>
  );
}
