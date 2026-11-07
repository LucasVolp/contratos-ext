"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { compactCurrency, currency, PageData } from "@/lib/api";
import { SegmentBar } from "./phase-summary";
/**
 * Phase 3, execution: what matters is what is still in force and what ends within 30 days;
 * ended contracts close the cycle back to phase 1, where a new pregão starts.
 */
export function ContractsOverview({
  stats,
}: {
  stats: PageData<unknown>["stats"] | null;
}) {
  const vigency = stats?.vigency;
  const inForce = vigency ? vigency.active + vigency.expiring : 0;
  const other = vigency ? vigency.upcoming + vigency.unknown : 0;
  return (
    <section className="phase-summary" aria-label="Resumo dos contratos">
      <div className="phase-summary-count">
        <strong>{stats ? stats.count.toLocaleString("pt-BR") : "—"}</strong>
        <span>{stats?.count === 1 ? "contrato" : "contratos"}</span>
      </div>
      <div className="phase-summary-savings">
        <span className="phase-summary-label">Vencem em 30 dias</span>
        {vigency && stats!.count > 0 ? (
          <>
            <p className="phase-summary-figure">
              <strong className={vigency.expiring ? "warn" : ""}>
                {vigency.expiring.toLocaleString("pt-BR")}
              </strong>
              <span title={currency(vigency.activeValue)}>
                de {inForce.toLocaleString("pt-BR")} em vigor ·{" "}
                {compactCurrency(vigency.activeValue ?? 0)} contratados
              </span>
            </p>
            <SegmentBar
              label={`${vigency.active} em vigor, ${vigency.expiring} vencem em 30 dias, ${vigency.ended} encerrados, ${other} a iniciar ou sem data`}
              segments={[
                { value: vigency.active, tone: "done" },
                { value: vigency.expiring, tone: "warn" },
                { value: vigency.ended, tone: "off" },
                { value: other, tone: "rest" },
              ]}
            />
            <small>
              <span className="legend done">{vigency.active} em vigor</span>
              <span className="legend warn">{vigency.expiring} vencem</span>
              <span className="legend off">{vigency.ended} encerrados</span>
              {other > 0 && (
                <span className="legend rest">{other} a iniciar ou sem data</span>
              )}
            </small>
          </>
        ) : (
          <p className="phase-summary-empty">
            {stats ? "Nenhum contrato nesta seleção." : "—"}
          </p>
        )}
      </div>
      <div className="phase-summary-next">
        <span className="phase-summary-label">Encerrados</span>
        <p className="phase-summary-figure">
          <strong>{vigency?.ended.toLocaleString("pt-BR") ?? "—"}</strong>
          <span>fora de vigência</span>
        </p>
        <Link href="/pregoes">
          Novo ciclo · Fase 1 Pregão <ArrowRight size={13} />
        </Link>
      </div>
    </section>
  );
}
